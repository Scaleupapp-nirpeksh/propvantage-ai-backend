// File: models/refreshTokenModel.js
// Description: Mongoose model for refresh tokens with rotation detection and TTL auto-cleanup.

import mongoose from 'mongoose';

const refreshTokenSchema = new mongoose.Schema(
  {
    token: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'User',
      index: true,
    },
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
    },
    // Token family ID — all tokens in a rotation chain share the same family.
    // Used to detect token reuse attacks: if a revoked token is reused,
    // the entire family is revoked (attacker + legitimate user).
    family: {
      type: String,
      required: true,
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    isRevoked: {
      type: Boolean,
      default: false,
    },
    revokedAt: {
      type: Date,
      default: null,
    },
    replacedByToken: {
      type: String,
      default: null,
    },
    userAgent: String,
    ipAddress: String,
  },
  {
    timestamps: true,
  }
);

// TTL index: auto-delete documents 1 day after expiry (cleanup)
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 86400 });

// Compound index for family-based revocation queries
refreshTokenSchema.index({ family: 1, isRevoked: 1 });

const RefreshToken = mongoose.model('RefreshToken', refreshTokenSchema);

export default RefreshToken;
