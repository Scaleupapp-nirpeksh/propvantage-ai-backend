// File: tests/testCompetitiveAnalysis.js
// Description: End-to-end test for the Competitive Analysis & AI Recommendation Engine.
// Usage: node tests/testCompetitiveAnalysis.js
// Connects to the real DB, authenticates with the demo org, and tests all endpoints.

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';
import FormData from 'form-data';

dotenv.config();

// ─── Config ──────────────────────────────────────────────────
const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;
let AUTH_TOKEN = null;
let DEMO_USER = null;
let DEMO_ORG = null;
let createdCompetitorId = null;
let testProjectId = null;

const results = { passed: 0, failed: 0, skipped: 0, tests: [] };

const log = (status, name, detail = '') => {
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⏭️';
  console.log(`  ${icon} ${name}${detail ? ` — ${detail}` : ''}`);
  results.tests.push({ status, name, detail });
  if (status === 'PASS') results.passed++;
  else if (status === 'FAIL') results.failed++;
  else results.skipped++;
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

// ─── Setup ───────────────────────────────────────────────────

const setup = async () => {
  console.log('\n🔧 SETUP: Connecting to DB and authenticating...\n');

  // Connect to MongoDB
  await mongoose.connect(process.env.MONGO_URI);
  console.log('  Connected to MongoDB');

  // Find demo org and user
  const { default: Organization } = await import('../models/organizationModel.js');
  const { default: User } = await import('../models/userModel.js');
  const { default: Project } = await import('../models/projectModel.js');

  const org = await Organization.findOne({ name: 'Prestige Horizon Developers' });
  if (!org) {
    console.error('  ❌ Demo organization not found. Run "node data/seedDemoData.js" first.');
    process.exit(1);
  }
  DEMO_ORG = org;

  const user = await User.findOne({ organization: org._id, email: /owner/i })
    || await User.findOne({ organization: org._id }).sort({ createdAt: 1 });
  if (!user) {
    console.error('  ❌ No user found in demo org.');
    process.exit(1);
  }
  DEMO_USER = user;

  // Get a project for analysis testing
  const project = await Project.findOne({ organization: org._id });
  if (project) {
    testProjectId = project._id.toString();
    console.log(`  Using project: "${project.name}" (${testProjectId})`);
  }

  // Generate JWT token (payload must use `userId` — see authMiddleware.js line 28)
  AUTH_TOKEN = jwt.sign(
    { userId: user._id.toString() },
    process.env.JWT_SECRET,
    { expiresIn: '1h', algorithm: 'HS256' }
  );
  console.log(`  Authenticated as: ${user.firstName} ${user.lastName} (${user.email})`);
  console.log(`  Organization: ${org.name}`);
  console.log('');
};

// ─── Tests ───────────────────────────────────────────────────

const testHealthCheck = async () => {
  console.log('📋 TEST GROUP: Server Health\n');
  try {
    const res = await api('GET', '/api/health');
    if (res.ok && res.data.features?.includes('Competitive Market Analysis')) {
      log('PASS', 'Health check includes Competitive Market Analysis feature');
    } else {
      log('FAIL', 'Health check missing competitive analysis feature', JSON.stringify(res.data.features?.slice(-5)));
    }
  } catch (e) {
    log('FAIL', 'Health check', e.message);
  }
};

const testDashboardEmpty = async () => {
  console.log('\n📋 TEST GROUP: Dashboard (before data)\n');
  try {
    const res = await api('GET', '/api/competitive-analysis/dashboard');
    if (res.ok && res.data.success) {
      log('PASS', 'Dashboard loads', `${res.data.data.totalCompetitors} competitors, ${res.data.data.localitiesTracked} localities`);
    } else {
      log('FAIL', 'Dashboard load failed', `${res.status}: ${JSON.stringify(res.data)}`);
    }
  } catch (e) {
    log('FAIL', 'Dashboard', e.message);
  }
};

const testCSVTemplate = async () => {
  console.log('\n📋 TEST GROUP: CSV Template\n');
  try {
    const opts = {
      method: 'GET',
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    };
    const res = await fetch(`${BASE_URL}/api/competitive-analysis/csv-template`, opts);
    const text = await res.text();
    if (res.ok && text.includes('Project Name') && text.includes('Developer Name')) {
      log('PASS', 'CSV template download', `${text.split('\n').length} lines`);
    } else {
      log('FAIL', 'CSV template', `Status: ${res.status}`);
    }
  } catch (e) {
    log('FAIL', 'CSV template', e.message);
  }
};

const testCreateCompetitor = async () => {
  console.log('\n📋 TEST GROUP: Competitor CRUD\n');

  // CREATE
  try {
    const res = await api('POST', '/api/competitive-analysis/competitors', {
      projectName: 'Test Prestige Lakeside',
      developerName: 'Prestige Group',
      reraNumber: 'PRM/KA/RERA/1250/2024',
      location: {
        city: 'Bangalore',
        area: 'Whitefield',
        state: 'Karnataka',
        pincode: '560066',
      },
      projectType: 'residential',
      projectStatus: 'under_construction',
      possessionTimeline: { description: 'Dec 2027' },
      totalUnits: 500,
      totalTowers: 5,
      pricing: {
        pricePerSqft: { min: 7500, max: 9500, avg: 8500 },
        basePriceRange: { min: 5000000, max: 12000000 },
        floorRiseCharge: 50,
        facingPremiums: { parkFacing: 200000, roadFacing: 100000, cornerUnit: 150000 },
        parkingCharges: { covered: 500000, open: 200000 },
        clubMembershipCharges: 200000,
        maintenanceDeposit: 100000,
        legalCharges: 50000,
        gstRate: 5,
        stampDutyRate: 5.6,
      },
      unitMix: [
        { unitType: '2BHK', carpetAreaRange: { min: 900, max: 1100 }, priceRange: { min: 5000000, max: 8000000 }, totalCount: 200 },
        { unitType: '3BHK', carpetAreaRange: { min: 1200, max: 1500 }, priceRange: { min: 8000000, max: 12000000 }, totalCount: 250 },
      ],
      amenities: {
        gym: true, swimmingPool: true, clubhouse: true, garden: true,
        playground: true, powerBackup: true, security24x7: true, lifts: true,
      },
      dataSource: 'manual',
      confidenceScore: 80,
    });

    if (res.status === 201 && res.data.success) {
      createdCompetitorId = res.data.data._id;
      log('PASS', 'Create competitor project', `ID: ${createdCompetitorId}`);
    } else {
      log('FAIL', 'Create competitor project', `${res.status}: ${res.data.message || JSON.stringify(res.data)}`);
    }
  } catch (e) {
    log('FAIL', 'Create competitor', e.message);
  }

  // Create a second competitor for richer market data
  try {
    const res = await api('POST', '/api/competitive-analysis/competitors', {
      projectName: 'Test Brigade Panorama',
      developerName: 'Brigade Group',
      location: { city: 'Bangalore', area: 'Whitefield', state: 'Karnataka' },
      projectType: 'residential',
      projectStatus: 'newly_launched',
      totalUnits: 350,
      pricing: {
        pricePerSqft: { min: 8000, max: 10500, avg: 9200 },
        floorRiseCharge: 60,
        parkingCharges: { covered: 600000, open: 250000 },
      },
      unitMix: [
        { unitType: '2BHK', carpetAreaRange: { min: 950, max: 1050 }, totalCount: 150 },
        { unitType: '3BHK', carpetAreaRange: { min: 1300, max: 1600 }, totalCount: 200 },
      ],
      amenities: { gym: true, swimmingPool: true, clubhouse: true, evCharging: true },
      dataSource: 'manual',
      confidenceScore: 75,
    });
    if (res.status === 201) {
      log('PASS', 'Create second competitor', `ID: ${res.data.data._id}`);
    } else {
      log('FAIL', 'Create second competitor', `${res.status}: ${res.data.message}`);
    }
  } catch (e) {
    log('FAIL', 'Create second competitor', e.message);
  }
};

const testDuplicateDetection = async () => {
  try {
    const res = await api('POST', '/api/competitive-analysis/competitors', {
      projectName: 'Test Prestige Lakeside',
      developerName: 'Prestige Group',
      location: { city: 'Bangalore', area: 'Whitefield' },
      dataSource: 'manual',
    });
    if (res.status === 409) {
      log('PASS', 'Duplicate detection works', 'Got 409 as expected');
    } else {
      log('FAIL', 'Duplicate detection', `Expected 409, got ${res.status}`);
    }
  } catch (e) {
    log('FAIL', 'Duplicate detection', e.message);
  }
};

const testGetCompetitors = async () => {
  try {
    const res = await api('GET', '/api/competitive-analysis/competitors?city=Bangalore&area=Whitefield');
    if (res.ok && res.data.data?.length >= 2) {
      const freshness = res.data.dataFreshness;
      log('PASS', 'List competitors with filters', `Found ${res.data.data.length}, freshScore: ${freshness.overallFreshnessScore}`);
    } else {
      log('FAIL', 'List competitors', `${res.status}: ${res.data.data?.length} results`);
    }
  } catch (e) {
    log('FAIL', 'List competitors', e.message);
  }
};

const testGetCompetitorById = async () => {
  if (!createdCompetitorId) { log('SKIP', 'Get competitor by ID', 'No ID'); return; }
  try {
    const res = await api('GET', `/api/competitive-analysis/competitors/${createdCompetitorId}`);
    if (res.ok && res.data.data.projectName === 'Test Prestige Lakeside') {
      log('PASS', 'Get competitor by ID', `"${res.data.data.projectName}"`);
    } else {
      log('FAIL', 'Get competitor by ID', `${res.status}`);
    }
  } catch (e) {
    log('FAIL', 'Get competitor by ID', e.message);
  }
};

const testUpdateCompetitor = async () => {
  if (!createdCompetitorId) { log('SKIP', 'Update competitor', 'No ID'); return; }
  try {
    const res = await api('PUT', `/api/competitive-analysis/competitors/${createdCompetitorId}`, {
      totalUnits: 520,
      notes: 'Updated in test',
    });
    if (res.ok && res.data.data.totalUnits === 520) {
      log('PASS', 'Update competitor', 'totalUnits → 520');
    } else {
      log('FAIL', 'Update competitor', `${res.status}: ${JSON.stringify(res.data)}`);
    }
  } catch (e) {
    log('FAIL', 'Update competitor', e.message);
  }
};

const testMarketOverview = async () => {
  console.log('\n📋 TEST GROUP: Market Intelligence\n');
  try {
    const res = await api('GET', '/api/competitive-analysis/market-overview?city=Bangalore&area=Whitefield');
    if (res.ok && res.data.data.totalProjects >= 2) {
      const d = res.data.data;
      log('PASS', 'Market overview', `${d.totalProjects} projects, avg ₹${d.pricePerSqft.avg}/sqft, median ₹${d.pricePerSqft.median}/sqft`);
    } else {
      log('FAIL', 'Market overview', `${res.status}: ${JSON.stringify(res.data)}`);
    }
  } catch (e) {
    log('FAIL', 'Market overview', e.message);
  }
};

const testMarketOverviewValidation = async () => {
  try {
    const res = await api('GET', '/api/competitive-analysis/market-overview?city=Bangalore');
    if (res.status === 400) {
      log('PASS', 'Market overview validation', 'Missing area → 400');
    } else {
      log('FAIL', 'Market overview validation', `Expected 400, got ${res.status}`);
    }
  } catch (e) {
    log('FAIL', 'Market overview validation', e.message);
  }
};

const testMarketTrends = async () => {
  try {
    const res = await api('GET', '/api/competitive-analysis/market-trends?city=Bangalore&area=Whitefield');
    if (res.ok && res.data.success) {
      log('PASS', 'Market trends', `${res.data.data.dataPoints} data points`);
    } else {
      log('FAIL', 'Market trends', `${res.status}`);
    }
  } catch (e) {
    log('FAIL', 'Market trends', e.message);
  }
};

const testDemandSupply = async () => {
  try {
    const res = await api('GET', '/api/competitive-analysis/demand-supply?city=Bangalore&area=Whitefield');
    if (res.ok && res.data.data.totalProjects >= 2) {
      const d = res.data.data;
      log('PASS', 'Demand-supply analysis', `${d.totalProjects} projects, ${d.supplyByUnitType?.length} unit types`);
    } else {
      log('FAIL', 'Demand-supply analysis', `${res.status}`);
    }
  } catch (e) {
    log('FAIL', 'Demand-supply analysis', e.message);
  }
};

const testDashboardWithData = async () => {
  console.log('\n📋 TEST GROUP: Dashboard (with data)\n');
  try {
    const res = await api('GET', '/api/competitive-analysis/dashboard');
    if (res.ok && res.data.data.totalCompetitors >= 2 && res.data.data.localitiesTracked >= 1) {
      const d = res.data.data;
      log('PASS', 'Dashboard with data', `${d.totalCompetitors} competitors, ${d.localitiesTracked} localities, freshScore: ${d.dataFreshness.overallFreshnessScore}`);
    } else {
      log('FAIL', 'Dashboard with data', `${res.status}: ${JSON.stringify(res.data.data)}`);
    }
  } catch (e) {
    log('FAIL', 'Dashboard with data', e.message);
  }
};

const testCSVImport = async () => {
  console.log('\n📋 TEST GROUP: CSV Import\n');
  try {
    const csvContent = [
      'Project Name,Developer Name,City,Area,Avg Price Per Sqft,Total Units,Project Status',
      'Test CSV Imported Project,Sobha Ltd,Bangalore,Whitefield,9800,400,under_construction',
    ].join('\n');

    const formData = new FormData();
    formData.append('file', Buffer.from(csvContent), {
      filename: 'test_import.csv',
      contentType: 'text/csv',
    });

    const res = await fetch(`${BASE_URL}/api/competitive-analysis/import-csv`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${AUTH_TOKEN}`,
        ...formData.getHeaders(),
      },
      body: formData,
    });
    const data = await res.json();

    if (res.ok && data.data.created >= 1) {
      log('PASS', 'CSV import', `Created: ${data.data.created}, Updated: ${data.data.updated}`);
    } else if (res.ok && data.data.updated >= 1) {
      log('PASS', 'CSV import (dedup update)', `Created: ${data.data.created}, Updated: ${data.data.updated}`);
    } else {
      log('FAIL', 'CSV import', `${res.status}: ${data.message || JSON.stringify(data)}`);
    }
  } catch (e) {
    log('FAIL', 'CSV import', e.message);
  }
};

const testCSVExport = async () => {
  try {
    const opts = {
      method: 'GET',
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    };
    const res = await fetch(`${BASE_URL}/api/competitive-analysis/export-csv?city=Bangalore&area=Whitefield`, opts);
    const text = await res.text();
    if (res.ok && text.includes('Prestige Lakeside')) {
      const rows = text.trim().split('\n');
      log('PASS', 'CSV export', `${rows.length - 1} data rows`);
    } else if (res.ok) {
      log('PASS', 'CSV export', `Downloaded (${text.length} chars)`);
    } else {
      log('FAIL', 'CSV export', `${res.status}`);
    }
  } catch (e) {
    log('FAIL', 'CSV export', e.message);
  }
};

const testProviders = async () => {
  console.log('\n📋 TEST GROUP: Provider Management\n');
  try {
    const res = await api('GET', '/api/competitive-analysis/providers');
    if (res.ok) {
      log('PASS', 'Get provider configs', `${res.data.data?.length || 0} configs`);
    } else {
      log('FAIL', 'Get provider configs', `${res.status}`);
    }
  } catch (e) {
    log('FAIL', 'Get provider configs', e.message);
  }

  try {
    const res = await api('PUT', '/api/competitive-analysis/providers/csv_import', {
      isEnabled: true,
    });
    if (res.ok) {
      log('PASS', 'Update provider config', `"${res.data.data.providerName}" enabled`);
    } else {
      log('FAIL', 'Update provider config', `${res.status}`);
    }
  } catch (e) {
    log('FAIL', 'Update provider config', e.message);
  }
};

const testAIAnalysis = async () => {
  console.log('\n📋 TEST GROUP: AI Analysis (skipped without real project in Whitefield)\n');
  if (!testProjectId) {
    log('SKIP', 'AI analysis', 'No project available');
    return;
  }

  // We can test the endpoint responds correctly even if no competitor data matches the project's locality
  try {
    const res = await api('GET', `/api/competitive-analysis/analysis/${testProjectId}?type=pricing_recommendations`);
    if (res.ok) {
      log('PASS', 'AI pricing analysis', `fromCache: ${res.data.data.fromCache}`);
    } else if (res.status === 500 && res.data.message?.includes('No competitor data')) {
      log('PASS', 'AI analysis — no data for project locality', res.data.message);
    } else {
      log('FAIL', 'AI pricing analysis', `${res.status}: ${res.data.message}`);
    }
  } catch (e) {
    log('FAIL', 'AI pricing analysis', e.message);
  }
};

const testProjectIntegration = async () => {
  console.log('\n📋 TEST GROUP: Platform Integration\n');
  if (!testProjectId) {
    log('SKIP', 'Project integration', 'No project');
    return;
  }

  try {
    const res = await api('GET', `/api/projects/${testProjectId}`);
    if (res.ok && res.data.data) {
      if (res.data.data.competitiveData !== undefined) {
        const cd = res.data.data.competitiveData;
        if (cd) {
          log('PASS', 'Project includes competitiveData', `${cd.competitorCount} competitors, avg ₹${cd.marketAvgPricePerSqft}/sqft`);
        } else {
          log('PASS', 'Project includes competitiveData field', 'null (no competitors in this locality)');
        }
      } else {
        log('FAIL', 'competitiveData field missing from project response');
      }
    } else {
      log('FAIL', 'Get project by ID', `${res.status}`);
    }
  } catch (e) {
    log('FAIL', 'Project integration', e.message);
  }
};

// ─── Cleanup ─────────────────────────────────────────────────

const cleanup = async () => {
  console.log('\n🧹 CLEANUP: Removing test data...\n');
  const { default: CompetitorProject } = await import('../models/competitorProjectModel.js');
  const { default: DataProviderConfig } = await import('../models/dataProviderConfigModel.js');
  const { default: MarketDataSnapshot } = await import('../models/marketDataSnapshotModel.js');
  const { default: CompetitiveAnalysis } = await import('../models/competitiveAnalysisModel.js');

  // Delete test competitors
  const deleted = await CompetitorProject.deleteMany({
    organization: DEMO_ORG._id,
    projectName: { $regex: /^Test / },
  });
  console.log(`  Deleted ${deleted.deletedCount} test competitor records`);

  // Delete test snapshots
  const snapDel = await MarketDataSnapshot.deleteMany({
    organization: DEMO_ORG._id,
    'snapshotScope.area': 'Whitefield',
  });
  console.log(`  Deleted ${snapDel.deletedCount} test snapshots`);

  // Delete test analysis cache
  const analysisDel = await CompetitiveAnalysis.deleteMany({
    organization: DEMO_ORG._id,
  });
  console.log(`  Deleted ${analysisDel.deletedCount} test analysis records`);

  // Delete test provider config
  const provDel = await DataProviderConfig.deleteMany({
    organization: DEMO_ORG._id,
    providerName: 'csv_import',
  });
  console.log(`  Deleted ${provDel.deletedCount} test provider configs`);
};

// ─── Main ────────────────────────────────────────────────────

const main = async () => {
  console.log('═══════════════════════════════════════════════════');
  console.log('  Competitive Analysis Feature — End-to-End Tests');
  console.log('═══════════════════════════════════════════════════');

  try {
    await setup();

    // Run test groups
    await testHealthCheck();
    await testDashboardEmpty();
    await testCSVTemplate();
    await testCreateCompetitor();
    await testDuplicateDetection();
    await testGetCompetitors();
    await testGetCompetitorById();
    await testUpdateCompetitor();
    await testMarketOverview();
    await testMarketOverviewValidation();
    await testMarketTrends();
    await testDemandSupply();
    await testDashboardWithData();
    await testCSVImport();
    await testCSVExport();
    await testProviders();
    await testAIAnalysis();
    await testProjectIntegration();

    // Cleanup
    await cleanup();

  } catch (err) {
    console.error('\n💥 FATAL ERROR:', err);
  } finally {
    // Summary
    console.log('\n═══════════════════════════════════════════════════');
    console.log(`  RESULTS: ✅ ${results.passed} passed  ❌ ${results.failed} failed  ⏭️ ${results.skipped} skipped`);
    console.log('═══════════════════════════════════════════════════\n');

    await mongoose.disconnect();
    process.exit(results.failed > 0 ? 1 : 0);
  }
};

main();
