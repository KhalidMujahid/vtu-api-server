const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/authRoutes');
const walletRoutes = require('./routes/walletRoutes');
const telecomRoutes = require('./routes/telecomRoutes');
const billsRoutes = require('./routes/billsRoutes');
const adminRoutes = require('./routes/adminRoutes');
// const webhookRoutes = require('./routes/webhookRoutes');
// const agentRoutes = require('/routes/agentRoutes');

const { errorHandler } = require('./middlewares/errorHandler');
const logger = require('./utils/logger');

const app = express();

app.use(helmet());
app.use(cors());
app.use(xss());
app.use(mongoSanitize());

// const limiter = rateLimit({
//   windowMs: 15 * 60 * 1000, 
//   max: 100,
//   message: 'Too many requests from this IP, please try again later.',
// });
// app.use('/api', limiter);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use((req, res, next) => {
  logger.info(`${req.method} ${req.url}`, {
    ip: req.ip,
    userAgent: req.get('user-agent'),
  });
  next();
});

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/wallet', walletRoutes);
app.use('/api/v1/telecom', telecomRoutes);
app.use('/api/v1/bills', billsRoutes);
app.use('/api/v1/admin', adminRoutes);
// app.use('/api/v1/webhook', webhookRoutes);
// app.use('/api/v1/agent', agentRoutes);

app.get('/api/v1/health', (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'Yareema Data Hub API is running',
    timestamp: new Date().toISOString(),
  });
});

app.use(errorHandler);


app.all('*', (req, res) => {
  res.status(404).json({
    status: 'error',
    message: `Can't find ${req.originalUrl} on this server`,
  });
});


module.exports = app;
