const express = require('express');
const router = express.Router();
const telecomController = require('../controllers/telecomController');
const giftCardController = require('../controllers/giftCardController');
const { protect, requireTransactionPin, restrictTo } = require('../middlewares/auth');

router.use(protect);

router.get('/balance', restrictTo('admin', 'super_admin'), telecomController.getGiftCardBalance);
router.get('/categories', telecomController.getGiftCardCategories);
router.get('/countries', telecomController.getGiftCardCountries);
router.get('/countries/:countryCode', telecomController.getGiftCardCountryByCode);
router.get('/products', telecomController.getGiftCardProducts);
router.get('/countries/:countryCode/products', telecomController.getGiftCardProductsByCountry);
router.get('/products/:productId', telecomController.getGiftCardProductById);
router.get('/redeem-instructions', telecomController.getGiftCardRedeemInstructions);
router.get('/products/:productId/redeem-instructions', telecomController.getGiftCardProductRedeemInstructions);
router.get('/fx-rate', telecomController.getGiftCardFxRate);
router.get('/discounts', telecomController.getGiftCardDiscounts);
router.get('/products/:productId/discounts', telecomController.getGiftCardProductDiscount);
router.get('/transactions', telecomController.getGiftCardTransactions);
router.get('/transactions/:transactionId', telecomController.getGiftCardTransactionById);
router.get('/orders/transactions/:transactionId/cards', telecomController.getGiftCardRedeemCode);
router.post('/purchase', requireTransactionPin, telecomController.orderGiftCard);
router.get('/orders', telecomController.getGiftCardTransactions);
router.get('/orders/:orderId/cards', (req, res, next) => {
  req.params.transactionId = req.params.orderId;
  return telecomController.getGiftCardRedeemCode(req, res, next);
});

router.get('/orders/:orderId', (req, res, next) => {
  req.params.transactionId = req.params.orderId;
  return telecomController.getGiftCardTransactionById(req, res, next);
});

// Zendit remains available as a backup path.
router.get('/zendit/brands', giftCardController.getZenditBrands);
router.get('/zendit/products', giftCardController.getZenditProducts);
router.get('/zendit/products/:offerId', giftCardController.getZenditProduct);
router.post('/zendit/purchase', requireTransactionPin, giftCardController.purchaseZenditGiftCard);
router.get('/zendit/orders/:transactionId', giftCardController.getZenditPurchase);

module.exports = router;
