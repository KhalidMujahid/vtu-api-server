require("dotenv").config();
const app = require('./src/app');
const connectDB = require('./src/config/database');
const VtuProviderService = require('./src/services/vtuProviderService');
const vtuConfig = require('./src/config/vtuProviders');
const { startApiBalanceAlertWorker } = require('./src/workers/apiBalanceAlertWorker');
const { startAirtimeReconciliationWorker } = require('./src/workers/airtimeReconciliationWorker');
const { startAlrahuzDataReconciliationWorker } = require('./src/workers/alrahuzDataReconciliationWorker');
const { startVtuPollingWorker } = require('./src/workers/vtuPollingWorker');
const { runCommissionsReferralBackfill } = require('./src/scripts/backfillCommissionsReferrals');

const PORT = process.env.PORT || 5000;

connectDB().then(async () => {
  
  try {
    await VtuProviderService.initializeProviders();
    console.log('VTU Providers initialized');
  } catch (error) {
    console.warn('VTU Provider initialization skipped:', error.message);
  }

  
  try {
    console.log('Initializing VTU config...');
    await vtuConfig.initialize();
    console.log('VTU config initialized, current routing:', vtuConfig.getServiceRouting());
  } catch (error) {
    console.warn('VTU Config initialization skipped:', error.message);
  }

  const server = app.listen(PORT, () => {
    console.log(`API running on port ${PORT}`);
  });

  startApiBalanceAlertWorker();
  startAirtimeReconciliationWorker();
  startAlrahuzDataReconciliationWorker();
  startVtuPollingWorker();

  // Optional: run the one-time commission/referral backfill on startup.
  // Enable by setting RUN_BACKFILL_ON_START=true in env. Runs in the background
  // so it never blocks the HTTP server from coming up.
  if (String(process.env.RUN_BACKFILL_ON_START || '').toLowerCase() === 'true') {
    runCommissionsReferralBackfill()
      .then((summary) => {
        console.log('Startup backfill completed:', JSON.stringify(summary));
      })
      .catch((error) => {
        console.error('Startup backfill failed:', error.message);
      });
  }

  process.on('unhandledRejection', (err) => {
    console.log(`Error: ${err.message}`);
    console.log('Shutting down server due to unhandled promise rejection');
    server.close(() => {
      process.exit(1);
    });
  });
});
