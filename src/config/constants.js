module.exports = {
  ROLES: {
    USER: 'user',
    STAFF: 'staff',
    ADMIN: 'admin',
    SUPER_ADMIN: 'super_admin',
  },

  KYC_LEVELS: {
    BASIC: 'basic',
    ADVANCED: 'advanced',
    VERIFIED: 'verified',
  },

  TRANSACTION_TYPES: {
    FUND_WALLET: 'fund_wallet',
    WALLET_TRANSFER: 'wallet_transfer',
    WITHDRAWAL: 'withdrawal',
    DATA_RECHARGE: 'data_recharge',
    AIRTIME_RECHARGE: 'airtime_recharge',
    AIRTIME_SWAP: 'airtime_swap',
    SME_DATA: 'sme_data',
    RECHARGE_PIN: 'recharge_pin',
    ELECTRICITY: 'electricity',
    CABLE_TV: 'cable_tv',
    EDUCATION_PIN: 'education_pin',
    RRR_PAYMENT: 'rrr_payment',
    BULK_SMS: 'bulk_sms',
  },

  TRANSACTION_STATUS: {
    PENDING: 'pending',
    PROCESSING: 'processing',
    SUCCESSFUL: 'successful',
    FAILED: 'failed',
    CANCELLED: 'cancelled',
    REFUNDED: 'refunded',
  },

  TELECOM_PROVIDERS: {
    MTN: 'mtn',
    AIRTEL: 'airtel',
    GLO: 'glo',
    NINE_MOBILE: '9mobile',
  },

  ELECTRICITY_DISCO: {
    AEDC: 'aedc',
    IKEDC: 'ikedc',
    EKEDC: 'ekedc',
    KAEDCO: 'kaedco',
    OTHERS: 'others',
  },

  CABLE_PROVIDERS: {
    DSTV: 'dstv',
    GOTV: 'gotv',
    STARTIMES: 'startimes',
  },

  WALLET_ACTIONS: {
    CREDIT: 'credit',
    DEBIT: 'debit',
  },

  ERROR_MESSAGES: {
    INSUFFICIENT_BALANCE: 'Insufficient wallet balance',
    TRANSACTION_PIN_INCORRECT: 'Transaction PIN is incorrect',
    USER_NOT_FOUND: 'User not found',
    SERVICE_UNAVAILABLE: 'Service temporarily unavailable',
  },
};