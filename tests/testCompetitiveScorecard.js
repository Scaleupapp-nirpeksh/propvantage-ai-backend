// File: tests/testCompetitiveScorecard.js
// Description: End-to-end test for the Competitive Performance Scorecard.
// Usage: node tests/testCompetitiveScorecard.js
// Requires the backend server running locally and a seeded org/project.

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';

dotenv.config();

const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;
let AUTH_TOKEN = null;
let testProjectId = null;

const results = { passed: 0, failed: 0 };

const log = (status, name, detail = '') => {
  const icon = status === 'PASS' ? '✅' : '❌';
  console.log(`  ${icon} ${name}${detail ? ` — ${detail}` : ''}`);
  if (status === 'PASS') results.passed++;
  else results.failed++;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  console.log('  Competitive Performance Scorecard — End-to-End Test');
  console.log('═══════════════════════════════════════════════════\n');

  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('  Connected to MongoDB');

    const { default: Project } = await import('../models/projectModel.js');
    const { default: User } = await import('../models/userModel.js');

    const project = await Project.findOne();
    if (!project) {
      console.error('  ❌ No project found — seed demo data first.');
      process.exit(1);
    }
    testProjectId = project._id.toString();

    const user = await User.findOne({ organization: project.organization });
    if (!user) {
      console.error('  ❌ No user found in the project organization.');
      process.exit(1);
    }

    AUTH_TOKEN = jwt.sign(
      { userId: user._id.toString() },
      process.env.JWT_SECRET,
      { expiresIn: '1h', algorithm: 'HS256' }
    );
    console.log(`  Project: "${project.name}"  ·  User: ${user.firstName} ${user.lastName}\n`);

    // ── Scorecard endpoint ──
    console.log('📋 TEST: Scorecard endpoint\n');
    const sc = await api('GET', `/api/competitive-analysis/scorecard/${testProjectId}`);
    if (sc.ok && sc.data.data) {
      const d = sc.data.data;
      const pillarsPresent =
        d.pricing && d.velocity && d.inventory && d.positioning && d.demand &&
        Array.isArray(d.leaderboard);
      if (pillarsPresent) {
        log('PASS', 'Scorecard returns all five pillars + leaderboard',
          `${d.velocity.totalUnits} units, ${d.pricing.competitorCount} competitors`);
      } else {
        log('FAIL', 'Scorecard missing pillars', JSON.stringify(Object.keys(d)));
      }
    } else {
      log('FAIL', 'Scorecard endpoint', `${sc.status}: ${JSON.stringify(sc.data)}`);
    }

    // ── Scorecard endpoint — bad project id ──
    const bad = await api('GET', '/api/competitive-analysis/scorecard/000000000000000000000000');
    if (bad.status === 404) {
      log('PASS', 'Scorecard 404s on unknown project');
    } else {
      log('FAIL', 'Scorecard bad-id handling', `expected 404, got ${bad.status}`);
    }

    // ── AI analysis endpoint (async poll) ──
    console.log('\n📋 TEST: Scorecard AI analysis (async)\n');
    const url = `/api/competitive-analysis/scorecard/${testProjectId}/analysis`;
    let res = await api('GET', url);
    let polls = 0;
    while (res.status === 202 && res.data?.status === 'processing' && polls < 25) {
      await sleep(3000);
      res = await api('GET', url);
      polls++;
    }
    if (res.ok && res.data?.status === 'completed' && res.data.data) {
      const md = res.data.data.marketDemand;
      if (res.data.data.verdict && md && typeof md.confidence === 'number') {
        log('PASS', 'Scorecard AI analysis completed',
          `confidence ${md.confidence} (${md.confidenceLabel}), polled ${polls}x`);
      } else {
        log('FAIL', 'AI analysis shape', JSON.stringify(res.data.data).slice(0, 200));
      }
    } else {
      log('FAIL', 'Scorecard AI analysis', `${res.status}: ${JSON.stringify(res.data).slice(0, 200)}`);
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
