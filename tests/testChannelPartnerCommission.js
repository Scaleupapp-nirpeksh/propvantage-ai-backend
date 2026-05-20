// File: tests/testChannelPartnerCommission.js
// Description: End-to-end test for CP attribution → commission generation.
// Usage: node tests/testChannelPartnerCommission.js
// Requires the backend server running locally and a seeded org/project/unit.

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';

dotenv.config();

const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;
let AUTH_TOKEN = null;
const results = { passed: 0, failed: 0 };
const created = {};

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
  console.log('  CP Attribution → Commission — End-to-End Test');
  console.log('═══════════════════════════════════════════════════\n');

  try {
    await mongoose.connect(process.env.MONGO_URI);
    const { default: User } = await import('../models/userModel.js');
    const { default: Project } = await import('../models/projectModel.js');
    const { default: Unit } = await import('../models/unitModel.js');

    const user =
      (await User.findOne({ email: /owner/i })) ||
      (await User.findOne().sort({ createdAt: 1 }));
    const project = await Project.findOne({ organization: user.organization });
    const unit = await Unit.findOne({ organization: user.organization, status: 'available' });
    if (!user || !project || !unit) {
      console.error('  ❌ Need a user, a project, and an available unit — seed data first.');
      process.exit(1);
    }
    AUTH_TOKEN = jwt.sign(
      { userId: user._id.toString() },
      process.env.JWT_SECRET,
      { expiresIn: '1h', algorithm: 'HS256' }
    );
    console.log(`  User: ${user.firstName} ${user.lastName}  ·  Project: ${project.name}\n`);

    // ── Setup: a CP firm + a commission rule ──
    const cpRes = await api('POST', '/api/channel-partners', {
      firmName: 'Commission SmokeTest CP', status: 'active',
    });
    created.cpId = cpRes.data?.data?._id;
    const ruleRes = await api('POST', '/api/channel-partners/commission-rules', {
      name: 'Commission SmokeTest Rule',
      rate: { method: 'percentage', percentage: 2, basis: 'sale_price' },
      payout: { schedule: 'lump_sum', tranches: [] },
      tdsPercent: 5,
    });
    created.ruleId = ruleRes.data?.data?._id;
    if (created.cpId && created.ruleId) {
      log('PASS', 'Setup: CP firm + commission rule created');
    } else {
      log('FAIL', 'Setup', `cp=${cpRes.status} rule=${ruleRes.status}`);
      throw new Error('Setup failed');
    }

    // ── Create a lead with CP attribution ──
    const leadRes = await api('POST', '/api/leads', {
      project: project._id.toString(),
      firstName: 'Commission', lastName: 'SmokeTest', phone: '+919000000004',
      source: 'Referral',
      channelPartnerAttribution: {
        viaChannelPartner: true,
        partners: [{ channelPartner: created.cpId, sharePct: 100 }],
      },
    });
    created.leadId = leadRes.data?.data?._id;
    if (leadRes.status === 201 && leadRes.data.data?.channelPartnerAttribution?.viaChannelPartner) {
      log('PASS', 'Lead created with CP attribution');
    } else {
      log('FAIL', 'Lead with CP attribution', `${leadRes.status}: ${JSON.stringify(leadRes.data).slice(0, 150)}`);
    }

    // ── Create a booking with CP attribution → commission should generate ──
    const saleRes = await api('POST', '/api/sales', {
      unitId: unit._id.toString(),
      leadId: created.leadId,
      costSheetSnapshot: { basePrice: unit.basePrice || unit.currentPrice || 1000000 },
      paymentPlanSnapshot: {},
      channelPartnerAttribution: {
        viaChannelPartner: true,
        partners: [{ channelPartner: created.cpId, sharePct: 100 }],
      },
    });
    created.saleId = saleRes.data?.data?._id || saleRes.data?.data?.sale?._id;
    if (saleRes.status === 201 || saleRes.status === 202) {
      log('PASS', 'Booking created with CP attribution', `status ${saleRes.status}`);
    } else {
      log('FAIL', 'Booking with CP attribution', `${saleRes.status}: ${JSON.stringify(saleRes.data).slice(0, 150)}`);
    }

    // ── A commission record should now exist for that CP ──
    await new Promise((r) => setTimeout(r, 1500));
    const recRes = await api('GET', `/api/channel-partners/commission-records?channelPartner=${created.cpId}`);
    const rec = (recRes.data?.data || [])[0];
    if (recRes.ok && rec && rec.netAmount > 0 && Array.isArray(rec.payouts) && rec.payouts.length > 0) {
      log('PASS', 'Commission record generated', `net ₹${rec.netAmount}, ${rec.payouts.length} payout(s)`);
      created.recordId = rec._id;
    } else {
      log('FAIL', 'Commission record generation', `${recRes.status}: ${JSON.stringify(recRes.data).slice(0, 150)}`);
    }

    // ── Mark the payout paid ──
    if (created.recordId) {
      const payRes = await api('PUT', `/api/channel-partners/commission-records/${created.recordId}/payouts/0/pay`);
      if (payRes.ok && payRes.data.data?.status === 'paid') {
        log('PASS', 'Mark payout paid → record status paid');
      } else {
        log('FAIL', 'Mark payout paid', `${payRes.status}: ${JSON.stringify(payRes.data).slice(0, 150)}`);
      }
    }
  } catch (err) {
    console.error('\n💥 FATAL ERROR:', err.message);
  } finally {
    console.log('\n🧹 CLEANUP\n');
    const { default: ChannelPartner } = await import('../models/channelPartnerModel.js');
    const { default: CommissionRule } = await import('../models/commissionRuleModel.js');
    const { default: CommissionRecord } = await import('../models/commissionRecordModel.js');
    const { default: Lead } = await import('../models/leadModel.js');
    const { default: Sale } = await import('../models/salesModel.js');
    if (created.saleId) {
      await CommissionRecord.deleteMany({ sale: created.saleId });
      await Sale.deleteOne({ _id: created.saleId });
    }
    if (created.leadId) await Lead.deleteOne({ _id: created.leadId });
    if (created.ruleId) await CommissionRule.deleteOne({ _id: created.ruleId });
    if (created.cpId) await ChannelPartner.deleteOne({ _id: created.cpId });
    console.log('  Cleaned up test records');
    console.log('\n═══════════════════════════════════════════════════');
    console.log(`  RESULTS: ✅ ${results.passed} passed  ❌ ${results.failed} failed`);
    console.log('═══════════════════════════════════════════════════\n');
    await mongoose.disconnect();
    process.exit(results.failed > 0 ? 1 : 0);
  }
};

main();
