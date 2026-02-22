// File: utils/auditLogger.js
// Description: Centralized audit logging for security-critical events.
// Logs to both Winston file logger and MongoDB for queryable audit trail.

import winston from 'winston';
import mongoose from 'mongoose';

// ─── Winston file logger for audit events ──────────────────────────────────────

const auditFileLogger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.json()
  ),
  defaultMeta: { service: 'propvantage-api' },
  transports: [
    new winston.transports.File({
      filename: 'logs/audit.log',
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 30,
    }),
    new winston.transports.File({
      filename: 'logs/security.log',
      level: 'warn',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 30,
    }),
  ],
});

// Also log to console in development
if (process.env.NODE_ENV !== 'production') {
  auditFileLogger.add(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
      level: 'warn', // only warn+ in console to avoid noise
    })
  );
}

// ─── MongoDB Audit Log Schema ──────────────────────────────────────────────────

const auditLogSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      required: true,
      enum: [
        // Auth events
        'LOGIN_SUCCESS',
        'LOGIN_FAILED',
        'LOGIN_LOCKED',
        'REGISTER',
        'LOGOUT',
        'PASSWORD_CHANGED',
        'PASSWORD_RESET_REQUESTED',
        'PASSWORD_RESET_COMPLETED',
        // User management
        'USER_INVITED',
        'USER_ACTIVATED',
        'USER_DEACTIVATED',
        'USER_DELETED',
        // Role & permission events
        'ROLE_CREATED',
        'ROLE_UPDATED',
        'ROLE_DELETED',
        'ROLE_ASSIGNED',
        'OWNERSHIP_TRANSFERRED',
        // Data access events
        'DATA_EXPORTED',
        'BULK_OPERATION',
        // Security events
        'PERMISSION_DENIED',
        'SUSPICIOUS_ACTIVITY',
        'ACCOUNT_UNLOCKED',
      ],
      index: true,
    },
    severity: {
      type: String,
      enum: ['info', 'warn', 'error', 'critical'],
      default: 'info',
    },
    actor: {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      email: { type: String, default: null },
      ip: { type: String, default: null },
      userAgent: { type: String, default: null },
    },
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      default: null,
      index: true,
    },
    target: {
      model: { type: String, default: null },
      documentId: { type: mongoose.Schema.Types.ObjectId, default: null },
      description: { type: String, default: null },
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    message: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Auto-delete audit logs after 1 year
auditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60 });

// Compound index for querying by org + action
auditLogSchema.index({ organization: 1, action: 1, createdAt: -1 });

const AuditLog = mongoose.model('AuditLog', auditLogSchema);

// ─── Audit log helper function ─────────────────────────────────────────────────

/**
 * Log an audit event to both file and MongoDB.
 * Non-blocking — never throws to avoid disrupting the main request flow.
 *
 * @param {object} params
 * @param {string} params.action        - Action enum value
 * @param {string} params.severity      - info | warn | error | critical
 * @param {string} params.message       - Human-readable description
 * @param {object} [params.actor]       - { userId, email, ip, userAgent }
 * @param {string} [params.organization]- Organization ID
 * @param {object} [params.target]      - { model, documentId, description }
 * @param {object} [params.metadata]    - Any additional data
 * @param {object} [params.req]         - Express request object (auto-extracts IP, user-agent)
 */
const logAuditEvent = async ({
  action,
  severity = 'info',
  message,
  actor = {},
  organization = null,
  target = {},
  metadata = {},
  req = null,
}) => {
  try {
    // Auto-extract from request if provided
    if (req) {
      actor.ip = actor.ip || req.ip || req.connection?.remoteAddress;
      actor.userAgent = actor.userAgent || req.get('User-Agent');
      if (req.user) {
        actor.userId = actor.userId || req.user._id;
        actor.email = actor.email || req.user.email;
        organization = organization || req.user.organization;
      }
    }

    // Log to file
    auditFileLogger.log(severity, message, {
      action,
      actor: { userId: actor.userId?.toString(), email: actor.email, ip: actor.ip },
      organization: organization?.toString(),
      target,
      metadata,
    });

    // Log to MongoDB (fire-and-forget)
    AuditLog.create({
      action,
      severity,
      message,
      actor,
      organization,
      target,
      metadata,
    }).catch((err) => {
      auditFileLogger.error('Failed to write audit log to MongoDB', { error: err.message });
    });
  } catch (err) {
    // Audit logging should never crash the app
    console.error('Audit logging error:', err.message);
  }
};

export { logAuditEvent, AuditLog };
