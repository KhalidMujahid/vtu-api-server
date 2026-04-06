const express = require('express');
const router = express.Router();
const referralController = require('../controllers/referralController');
const { protect } = require('../middlewares/auth');

router.use(protect);

router.get('/list', referralController.getReferralList);
router.post('/move-bonus', referralController.moveBonusToWallet);

module.exports = router;

