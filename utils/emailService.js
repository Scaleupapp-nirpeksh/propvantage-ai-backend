// File: utils/emailService.js
// Description: Professional email service for PropVantage AI invitation system
// Version: 1.0.0 - Production ready email service with templates and error handling
// Location: utils/emailService.js

import nodemailer from 'nodemailer';
import { format } from 'date-fns';

// =============================================================================
// EMAIL SERVICE CONFIGURATION
// =============================================================================

const EMAIL_CONFIG = {
  // Service configuration
  service: process.env.EMAIL_SERVICE || 'gmail', // 'gmail', 'outlook', 'sendgrid', etc.
  
  // SMTP configuration for custom providers
  smtp: {
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
  },
  
  // Authentication
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  
  // Default sender
  from: {
    name: process.env.EMAIL_FROM_NAME || 'PropVantage AI',
    email: process.env.EMAIL_FROM_EMAIL || process.env.EMAIL_USER,
  },
  
  // Retry configuration
  maxRetries: 3,
  retryDelay: 5000, // 5 seconds
  
  // Email limits
  maxEmailsPerHour: parseInt(process.env.MAX_EMAILS_PER_HOUR) || 100,
};

// =============================================================================
// EMAIL TRANSPORTER SETUP
// =============================================================================

let transporter = null;

/**
 * Create and configure email transporter
 */
const createTransporter = () => {
  try {
    const config = {
      auth: EMAIL_CONFIG.auth,
    };
    
    // Use service-specific configuration or custom SMTP
    if (EMAIL_CONFIG.service && EMAIL_CONFIG.service !== 'custom') {
      config.service = EMAIL_CONFIG.service;
    } else {
      config.host = EMAIL_CONFIG.smtp.host;
      config.port = EMAIL_CONFIG.smtp.port;
      config.secure = EMAIL_CONFIG.smtp.secure;
    }
    
    transporter = nodemailer.createTransporter(config);
    
    console.log(`📧 Email transporter created using ${EMAIL_CONFIG.service || 'custom SMTP'}`);
    
    return transporter;
  } catch (error) {
    console.error('❌ Failed to create email transporter:', error);
    return null;
  }
};

/**
 * Verify email configuration
 */
const verifyEmailConfig = async () => {
  try {
    if (!transporter) {
      transporter = createTransporter();
    }
    
    if (!transporter) {
      throw new Error('Email transporter not initialized');
    }
    
    await transporter.verify();
    console.log('✅ Email service verified successfully');
    return true;
  } catch (error) {
    console.error('❌ Email service verification failed:', error);
    return false;
  }
};

// Initialize transporter
createTransporter();

// =============================================================================
// EMAIL TEMPLATES
// =============================================================================

/**
 * Generate invitation email HTML template
 */
const generateInvitationEmailHTML = ({
  firstName,
  lastName,
  inviterName,
  organizationName,
  role,
  invitationLink,
  expiresAt,
  isResend = false,
}) => {
  const expiryDate = format(new Date(expiresAt), 'MMMM dd, yyyy');
  const expiryTime = format(new Date(expiresAt), 'h:mm a');
  
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${isResend ? 'Reminder: ' : ''}Join ${organizationName} - PropVantage AI</title>
        <style>
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
                line-height: 1.6;
                color: #333;
                max-width: 600px;
                margin: 0 auto;
                padding: 20px;
                background-color: #f8fafc;
            }
            .container {
                background-color: white;
                border-radius: 12px;
                padding: 40px;
                box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);
                border: 1px solid #e2e8f0;
            }
            .header {
                text-align: center;
                margin-bottom: 40px;
                padding-bottom: 20px;
                border-bottom: 2px solid #667eea;
            }
            .logo {
                background: linear-gradient(45deg, #667eea, #764ba2);
                color: white;
                width: 60px;
                height: 60px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                margin: 0 auto 20px;
                font-size: 24px;
                font-weight: bold;
            }
            .title {
                color: #1a202c;
                font-size: 28px;
                font-weight: 700;
                margin: 0;
                background: linear-gradient(45deg, #667eea, #764ba2);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                background-clip: text;
            }
            .subtitle {
                color: #64748b;
                font-size: 16px;
                margin: 8px 0 0 0;
                font-weight: 500;
            }
            .content {
                margin-bottom: 40px;
            }
            .greeting {
                font-size: 18px;
                color: #1a202c;
                margin-bottom: 20px;
            }
            .message {
                font-size: 16px;
                color: #4a5568;
                margin-bottom: 20px;
                line-height: 1.6;
            }
            .invitation-details {
                background: linear-gradient(135deg, #f8fafc, #e2e8f0);
                border-radius: 8px;
                padding: 24px;
                margin: 24px 0;
                border-left: 4px solid #667eea;
            }
            .detail-row {
                display: flex;
                justify-content: space-between;
                margin-bottom: 12px;
                align-items: center;
            }
            .detail-row:last-child {
                margin-bottom: 0;
            }
            .detail-label {
                font-weight: 600;
                color: #374151;
                font-size: 14px;
            }
            .detail-value {
                color: #1f2937;
                font-weight: 500;
                font-size: 14px;
            }
            .role-badge {
                background: linear-gradient(45deg, #667eea, #764ba2);
                color: white;
                padding: 4px 12px;
                border-radius: 20px;
                font-size: 12px;
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            .cta-section {
                text-align: center;
                margin: 40px 0;
            }
            .cta-button {
                display: inline-block;
                background: linear-gradient(45deg, #667eea, #764ba2);
                color: white;
                text-decoration: none;
                padding: 16px 32px;
                border-radius: 8px;
                font-weight: 600;
                font-size: 16px;
                text-align: center;
                transition: all 0.3s ease;
                box-shadow: 0 4px 12px rgba(102, 126, 234, 0.25);
            }
            .cta-button:hover {
                transform: translateY(-2px);
                box-shadow: 0 6px 16px rgba(102, 126, 234, 0.35);
            }
            .alternative-link {
                background: #f1f5f9;
                border: 2px dashed #cbd5e1;
                border-radius: 8px;
                padding: 16px;
                margin: 24px 0;
                text-align: center;
            }
            .alternative-link p {
                margin: 0 0 8px 0;
                font-size: 14px;
                color: #64748b;
            }
            .link-text {
                font-family: monospace;
                font-size: 12px;
                color: #3b82f6;
                word-break: break-all;
                background: white;
                padding: 8px;
                border-radius: 4px;
                border: 1px solid #e2e8f0;
            }
            .expiry-warning {
                background: #fef3cd;
                border: 1px solid #f6e05e;
                border-radius: 8px;
                padding: 16px;
                margin: 24px 0;
                color: #744210;
                text-align: center;
            }
            .expiry-warning strong {
                color: #92400e;
            }
            .footer {
                border-top: 1px solid #e2e8f0;
                padding-top: 24px;
                text-align: center;
                color: #64748b;
                font-size: 14px;
            }
            .footer p {
                margin: 4px 0;
            }
            .security-note {
                background: #f0f9ff;
                border: 1px solid #bae6fd;
                border-radius: 6px;
                padding: 12px;
                margin: 20px 0;
                font-size: 13px;
                color: #0c4a6e;
            }
            .resend-notice {
                background: #fef7ed;
                border: 1px solid #fed7aa;
                border-radius: 8px;
                padding: 16px;
                margin: 20px 0;
                color: #9a3412;
                text-align: center;
            }
            @media (max-width: 600px) {
                body {
                    padding: 10px;
                }
                .container {
                    padding: 24px;
                }
                .title {
                    font-size: 24px;
                }
                .detail-row {
                    flex-direction: column;
                    align-items: flex-start;
                    gap: 4px;
                }
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <div class="logo">PV</div>
                <h1 class="title">PropVantage</h1>
                <p class="subtitle">AI POWERED CRM</p>
            </div>
            
            <div class="content">
                ${isResend ? `
                <div class="resend-notice">
                    <strong>Reminder:</strong> This is a resend of your original invitation.
                </div>
                ` : ''}
                
                <div class="greeting">
                    Hello ${firstName} ${lastName}! 👋
                </div>
                
                <p class="message">
                    ${inviterName} has invited you to join <strong>${organizationName}</strong> on PropVantage AI, 
                    our advanced real estate CRM platform powered by artificial intelligence.
                </p>
                
                <p class="message">
                    You've been assigned the role of <strong>${role}</strong> and will have access to powerful 
                    tools for lead management, sales tracking, analytics, and AI-driven insights.
                </p>
                
                <div class="invitation-details">
                    <div class="detail-row">
                        <span class="detail-label">Organization:</span>
                        <span class="detail-value">${organizationName}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Your Role:</span>
                        <span class="role-badge">${role}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Invited By:</span>
                        <span class="detail-value">${inviterName}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Email:</span>
                        <span class="detail-value">${firstName.toLowerCase()}.${lastName.toLowerCase()}@yourorg.com</span>
                    </div>
                </div>
                
                <div class="cta-section">
                    <a href="${invitationLink}" class="cta-button">
                        🚀 Accept Invitation & Set Password
                    </a>
                </div>
                
                <div class="alternative-link">
                    <p><strong>Can't click the button?</strong> Copy and paste this link into your browser:</p>
                    <div class="link-text">${invitationLink}</div>
                </div>
                
                <div class="expiry-warning">
                    ⏰ <strong>Important:</strong> This invitation expires on <strong>${expiryDate}</strong> at <strong>${expiryTime}</strong>.
                    Please accept it before then to avoid having to request a new invitation.
                </div>
                
                <div class="security-note">
                    🔒 <strong>Security Note:</strong> This invitation link is unique to you and should not be shared. 
                    If you didn't expect this invitation, please contact your administrator.
                </div>
            </div>
            
            <div class="footer">
                <p><strong>PropVantage AI</strong> - Transforming Real Estate with Intelligence</p>
                <p>This is an automated email. Please do not reply to this address.</p>
                <p>If you have questions, contact your system administrator.</p>
                <p style="margin-top: 16px; font-size: 12px;">
                    © ${new Date().getFullYear()} PropVantage AI. All rights reserved.
                </p>
            </div>
        </div>
    </body>
    </html>
  `;
};

/**
 * Generate plain text version of invitation email
 */
const generateInvitationEmailText = ({
  firstName,
  lastName,
  inviterName,
  organizationName,
  role,
  invitationLink,
  expiresAt,
  isResend = false,
}) => {
  const expiryDate = format(new Date(expiresAt), 'MMMM dd, yyyy \'at\' h:mm a');
  
  return `
${isResend ? 'REMINDER: ' : ''}Welcome to PropVantage AI!

Hello ${firstName} ${lastName}!

${inviterName} has invited you to join ${organizationName} on PropVantage AI, our advanced real estate CRM platform powered by artificial intelligence.

INVITATION DETAILS:
- Organization: ${organizationName}
- Your Role: ${role}
- Invited By: ${inviterName}
- Email: ${firstName.toLowerCase()}.${lastName.toLowerCase()}@yourorg.com

You've been assigned the role of "${role}" and will have access to powerful tools for lead management, sales tracking, analytics, and AI-driven insights.

To accept this invitation and set up your account:
1. Click this link: ${invitationLink}
2. Create a secure password
3. Start using PropVantage AI!

IMPORTANT: This invitation expires on ${expiryDate}. Please accept it before then to avoid having to request a new invitation.

SECURITY NOTE: This invitation link is unique to you and should not be shared. If you didn't expect this invitation, please contact your administrator.

---
PropVantage AI - Transforming Real Estate with Intelligence
This is an automated email. Please do not reply to this address.
If you have questions, contact your system administrator.

© ${new Date().getFullYear()} PropVantage AI. All rights reserved.
  `.trim();
};

// =============================================================================
// EMAIL SENDING FUNCTIONS
// =============================================================================

/**
 * Send invitation email with retry logic
 */
export const sendInvitationEmail = async (invitationData) => {
  const {
    to,
    firstName,
    lastName,
    inviterName,
    organizationName,
    role,
    invitationLink,
    expiresAt,
    isResend = false,
  } = invitationData;
  
  console.log(`📧 Sending ${isResend ? 'resend ' : ''}invitation email to ${to}`);
  
  // Validate required data
  if (!to || !firstName || !lastName || !inviterName || !organizationName || !role || !invitationLink || !expiresAt) {
    throw new Error('Missing required invitation email data');
  }
  
  // Ensure transporter is available
  if (!transporter) {
    transporter = createTransporter();
  }
  
  if (!transporter) {
    throw new Error('Email service not available');
  }
  
  // Prepare email content
  const subject = isResend 
    ? `Reminder: Join ${organizationName} on PropVantage AI`
    : `You're invited to join ${organizationName} on PropVantage AI`;
  
  const emailOptions = {
    from: {
      name: EMAIL_CONFIG.from.name,
      address: EMAIL_CONFIG.from.email,
    },
    to: to,
    subject: subject,
    html: generateInvitationEmailHTML(invitationData),
    text: generateInvitationEmailText(invitationData),
    headers: {
      'X-Priority': '1',
      'X-MSMail-Priority': 'High',
      'Importance': 'high',
    },
  };
  
  // Retry logic
  let lastError = null;
  for (let attempt = 1; attempt <= EMAIL_CONFIG.maxRetries; attempt++) {
    try {
      console.log(`📤 Sending email attempt ${attempt}/${EMAIL_CONFIG.maxRetries} to ${to}`);
      
      const result = await transporter.sendMail(emailOptions);
      
      console.log(`✅ Email sent successfully to ${to}:`, {
        messageId: result.messageId,
        accepted: result.accepted,
        rejected: result.rejected,
      });
      
      return {
        success: true,
        messageId: result.messageId,
        accepted: result.accepted,
        rejected: result.rejected,
      };
      
    } catch (error) {
      lastError = error;
      console.error(`❌ Email sending attempt ${attempt} failed:`, error);
      
      // If this is not the last attempt, wait before retrying
      if (attempt < EMAIL_CONFIG.maxRetries) {
        console.log(`⏳ Waiting ${EMAIL_CONFIG.retryDelay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, EMAIL_CONFIG.retryDelay));
      }
    }
  }
  
  // All attempts failed
  console.error(`❌ Failed to send email to ${to} after ${EMAIL_CONFIG.maxRetries} attempts`);
  throw new Error(`Failed to send email after ${EMAIL_CONFIG.maxRetries} attempts: ${lastError?.message}`);
};

/**
 * Send notification email to admin about new user registration
 */
export const sendNewUserNotificationEmail = async ({
  adminEmail,
  adminName,
  newUserName,
  newUserEmail,
  newUserRole,
  organizationName,
}) => {
  console.log(`📧 Sending new user notification to admin: ${adminEmail}`);
  
  if (!transporter) {
    transporter = createTransporter();
  }
  
  if (!transporter) {
    throw new Error('Email service not available');
  }
  
  const subject = `New User Joined: ${newUserName} - ${organizationName}`;
  
  const htmlContent = `
    <h2>New User Registration</h2>
    <p>Hello ${adminName},</p>
    <p>A new user has successfully joined your organization on PropVantage AI:</p>
    <ul>
      <li><strong>Name:</strong> ${newUserName}</li>
      <li><strong>Email:</strong> ${newUserEmail}</li>
      <li><strong>Role:</strong> ${newUserRole}</li>
      <li><strong>Joined:</strong> ${new Date().toLocaleString()}</li>
    </ul>
    <p>The user can now access the PropVantage AI platform with their assigned permissions.</p>
    <hr>
    <p><small>PropVantage AI - Administrative Notification</small></p>
  `;
  
  const textContent = `
New User Registration

Hello ${adminName},

A new user has successfully joined your organization on PropVantage AI:

- Name: ${newUserName}
- Email: ${newUserEmail}
- Role: ${newUserRole}
- Joined: ${new Date().toLocaleString()}

The user can now access the PropVantage AI platform with their assigned permissions.

---
PropVantage AI - Administrative Notification
  `.trim();
  
  const emailOptions = {
    from: {
      name: EMAIL_CONFIG.from.name,
      address: EMAIL_CONFIG.from.email,
    },
    to: adminEmail,
    subject: subject,
    html: htmlContent,
    text: textContent,
  };
  
  try {
    const result = await transporter.sendMail(emailOptions);
    console.log(`✅ Admin notification sent successfully to ${adminEmail}`);
    return result;
  } catch (error) {
    console.error(`❌ Failed to send admin notification to ${adminEmail}:`, error);
    throw error;
  }
};

// =============================================================================
// EMAIL SERVICE STATUS AND HEALTH
// =============================================================================

/**
 * Get email service status
 */
export const getEmailServiceStatus = async () => {
  try {
    const isVerified = await verifyEmailConfig();
    
    return {
      available: isVerified,
      service: EMAIL_CONFIG.service,
      host: EMAIL_CONFIG.smtp.host,
      port: EMAIL_CONFIG.smtp.port,
      secure: EMAIL_CONFIG.smtp.secure,
      from: EMAIL_CONFIG.from,
      lastVerified: new Date().toISOString(),
    };
  } catch (error) {
    return {
      available: false,
      error: error.message,
      lastChecked: new Date().toISOString(),
    };
  }
};

/**
 * Test email sending
 */
export const sendTestEmail = async (toEmail) => {
  if (!transporter) {
    transporter = createTransporter();
  }
  
  const testEmailOptions = {
    from: {
      name: EMAIL_CONFIG.from.name,
      address: EMAIL_CONFIG.from.email,
    },
    to: toEmail,
    subject: 'PropVantage AI - Email Service Test',
    html: `
      <h2>Email Service Test</h2>
      <p>This is a test email from PropVantage AI email service.</p>
      <p><strong>Sent at:</strong> ${new Date().toLocaleString()}</p>
      <p>If you received this email, the email service is working correctly.</p>
    `,
    text: `Email Service Test\n\nThis is a test email from PropVantage AI email service.\nSent at: ${new Date().toLocaleString()}\n\nIf you received this email, the email service is working correctly.`,
  };
  
  try {
    const result = await transporter.sendMail(testEmailOptions);
    console.log(`✅ Test email sent successfully to ${toEmail}`);
    return result;
  } catch (error) {
    console.error(`❌ Test email failed:`, error);
    throw error;
  }
};

// =============================================================================
// INITIALIZATION AND VERIFICATION
// =============================================================================

// Verify email configuration on startup
if (process.env.NODE_ENV !== 'test') {
  setTimeout(async () => {
    try {
      await verifyEmailConfig();
    } catch (error) {
      console.error('❌ Email service initialization failed:', error);
    }
  }, 2000);
}

export default {
  sendInvitationEmail,
  sendNewUserNotificationEmail,
  getEmailServiceStatus,
  sendTestEmail,
  verifyEmailConfig,
};