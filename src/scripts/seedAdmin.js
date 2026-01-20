require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Wallet = require('../models/Wallet');
const ProviderStatus = require('../models/ProviderStatus');
const ServicePricing = require('../models/ServicePricing');
const connectDB = require('../config/database');

const seedAdmin = async () => {
  try {
    await connectDB();
    
    console.log('Seeding admin user...');
    
    const existingAdmin = await User.findOne({ email: process.env.DEFAULT_ADMIN_EMAIL });
    
    if (existingAdmin) {
      console.log('Admin user already exists');
      process.exit(0);
    }
    
    const admin = await User.create({
      firstName: 'Admin',
      lastName: 'User',
      email: process.env.DEFAULT_ADMIN_EMAIL,
      phoneNumber: '+2348000000000',
      password: process.env.DEFAULT_ADMIN_PASSWORD,
      isEmailVerified: true,
      isPhoneVerified: true,
      role: 'super_admin',
      kycStatus: 'verified',
    });
    
    await Wallet.create({
      user: admin._id,
      balance: 1000000,
      totalFunded: 1000000,
    });
    
    console.log('Admin user created successfully');
    console.log('Email:', process.env.DEFAULT_ADMIN_EMAIL);
    console.log('Password:', process.env.DEFAULT_ADMIN_PASSWORD);
    
    console.log('Seeding telecom providers...');
    
    const telecomProviders = [
      {
        providerName: 'mtn',
        supportedServices: ['data_recharge', 'airtime_recharge', 'airtime_swap', 'sme_data', 'recharge_pin'],
        status: 'active',
        priority: 1,
        description: 'MTN Nigeria',
      },
      {
        providerName: 'airtel',
        supportedServices: ['data_recharge', 'airtime_recharge', 'airtime_swap', 'sme_data', 'recharge_pin'],
        status: 'active',
        priority: 2,
        description: 'Airtel Nigeria',
      },
      {
        providerName: 'glo',
        supportedServices: ['data_recharge', 'airtime_recharge', 'airtime_swap', 'sme_data', 'recharge_pin'],
        status: 'active',
        priority: 3,
        description: 'Glo Nigeria',
      },
      {
        providerName: '9mobile',
        supportedServices: ['data_recharge', 'airtime_recharge', 'airtime_swap', 'sme_data', 'recharge_pin'],
        status: 'active',
        priority: 4,
        description: '9mobile Nigeria',
      },
    ];
    
    await ProviderStatus.insertMany(telecomProviders);
    
    const electricityProviders = [
      {
        providerName: 'aedc',
        supportedServices: ['electricity'],
        status: 'active',
        priority: 1,
        description: 'Abuja Electricity Distribution Company',
      },
      {
        providerName: 'ikedc',
        supportedServices: ['electricity'],
        status: 'active',
        priority: 2,
        description: 'Ikeja Electricity Distribution Company',
      },
      {
        providerName: 'ekedc',
        supportedServices: ['electricity'],
        status: 'active',
        priority: 3,
        description: 'Eko Electricity Distribution Company',
      },
      {
        providerName: 'kaedco',
        supportedServices: ['electricity'],
        status: 'active',
        priority: 4,
        description: 'Kaduna Electricity Distribution Company',
      },
    ];
    
    await ProviderStatus.insertMany(electricityProviders);
    
    console.log('Seeding sample data plans...');
    
    const sampleDataPlans = [
      {
        serviceType: 'data_recharge',
        provider: 'mtn',
        network: 'mtn',
        planName: 'MTN 1GB',
        planCode: 'MTN-1GB',
        validity: '30 days',
        dataAmount: '1GB',
        costPrice: 280,
        sellingPrice: 300,
        profitMargin: 20,
        isActive: true,
        isAvailable: true,
        createdBy: admin._id,
      },
      {
        serviceType: 'data_recharge',
        provider: 'mtn',
        network: 'mtn',
        planName: 'MTN 2GB',
        planCode: 'MTN-2GB',
        validity: '30 days',
        dataAmount: '2GB',
        costPrice: 560,
        sellingPrice: 600,
        profitMargin: 40,
        isActive: true,
        isAvailable: true,
        createdBy: admin._id,
      },
      
      {
        serviceType: 'data_recharge',
        provider: 'airtel',
        network: 'airtel',
        planName: 'Airtel 1GB',
        planCode: 'AIRTEL-1GB',
        validity: '30 days',
        dataAmount: '1GB',
        costPrice: 290,
        sellingPrice: 310,
        profitMargin: 20,
        isActive: true,
        isAvailable: true,
        createdBy: admin._id,
      },
      
      {
        serviceType: 'data_recharge',
        provider: 'glo',
        network: 'glo',
        planName: 'Glo 1.8GB',
        planCode: 'GLO-1.8GB',
        validity: '30 days',
        dataAmount: '1.8GB',
        costPrice: 450,
        sellingPrice: 500,
        profitMargin: 50,
        isActive: true,
        isAvailable: true,
        createdBy: admin._id,
      },
      
      {
        serviceType: 'data_recharge',
        provider: '9mobile',
        network: '9mobile',
        planName: '9mobile 1.5GB',
        planCode: '9MOBILE-1.5GB',
        validity: '30 days',
        dataAmount: '1.5GB',
        costPrice: 420,
        sellingPrice: 450,
        profitMargin: 30,
        isActive: true,
        isAvailable: true,
        createdBy: admin._id,
      },
    ];
    
    await ServicePricing.insertMany(sampleDataPlans);
    
    console.log('Database seeded successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error seeding database:', error);
    process.exit(1);
  }
};

seedAdmin();