// File: tests/regression/_lib/auth.js
// Auth bootstrap for the regression suite.
//
// Precedence:
//   1. API_TEST_TOKEN env var (a real user JWT) — used as-is
//   2. If MONGO_URI + JWT_SECRET are present, mint a JWT for the first non-archived
//      user we find in the DB (local/staging convenience — same pattern as the
//      existing testCompetitiveAnalysis.js)
//   3. Otherwise return null — auth-required tests will mark themselves skipped
//
// This module is intentionally side-effect-free until you call `tryAcquireToken()`.

import 'dotenv/config';
import jwt from 'jsonwebtoken';
import { setAuthToken, getAuthToken } from './api.js';

let authedUser = null;
let authedOrg = null;
let acquired = false;

export const getAuthedUser = () => authedUser;
export const getAuthedOrg = () => authedOrg;

export const tryAcquireToken = async () => {
  if (acquired) return getAuthToken();
  acquired = true;

  // Path 1: explicit token
  if (process.env.API_TEST_TOKEN) {
    setAuthToken(process.env.API_TEST_TOKEN);
    return process.env.API_TEST_TOKEN;
  }

  // Path 2: DB-based mint (local/staging only)
  if (!process.env.MONGO_URI || !process.env.JWT_SECRET) {
    return null;
  }

  try {
    const mongoose = (await import('mongoose')).default;
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGO_URI);
    }
    const { default: User } = await import('../../../models/userModel.js');
    const { default: Organization } = await import('../../../models/organizationModel.js');

    const user = await User.findOne({ isActive: { $ne: false } })
      .populate('roleRef')
      .lean();
    if (!user) return null;

    const org = await Organization.findById(user.organization).lean();
    if (!org) return null;

    const token = jwt.sign(
      { id: user._id.toString() },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
    setAuthToken(token);
    authedUser = user;
    authedOrg = org;
    return token;
  } catch (e) {
    console.warn(`[auth] DB-based mint failed: ${e.message}`);
    return null;
  }
};

export const disconnectAuth = async () => {
  try {
    const mongoose = (await import('mongoose')).default;
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  } catch { /* ignore */ }
};
