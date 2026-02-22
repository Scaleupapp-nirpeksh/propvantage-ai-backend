// File: controllers/tokenController.js
// Description: Handles refresh token rotation, logout, and token revocation.

import crypto from 'crypto';
import asyncHandler from 'express-async-handler';
import RefreshToken from '../models/refreshTokenModel.js';
import {
  generateAccessToken,
  generateRefreshTokenValue,
  setRefreshCookie,
  clearRefreshCookie,
} from '../utils/generateToken.js';
import { logAuditEvent } from '../utils/auditLogger.js';

const REFRESH_TOKEN_EXPIRY_DAYS = 7;

/**
 * @desc    Issue a new access token using a valid refresh token (from httpOnly cookie).
 *          Implements token rotation: old refresh token is revoked, new one issued.
 *          Detects token reuse attacks by checking if a revoked token is presented.
 * @route   POST /api/auth/refresh
 * @access  Public (cookie-based)
 */
const refreshTokenHandler = asyncHandler(async (req, res) => {
  const incomingToken = req.cookies?.refreshToken;

  if (!incomingToken) {
    res.status(401);
    throw new Error('No refresh token provided');
  }

  const storedToken = await RefreshToken.findOne({ token: incomingToken });

  if (!storedToken) {
    clearRefreshCookie(res);
    res.status(401);
    throw new Error('Invalid refresh token');
  }

  // Token reuse detection: if a revoked token is presented, an attacker
  // may have stolen the previous token. Revoke the entire family.
  if (storedToken.isRevoked) {
    await RefreshToken.updateMany(
      { family: storedToken.family },
      { isRevoked: true, revokedAt: new Date() }
    );

    logAuditEvent({
      action: 'SUSPICIOUS_ACTIVITY',
      severity: 'critical',
      message: `Refresh token reuse detected for user ${storedToken.user}. Entire token family revoked.`,
      actor: { userId: storedToken.user },
      organization: storedToken.organization,
      metadata: { family: storedToken.family },
      req,
    });

    clearRefreshCookie(res);
    res.status(401);
    throw new Error('Refresh token reuse detected. Please log in again.');
  }

  // Check expiry
  if (storedToken.expiresAt < new Date()) {
    clearRefreshCookie(res);
    res.status(401);
    throw new Error('Refresh token expired');
  }

  // Rotate: revoke old token, create new one in the same family
  const newRefreshTokenValue = generateRefreshTokenValue();

  storedToken.isRevoked = true;
  storedToken.revokedAt = new Date();
  storedToken.replacedByToken = newRefreshTokenValue;
  await storedToken.save();

  await RefreshToken.create({
    token: newRefreshTokenValue,
    user: storedToken.user,
    organization: storedToken.organization,
    family: storedToken.family,
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
    userAgent: req.get('User-Agent'),
    ipAddress: req.ip,
  });

  const accessToken = generateAccessToken(storedToken.user);
  setRefreshCookie(res, newRefreshTokenValue);

  logAuditEvent({
    action: 'TOKEN_REFRESHED',
    severity: 'info',
    message: 'Access token refreshed via rotation',
    actor: { userId: storedToken.user },
    organization: storedToken.organization,
    req,
  });

  res.json({ token: accessToken });
});

/**
 * @desc    Logout — revoke the refresh token and clear the cookie.
 *          Does not require JWT auth (only needs the cookie).
 * @route   POST /api/auth/logout
 * @access  Public (cookie-based)
 */
const logoutUser = asyncHandler(async (req, res) => {
  const incomingToken = req.cookies?.refreshToken;

  if (incomingToken) {
    const storedToken = await RefreshToken.findOne({ token: incomingToken });
    if (storedToken && !storedToken.isRevoked) {
      storedToken.isRevoked = true;
      storedToken.revokedAt = new Date();
      await storedToken.save();

      logAuditEvent({
        action: 'LOGOUT',
        severity: 'info',
        message: 'User logged out',
        actor: { userId: storedToken.user },
        organization: storedToken.organization,
        req,
      });
    }
  }

  clearRefreshCookie(res);
  res.json({ message: 'Logged out successfully' });
});

/**
 * @desc    Logout from all devices — revoke ALL refresh tokens for this user.
 *          Requires JWT auth so we know which user is making the request.
 * @route   POST /api/auth/logout-all
 * @access  Private
 */
const logoutAllDevices = asyncHandler(async (req, res) => {
  const result = await RefreshToken.updateMany(
    { user: req.user._id, isRevoked: false },
    { isRevoked: true, revokedAt: new Date() }
  );

  clearRefreshCookie(res);

  logAuditEvent({
    action: 'LOGOUT',
    severity: 'info',
    message: `User logged out from all devices. ${result.modifiedCount} token(s) revoked.`,
    actor: { userId: req.user._id, email: req.user.email },
    organization: req.user.organization,
    metadata: { allDevices: true, tokensRevoked: result.modifiedCount },
    req,
  });

  res.json({ message: 'Logged out from all devices successfully' });
});

export { refreshTokenHandler, logoutUser, logoutAllDevices };
