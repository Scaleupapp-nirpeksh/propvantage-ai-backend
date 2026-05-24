// File: data/mumbaiLuxuryCPSeeder.js
// Description: Channel Partner demo data for the "PropVantage Demo Realty"
//   Mumbai ultra-luxury demo org. Seeds CP firms + agents, commission rules,
//   tags a realistic share of existing leads and bookings with CP attribution,
//   and generates commission records via the real commission engine.
//
// Run AFTER the main Mumbai demo seeder (data/mumbaiLuxuryDemoSeederPart2.js).
// Usage:
//   node data/mumbaiLuxuryCPSeeder.js          # seed / re-seed (idempotent)
//   node data/mumbaiLuxuryCPSeeder.js --clean  # remove CP demo data and exit

import mongoose from 'mongoose';
import dotenv from 'dotenv';

import Organization from '../models/organizationModel.js';
import Project from '../models/projectModel.js';
import User from '../models/userModel.js';
import Lead from '../models/leadModel.js';
import Sale from '../models/salesModel.js';
import ChannelPartner from '../models/channelPartnerModel.js';
import ChannelPartnerAgent from '../models/channelPartnerAgentModel.js';
import CommissionRule from '../models/commissionRuleModel.js';
import CommissionRecord from '../models/commissionRecordModel.js';
import { syncCommissionForSale } from '../services/commissionService.js';

dotenv.config();

const DEMO_ORG_NAME = 'PropVantage Demo Realty';

// ─── Helpers ──────────────────────────────────────────────────
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const intBetween = (lo, hi) => Math.floor(Math.random() * (hi - lo + 1)) + lo;
const chance = (p) => Math.random() < p;
const daysAgo = (d) => new Date(Date.now() - d * 86400000);

const AGENT_FIRST = ['Arjun', 'Kabir', 'Ishaan', 'Rohan', 'Nikhil', 'Varun', 'Meera',
  'Ananya', 'Pooja', 'Sneha', 'Karan', 'Aditya', 'Riya', 'Tara', 'Devang'];
const AGENT_LAST = ['Shah', 'Mehta', 'Desai', 'Iyer', 'Nair', 'Rao', 'Kapoor',
  'Malhotra', 'Bhatt', 'Joshi', 'Sethi', 'Chopra', 'Merchant', 'Vora'];

// ─── Channel partner firm specs ───────────────────────────────
// approvedAreas references project locality areas in the demo (BKC / Worli / Bandra West).
const FIRM_SPECS = [
  {
    firmName: 'Crest Luxury Advisors',
    rera: 'A51900012345',
    approvedAreas: ['BKC', 'Worli', 'Bandra West'],
    status: 'active',
    category: 'broker_firm',
    contact: { name: 'Naveen Sippy', email: 'naveen@crestluxury.example.com', phone: '+919820011001' },
    agents: 4,
  },
  {
    firmName: 'Marine Drive Realty',
    rera: 'A51900023456',
    approvedAreas: ['BKC', 'Worli'],
    status: 'active',
    category: 'corporate',
    contact: { name: 'Farah Lalvani', email: 'farah@marinedriverealty.example.com', phone: '+919820011002' },
    agents: 3,
  },
  {
    firmName: 'Sterling Estate Partners',
    rera: 'A51900034567',
    approvedAreas: ['BKC', 'Worli', 'Bandra West'],
    status: 'active',
    category: 'broker_firm',
    contact: { name: 'Rajeev Anand', email: 'rajeev@sterlingestates.example.com', phone: '+919820011003' },
    agents: 4,
  },
  {
    firmName: 'Pinnacle Property Consultants',
    rera: 'A51900045678',
    approvedAreas: ['Worli', 'Bandra West'],
    status: 'active',
    category: 'individual_agent',
    contact: { name: 'Sunita Karani', email: 'sunita@pinnacleproperty.example.com', phone: '+919820011004' },
    agents: 3,
  },
  {
    firmName: 'Bandra Bay Realtors',
    rera: 'A51900056789',
    approvedAreas: ['Bandra West', 'BKC'],
    status: 'active',
    category: 'digital_aggregator',
    contact: { name: 'Imran Qureshi', email: 'imran@bandrabay.example.com', phone: '+919820011005' },
    agents: 2,
  },
  {
    firmName: 'Heritage Homes Brokerage',
    rera: 'A51900067890',
    approvedAreas: ['Bandra West'],
    status: 'suspended',
    category: 'individual_agent',
    contact: { name: 'Gautam Bhandari', email: 'gautam@heritagehomes.example.com', phone: '+919820011006' },
    agents: 2,
  },
];

// ─── Connection ───────────────────────────────────────────────
async function connect() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is not set in .env');
  await mongoose.connect(process.env.MONGO_URI);
  console.log('✅ Connected to MongoDB');
}

async function cleanCPData(orgId) {
  console.log('\n🧹 Removing any prior channel-partner demo data...');
  const rec = await CommissionRecord.deleteMany({ organization: orgId });
  const rule = await CommissionRule.deleteMany({ organization: orgId });
  const agent = await ChannelPartnerAgent.deleteMany({ organization: orgId });
  const firm = await ChannelPartner.deleteMany({ organization: orgId });
  await Sale.updateMany({ organization: orgId }, { $unset: { channelPartnerAttribution: '' } });
  await Lead.updateMany({ organization: orgId }, { $unset: { channelPartnerAttribution: '' } });
  console.log(
    `   removed ${firm.deletedCount} firms, ${agent.deletedCount} agents, ` +
    `${rule.deletedCount} rules, ${rec.deletedCount} records; cleared attribution on sales + leads`
  );
}

// ─── Seed ─────────────────────────────────────────────────────
// Exported so the master seeder (data/seedFullDemo.js) can run the CP seeding
// step without managing its own connection / disconnection. Standalone `main()`
// (below) still calls connect/disconnect for its own CLI lifecycle.
export async function seedCPDataForDemoOrg({ cleanOnly = false, skipCleanup = false, manageConnection = false } = {}) {
  if (manageConnection) await connect();
  try {
    const org = await Organization.findOne({ name: DEMO_ORG_NAME });
    if (!org) {
      console.error(`❌ Demo org "${DEMO_ORG_NAME}" not found. Run the Mumbai demo seeder first.`);
      return null;
    }

    if (!skipCleanup) {
      await cleanCPData(org._id);
    }
    if (cleanOnly) {
      console.log('\n✅ --clean done.');
      return null;
    }

    // Defer to the original inline body via the legacy main() — but extracted.
    return await _seedCPDataForDemoOrgInner(org);
  } finally {
    if (manageConnection) {
      await mongoose.disconnect();
      console.log('Disconnected.');
    }
  }
}

async function _seedCPDataForDemoOrgInner(org) {
  try {

    const projects = await Project.find({ organization: org._id });
    const users = await User.find({ organization: org._id });
    const owner =
      users.find((u) => /owner/i.test(u.role || '')) ||
      users.find((u) => u.firstName === 'Rohan') ||
      users[0];
    if (!projects.length || !owner) {
      console.error('❌ Demo org has no projects/users — run the Mumbai demo seeder first.');
      process.exitCode = 1;
      return;
    }

    const areaOf = (p) => p.location?.area || '';
    const projectByArea = (area) => projects.find((p) => areaOf(p) === area);

    // ── 1. Channel partner firms + agents ──────────────────────
    console.log('\n🤝 Seeding channel partner firms + agents...');
    const firms = [];
    for (const spec of FIRM_SPECS) {
      const approvedProjects = spec.approvedAreas
        .map((a) => projectByArea(a))
        .filter(Boolean)
        .map((p) => p._id);

      const firm = await ChannelPartner.create({
        organization: org._id,
        firmName: spec.firmName,
        reraRegistrationNumber: spec.rera,
        pan: `AAACP${intBetween(1000, 9999)}K`,
        gstin: `27AAACP${intBetween(1000, 9999)}K1Z5`,
        primaryContact: spec.contact,
        address: 'Mumbai, Maharashtra, India',
        approvedProjects,
        status: spec.status,
        category: spec.category,
        bankDetails: {
          accountName: spec.firmName,
          accountNumber: String(intBetween(100000000000, 999999999999)),
          ifsc: `HDFC000${intBetween(1000, 9999)}`,
          bankName: 'HDFC Bank',
        },
        agreementNotes: `Channel partner agreement signed ${daysAgo(intBetween(120, 400)).toDateString()}.`,
        onboardedBy: owner._id,
      });

      const agents = [];
      for (let i = 0; i < spec.agents; i++) {
        const fn = pick(AGENT_FIRST);
        const ln = pick(AGENT_LAST);
        const agent = await ChannelPartnerAgent.create({
          organization: org._id,
          channelPartner: firm._id,
          name: `${fn} ${ln}`,
          email: `${fn.toLowerCase()}.${ln.toLowerCase()}.${i}@${spec.firmName.split(' ')[0].toLowerCase()}.example.com`,
          phone: `+9198200${intBetween(20000, 99999)}`,
          reraAgentNumber: `A519${intBetween(100000, 999999)}`,
          status: 'active',
        });
        agents.push(agent);
      }
      firms.push({ firm, agents, approvedProjectIds: approvedProjects.map(String) });
      console.log(`   • ${spec.firmName} (${spec.status}) — ${agents.length} agents`);
    }

    const activeFirms = firms.filter((f) => f.firm.status === 'active');

    // ── 2. Commission rules ────────────────────────────────────
    console.log('\n📐 Seeding commission rules...');
    const bkc = projectByArea('BKC');
    const worli = projectByArea('Worli');

    const orgWideRule = await CommissionRule.create({
      organization: org._id,
      name: 'Standard Channel Partner Commission',
      description: '2% of sale price, paid half on booking and half on registration.',
      appliesToProject: null,
      rate: { method: 'percentage', percentage: 2, basis: 'sale_price' },
      payout: {
        schedule: 'tranches',
        tranches: [
          { label: 'On booking', percentage: 50, trigger: 'on_booking' },
          { label: 'On registration', percentage: 50, trigger: 'on_registration' },
        ],
      },
      tdsPercent: 5,
      status: 'active',
    });
    console.log('   • Standard Channel Partner Commission (all projects, 2%, 2 tranches)');

    if (bkc) {
      await CommissionRule.create({
        organization: org._id,
        name: 'Heliconia BKC — Launch Incentive',
        description: 'Enhanced 2.5% flagship rate, paid lump sum.',
        appliesToProject: bkc._id,
        rate: { method: 'percentage', percentage: 2.5, basis: 'sale_price' },
        payout: { schedule: 'lump_sum', tranches: [] },
        tdsPercent: 5,
        status: 'active',
      });
      console.log('   • Heliconia BKC — Launch Incentive (2.5%, lump sum)');
    }

    if (worli) {
      await CommissionRule.create({
        organization: org._id,
        name: 'Marquis Sea Face — Tiered Payout',
        description: '2.25%, paid across booking / agreement / registration.',
        appliesToProject: worli._id,
        rate: { method: 'percentage', percentage: 2.25, basis: 'sale_price' },
        payout: {
          schedule: 'tranches',
          tranches: [
            { label: 'On booking', percentage: 40, trigger: 'on_booking' },
            { label: 'On agreement', percentage: 30, trigger: 'on_agreement' },
            { label: 'On registration', percentage: 30, trigger: 'on_registration' },
          ],
        },
        tdsPercent: 5,
        status: 'active',
      });
      console.log('   • Marquis Sea Face — Tiered Payout (2.25%, 3 tranches)');
    }

    // ── 3. Tag bookings with CP attribution + generate commission ──
    console.log('\n🏷️  Tagging bookings with channel partner attribution...');
    const sales = await Sale.find({ organization: org._id });
    let taggedSales = 0;
    let splitSales = 0;
    const taggedLeadIds = new Set();

    for (const sale of sales) {
      // ~65% of luxury bookings come through a channel partner.
      if (!chance(0.65)) continue;

      const eligible = activeFirms.filter((f) =>
        f.approvedProjectIds.includes(String(sale.project))
      );
      if (eligible.length === 0) continue;

      let partners;
      if (eligible.length >= 2 && chance(0.2)) {
        // Co-sourced booking: 60/40 split across two firms.
        const [a, b] = [...eligible].sort(() => Math.random() - 0.5).slice(0, 2);
        partners = [
          { channelPartner: a.firm._id, agent: pick(a.agents)._id, sharePct: 60 },
          { channelPartner: b.firm._id, agent: pick(b.agents)._id, sharePct: 40 },
        ];
        splitSales++;
      } else {
        const f = pick(eligible);
        partners = [{ channelPartner: f.firm._id, agent: pick(f.agents)._id, sharePct: 100 }];
      }

      const taggedAt = sale.bookingDate ? new Date(sale.bookingDate) : daysAgo(intBetween(20, 200));
      sale.channelPartnerAttribution = {
        viaChannelPartner: true,
        partners,
        status: 'tagged',
        taggedBy: owner._id,
        taggedAt,
        history: [{ at: taggedAt, by: owner._id, action: 'tagged', note: 'Seeded demo attribution.' }],
      };
      await sale.save();
      await syncCommissionForSale(sale._id, owner._id);
      taggedSales++;

      if (sale.lead) taggedLeadIds.add(String(sale.lead));
    }
    console.log(`   tagged ${taggedSales} bookings (${splitSales} co-sourced splits)`);

    // ── 4. Mark a realistic share of payouts as paid ───────────
    console.log('\n💸 Marking payout tranches paid on older bookings...');
    const records = await CommissionRecord.find({ organization: org._id });
    let paidRecords = 0;
    let partialRecords = 0;
    for (const rec of records) {
      if (!rec.payouts || rec.payouts.length === 0) continue;
      const roll = Math.random();
      let paidCount = 0;
      if (roll < 0.35) {
        // Fully paid out.
        rec.payouts.forEach((p) => {
          p.status = 'paid';
          p.paidOn = daysAgo(intBetween(5, 120));
          p.paidBy = owner._id;
        });
        paidCount = rec.payouts.length;
        paidRecords++;
      } else if (roll < 0.7 && rec.payouts.length > 1) {
        // First tranche paid, rest pending.
        rec.payouts[0].status = 'paid';
        rec.payouts[0].paidOn = daysAgo(intBetween(5, 120));
        rec.payouts[0].paidBy = owner._id;
        paidCount = 1;
        partialRecords++;
      }
      if (paidCount > 0) {
        rec.history.push({
          at: daysAgo(intBetween(5, 120)),
          by: owner._id,
          action: 'payout_paid',
          note: `Seeded: ${paidCount} payout(s) marked paid.`,
        });
        rec.recomputeStatus();
        await rec.save();
      }
    }
    console.log(`   ${paidRecords} records fully paid, ${partialRecords} partially paid, of ${records.length} total`);

    // ── 5. Tag a set of leads (pipeline still open) ────────────
    console.log('\n🎯 Tagging open leads with channel partner attribution...');
    const leads = await Lead.find({ organization: org._id });
    let taggedLeads = 0;

    for (const lead of leads) {
      const alreadyConvertedTag = taggedLeadIds.has(String(lead._id));
      // Tag the lead behind every CP-sourced booking, plus ~20% of other leads.
      if (!alreadyConvertedTag && !chance(0.2)) continue;

      const eligible = activeFirms.filter((f) =>
        f.approvedProjectIds.includes(String(lead.project))
      );
      if (eligible.length === 0) continue;

      const f = pick(eligible);
      const taggedAt = lead.createdAt ? new Date(lead.createdAt) : daysAgo(intBetween(10, 120));
      lead.channelPartnerAttribution = {
        viaChannelPartner: true,
        partners: [{ channelPartner: f.firm._id, agent: pick(f.agents)._id, sharePct: 100 }],
        status: 'tagged',
        taggedBy: owner._id,
        taggedAt,
        history: [{ at: taggedAt, by: owner._id, action: 'tagged', note: 'Seeded demo attribution.' }],
      };
      await lead.save();
      taggedLeads++;
    }
    console.log(`   tagged ${taggedLeads} leads`);

    // ── Summary ────────────────────────────────────────────────
    const finalRecords = await CommissionRecord.find({ organization: org._id });
    const netTotal = finalRecords.reduce((s, r) => s + (r.netAmount || 0), 0);
    console.log('\n═══════════════════════════════════════════════════');
    console.log('  Channel Partner demo data seeded');
    console.log('═══════════════════════════════════════════════════');
    console.log(`  Firms:             ${firms.length} (${activeFirms.length} active)`);
    console.log(`  Commission rules:  ${await CommissionRule.countDocuments({ organization: org._id })}`);
    console.log(`  Tagged bookings:   ${taggedSales}`);
    console.log(`  Tagged leads:      ${taggedLeads}`);
    console.log(`  Commission records:${finalRecords.length}`);
    console.log(`  Total net commission: ₹${(netTotal / 1e7).toFixed(2)} Cr`);
    console.log('═══════════════════════════════════════════════════\n');
  } catch (err) {
    console.error('\n💥 Seeder failed:', err);
    throw err;
  }
}

// Standalone CLI entry — preserved for backward compat (node data/mumbaiLuxuryCPSeeder.js).
async function main() {
  const cleanOnly = process.argv.includes('--clean');
  try {
    await seedCPDataForDemoOrg({ cleanOnly, manageConnection: true });
  } catch (err) {
    process.exitCode = 1;
  }
}

export { main as cpSeederMain };

// Only run as a script when invoked directly (not when imported by master seeder).
const isDirectInvocation = import.meta.url === `file://${process.argv[1]}`;
if (isDirectInvocation) main();
