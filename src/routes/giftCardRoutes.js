const express = require('express');
const router = express.Router();
const giftCardController = require('../controllers/giftCardController');
const { protect, requireTransactionPin, restrictTo } = require('../middlewares/auth');

router.use(protect);

// ── Prestmit (Primary) ────────────────────────────────────────────────────────
router.get('/balance', restrictTo('admin', 'super_admin'), giftCardController.getPrestmitBalance);
router.get('/categories', giftCardController.getCategories);
router.get('/products', giftCardController.getProducts);
router.get('/products/:productId', giftCardController.getProduct);
router.post('/purchase', requireTransactionPin, giftCardController.purchaseGiftCard);
router.get('/orders', giftCardController.listOrders);
router.get('/orders/:orderId', giftCardController.getOrder);

// ── Zendit (Backup / Secondary) ───────────────────────────────────────────────
router.get('/zendit/brands', giftCardController.getZenditBrands);
router.get('/zendit/products', giftCardController.getZenditProducts);
router.get('/zendit/products/:offerId', giftCardController.getZenditProduct);
router.post('/zendit/purchase', requireTransactionPin, giftCardController.purchaseZenditGiftCard);
router.get('/zendit/orders/:transactionId', giftCardController.getZenditPurchase);

module.exports = router;
