require("dotenv").config();
const app = require('./src/app');
const connectDB = require('./src/config/database');
const VtuProviderService = require('./src/services/vtuProviderService');
const vtuConfig = require('./src/config/vtuProviders');
const { startVtuPollingWorker, stopVtuPollingWorker } = require('./src/workers/vtuPollingWorker');

const PORT = process.env.PORT || 5000;

connectDB().then(async () => {
  // Initialize VTU providers
  try {
    await VtuProviderService.initializeProviders();
    console.log('VTU Providers initialized');
  } catch (error) {
    console.warn('VTU Provider initialization skipped:', error.message);
  }

  // Load VTU service routing from database
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

  try {
    await startVtuPollingWorker();
    console.log('VTU polling worker started');
  } catch (error) {
    console.warn('VTU polling worker startup skipped:', error.message);
  }

  const shutdown = async (exitCode = 0) => {
    await stopVtuPollingWorker();
    server.close(() => {
      process.exit(exitCode);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  process.on('unhandledRejection', (err) => {
    console.log(`Error: ${err.message}`);
    console.log('Shutting down server due to unhandled promise rejection');
    shutdown(1);
  });
});
