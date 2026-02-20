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
          console.log('Attempting to get Monnify access token...');
          const monnify = this.getMonnifyClient();
          const [status, body] = await monnify.getToken();
    
          console.log('Monnify Token Response - Status:', status);
          console.log('Monnify Token Response - Body:', body);
    
          if (status === 200) {
            logger.info('Monnify access token obtained successfully');
            return body.responseBody.accessToken; 
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
    
      static async createReservedAccount(user) {
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
            nin: user.nin || "12345678901",
          };

    
          logger.info(`Creating reserved account for user: ${user.email}`, {
            accountReference,
            contractCode: process.env.MONNIFY_CONTRACT_CODE?.substring(0, 10) + '...'
          });
    
          const [status, response] = await monnify.reservedAccount.createReservedAccount(authToken, payload);
    
          console.log('Monnify Create Account Response - Status:', status);
          console.log('Monnify Create Account Response - Body:', JSON.stringify(response, null, 2));
    
          if (status === 200) {
            const accounts = response.accounts || [];
            
            if (accounts.length === 0) {
              console.warn('No accounts returned from Monnify');
            }
            
            const formattedAccounts = accounts.map((account, index) => ({
              bankName: account.bankName,
              accountNumber: account.accountNumber,
              accountName: account.accountName,
              bankCode: account.bankCode,
              isDefault: index === 0, 
            }));
    
            logger.info(`Reserved account created successfully for user: ${user.email}`, {
              userId: user._id,
              accountsCount: formattedAccounts.length,
              accountReference: response.accountReference || accountReference
            });
    
            return {
              success: true,
              accounts: formattedAccounts,
              accountReference: response.accountReference || accountReference,
              collectionChannel: response.collectionChannel,
              reservationReference: response.reservationReference,
            };
          } else {
            console.error('Monnify API returned non-200 status:', { status, response });
            throw new AppError(`Monnify API error (${status}): ${JSON.stringify(response)}`, 500);
          }
        } catch (error) {
          console.error('Monnify Create Account Error Details:', {
            message: error.message,
            stack: error.stack,
            response: error.response?.data
          });
          logger.error('Error creating reserved account:', error);
          
          if (error.message.includes('contractCode')) {
            throw new AppError('Invalid Monnify contract code. Please check your configuration.', 500);
          } else if (error.message.includes('apiKey') || error.message.includes('secret')) {
            throw new AppError('Invalid Monnify API credentials. Please check your configuration.', 500);
          }
          
          throw new AppError(`Failed to create wallet account with Monnify: ${error.message}`, 500);
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

module.exports = MonnifyService;