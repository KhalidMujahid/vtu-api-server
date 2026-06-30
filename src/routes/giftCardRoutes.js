const express = require('express');
const router = express.Router();
const giftCardController = require('../controllers/giftCardController');
const { protect, requireTransactionPin } = require('../middlewares/auth');

router.use(protect);

router.get('/catalog', giftCardController.getCatalog);
router.get('/catalog/:id', giftCardController.getCatalogProduct);
router.post('/quote', giftCardController.getGiftCardQuote);

router.get('/orders', giftCardController.getOrders);
router.post('/orders', giftCardController.createOrder);
router.post('/buy', requireTransactionPin, giftCardController.buyGiftCard);
router.get('/orders/:id', giftCardController.getOrder);
router.post('/orders/:id/purchase', requireTransactionPin, giftCardController.purchaseOrder);
router.get('/orders/:id/code', giftCardController.getOrderCode);

module.exports = router;
