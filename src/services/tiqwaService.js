const axios = require('axios');
const logger = require('../utils/logger');
const { AppError } = require('../middlewares/errorHandler');

// Tiqwa — Africa-focused travel API (domestic + regional Nigerian flights)
// Docs: https://docs.tiqwa.com  |  Sandbox: https://sandbox.tiqwa.com/v1
// NOTE: Update field names below if they differ after verifying with your sandbox credentials.
class TiqwaService {
  static config = {
    baseUrl: process.env.TIQWA_BASE_URL || 'https://sandbox.tiqwa.com/v1',
    apiKey: process.env.TIQWA_API_KEY || '',
    timeout: 60000,
  };

  static async request(method, path, data = null, params = null) {
    if (!this.config.apiKey) {
      throw new AppError('Tiqwa API key is not configured', 500);
    }
    try {
      const response = await axios({
        method,
        url: `${this.config.baseUrl}${path}`,
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        data: data || undefined,
        params,
        timeout: this.config.timeout,
      });
      return response.data;
    } catch (error) {
      const errMsg =
        error.response?.data?.message ||
        error.response?.data?.error ||
        error.message;
      logger.error('Tiqwa API error', { path, message: errMsg, response: error.response?.data });
      throw new AppError(`Tiqwa error: ${errMsg}`, error.response?.status || 500);
    }
  }

  // List supported airlines
  static async getAirlines() {
    return this.request('GET', '/airlines');
  }

  // Search airports by keyword (IATA code or city name)
  static async searchAirports(query) {
    return this.request('GET', '/airports', null, { q: query });
  }

  // Search domestic/regional flights
  // origin/destination: IATA airport codes (e.g. LOS, ABV, KAN)
  static async searchFlights({ origin, destination, departureDate, returnDate, adults = 1, children = 0, infants = 0, cabinClass = 'economy' }) {
    const payload = {
      origin,
      destination,
      departure_date: departureDate,
      adults: Number(adults),
      children: Number(children),
      infants: Number(infants),
      cabin_class: cabinClass,
      trip_type: returnDate ? 'round_trip' : 'one_way',
    };
    if (returnDate) payload.return_date = returnDate;
    return this.request('POST', '/flights/search', payload);
  }

  // Get fare details / availability for a specific offer key
  static async getFlight(offerId) {
    return this.request('GET', `/flights/${offerId}`);
  }

  // Book a domestic flight
  static async bookFlight({ offerId, passengers, contactEmail, contactPhone }) {
    return this.request('POST', '/flights/orders', {
      offer_id: offerId,
      passengers,
      contact: { email: contactEmail, phone: contactPhone },
    });
  }

  // Get booking details
  static async getBooking(bookingId) {
    return this.request('GET', `/flights/orders/${bookingId}`);
  }

  // List bookings
  static async listBookings({ page = 1, limit = 20 } = {}) {
    return this.request('GET', '/flights/orders', null, { page, limit });
  }

  // Cancel a booking
  static async cancelBooking(bookingId) {
    return this.request('POST', `/flights/orders/${bookingId}/cancel`, {});
  }
}

module.exports = TiqwaService;
