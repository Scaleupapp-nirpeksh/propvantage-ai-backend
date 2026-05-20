// File: tests/testChannelPartner.js
// Description: End-to-end test for the Channel Partner registry & rules.
// Usage: node tests/testChannelPartner.js
// Requires the backend server running locally and a seeded org/user.

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';

dotenv.config();

const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;
let AUTH_TOKEN = null;
let createdPartnerId = null;
let createdRuleId = null;

const results = { passed: 0, failed: 0 };

const log = (status, name, detail = '') => {
  const icon = status === 'PASS' ? '✅' : '❌';
  console.log(`  ${icon} ${name}${detail ? ` — ${detail}` : ''}`);
  if (status === 'PASS') results.passed++;
  else results.failed++;
};

const api = async (method, path, body = null) => {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(AUTH_TOKEN ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {}),
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${path}`, opts);
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
  console.log('  Channel Partner Registry & Rules — End-to-End Test');
  console.log('═══════════════════════════════════════════════════\n');

  try {
    await mongoose.connect(process.env.MONGO_URI);
    const { default: User } = await import('../models/userModel.js');

    // Prefer an owner-equivalent user — they have channel_partners:create.
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

    // ── Create a channel partner firm ──
    console.log('📋 TEST: Channel partner firm CRUD\n');
    const createRes = await api('POST', '/api/channel-partners', {
      firmName: 'CP SmokeTest Realty',
      reraRegistrationNumber: 'A0123456789',
      primaryContact: { name: 'Test Broker', email: 't@example.com', phone: '+919000000002' },
      status: 'active',
    });
    if (createRes.status === 201 && createRes.data.data?._id) {
      createdPartnerId = createRes.data.data._id;
      log('PASS', 'Create channel partner firm', `ID: ${createdPartnerId}`);
    } else {
      log('FAIL', 'Create channel partner firm', `${createRes.status}: ${JSON.stringify(createRes.data)}`);
      throw new Error('Cannot continue without a partner');
    }

    const listRes = await api('GET', '/api/channel-partners');
    if (listRes.ok && Array.isArray(listRes.data.data)) {
      log('PASS', 'List channel partners', `${listRes.data.count} found`);
    } else {
      log('FAIL', 'List channel partners', `${listRes.status}`);
    }

    // ── Add an agent ──
    const agentRes = await api('POST', `/api/channel-partners/${createdPartnerId}/agents`, {
      name: 'Smoke Agent',
      phone: '+919000000003',
    });
    if (agentRes.status === 201 && agentRes.data.data?._id) {
      log('PASS', 'Add agent to firm');
    } else {
      log('FAIL', 'Add agent', `${agentRes.status}: ${JSON.stringify(agentRes.data)}`);
    }

    const getRes = await api('GET', `/api/channel-partners/${createdPartnerId}`);
    if (getRes.ok && Array.isArray(getRes.data.data?.agents) && getRes.data.data.agents.length >= 1) {
      log('PASS', 'Get firm includes its agents');
    } else {
      log('FAIL', 'Get firm with agents', `${getRes.status}`);
    }

    // ── Commission rule: valid tranches ──
    console.log('\n📋 TEST: Commission rule CRUD\n');
    const ruleRes = await api('POST', '/api/channel-partners/commission-rules', {
      name: 'Smoke Rule 2%',
      rate: { method: 'percentage', percentage: 2, basis: 'sale_price' },
      payout: {
        schedule: 'tranches',
        tranches: [
          { label: 'On booking', percentage: 50, trigger: 'on_booking' },
          { label: 'On registration', percentage: 50, trigger: 'on_registration' },
        ],
      },
      tdsPercent: 5,
    });
    if (ruleRes.status === 201 && ruleRes.data.data?._id) {
      createdRuleId = ruleRes.data.data._id;
      log('PASS', 'Create commission rule (tranches sum to 100)');
    } else {
      log('FAIL', 'Create commission rule', `${ruleRes.status}: ${JSON.stringify(ruleRes.data)}`);
    }

    // ── Commission rule: invalid tranches (must be rejected) ──
    const badRuleRes = await api('POST', '/api/channel-partners/commission-rules', {
      name: 'Bad Rule',
      payout: {
        schedule: 'tranches',
        tranches: [{ label: 'Half', percentage: 50, trigger: 'on_booking' }],
      },
    });
    if (badRuleRes.status === 400) {
      log('PASS', 'Reject commission rule whose tranches != 100');
    } else {
      log('FAIL', 'Tranche-sum validation', `expected 400, got ${badRuleRes.status}`);
    }
  } catch (err) {
    console.error('\n💥 FATAL ERROR:', err.message);
  } finally {
    console.log('\n🧹 CLEANUP\n');
    const { default: ChannelPartner } = await import('../models/channelPartnerModel.js');
    const { default: ChannelPartnerAgent } = await import('../models/channelPartnerAgentModel.js');
    const { default: CommissionRule } = await import('../models/commissionRuleModel.js');
    if (createdPartnerId) {
      await ChannelPartnerAgent.deleteMany({ channelPartner: createdPartnerId });
      await ChannelPartner.deleteOne({ _id: createdPartnerId });
      console.log('  Deleted test firm + agents');
    }
    if (createdRuleId) {
      await CommissionRule.deleteOne({ _id: createdRuleId });
      console.log('  Deleted test rule');
    }
    console.log('\n═══════════════════════════════════════════════════');
    console.log(`  RESULTS: ✅ ${results.passed} passed  ❌ ${results.failed} failed`);
    console.log('═══════════════════════════════════════════════════\n');
    await mongoose.disconnect();
    process.exit(results.failed > 0 ? 1 : 0);
  }
};

main();
