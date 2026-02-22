// File: utils/generateToken.js
// Description: Token generation utilities for access tokens (JWT) and refresh tokens (opaque).

import jwt from 'jsonwebtoken';
import crypto from 'crypto';

/**
 * Generate a short-lived JWT access token (15 minutes).
 * @param {string} userId - The MongoDB ObjectId of the user.
 * @returns {string} Signed JWT access token.
 */
const generateAccessToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: '15m',
    algorithm: 'HS256',
  });
};

/**
 * Generate a cryptographically random opaque refresh token (80-char hex).
 * @returns {string} Random hex string.
 */
const generateRefreshTokenValue = () => {
  return crypto.randomBytes(40).toString('hex');
};

/**
 * Set the refresh token as an httpOnly secure cookie on the response.
 * Cookie is scoped to /api/auth to minimize exposure.
 * @param {object} res - Express response object.
 * @param {string} refreshTokenValue - The opaque refresh token string.
 */
const setRefreshCookie = (res, refreshTokenValue) => {
  res.cookie('refreshToken', refreshTokenValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: '/api/auth',
  });
};

/**
 * Clear the refresh token cookie from the response.
 * @param {object} res - Express response object.
 */
const clearRefreshCookie = (res) => {
  res.clearCookie('refreshToken', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/auth',
  });
};

/**
 * Backward-compatible default export — generates an access token.
 * @param {object} res - Express response object (unused, kept for signature compat).
 * @param {string} userId - The MongoDB ObjectId of the user.
 * @returns {string} Signed JWT access token.
 */
const generateToken = (res, userId) => {
  return generateAccessToken(userId);
};

export default generateToken;
export {
  generateAccessToken,
  generateRefreshTokenValue,
  setRefreshCookie,
  clearRefreshCookie,
};
