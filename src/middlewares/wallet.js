const Wallet = require('../models/Wallet');
const { AppError } = require('./errorHandler');

const hasWallet = async (req, res, next) => {
  try {
    const wallet = await Wallet.findOne({ user: req.user.id });
    
    if (!wallet) {
      return res.status(404).json({
        status: 'error',
        message: 'Wallet not found. Please create a wallet first.',
        data: {
          needsWalletCreation: true,
          createWalletEndpoint: '/api/v1/wallet/create'
        }
      });
    }
    
    req.wallet = wallet;
    next();
  } catch (error) {
    next(error);
  }
};

module.exports = { hasWallet };