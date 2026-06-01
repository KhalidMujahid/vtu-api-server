const DuffelService = require('../services/duffelService');
const TiqwaService = require('../services/tiqwaService');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const { AppError } = require('../middlewares/errorHandler');
const logger = require('../utils/logger');

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function refundToWallet(transaction, reason, amount) {
  try {
    const wallet = await Wallet.findOne({ user: transaction.user });
    if (wallet) await wallet.credit(amount, reason);
  } catch (err) {
    logger.error('Flight refund failed', { ref: transaction.reference, err: err.message });
  }
}

// ─── International Flights (Duffel) ──────────────────────────────────────────

exports.searchInternational = async (req, res, next) => {
  try {
    const {
      origin, destination, departureDate, returnDate,
      adults = 1, children = 0, infants = 0,
      cabinClass = 'economy', maxConnections,
    } = req.body;

    if (!origin || !destination || !departureDate) {
      return next(new AppError('origin, destination, and departureDate are required', 400));
    }

    const result = await DuffelService.searchFlights({
      origin: String(origin).toUpperCase(),
      destination: String(destination).toUpperCase(),
      departureDate,
      returnDate,
      passengers: { adults, children, infants },
      cabinClass,
      maxConnections,
    });

    const offerRequest = result.data;
    const offers = (offerRequest?.offers || []).map(offer => ({
      id: offer.id,
      airline: offer.owner?.name,
      airlineCode: offer.owner?.iata_code,
      totalAmount: offer.total_amount,
      totalCurrency: offer.total_currency,
      baseAmount: offer.base_amount,
      taxAmount: offer.tax_amount,
      cabinClass: offer.slices?.[0]?.segments?.[0]?.cabin_class,
      stops: offer.slices?.[0]?.segments?.length - 1,
      duration: offer.slices?.[0]?.duration,
      departingAt: offer.slices?.[0]?.segments?.[0]?.departing_at,
      arrivingAt: offer.slices?.[0]?.segments?.slice(-1)[0]?.arriving_at,
      expiresAt: offer.expires_at,
      conditions: offer.conditions,
    }));

    return res.status(200).json({
      status: 'success',
      provider: 'duffel',
      data: {
        searchId: offerRequest?.id,
        totalOffers: offers.length,
        offers,
      },
    });
  } catch (error) {
    return next(error);
  }
};

exports.getInternationalOffers = async (req, res, next) => {
  try {
    const { sort = 'total_amount', limit = 50 } = req.query;
    const result = await DuffelService.listOffers(req.params.searchId, sort, limit);
    return res.status(200).json({ status: 'success', provider: 'duffel', data: result.data });
  } catch (error) {
    return next(error);
  }
};

exports.getInternationalOffer = async (req, res, next) => {
  try {
    const result = await DuffelService.getOffer(req.params.offerId);
    return res.status(200).json({ status: 'success', provider: 'duffel', data: result.data });
  } catch (error) {
    return next(error);
  }
};

exports.bookInternational = async (req, res, next) => {
  try {
    const { offerId, passengers, services = [], transactionPin } = req.body;
    const user = req.user;

    if (!offerId || !passengers || !passengers.length) {
      return next(new AppError('offerId and passengers are required', 400));
    }

    // Validate required passenger fields
    for (const p of passengers) {
      if (!p.id || !p.given_name || !p.family_name || !p.born_on || !p.gender || !p.email || !p.phone_number) {
        return next(new AppError('Each passenger needs: id, given_name, family_name, born_on, gender, email, phone_number', 400));
      }
      if (!p.title) p.title = p.gender === 'female' ? 'ms' : 'mr';
    }

    // Fetch offer to get the price in its currency
    const offerResult = await DuffelService.getOffer(offerId);
    const offer = offerResult?.data;
    if (!offer) return next(new AppError('Offer not found or expired', 404));

    const wallet = await Wallet.findOne({ user: user._id });
    if (!wallet) return next(new AppError('Wallet not found', 404));

    // chargedAmountNgn must be provided by the client (after FX conversion display)
    const chargedAmount = Number(req.body.amountNgn);
    if (!chargedAmount || chargedAmount <= 0) {
      return next(new AppError('amountNgn (NGN equivalent) is required', 400));
    }

    if (wallet.balance < chargedAmount) {
      return next(new AppError('Insufficient wallet balance', 400));
    }

    await wallet.debit(chargedAmount, `International flight: ${offerId}`);

    const reference = `FLT-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const transaction = await Transaction.create({
      reference,
      user: user._id,
      type: 'flight_booking',
      category: 'travel',
      amount: chargedAmount,
      totalAmount: chargedAmount,
      previousBalance: wallet.balance + chargedAmount,
      newBalance: wallet.balance,
      status: 'pending',
      description: `International flight booking`,
      service: {
        provider: 'duffel',
        orderId: null,
        network: `${offer.slices?.[0]?.origin?.iata_code}-${offer.slices?.[0]?.destination?.iata_code}`,
      },
      metadata: {
        offerId,
        providerAmount: offer.total_amount,
        providerCurrency: offer.total_currency,
        airline: offer.owner?.name,
        passengers: passengers.map(p => `${p.given_name} ${p.family_name}`),
      },
      statusHistory: [{ status: 'pending', note: 'Flight booking initiated', timestamp: new Date() }],
    });

    try {
      const orderResult = await DuffelService.bookFlight({ offerId, passengers, services });
      const order = orderResult?.data;
      const success = !!order?.id && !!order?.booking_reference;

      transaction.status = success ? 'successful' : 'failed';
      transaction.service.orderId = order?.id || null;
      transaction.statusHistory.push({
        status: transaction.status,
        note: success ? `Booking confirmed. Ref: ${order?.booking_reference}` : 'Booking failed',
        timestamp: new Date(),
      });
      if (success) transaction.completedAt = new Date();

      if (!success) await refundToWallet(transaction, 'Flight booking refund', chargedAmount);

      await transaction.save();

      return res.status(success ? 200 : 400).json({
        status: success ? 'success' : 'error',
        message: success ? 'Flight booked successfully' : 'Booking failed',
        data: success ? {
          reference,
          orderId: order.id,
          bookingReference: order.booking_reference,
          airline: order.owner?.name,
          totalAmount: order.total_amount,
          totalCurrency: order.total_currency,
          chargedNgn: chargedAmount,
          passengers: order.passengers,
          slices: order.slices,
          documents: order.documents,
          paymentStatus: order.payment_status,
        } : null,
      });
    } catch (error) {
      await refundToWallet(transaction, 'Flight booking refund', chargedAmount);
      transaction.status = 'failed';
      transaction.statusHistory.push({ status: 'failed', note: error.message, timestamp: new Date() });
      await transaction.save();
      return next(new AppError('Flight booking failed. Please try again.', 500));
    }
  } catch (error) {
    return next(error);
  }
};

exports.getInternationalBooking = async (req, res, next) => {
  try {
    const result = await DuffelService.getOrder(req.params.orderId);
    return res.status(200).json({ status: 'success', provider: 'duffel', data: result.data });
  } catch (error) {
    return next(error);
  }
};

exports.listInternationalBookings = async (req, res, next) => {
  try {
    const { limit = 20, offset = 0, bookingReference } = req.query;
    const result = await DuffelService.listOrders({ limit, offset, bookingReference });
    return res.status(200).json({ status: 'success', provider: 'duffel', data: result.data });
  } catch (error) {
    return next(error);
  }
};

exports.cancelInternationalBooking = async (req, res, next) => {
  try {
    const result = await DuffelService.createCancellationQuote(req.params.orderId);
    return res.status(200).json({
      status: 'success',
      message: 'Cancellation quote created. Call /confirm to proceed.',
      data: result.data,
    });
  } catch (error) {
    return next(error);
  }
};

exports.confirmInternationalCancellation = async (req, res, next) => {
  try {
    const result = await DuffelService.confirmCancellation(req.params.cancellationId);
    const cancellation = result.data;
    return res.status(200).json({
      status: 'success',
      message: 'Cancellation confirmed',
      data: {
        cancellationId: cancellation.id,
        orderId: cancellation.order_id,
        refundAmount: cancellation.refund_amount,
        refundCurrency: cancellation.refund_currency,
        refundTo: cancellation.refund_to,
        confirmedAt: cancellation.confirmed_at,
      },
    });
  } catch (error) {
    return next(error);
  }
};

// ─── Domestic Flights (Tiqwa) ─────────────────────────────────────────────────

exports.getAirlines = async (req, res, next) => {
  try {
    const data = await TiqwaService.getAirlines();
    return res.status(200).json({ status: 'success', provider: 'tiqwa', data });
  } catch (error) {
    return next(error);
  }
};

exports.searchAirports = async (req, res, next) => {
  try {
    const { q } = req.query;
    if (!q) return next(new AppError('q (search query) is required', 400));
    const data = await TiqwaService.searchAirports(q);
    return res.status(200).json({ status: 'success', provider: 'tiqwa', data });
  } catch (error) {
    return next(error);
  }
};

exports.searchDomestic = async (req, res, next) => {
  try {
    const {
      origin, destination, departureDate, returnDate,
      adults = 1, children = 0, infants = 0, cabinClass = 'economy',
    } = req.body;

    if (!origin || !destination || !departureDate) {
      return next(new AppError('origin, destination, and departureDate are required', 400));
    }

    const data = await TiqwaService.searchFlights({
      origin: String(origin).toUpperCase(),
      destination: String(destination).toUpperCase(),
      departureDate,
      returnDate,
      adults,
      children,
      infants,
      cabinClass,
    });

    return res.status(200).json({ status: 'success', provider: 'tiqwa', data });
  } catch (error) {
    return next(error);
  }
};

exports.bookDomestic = async (req, res, next) => {
  try {
    const { offerId, passengers, contactEmail, contactPhone, transactionPin } = req.body;
    const user = req.user;

    if (!offerId || !passengers?.length || !contactEmail) {
      return next(new AppError('offerId, passengers, and contactEmail are required', 400));
    }

    const wallet = await Wallet.findOne({ user: user._id });
    if (!wallet) return next(new AppError('Wallet not found', 404));

    const chargedAmount = Number(req.body.amountNgn);
    if (!chargedAmount || chargedAmount <= 0) {
      return next(new AppError('amountNgn (NGN cost) is required', 400));
    }

    if (wallet.balance < chargedAmount) {
      return next(new AppError('Insufficient wallet balance', 400));
    }

    await wallet.debit(chargedAmount, `Domestic flight: ${offerId}`);

    const reference = `DFLY-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const transaction = await Transaction.create({
      reference,
      user: user._id,
      type: 'flight_booking',
      category: 'travel',
      amount: chargedAmount,
      totalAmount: chargedAmount,
      previousBalance: wallet.balance + chargedAmount,
      newBalance: wallet.balance,
      status: 'pending',
      description: 'Domestic flight booking',
      service: { provider: 'tiqwa', orderId: null },
      metadata: { offerId, passengers: passengers.map(p => `${p.firstName} ${p.lastName}`), contactEmail },
      statusHistory: [{ status: 'pending', note: 'Domestic flight booking initiated', timestamp: new Date() }],
    });

    try {
      const apiResponse = await TiqwaService.bookFlight({ offerId, passengers, contactEmail, contactPhone });
      const bookingId = apiResponse?.data?.id || apiResponse?.bookingId || apiResponse?.id;
      const success = !!bookingId;

      transaction.status = success ? 'successful' : 'failed';
      transaction.service.orderId = bookingId || null;
      transaction.statusHistory.push({
        status: transaction.status,
        note: success ? `Booking confirmed. ID: ${bookingId}` : 'Booking failed',
        timestamp: new Date(),
      });
      if (success) transaction.completedAt = new Date();

      if (!success) await refundToWallet(transaction, 'Domestic flight refund', chargedAmount);

      await transaction.save();

      return res.status(success ? 200 : 400).json({
        status: success ? 'success' : 'error',
        message: success ? 'Domestic flight booked successfully' : 'Booking failed',
        data: success ? {
          reference,
          provider: 'tiqwa',
          bookingId,
          chargedNgn: chargedAmount,
          raw: apiResponse?.data || apiResponse,
        } : null,
      });
    } catch (error) {
      await refundToWallet(transaction, 'Domestic flight refund', chargedAmount);
      transaction.status = 'failed';
      transaction.statusHistory.push({ status: 'failed', note: error.message, timestamp: new Date() });
      await transaction.save();
      return next(new AppError('Domestic flight booking failed. Please try again.', 500));
    }
  } catch (error) {
    return next(error);
  }
};

exports.getDomesticBooking = async (req, res, next) => {
  try {
    const data = await TiqwaService.getBooking(req.params.bookingId);
    return res.status(200).json({ status: 'success', provider: 'tiqwa', data });
  } catch (error) {
    return next(error);
  }
};

exports.cancelDomesticBooking = async (req, res, next) => {
  try {
    const data = await TiqwaService.cancelBooking(req.params.bookingId);
    return res.status(200).json({ status: 'success', message: 'Booking cancelled', data });
  } catch (error) {
    return next(error);
  }
};
