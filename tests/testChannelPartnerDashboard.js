// File: tests/testChannelPartnerDashboard.js
// Description: End-to-end test for the CP performance dashboard endpoint.
// Usage: node tests/testChannelPartnerDashboard.js
// Requires the backend server running locally and a seeded org/user.

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';

dotenv.config();

const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;
let AUTH_TOKEN = null;
const results = { passed: 0, failed: 0 };

const log = (status, name, detail = '') => {
  const icon = status === 'PASS' ? '✅' : '❌';
  console.log(`  ${icon} ${name}${detail ? ` — ${detail}` : ''}`);
  if (status === 'PASS') results.passed++;
  else results.failed++;
};

const api = async (method, path) => {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(AUTH_TOKEN ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {}),
    },
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data, ok: res.ok };
};

const main = async () => {
  console.log('═══════════════════════════════════════════════════');
  console.log('  CP Performance Dashboard — End-to-End Test');
  console.log('═══════════════════════════════════════════════════\n');

  try {
    await mongoose.connect(process.env.MONGO_URI);
    const { default: User } = await import('../models/userModel.js');
    const user =
      (await User.findOne({ email: /owner/i })) ||
      (await User.findOne().sort({ createdAt: 1 }));
    if (!user) {
      console.error('  ❌ No user found — seed data first.');
      process.exit(1);
    }
    AUTH_TOKEN = jwt.sign(
      { userId: user._id.toString() },
      process.env.JWT_SECRET,
      { expiresIn: '1h', algorithm: 'HS256' }
    );
    console.log(`  User: ${user.firstName} ${user.lastName}\n`);

    const res = await api('GET', '/api/channel-partners/dashboard');
    if (res.ok && res.data.data) {
      const d = res.data.data;
      const shapeOk =
        Array.isArray(d.leaderboard) &&
        d.funnel &&
        typeof d.funnel.leadsTagged === 'number' &&
        typeof d.funnel.bookings === 'number' &&
        typeof d.funnel.conversionPct === 'number';
      if (shapeOk) {
        log('PASS', 'Dashboard returns leaderboard + funnel',
          `${d.leaderboard.length} partners, ${d.funnel.bookings} bookings, ${d.funnel.conversionPct}% conversion`);
      } else {
        log('FAIL', 'Dashboard shape', JSON.stringify(d).slice(0, 200));
      }
    } else {
      log('FAIL', 'Dashboard endpoint', `${res.status}: ${JSON.stringify(res.data).slice(0, 200)}`);
    }
  } catch (err) {
    console.error('\n💥 FATAL ERROR:', err.message);
  } finally {
    console.log('\n═══════════════════════════════════════════════════');
    console.log(`  RESULTS: ✅ ${results.passed} passed  ❌ ${results.failed} failed`);
    console.log('═══════════════════════════════════════════════════\n');
    await mongoose.disconnect();
    process.exit(results.failed > 0 ? 1 : 0);
  }
};

main();
