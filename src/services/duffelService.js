const axios = require('axios');
const logger = require('../utils/logger');
const { AppError } = require('../middlewares/errorHandler');

class DuffelService {
  static config = {
    baseUrl: process.env.DUFFEL_BASE_URL || 'https://api.duffel.com',
    accessToken: process.env.DUFFEL_ACCESS_TOKEN || '',
    version: 'v2',
    timeout: 60000,
  };

  static get headers() {
    return {
      Authorization: `Bearer ${this.config.accessToken}`,
      'Duffel-Version': this.config.version,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  static async request(method, path, data = null, params = null) {
    if (!this.config.accessToken) {
      throw new AppError('Duffel access token is not configured', 500);
    }
    try {
      const response = await axios({
        method,
        url: `${this.config.baseUrl}${path}`,
        headers: this.headers,
        data: data !== null ? { data } : undefined,
        params,
        timeout: this.config.timeout,
      });
      return response.data;
    } catch (error) {
      const errMsg =
        error.response?.data?.errors?.[0]?.message ||
        error.response?.data?.errors?.[0]?.title ||
        error.message;
      logger.error('Duffel API error', { path, message: errMsg, response: error.response?.data });
      throw new AppError(`Duffel error: ${errMsg}`, error.response?.status || 500);
    }
  }

  // Search international flights — returns offer_request with embedded offers
  static async searchFlights({ origin, destination, departureDate, returnDate, passengers, cabinClass, maxConnections }) {
    const slices = [{ origin, destination, departure_date: departureDate }];
    if (returnDate) {
      slices.push({ origin: destination, destination: origin, departure_date: returnDate });
    }

    const passengerList = [];
    const adults = Number(passengers?.adults ?? 1);
    const children = Number(passengers?.children ?? 0);
    const infants = Number(passengers?.infants ?? 0);
    for (let i = 0; i < adults; i++) passengerList.push({ type: 'adult' });
    for (let i = 0; i < children; i++) passengerList.push({ type: 'child' });
    for (let i = 0; i < infants; i++) passengerList.push({ type: 'infant_without_seat' });

    return this.request('POST', '/air/offer_requests', {
      slices,
      passengers: passengerList,
      cabin_class: cabinClass || 'economy',
      max_connections: maxConnections !== undefined ? Number(maxConnections) : 1,
      return_offers: true,
    });
  }

  // Get a single offer (refreshes price + availability)
  static async getOffer(offerId) {
    return this.request('GET', `/air/offers/${offerId}`, null, { return_available_services: true });
  }

  // List all offers for a search (paginated)
  static async listOffers(offerRequestId, sort = 'total_amount', limit = 50) {
    return this.request('GET', '/air/offers', null, {
      offer_request_id: offerRequestId,
      sort,
      limit,
    });
  }

  // Book a flight (creates an order, debits Duffel balance)
  static async bookFlight({ offerId, passengers, services = [] }) {
    return this.request('POST', '/air/orders', {
      type: 'instant',
      selected_offers: [offerId],
      passengers,
      payment: { type: 'balance' },
      services,
    });
  }

  // Get order details
  static async getOrder(orderId) {
    return this.request('GET', `/air/orders/${orderId}`);
  }

  // List orders with optional filters
  static async listOrders({ limit = 20, offset = 0, bookingReference } = {}) {
    const params = { limit, offset };
    if (bookingReference) params.booking_reference = bookingReference;
    return this.request('GET', '/air/orders', null, params);
  }

  // Get a refund quote before cancelling
  static async createCancellationQuote(orderId) {
    return this.request('POST', '/air/order_cancellations', { order_id: orderId });
  }

  // Confirm a cancellation (executes the refund)
  static async confirmCancellation(cancellationId) {
    return this.request('POST', `/air/order_cancellations/${cancellationId}/actions/confirm`, {});
  }

  // Get a cancellation record
  static async getCancellation(cancellationId) {
    return this.request('GET', `/air/order_cancellations/${cancellationId}`);
  }
}

module.exports = DuffelService;
