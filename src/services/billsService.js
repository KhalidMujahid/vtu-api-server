const axios = require('axios');
const Transaction = require('../models/Transaction');
const ProviderStatus = require('../models/ProviderStatus');
const ServicePricing = require('../models/ServicePricing');
const { AppError } = require('../middlewares/errorHandler');
const logger = require('../utils/logger');

class BillsService {
  // Mock provider configurations for bills
  static providerConfigs = {
    // Electricity Providers
    aedc: {
      name: 'AEDC',
      baseUrl: 'https://api.aedcmock.com/v1',
      endpoints: {
        verify: '/customer/verify',
        purchase: '/bill/pay',
        status: '/transaction/status',
        balance: '/account/balance',
      },
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer AEDC_MOCK_API_KEY',
      },
      timeout: 30000,
    },
    ikedc: {
      name: 'IKEDC',
      baseUrl: 'https://api.ikedcmock.com/v1',
      endpoints: {
        verify: '/customer/validate',
        purchase: '/payment/process',
        status: '/payment/status',
        balance: '/wallet/balance',
      },
      headers: {
        'Content-Type': 'application/json',
        'API-Key': 'IKEDC_MOCK_API_KEY',
        'API-Secret': 'IKEDC_MOCK_SECRET',
      },
      timeout: 35000,
    },
    ekedc: {
      name: 'EKEDC',
      baseUrl: 'https://api.ekedcmock.com/v1',
      endpoints: {
        verify: '/meter/validate',
        purchase: '/topup/process',
        status: '/topup/status',
        balance: '/account/balance',
      },
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'EKEDC_MOCK_API_KEY',
      },
      timeout: 25000,
    },
    kaedco: {
      name: 'KAEDCO',
      baseUrl: 'https://api.kaedcomock.com/v1',
      endpoints: {
        verify: '/customer/check',
        purchase: '/electricity/pay',
        status: '/transaction/check',
        balance: '/balance',
      },
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic S0FFRENPX01PQ0s6U0VDUkVU',
      },
      timeout: 40000,
    },
    
    // Cable TV Providers
    dstv: {
      name: 'DStv',
      baseUrl: 'https://api.dstvmock.com/v1',
      endpoints: {
        verify: '/subscriber/validate',
        purchase: '/subscription/renew',
        packages: '/packages/list',
        balance: '/account/balance',
      },
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer DSTV_MOCK_API_KEY',
      },
      timeout: 25000,
    },
    gotv: {
      name: 'GOtv',
      baseUrl: 'https://api.gotvmock.com/v1',
      endpoints: {
        verify: '/customer/verify',
        purchase: '/package/activate',
        packages: '/packages/available',
        balance: '/wallet/balance',
      },
      headers: {
        'Content-Type': 'application/json',
        'API-Key': 'GOTV_MOCK_API_KEY',
      },
      timeout: 20000,
    },
    startimes: {
      name: 'Startimes',
      baseUrl: 'https://api.startimesmock.com/v1',
      endpoints: {
        verify: '/smartcard/validate',
        purchase: '/bundle/activate',
        packages: '/bundles',
        balance: '/account/balance',
      },
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'STARTIMES_MOCK_API_KEY',
      },
      timeout: 30000,
    },
    
    // Education Boards
    waec: {
      name: 'WAEC',
      baseUrl: 'https://api.waecmock.com/v1',
      endpoints: {
        purchase: '/pin/generate',
        validate: '/pin/validate',
        balance: '/vendor/balance',
      },
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer WAEC_MOCK_API_KEY',
      },
      timeout: 15000,
    },
    neco: {
      name: 'NECO',
      baseUrl: 'https://api.necomock.com/v1',
      endpoints: {
        purchase: '/token/generate',
        validate: '/token/verify',
        balance: '/account/balance',
      },
      headers: {
        'Content-Type': 'application/json',
        'API-Key': 'NECO_MOCK_API_KEY',
      },
      timeout: 15000,
    },
    jamb: {
      name: 'JAMB',
      baseUrl: 'https://api.jambmock.com/v1',
      endpoints: {
        purchase: '/epin/generate',
        validate: '/epin/validate',
        balance: '/vendor/balance',
      },
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'JAMB_MOCK_API_KEY',
      },
      timeout: 20000,
    },
  };

  // Process bills transaction with provider
  static async processWithProvider(transaction, preferredProvider = null) {
    try {
      const { type, service } = transaction;
      
      // Determine which provider to use
      let providerName = preferredProvider;
      
      if (!providerName) {
        // Determine provider based on service type
        switch (type) {
          case 'electricity':
            providerName = service.disco || service.provider;
            break;
          case 'cable_tv':
            providerName = service.provider;
            break;
          case 'education_pin':
            providerName = this.getEducationProvider(service.plan);
            break;
          default:
            throw new AppError(`Unsupported bills service type: ${type}`, 400);
        }
      }
      
      if (!providerName) {
        throw new AppError('No provider specified for transaction', 400);
      }

      // Get available providers for this service type
      const availableProviders = await this.getAvailableProviders(type, providerName);
      
      if (availableProviders.length === 0) {
        throw new AppError('No available providers for this service', 503);
      }

      let lastError = null;
      
      // Try each provider in order of priority
      for (const provider of availableProviders) {
        try {
          logger.info(`Processing ${type} with provider: ${provider.providerName}`);
          
          let result;
          switch (type) {
            case 'electricity':
              result = await this.processElectricity(transaction, provider.providerName);
              break;
            case 'cable_tv':
              result = await this.processCableTV(transaction, provider.providerName);
              break;
            case 'education_pin':
              result = await this.processEducationPin(transaction, provider.providerName);
              break;
            case 'rrr_payment':
              result = await this.processRRRPayment(transaction, provider.providerName);
              break;
            default:
              throw new AppError(`Unsupported bills service type: ${type}`, 400);
          }
          
          // Update provider success stats
          await ProviderStatus.findOneAndUpdate(
            { providerName: provider.providerName },
            {
              $inc: { successfulRequests: 1, totalRequests: 1 },
              $set: { lastChecked: new Date() },
            }
          );
          
          logger.info(`Transaction ${transaction.reference} processed successfully with ${provider.providerName}`);
          return result;
          
        } catch (error) {
          lastError = error;
          logger.error(`Provider ${provider.providerName} failed:`, error.message);
          
          // Update provider failure stats
          await ProviderStatus.findOneAndUpdate(
            { providerName: provider.providerName },
            {
              $inc: { failedRequests: 1, totalRequests: 1 },
              $set: { lastChecked: new Date() },
            }
          );
          
          // Continue to next provider
          continue;
        }
      }
      
      // All providers failed
      throw new AppError(
        `All providers failed for transaction ${transaction.reference}: ${lastError?.message}`,
        503
      );
      
    } catch (error) {
      logger.error('Error in processWithProvider:', error);
      throw error;
    }
  }

  // Get available providers for a service type
  static async getAvailableProviders(serviceType, preferredProvider = null) {
    try {
      const query = {
        supportedServices: serviceType,
        status: { $in: ['active', 'degraded'] },
      };
      
      const providers = await ProviderStatus.find(query)
        .sort({ priority: 1, successRate: -1 })
        .lean();
      
      // Filter out providers in maintenance
      const availableProviders = providers.filter(provider => {
        if (provider.status === 'maintenance') return false;
        if (provider.status === 'inactive') return false;
        
        // Check maintenance window
        if (provider.maintenanceStart && provider.maintenanceEnd) {
          const now = new Date();
          if (now >= provider.maintenanceStart && now <= provider.maintenanceEnd) {
            return false;
          }
        }
        
        return true;
      });
      
      // If preferred provider is specified, prioritize it
      if (preferredProvider) {
        const preferred = availableProviders.find(p => p.providerName === preferredProvider);
        if (preferred) {
          return [
            preferred,
            ...availableProviders.filter(p => p.providerName !== preferredProvider),
          ];
        }
      }
      
      return availableProviders;
    } catch (error) {
      logger.error('Error getting available providers:', error);
      return [];
    }
  }

  // Process electricity bill payment
  static async processElectricity(transaction, providerName) {
    try {
      const { service } = transaction;
      const config = this.providerConfigs[providerName];
      
      if (!config) {
        throw new AppError(`Provider ${providerName} not configured`, 500);
      }
      
      // Generate token (for prepaid)
      const token = service.meterType === 'prepaid' 
        ? this.generateElectricityToken()
        : null;
      
      // Mock API call to provider
      const mockResponse = {
        success: true,
        message: 'Electricity bill payment successful',
        data: {
          transactionId: `ELEC-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
          meterNumber: service.meterNumber,
          disco: service.disco.toUpperCase(),
          customerName: service.customerName || 'JOHN DOE',
          amount: transaction.amount,
          token: token,
          units: token ? this.calculateUnits(transaction.amount) : null,
          date: new Date().toISOString(),
          reference: `ELEC-REF-${Date.now()}`,
          receiptNumber: `REC${Date.now()}${Math.floor(Math.random() * 1000)}`,
        },
        provider: providerName,
      };
      
      // Simulate API delay
      await this.simulateDelay(2000, 6000);
      
      // Simulate occasional failure (15% chance for testing - electricity can be unreliable)
      if (Math.random() < 0.15) {
        throw new AppError(`Provider ${providerName} electricity service temporarily unavailable`, 503);
      }
      
      logger.info(`Electricity payment successful: Meter ${service.meterNumber}, Amount: ${transaction.amount}, Provider: ${providerName}`);
      return mockResponse;
      
    } catch (error) {
      logger.error('Error in processElectricity:', error);
      throw error;
    }
  }

  // Process cable TV subscription
  static async processCableTV(transaction, providerName) {
    try {
      const { service, metadata } = transaction;
      const config = this.providerConfigs[providerName];
      
      if (!config) {
        throw new AppError(`Provider ${providerName} not configured`, 500);
      }
      
      // Mock API call to provider
      const mockResponse = {
        success: true,
        message: 'Cable TV subscription successful',
        data: {
          transactionId: `CABLE-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
          smartCardNumber: service.smartCardNumber,
          provider: service.provider.toUpperCase(),
          package: service.package,
          months: metadata.months || 1,
          amount: transaction.amount,
          startDate: new Date().toISOString(),
          endDate: new Date(Date.now() + (metadata.months || 1) * 30 * 24 * 60 * 60 * 1000).toISOString(),
          date: new Date().toISOString(),
          reference: `CABLE-REF-${Date.now()}`,
          confirmationCode: `SUB${Date.now()}${Math.floor(Math.random() * 1000)}`,
        },
        provider: providerName,
      };
      
      // Simulate API delay
      await this.simulateDelay(1500, 4000);
      
      // Simulate occasional failure (10% chance for testing)
      if (Math.random() < 0.10) {
        throw new AppError(`Provider ${providerName} cable TV service temporarily unavailable`, 503);
      }
      
      logger.info(`Cable TV subscription successful: SmartCard ${service.smartCardNumber}, Package: ${service.package}, Provider: ${providerName}`);
      return mockResponse;
      
    } catch (error) {
      logger.error('Error in processCableTV:', error);
      throw error;
    }
  }

  // Process education PIN purchase
  static async processEducationPin(transaction, providerName) {
    try {
      const { service, metadata } = transaction;
      const config = this.providerConfigs[providerName];
      
      if (!config) {
        throw new AppError(`Provider ${providerName} not configured`, 500);
      }
      
      // Generate mock PINs based on exam type
      const pins = [];
      for (let i = 0; i < metadata.quantity; i++) {
        pins.push({
          pin: this.generateEducationPin(service.plan),
          serial: `${service.plan.substring(0, 3)}${Date.now()}${i}`.substring(0, 12),
          examType: service.plan,
          expiry: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString(), // 6 months
        });
      }
      
      // Mock API call to provider
      const mockResponse = {
        success: true,
        message: 'Education PINs generated successfully',
        data: {
          transactionId: `EDU-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
          examType: service.plan,
          quantity: metadata.quantity,
          pins: pins,
          date: new Date().toISOString(),
          reference: `EDU-REF-${Date.now()}`,
        },
        provider: providerName,
      };
      
      // Simulate API delay
      await this.simulateDelay(1000, 3000);
      
      // Simulate occasional failure (5% chance for testing)
      if (Math.random() < 0.05) {
        throw new AppError(`Provider ${providerName} education PIN service temporarily unavailable`, 503);
      }
      
      logger.info(`Education PINs generated: ${service.plan}, Quantity: ${metadata.quantity}, Provider: ${providerName}`);
      return mockResponse;
      
    } catch (error) {
      logger.error('Error in processEducationPin:', error);
      throw error;
    }
  }

  // Process RRR (Remita) payment
  static async processRRRPayment(transaction, providerName = 'remita') {
    try {
      const { service } = transaction;
      
      // Mock API call to Remita
      const mockResponse = {
        success: true,
        message: 'RRR payment successful',
        data: {
          transactionId: `RRR-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
          rrr: service.rrrNumber,
          payerName: service.payerName || 'JOHN DOE',
          amount: transaction.amount,
          department: service.department || 'Federal Inland Revenue Service',
          description: service.description || 'Tax Payment',
          date: new Date().toISOString(),
          reference: `RRR-REF-${Date.now()}`,
          receiptNumber: `RRR${Date.now()}${Math.floor(Math.random() * 1000)}`,
          status: 'PAID',
        },
        provider: 'remita',
      };
      
      // Simulate API delay
      await this.simulateDelay(3000, 8000); // RRR payments can take longer
      
      // Simulate occasional failure (20% chance for testing - government payments can be unreliable)
      if (Math.random() < 0.20) {
        throw new AppError('Remita RRR payment service temporarily unavailable', 503);
      }
      
      logger.info(`RRR payment successful: RRR ${service.rrrNumber}, Amount: ${transaction.amount}`);
      return mockResponse;
      
    } catch (error) {
      logger.error('Error in processRRRPayment:', error);
      throw error;
    }
  }

  // Verify electricity customer
  static async verifyElectricityCustomer(meterNumber, disco, meterType = 'prepaid') {
    try {
      const config = this.providerConfigs[disco];
      
      if (!config) {
        throw new AppError(`DISCO ${disco} not configured`, 500);
      }
      
      // Mock verification response
      const mockResponse = {
        success: true,
        data: {
          meterNumber,
          disco: disco.toUpperCase(),
          customerName: 'JOHN DOE',
          customerAddress: '123 TEST STREET, ABUJA',
          tariff: meterType === 'prepaid' ? 'R2S' : 'A1',
          meterType,
          minimumAmount: 500,
          maximumAmount: 100000,
          outstandingBalance: meterType === 'postpaid' ? Math.floor(Math.random() * 5000) : 0,
          lastPayment: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        },
        provider: disco,
      };
      
      // Simulate API delay
      await this.simulateDelay(1000, 4000);
      
      // Simulate occasional failure (8% chance)
      if (Math.random() < 0.08) {
        throw new AppError(`Provider ${disco} verification service temporarily unavailable`, 503);
      }
      
      return mockResponse;
      
    } catch (error) {
      logger.error('Error in verifyElectricityCustomer:', error);
      throw error;
    }
  }

  // Verify cable TV customer
  static async verifyCableCustomer(smartCardNumber, provider) {
    try {
      const config = this.providerConfigs[provider];
      
      if (!config) {
        throw new AppError(`Provider ${provider} not configured`, 500);
      }
      
      // Mock verification response
      const mockResponse = {
        success: true,
        data: {
          smartCardNumber,
          provider: provider.toUpperCase(),
          customerName: 'JANE DOE',
          currentPackage: 'DStv Compact',
          expiryDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          status: 'ACTIVE',
          outstandingBalance: 0,
        },
        provider,
      };
      
      // Simulate API delay
      await this.simulateDelay(800, 2500);
      
      // Simulate occasional failure (5% chance)
      if (Math.random() < 0.05) {
        throw new AppError(`Provider ${provider} verification service temporarily unavailable`, 503);
      }
      
      return mockResponse;
      
    } catch (error) {
      logger.error('Error in verifyCableCustomer:', error);
      throw error;
    }
  }

  // Get education provider based on exam type
  static getEducationProvider(examType) {
    const examProviders = {
      'WAEC': 'waec',
      'NECO': 'neco',
      'NABTEB': 'neco', // Using NECO as fallback
      'JAMB': 'jamb',
      'WAEC_RESULT': 'waec',
      'NECO_RESULT': 'neco',
    };
    
    return examProviders[examType] || 'waec'; // Default to WAEC
  }

  // Generate electricity token
  static generateElectricityToken() {
    const token = Math.floor(1000000000000000 + Math.random() * 9000000000000000).toString();
    // Format as 20-digit token with dashes every 4 digits
    return token.substring(0, 20).replace(/(\d{4})(?=\d)/g, '$1-');
  }

  // Generate education PIN
  static generateEducationPin(examType) {
    const prefix = {
      'WAEC': 'WAEC',
      'NECO': 'NECO',
      'NABTEB': 'NABT',
      'JAMB': 'JAMB',
      'WAEC_RESULT': 'WRSC',
      'NECO_RESULT': 'NRSC',
    }[examType] || 'EXAM';
    
    const random = Math.floor(100000000 + Math.random() * 900000000).toString();
    return `${prefix}${random}`.substring(0, 12);
  }

  // Calculate electricity units from amount
  static calculateUnits(amount) {
    // Simplified calculation: NGN 50 per unit
    const units = amount / 50;
    return parseFloat(units.toFixed(2));
  }

  // Check transaction status with provider
  static async checkTransactionStatus(reference, providerName) {
    try {
      const config = this.providerConfigs[providerName];
      
      if (!config) {
        throw new AppError(`Provider ${providerName} not configured`, 500);
      }
      
      // Mock status response
      const statuses = ['PENDING', 'SUCCESSFUL', 'FAILED', 'PROCESSING'];
      const randomStatus = statuses[Math.floor(Math.random() * statuses.length)];
      
      const mockResponse = {
        success: true,
        data: {
          reference,
          provider: providerName,
          status: randomStatus,
          statusMessage: randomStatus === 'SUCCESSFUL' ? 'Transaction completed successfully' :
                         randomStatus === 'FAILED' ? 'Transaction failed' :
                         randomStatus === 'PROCESSING' ? 'Transaction is being processed' :
                         'Transaction is pending',
          amount: Math.floor(Math.random() * 10000) + 1000,
          date: new Date().toISOString(),
          providerReference: `PROV-REF-${reference}`,
        },
      };
      
      // Simulate API delay
      await this.simulateDelay(500, 1500);
      
      return mockResponse;
      
    } catch (error) {
      logger.error('Error in checkTransactionStatus:', error);
      throw error;
    }
  }

  // Get provider balance
  static async getProviderBalance(providerName) {
    try {
      const config = this.providerConfigs[providerName];
      
      if (!config) {
        throw new AppError(`Provider ${providerName} not configured`, 500);
      }
      
      // Mock balance response
      const mockResponse = {
        success: true,
        data: {
          provider: providerName,
          balance: Math.floor(Math.random() * 5000000), // Random balance
          currency: 'NGN',
          lastUpdated: new Date().toISOString(),
          status: 'active',
          creditLimit: 10000000,
          availableCredit: Math.floor(Math.random() * 10000000),
        },
      };
      
      // Simulate API delay
      await this.simulateDelay(300, 1000);
      
      return mockResponse;
      
    } catch (error) {
      logger.error('Error in getProviderBalance:', error);
      throw error;
    }
  }

  // Check provider status
  static async checkProviderStatus(providerName) {
    try {
      const config = this.providerConfigs[providerName];
      
      if (!config) {
        return {
          provider: providerName,
          status: 'inactive',
          message: 'Provider not configured',
          lastChecked: new Date().toISOString(),
        };
      }
      
      // Mock status check
      const statuses = ['active', 'degraded', 'maintenance'];
      const randomStatus = statuses[Math.floor(Math.random() * statuses.length)];
      
      const mockResponse = {
        provider: providerName,
        status: randomStatus,
        message: randomStatus === 'active' ? 'Service is operational' : 
                 randomStatus === 'degraded' ? 'Service experiencing delays' : 
                 'Service under maintenance',
        responseTime: Math.floor(Math.random() * 800) + 100,
        lastChecked: new Date().toISOString(),
      };
      
      // Simulate API delay
      await this.simulateDelay(300, 1000);
      
      // Update provider status in database
      await ProviderStatus.findOneAndUpdate(
        { providerName },
        {
          $set: {
            status: mockResponse.status,
            lastChecked: new Date(),
            averageResponseTime: mockResponse.responseTime,
          },
        },
        { upsert: true, new: true }
      );
      
      return mockResponse;
      
    } catch (error) {
      logger.error('Error in checkProviderStatus:', error);
      
      // Update provider as inactive on error
      await ProviderStatus.findOneAndUpdate(
        { providerName },
        {
          $set: {
            status: 'inactive',
            lastChecked: new Date(),
          },
        },
        { upsert: true }
      );
      
      return {
        provider: providerName,
        status: 'inactive',
        message: 'Error checking provider status',
        lastChecked: new Date().toISOString(),
      };
    }
  }

  // Simulate API delay
  static simulateDelay(min, max) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise(resolve => setTimeout(resolve, delay));
  }

  // Retry failed transaction with fallback provider
  static async retryFailedTransaction(transactionId, retryCount = 0) {
    try {
      const transaction = await Transaction.findById(transactionId);
      
      if (!transaction) {
        throw new AppError('Transaction not found', 404);
      }
      
      if (transaction.status !== 'failed') {
        throw new AppError('Transaction is not in failed state', 400);
      }
      
      if (retryCount >= transaction.maxRetries) {
        throw new AppError('Max retry attempts reached', 400);
      }
      
      // Get next provider to try
      const currentProvider = transaction.provider?.name;
      const availableProviders = await this.getAvailableProviders(transaction.type, currentProvider);
      
      // Exclude already tried providers
      const triedProviders = transaction.metadata?.triedProviders || [];
      const nextProvider = availableProviders.find(p => !triedProviders.includes(p.providerName));
      
      if (!nextProvider) {
        throw new AppError('No more providers to try', 503);
      }
      
      // Update transaction with retry info
      transaction.retryCount += 1;
      transaction.provider = {
        name: nextProvider.providerName,
        alternate: currentProvider,
      };
      
      if (!transaction.metadata) transaction.metadata = {};
      if (!transaction.metadata.triedProviders) transaction.metadata.triedProviders = [];
      transaction.metadata.triedProviders.push(nextProvider.providerName);
      transaction.nextRetry = null;
      
      await transaction.save();
      
      // Retry the transaction
      const result = await this.processWithProvider(transaction, nextProvider.providerName);
      
      return {
        transaction,
        result,
        retryCount: transaction.retryCount,
      };
      
    } catch (error) {
      logger.error('Error in retryFailedTransaction:', error);
      throw error;
    }
  }

  // Bulk verify customers
  static async bulkVerifyCustomers(verifications, providerName) {
    try {
      const results = [];
      const failed = [];
      
      for (const verification of verifications) {
        try {
          let result;
          if (verification.type === 'electricity') {
            result = await this.verifyElectricityCustomer(
              verification.meterNumber,
              verification.disco,
              verification.meterType
            );
          } else if (verification.type === 'cable') {
            result = await this.verifyCableCustomer(
              verification.smartCardNumber,
              verification.provider
            );
          } else {
            throw new AppError(`Unsupported verification type: ${verification.type}`, 400);
          }
          
          results.push({
            type: verification.type,
            identifier: verification.type === 'electricity' ? verification.meterNumber : verification.smartCardNumber,
            status: 'success',
            result,
          });
        } catch (error) {
          failed.push({
            type: verification.type,
            identifier: verification.type === 'electricity' ? verification.meterNumber : verification.smartCardNumber,
            status: 'failed',
            error: error.message,
          });
        }
      }
      
      return {
        total: verifications.length,
        successful: results.length,
        failed: failed.length,
        results,
        failedVerifications: failed,
      };
      
    } catch (error) {
      logger.error('Error in bulkVerifyCustomers:', error);
      throw error;
    }
  }

  // Validate RRR number
  static async validateRRR(rrrNumber) {
    try {
      // Mock RRR validation
      const mockResponse = {
        success: true,
        data: {
          rrr: rrrNumber,
          payerName: 'FEDERAL GOVERNMENT OF NIGERIA',
          amount: Math.floor(Math.random() * 50000) + 1000,
          description: 'Company Income Tax - 2024',
          department: 'Federal Inland Revenue Service',
          invoiceNumber: `INV${Date.now()}${Math.floor(Math.random() * 1000)}`,
          dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          status: 'UNPAID',
        },
      };
      
      // Simulate API delay
      await this.simulateDelay(1500, 5000);
      
      // Simulate occasional failure (10% chance)
      if (Math.random() < 0.10) {
        throw new AppError('RRR validation service temporarily unavailable', 503);
      }
      
      return mockResponse;
      
    } catch (error) {
      logger.error('Error in validateRRR:', error);
      throw error;
    }
  }
}

module.exports = BillsService;