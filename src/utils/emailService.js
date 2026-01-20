const nodemailer = require('nodemailer');
const logger = require('./logger');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

transporter.verify((error) => {
  if (error) {
    logger.error('Email transporter error:', error);
  } else {
    logger.info('Email transporter is ready');
  }
});

exports.sendOTPEmail = async (email, otp) => {
  try {
    const mailOptions = {
      from: `"Yareema Data Hub" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Your OTP Code - Yareema Data Hub',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Yareema Data Hub</h2>
          <p style="font-size: 16px;">Your OTP code is:</p>
          <div style="background-color: #f4f4f4; padding: 20px; text-align: center; margin: 20px 0;">
            <h1 style="margin: 0; color: #333; letter-spacing: 5px;">${otp}</h1>
          </div>
          <p style="font-size: 14px; color: #666;">
            This OTP will expire in 10 minutes.
          </p>
          <p style="font-size: 14px; color: #666;">
            If you didn't request this code, please ignore this email.
          </p>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
    logger.info(`OTP email sent to ${email}`);
  } catch (error) {
    logger.error('Error sending OTP email:', error);
    throw error;
  }
};

exports.sendPasswordResetEmail = async (email, resetURL) => {
  try {
    const mailOptions = {
      from: `"Yareema Data Hub" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Password Reset Request - Yareema Data Hub',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Password Reset Request</h2>
          <p style="font-size: 16px;">
            You requested to reset your password. Click the button below to reset it:
          </p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetURL}" 
               style="background-color: #4CAF50; color: white; padding: 12px 30px; 
                      text-decoration: none; border-radius: 5px; font-size: 16px;">
              Reset Password
            </a>
          </div>
          <p style="font-size: 14px; color: #666;">
            If you didn't request this, please ignore this email.
          </p>
          <p style="font-size: 14px; color: #666;">
            This link will expire in 10 minutes.
          </p>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
    logger.info(`Password reset email sent to ${email}`);
  } catch (error) {
    logger.error('Error sending password reset email:', error);
    throw error;
  }
};

exports.sendTransactionNotification = async (email, transaction) => {
  try {
    const mailOptions = {
      from: `"Yareema Data Hub" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: `Transaction ${transaction.status} - Yareema Data Hub`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Transaction Notification</h2>
          <div style="background-color: #f9f9f9; padding: 20px; border-radius: 5px;">
            <p><strong>Reference:</strong> ${transaction.reference}</p>
            <p><strong>Status:</strong> ${transaction.status}</p>
            <p><strong>Amount:</strong> ₦${transaction.amount}</p>
            <p><strong>Description:</strong> ${transaction.description}</p>
            <p><strong>Date:</strong> ${new Date(transaction.createdAt).toLocaleString()}</p>
          </div>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
    logger.info(`Transaction notification sent to ${email}`);
  } catch (error) {
    logger.error('Error sending transaction notification:', error);
  }
};

exports.sendOTPSMS = async (phoneNumber, otp) => {
  try {
    logger.info(`Mock SMS sent to ${phoneNumber}: Your OTP is ${otp}`);
    return true;
  } catch (error) {
    logger.error('Error sending SMS:', error);
    throw error;
  }
};