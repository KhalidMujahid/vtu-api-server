const { Resend } = require('resend');
const logger = require('./logger');

const resend = new Resend(process.env.RESEND_API_KEY);

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

exports.sendWelcomeEmail = async (email, firstName) => {
  try {
    const mailOptions = {
      from: `"Yareema Data Hub" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Welcome to Yareema Data Hub",
      html: `
        <div style="font-family: Arial, sans-serif; max-width:600px; margin:auto;">
          <h2 style="color:#333;">Welcome to Yareema Data Hub</h2>

          <p style="font-size:16px;">
            Hi <strong>${firstName}</strong>,
          </p>

          <p style="font-size:16px;">
            Your account has been successfully created on 
            <strong>Yareema Data Hub</strong>.
          </p>

          <p style="font-size:16px;">
            You can now enjoy our services such as:
          </p>

          <ul style="font-size:16px;">
            <li>📶 Buy Data</li>
            <li>📱 Buy Airtime</li>
            <li>💳 Fast Transactions</li>
            <li>🔒 Secure Wallet</li>
          </ul>

          <p style="font-size:16px;">
            If you did not create this account, please contact support immediately.
          </p>

          <hr/>

          <p style="font-size:14px;color:#777;">
            Thank you for choosing Yareema Data Hub.
          </p>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
    logger.info(`Welcome email sent to ${email}`);
  } catch (error) {
    logger.error("Error sending welcome email:", error);
  }
};

exports.sendStaffCredentials = async ({ email, firstName, lastName, tempPassword, role }) => {
  try {
    const roleDisplay = {
      superadmin: 'Super Admin',
      admin: 'Admin',
      support: 'Support Staff'
    }[role] || role;

    const mailOptions = {
      from: `"Yareema Data Hub" <${process.env.EMAIL_USER}>`,
      subject: `Welcome to Yareema Data Hub - Your Staff Account Details`,
      to: email,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 28px;">Yareema Data Hub</h1>
            <p style="color: white; margin: 10px 0 0 0; opacity: 0.9;">Staff Account Created</p>
          </div>
          
          <div style="padding: 30px; background: #f9f9f9;">
            <h2 style="color: #333; margin-top: 0;">Welcome, ${firstName}!</h2>
            
            <p style="font-size: 16px; color: #555;">
              Your staff account has been created on <strong>Yareema Data Hub</strong> as a <strong>${roleDisplay}</strong>.
            </p>
            
            <div style="background: white; border-radius: 8px; padding: 20px; margin: 20px 0; border: 1px solid #e0e0e0;">
              <h3 style="color: #333; margin-top: 0; font-size: 16px;">Your Login Credentials</h3>
              
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; color: #666; font-size: 14px;"><strong>Email:</strong></td>
                  <td style="padding: 8px 0; color: #333; font-size: 14px;">${email}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #666; font-size: 14px;"><strong>Temporary Password:</strong></td>
                  <td style="padding: 8px 0; color: #333; font-size: 14px; font-family: monospace; background: #f0f0f0; padding: 4px 8px; border-radius: 4px;">${tempPassword}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #666; font-size: 14px;"><strong>Role:</strong></td>
                  <td style="padding: 8px 0; color: #333; font-size: 14px;">${roleDisplay}</td>
                </tr>
              </table>
            </div>
            
            <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0;">
              <p style="margin: 0; color: #856404; font-size: 14px;">
                <strong>Important:</strong> Please change your password after your first login for security purposes.
              </p>
            </div>
            
            <p style="font-size: 14px; color: #666;">
              If you did not expect this email, please contact your administrator immediately.
            </p>
          </div>
          
          <div style="background: #333; padding: 20px; text-align: center;">
            <p style="color: #999; font-size: 12px; margin: 0;">
              &copy; ${new Date().getFullYear()} Yareema Data Hub. All rights reserved.
            </p>
          </div>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    logger.info(`Staff credentials email sent to ${email}`);
  } catch (error) {
    logger.error('Error sending staff credentials email:', error);
    throw error;
  }
};