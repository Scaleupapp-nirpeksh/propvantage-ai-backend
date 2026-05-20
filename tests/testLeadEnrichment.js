// File: tests/testLeadEnrichment.js
// Description: End-to-end test for AI Lead Enrichment.
// Usage: node tests/testLeadEnrichment.js
// Requires the backend server running locally and a seeded demo org/project/user.

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';

dotenv.config();

const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;
let AUTH_TOKEN = null;
let testProjectId = null;
let createdLeadId = null;

const results = { passed: 0, failed: 0, skipped: 0 };

const log = (status, name, detail = '') => {
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⏭️';
  console.log(`  ${icon} ${name}${detail ? ` — ${detail}` : ''}`);
  if (status === 'PASS') results.passed++;
  else if (status === 'FAIL') results.failed++;
  else results.skipped++;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  console.log('  AI Lead Enrichment — End-to-End Test');
  console.log('═══════════════════════════════════════════════════\n');

  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('  Connected to MongoDB');

    const { default: Project } = await import('../models/projectModel.js');
    const { default: User } = await import('../models/userModel.js');
    const { default: Lead } = await import('../models/leadModel.js');

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
    console.log(`  Authenticated as: ${user.firstName} ${user.lastName}`);
    console.log(`  Using project: "${project.name}"\n`);

    // ── Create a lead WITH research sources ──
    console.log('📋 TEST: Create lead with research sources\n');
    const createRes = await api('POST', '/api/leads', {
      project: testProjectId,
      firstName: 'Enrichment',
      lastName: 'SmokeTest',
      phone: '+919000000001',
      source: 'Website',
      enrichment: {
        sources: {
          companyWebsite: 'https://www.tcs.com',
          articleUrls: ['https://en.wikipedia.org/wiki/Tata_Consultancy_Services'],
        },
      },
    });

    if (createRes.status === 201 && createRes.data.data?._id) {
      createdLeadId = createRes.data.data._id;
      const status = createRes.data.data.enrichment?.status;
      if (status === 'pending') {
        log('PASS', 'Lead created with enrichment status=pending', `ID: ${createdLeadId}`);
      } else {
        log('FAIL', 'Lead created but enrichment status wrong', `got "${status}"`);
      }
    } else {
      log('FAIL', 'Create lead', `${createRes.status}: ${JSON.stringify(createRes.data)}`);
      throw new Error('Cannot continue without a created lead');
    }

    // ── Poll until enrichment resolves ──
    console.log('\n📋 TEST: Poll for enrichment completion\n');
    const POLL_MS = 3000;
    const MAX_POLLS = 25;
    let polls = 0;
    let enrichment = null;
    do {
      await sleep(POLL_MS);
      const res = await api('GET', `/api/leads/${createdLeadId}`);
      enrichment = res.data.data?.enrichment;
      polls++;
    } while (
      enrichment &&
      ['pending', 'researching'].includes(enrichment.status) &&
      polls < MAX_POLLS
    );

    if (enrichment?.status === 'completed' && enrichment.summary) {
      log(
        'PASS',
        'Enrichment completed',
        `${enrichment.summary.length} char summary, ${enrichment.signals?.length || 0} signals (polled ${polls}x)`
      );
    } else if (enrichment?.status === 'failed') {
      log('FAIL', 'Enrichment failed', enrichment.error);
    } else {
      log('FAIL', 'Enrichment did not complete', `status="${enrichment?.status}" after ${polls} polls`);
    }

    // ── Re-run endpoint ──
    console.log('\n📋 TEST: Re-run endpoint returns 202\n');
    const rerunRes = await api('POST', `/api/leads/${createdLeadId}/enrich`, {});
    if (rerunRes.status === 202 && rerunRes.data.status === 'pending') {
      log('PASS', 'Re-run endpoint', 'Got 202 + status=pending');
    } else {
      log('FAIL', 'Re-run endpoint', `${rerunRes.status}: ${JSON.stringify(rerunRes.data)}`);
    }
  } catch (err) {
    console.error('\n💥 FATAL ERROR:', err.message);
  } finally {
    // ── Cleanup ──
    console.log('\n🧹 CLEANUP\n');
    if (createdLeadId) {
      const { default: Lead } = await import('../models/leadModel.js');
      await Lead.deleteOne({ _id: createdLeadId });
      console.log(`  Deleted test lead ${createdLeadId}`);
    }

    console.log('\n═══════════════════════════════════════════════════');
    console.log(`  RESULTS: ✅ ${results.passed} passed  ❌ ${results.failed} failed  ⏭️ ${results.skipped} skipped`);
    console.log('═══════════════════════════════════════════════════\n');

    await mongoose.disconnect();
    process.exit(results.failed > 0 ? 1 : 0);
  }
};

main();
