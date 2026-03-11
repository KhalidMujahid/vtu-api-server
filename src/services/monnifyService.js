<<<<<<< HEAD
const crypto = require('crypto');
const logger = require('../utils/logger');
const { AppError } = require('../middlewares/errorHandler');
const { MonnifyAPI } = require('monnify-nodejs-lib');

class MonnifyService {
    static getMonnifyClient() {
        const config = {
          MONNIFY_APIKEY: process.env.MONNIFY_APIKEY,
          MONNIFY_SECRET: process.env.MONNIFY_SECRET,
          env: process.env.MONNIFY_ENV || "SANDBOX"
        };
    
        if (!config.MONNIFY_APIKEY || !config.MONNIFY_SECRET) {
          throw new AppError('Monnify API credentials not configured', 500);
        }
    
        return new MonnifyAPI(config);
      }
    
      static async getAccessToken() {
        try {
          const monnify = this.getMonnifyClient();
          const [status, body] = await monnify.getToken();
    
          if (status === 200) {
            logger.info('Monnify access token obtained successfully');
            return body; 
          }
    
          throw new Error(`Token error: ${JSON.stringify(body)}`);
        } catch (error) {
          console.error('Monnify Token Error Details:', {
            message: error.message,
            stack: error.stack,
            response: error.response?.data
          });
          logger.error('Error getting Monnify access token:', error);
          throw new AppError(`Failed to authenticate with Monnify: ${error.message}`, 500);
        }
      }
    
      static async createReservedAccount(user, bvn) {
        try {
          const authToken = await this.getAccessToken();
          if (!authToken) {
            throw new AppError('Failed to get Monnify access token', 500);
          }
      
          const monnify = this.getMonnifyClient();
          
          const accountReference = `YAR-${user._id}-${Date.now()}`;
          const accountName = `${user.firstName} ${user.lastName}`.substring(0, 50);
          
          const payload = {
            accountReference: accountReference,
            accountName: accountName,
            currencyCode: process.env.MONNIFY_CURRENCY || 'NGN',
            contractCode: process.env.MONNIFY_CONTRACT_CODE,
            customerEmail: user.email,
            customerName: accountName,
            getAllAvailableBanks: true,
            bvn: bvn
          };
      
          logger.info(`Creating reserved account for user: ${user.email}`);
          
          const [status, response] = await monnify.reservedAccount.createReservedAccount(authToken, payload);
          
          if (status === 200) {
            const responseBody = response.responseBody || {};
            
            await User.findByIdAndUpdate(user._id, {
              monnifyAccountReference: responseBody.accountReference || accountReference
            });
            
            const accounts = responseBody.accounts || [];
            
            const formattedAccounts = accounts.map((account, index) => ({
              bankName: account.bankName,
              accountNumber: account.accountNumber,
              accountName: account.accountName,
              bankCode: account.bankCode,
              isDefault: index === 0,
            }));
            
            logger.info(`Reserved account created successfully for user: ${user.email}`);
            
            return {
              success: true,
              accounts: formattedAccounts,
              accountReference: responseBody.accountReference || accountReference,
              collectionChannel: responseBody.collectionChannel,
              reservationReference: responseBody.reservationReference,
            };
          } else {
            if (status === 422 && response?.responseCode === "R42") {
              logger.warn("Reserved account already exists. You need to store the accountReference during initial creation.");
              

              return {
                success: true,
                accounts: [],
                accountReference: null,
                message: "Account exists but accountReference is required to fetch details"
              };
            }
          }
        } catch (error) {
          console.error(error);
        }
      }

  static async getAccountDetails(accountReference) {
    try {
      const authToken = await this.getAccessToken();
      if (!authToken) {
        throw new AppError('Failed to get Monnify access token', 500);
      }

      const monnify = this.getMonnifyClient();
      
      const [status, response] = await monnify.reservedAccount.getReservedAccountDetails(
        authToken, 
        accountReference
      );
      
      if (status === 200) {
        return response;
      }
      
      return null;
    } catch (error) {
      logger.error('Error getting account details:', error);
      return null;
    }
  }

  static async deallocateReservedAccount(accountReference) {
    try {
      const authToken = await this.getAccessToken();
      if (!authToken) {
        throw new AppError('Failed to get Monnify access token', 500);
      }

      const monnify = this.getMonnifyClient();
      
      const [status, response] = await monnify.reservedAccount.deallocateReservedAccount(
        authToken, 
        accountReference
      );
      
      if (status === 200) {
        logger.info(`Reserved account deallocated: ${accountReference}`);
        return true;
      }
      
      return false;
    } catch (error) {
      logger.error('Error deallocating account:', error);
      return false;
    }
  }

  static verifyWebhookSignature(payload, signature) {
    try {
      const hash = crypto
        .createHmac('sha512', process.env.MONNIFY_SECRET_KEY)
        .update(JSON.stringify(payload))
        .digest('hex');
      
      return hash === signature;
    } catch (error) {
      logger.error('Error verifying webhook signature:', error);
      return false;
    }
  }

  static async getTransactionStatus(transactionReference) {
    try {
      const authToken = await this.getAccessToken();
      if (!authToken) {
        throw new AppError('Failed to get Monnify access token', 500);
      }

      const monnify = this.getMonnifyClient();
      
      const [status, response] = await monnify.transactions.getTransactionStatus(
        authToken,
        transactionReference
      );
      
      if (status === 200) {
        return response;
      }
      
      return null;
    } catch (error) {
      logger.error('Error getting transaction status:', error);
      return null;
    }
  }

  static async initiateTransfer(amount, destinationAccountNumber, destinationBankCode, narration) {
    try {
      const authToken = await this.getAccessToken();
      if (!authToken) {
        throw new AppError('Failed to get Monnify access token', 500);
      }

      const monnify = this.getMonnifyClient();
      
      const reference = `TRF-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      
      const payload = {
        amount,
        reference,
        narration: narration || 'Wallet withdrawal',
        destinationAccountNumber,
        destinationBankCode,
        currency: process.env.MONNIFY_CURRENCY || 'NGN',
        sourceAccountNumber: process.env.MONNIFY_WALLET_ACCOUNT_NUMBER,
      };

      const [status, response] = await monnify.transfers.initiateTransfer(authToken, payload);

      if (status === 200) {
        logger.info(`Transfer initiated: ${reference}, Amount: ${amount}`);
        return {
          success: true,
          reference,
          data: response,
        };
      }

      return {
        success: false,
        message: 'Transfer initiation failed',
      };
    } catch (error) {
      logger.error('Error initiating transfer:', error);
      return {
        success: false,
        message: error.message || 'Transfer initiation failed',
      };
    }
  }

  static async verifyBankAccount(accountNumber, bankCode) {
    try {
      const authToken = await this.getAccessToken();
      if (!authToken) {
        throw new AppError('Failed to get Monnify access token', 500);
      }

      const monnify = this.getMonnifyClient();
      
      const [status, response] = await monnify.transfers.validateBankAccount(
        authToken,
        accountNumber,
        bankCode
      );

      if (status === 200) {
        return {
          success: true,
          accountName: response.accountName,
          accountNumber: response.accountNumber,
          bankCode,
        };
      }

      return {
        success: false,
        message: 'Account verification failed',
      };
    } catch (error) {
      logger.error('Error verifying bank account:', error);
      return {
        success: false,
        message: error.message || 'Account verification failed',
      };
    }
  }

  static async getBanks() {
    try {
      const authToken = await this.getAccessToken();
      if (!authToken) {
        throw new AppError('Failed to get Monnify access token', 500);
      }

      const monnify = this.getMonnifyClient();
      
      const [status, response] = await monnify.banks.getBanks(authToken);
      
      if (status === 200) {
        return response;
      }
      
      return [];
    } catch (error) {
      logger.error('Error getting banks:', error);
      return [];
    }
  }
}

=======
const crypto = require('crypto');
const logger = require('../utils/logger');
const { AppError } = require('../middlewares/errorHandler');
const { MonnifyAPI } = require('monnify-nodejs-lib');

class MonnifyService {
    static getMonnifyClient() {
        const config = {
          MONNIFY_APIKEY: process.env.MONNIFY_APIKEY,
          MONNIFY_SECRET: process.env.MONNIFY_SECRET,
          env: process.env.MONNIFY_ENV || "SANDBOX"
        };
    
        if (!config.MONNIFY_APIKEY || !config.MONNIFY_SECRET) {
          throw new AppError('Monnify API credentials not configured', 500);
        }
    
        return new MonnifyAPI(config);
      }
    
      static async getAccessToken() {
        try {
          const monnify = this.getMonnifyClient();
          const [status, body] = await monnify.getToken();
    
          if (status === 200) {
            logger.info('Monnify access token obtained successfully');
            return body; 
          }
    
          throw new Error(`Token error: ${JSON.stringify(body)}`);
        } catch (error) {
          console.error('Monnify Token Error Details:', {
            message: error.message,
            stack: error.stack,
            response: error.response?.data
          });
          logger.error('Error getting Monnify access token:', error);
          throw new AppError(`Failed to authenticate with Monnify: ${error.message}`, 500);
        }
      }
    
      static async createReservedAccount(user, bvn) {
        try {
          const authToken = await this.getAccessToken();
          if (!authToken) {
            throw new AppError('Failed to get Monnify access token', 500);
          }
      
          const monnify = this.getMonnifyClient();
          
          const accountReference = `YAR-${user._id}-${Date.now()}`;
          const accountName = `${user.firstName} ${user.lastName}`.substring(0, 50);
          
          const payload = {
            accountReference: accountReference,
            accountName: accountName,
            currencyCode: process.env.MONNIFY_CURRENCY || 'NGN',
            contractCode: process.env.MONNIFY_CONTRACT_CODE,
            customerEmail: user.email,
            customerName: accountName,
            getAllAvailableBanks: true,
            bvn: bvn
          };
      
          logger.info(`Creating reserved account for user: ${user.email}`);
          
          const [status, response] = await monnify.reservedAccount.createReservedAccount(authToken, payload);
          
          if (status === 200) {
            const responseBody = response.responseBody || {};
            
            await User.findByIdAndUpdate(user._id, {
              monnifyAccountReference: responseBody.accountReference || accountReference
            });
            
            const accounts = responseBody.accounts || [];
            
            const formattedAccounts = accounts.map((account, index) => ({
              bankName: account.bankName,
              accountNumber: account.accountNumber,
              accountName: account.accountName,
              bankCode: account.bankCode,
              isDefault: index === 0,
            }));
            
            logger.info(`Reserved account created successfully for user: ${user.email}`);
            
            return {
              success: true,
              accounts: formattedAccounts,
              accountReference: responseBody.accountReference || accountReference,
              collectionChannel: responseBody.collectionChannel,
              reservationReference: responseBody.reservationReference,
            };
          } else {
            if (status === 422 && response?.responseCode === "R42") {
              logger.warn("Reserved account already exists. You need to store the accountReference during initial creation.");
              

              return {
                success: true,
                accounts: [],
                accountReference: null,
                message: "Account exists but accountReference is required to fetch details"
              };
            }
          }
        } catch (error) {
          console.error(error);
        }
      }

  static async getAccountDetails(accountReference) {
    try {
      const authToken = await this.getAccessToken();
      if (!authToken) {
        throw new AppError('Failed to get Monnify access token', 500);
      }

      const monnify = this.getMonnifyClient();
      
      const [status, response] = await monnify.reservedAccount.getReservedAccountDetails(
        authToken, 
        accountReference
      );
      
      if (status === 200) {
        return response;
      }
      
      return null;
    } catch (error) {
      logger.error('Error getting account details:', error);
      return null;
    }
  }

  static async deallocateReservedAccount(accountReference) {
    try {
      const authToken = await this.getAccessToken();
      if (!authToken) {
        throw new AppError('Failed to get Monnify access token', 500);
      }

      const monnify = this.getMonnifyClient();
      
      const [status, response] = await monnify.reservedAccount.deallocateReservedAccount(
        authToken, 
        accountReference
      );
      
      if (status === 200) {
        logger.info(`Reserved account deallocated: ${accountReference}`);
        return true;
      }
      
      return false;
    } catch (error) {
      logger.error('Error deallocating account:', error);
      return false;
    }
  }

  static verifyWebhookSignature(payload, signature) {
    try {
      const hash = crypto
        .createHmac('sha512', process.env.MONNIFY_SECRET_KEY)
        .update(JSON.stringify(payload))
        .digest('hex');
      
      return hash === signature;
    } catch (error) {
      logger.error('Error verifying webhook signature:', error);
      return false;
    }
  }

  static async getTransactionStatus(transactionReference) {
    try {
      const authToken = await this.getAccessToken();
      if (!authToken) {
        throw new AppError('Failed to get Monnify access token', 500);
      }

      const monnify = this.getMonnifyClient();
      
      const [status, response] = await monnify.transactions.getTransactionStatus(
        authToken,
        transactionReference
      );
      
      if (status === 200) {
        return response;
      }
      
      return null;
    } catch (error) {
      logger.error('Error getting transaction status:', error);
      return null;
    }
  }

  static async initiateTransfer(amount, destinationAccountNumber, destinationBankCode, narration) {
    try {
      const authToken = await this.getAccessToken();
      if (!authToken) {
        throw new AppError('Failed to get Monnify access token', 500);
      }

      const monnify = this.getMonnifyClient();
      
      const reference = `TRF-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      
      const payload = {
        amount,
        reference,
        narration: narration || 'Wallet withdrawal',
        destinationAccountNumber,
        destinationBankCode,
        currency: process.env.MONNIFY_CURRENCY || 'NGN',
        sourceAccountNumber: process.env.MONNIFY_WALLET_ACCOUNT_NUMBER,
      };

      const [status, response] = await monnify.transfers.initiateTransfer(authToken, payload);

      if (status === 200) {
        logger.info(`Transfer initiated: ${reference}, Amount: ${amount}`);
        return {
          success: true,
          reference,
          data: response,
        };
      }

      return {
        success: false,
        message: 'Transfer initiation failed',
      };
    } catch (error) {
      logger.error('Error initiating transfer:', error);
      return {
        success: false,
        message: error.message || 'Transfer initiation failed',
      };
    }
  }

  static async verifyBankAccount(accountNumber, bankCode) {
    try {
      const authToken = await this.getAccessToken();
      if (!authToken) {
        throw new AppError('Failed to get Monnify access token', 500);
      }

      const monnify = this.getMonnifyClient();
      
      const [status, response] = await monnify.transfers.validateBankAccount(
        authToken,
        accountNumber,
        bankCode
      );

      if (status === 200) {
        return {
          success: true,
          accountName: response.accountName,
          accountNumber: response.accountNumber,
          bankCode,
        };
      }

      return {
        success: false,
        message: 'Account verification failed',
      };
    } catch (error) {
      logger.error('Error verifying bank account:', error);
      return {
        success: false,
        message: error.message || 'Account verification failed',
      };
    }
  }

  static async getBanks() {
    try {
      const authToken = await this.getAccessToken();
      if (!authToken) {
        throw new AppError('Failed to get Monnify access token', 500);
      }

      const monnify = this.getMonnifyClient();
      
      const [status, response] = await monnify.banks.getBanks(authToken);
      
      if (status === 200) {
        return response;
      }
      
      return [];
    } catch (error) {
      logger.error('Error getting banks:', error);
      return [];
    }
  }
}

>>>>>>> 8afeb82 (another commit)
module.exports = MonnifyService;