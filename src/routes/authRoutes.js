const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/verify-otp', authController.verifyOTP);
router.post('/resend-otp', authController.resendOTP);
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password/:token', authController.resetPassword);

const { protect } = require('../middlewares/auth');
router.use(protect);

router.post('/set-transaction-pin', authController.setTransactionPin);
router.post('/change-password', authController.changePassword);
router.get('/profile', authController.getProfile);
router.put('/profile', authController.updateProfile);

module.exports = router;