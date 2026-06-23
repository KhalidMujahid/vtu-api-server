const express = require('express');
const router = express.Router();
const flightController = require('../controllers/flightController');
const { protect, requireTransactionPin } = require('../middlewares/auth');

router.use(protect);

// ── Shared ─────────────────────────────────────────────────────────────────────
router.get('/airports', flightController.searchAirports);
router.get('/wakanow/redirect', flightController.redirectWakanowAffiliate);

// ── International Flights (Duffel) ────────────────────────────────────────────
router.post('/international/search', flightController.searchInternational);
router.get('/international/offers/:searchId', flightController.getInternationalOffers);
router.get('/international/offer/:offerId', flightController.getInternationalOffer);
router.post('/international/book', requireTransactionPin, flightController.bookInternational);
router.get('/international/bookings', flightController.listInternationalBookings);
router.get('/international/bookings/:orderId', flightController.getInternationalBooking);
router.post('/international/bookings/:orderId/cancel', flightController.cancelInternationalBooking);
router.post('/international/cancellations/:cancellationId/confirm', flightController.confirmInternationalCancellation);

// ── Domestic Flights (Tiqwa) ─────────────────────────────────────────────────
router.get('/domestic/airlines', flightController.getAirlines);
router.post('/domestic/search', flightController.searchDomestic);
router.post('/domestic/book', requireTransactionPin, flightController.bookDomestic);
router.get('/domestic/bookings/:bookingId', flightController.getDomesticBooking);
router.post('/domestic/bookings/:bookingId/cancel', flightController.cancelDomesticBooking);

module.exports = router;
