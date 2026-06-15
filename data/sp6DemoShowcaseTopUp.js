// File: data/sp6DemoShowcaseTopUp.js
// 2026-06 "developer-ready" Leads refactor — NON-DESTRUCTIVE demo showcase top-up.
//
// The existing demo leads were already migrated to the new model by
// data/migrateLeadsDeveloperReady.js. This script only ADDS the data needed to
// SHOWCASE the new features, without touching existing bookings/payments/CP:
//   1. Seeds an org amenity catalog (idempotent) + back-fills amenities onto
//      existing leads that have none → populates the "most-wanted amenities"
//      demand report.
//   2. Creates a handful of Management- and Cold-Calling-sourced leads (the two
//      new sources absent from the migrated data) so the source mix is complete.
//   3. Creates a few Lost → Revived leads (with statusHistory + revivedCount)
//      so the revival report has data.
//
// Idempotent: showcase leads are tagged with a marker in `notes`; re-running
// skips creating them again. Run:  node data/sp6DemoShowcaseTopUp.js

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import Lead from '../models/leadModel.js';
import Amenity from '../models/amenityModel.js';
import Project from '../models/projectModel.js';
import User from '../models/userModel.js';
import { derivePriorityFromTimeline } from '../utils/leadPriority.js';
import { amenityKey } from '../utils/amenity.js';

dotenv.config();

const MARKER = '[SP6-SHOWCASE]';
const CATALOG = [
  'Swimming Pool', 'Gymnasium', 'Clubhouse', 'Concierge Service', 'Private Elevator',
  'Sea View Deck', 'Spa & Sauna', 'EV Charging', 'Home Automation', 'Infinity Pool',
  'Sky Lounge', 'Valet Parking', 'Landscaped Gardens', '24x7 Security', 'Kids Play Area',
];
const FACINGS = ['North', 'South', 'East', 'West', 'North-East', 'North-West', 'South-East', 'South-West', 'Any'];
const UNIT_TYPES = ['3BHK', '4BHK', '4BHK XL', 'Penthouse'];
const TIMELINES = ['immediate', '1-3_months', '3-6_months', '6-12_months', '12+_months'];
const BUDGETS = [
  { min: 10000000, max: 50000000 },   // 1-5Cr
  { min: 60000000, max: 100000000 },  // 6-10Cr
  { min: 110000000, max: 150000000 }, // 11-15Cr
  { min: 160000000, max: 200000000 }, // 16-20Cr
  { min: 500000000, max: null },      // 50Cr+
];

const pick = (arr, i) => arr[i % arr.length];
const daysAgo = (n) => new Date(Date.now() - n * 86400000);

const run = async () => {
  try {
    await connectDB();
    console.log('🎬 Demo showcase top-up (non-destructive)…');

    // Resolve the primary demo developer org = the org with the most leads.
    const [topOrg] = await Lead.aggregate([
      { $group: { _id: '$organization', n: { $sum: 1 } } },
      { $sort: { n: -1 } }, { $limit: 1 },
    ]);
    const orgId = topOrg?._id;
    if (!orgId) { console.log('No leads/org found — nothing to do.'); await mongoose.disconnect(); process.exit(0); }

    const projects = await Project.find({ organization: orgId }).select('_id name').lean();
    if (!projects.length) { console.log('No projects in org — aborting.'); await mongoose.disconnect(); process.exit(0); }
    const salesUsers = await User.find({
      organization: orgId,
      role: { $in: ['Sales Executive', 'Sales Manager', 'Business Head', 'Sales Head'] },
    }).select('_id').lean();
    const anyUser = salesUsers[0] || (await User.findOne({ organization: orgId }).select('_id').lean());
    const execId = (i) => (salesUsers.length ? pick(salesUsers, i)._id : anyUser?._id);
    const projId = (i) => pick(projects, i)._id;

    // ── 1) Amenity catalog (idempotent) ────────────────────────────────────
    for (const name of CATALOG) {
      await Amenity.findOneAndUpdate(
        { organization: orgId, nameLower: amenityKey(name) },
        { $setOnInsert: { organization: orgId, name, nameLower: amenityKey(name), createdBy: null } },
        { upsert: true }
      );
    }
    console.log(`✅ Amenity catalog: ${CATALOG.length} entries ensured.`);

    // Back-fill amenities onto existing leads that have none (for the demand report).
    const noAmenityFilter = {
      organization: orgId,
      notes: { $not: { $regex: '\\[SP6-SHOWCASE\\]' } },
      $or: [{ 'requirements.amenities': { $exists: false } }, { 'requirements.amenities': { $size: 0 } }],
    };
    const targets = await Lead.find(noAmenityFilter).select('_id').limit(90).lean();
    let backfilled = 0;
    for (let i = 0; i < targets.length; i++) {
      const a = CATALOG.slice(i % 6, (i % 6) + 3);
      await Lead.collection.updateOne({ _id: targets[i]._id }, { $set: { 'requirements.amenities': a } });
      backfilled++;
    }
    console.log(`✅ Back-filled amenities onto ${backfilled} existing leads.`);

    // ── 2/3) Showcase leads (idempotent via marker) ────────────────────────
    const existing = await Lead.countDocuments({ organization: orgId, notes: { $regex: '\\[SP6-SHOWCASE\\]' } });
    if (existing > 0) {
      console.log(`Showcase leads already present (${existing}) — skipping creation (re-run safe).`);
      await mongoose.disconnect(); process.exit(0);
    }

    const mk = (i, o) => {
      const t = o.timeline || pick(TIMELINES, i);
      const b = pick(BUDGETS, i);
      return new Lead({
        organization: orgId,
        project: projId(i),
        assignedTo: execId(i),
        firstName: o.firstName,
        lastName: o.lastName,
        phone: o.phone,
        email: `${o.firstName}.${o.lastName}`.toLowerCase().replace(/\s+/g, '') + '@example.com',
        source: o.source,
        ...(o.sourceDetail ? { sourceDetail: o.sourceDetail } : {}),
        status: o.status || 'New',
        statusHistory: o.statusHistory || [{ status: o.status || 'New', changedAt: daysAgo(3), changedBy: execId(i) }],
        ...(o.revivedCount ? { revivedCount: o.revivedCount } : {}),
        priority: derivePriorityFromTimeline(t),
        budget: { min: b.min, max: b.max, budgetSource: i % 2 ? 'bank_loan' : 'self_funded', currency: 'INR' },
        requirements: {
          timeline: t,
          unitType: pick(UNIT_TYPES, i),
          floor: { preference: pick(['any', 'low', 'medium', 'high'], i) },
          facing: pick(FACINGS, i),
          amenities: CATALOG.slice(i % 5, (i % 5) + 4),
        },
        notes: `${MARKER} ${o.note || ''}`.trim(),
      });
    };

    const revivedHistory = (i) => [
      { status: 'New', changedAt: daysAgo(40), changedBy: execId(i) },
      { status: 'Qualified', changedAt: daysAgo(34), changedBy: execId(i) },
      { status: 'Site Visit Completed', changedAt: daysAgo(28), changedBy: execId(i) },
      { status: 'Negotiating', changedAt: daysAgo(22), changedBy: execId(i) },
      { status: 'Lost', changedAt: daysAgo(16), changedBy: execId(i) },
      { status: 'Revived', changedAt: daysAgo(4), changedBy: execId(i) },
    ];

    const docs = [
      // Management-sourced (promoters / investors / board)
      mk(0, { firstName: 'Aditya', lastName: 'Birla', phone: '9810000001', source: 'Management', status: 'Qualified', sourceDetail: { management: { contactName: 'Mr. Mehta (Promoter)', note: 'Introduced by the promoter directly.' } }, note: 'Promoter-sourced.' }),
      mk(1, { firstName: 'Neha', lastName: 'Kapadia', phone: '9810000002', source: 'Management', status: 'Site Visit Completed', sourceDetail: { management: { contactName: 'Investor — Mr. Shah' } }, note: 'Investor network.' }),
      mk(2, { firstName: 'Vikram', lastName: 'Sethi', phone: '9810000003', source: 'Management', status: 'Negotiating', sourceDetail: { management: { contactName: 'Board member intro' } }, note: 'Board referral.' }),
      mk(3, { firstName: 'Riya', lastName: 'Khanna', phone: '9810000004', source: 'Management', status: 'New', sourceDetail: { management: { contactName: 'Promoter — Mrs. Rao' } }, note: 'Promoter-sourced.' }),
      // Cold-Calling-sourced
      mk(4, { firstName: 'Karan', lastName: 'Malhotra', phone: '9820000001', source: 'Cold Calling', status: 'New', note: 'Outbound campaign.' }),
      mk(5, { firstName: 'Pooja', lastName: 'Reddy', phone: '9820000002', source: 'Cold Calling', status: 'Qualified', note: 'Outbound campaign.' }),
      mk(6, { firstName: 'Arjun', lastName: 'Nair', phone: '9820000003', source: 'Cold Calling', status: 'New', note: 'Outbound campaign.' }),
      mk(7, { firstName: 'Sneha', lastName: 'Iyer', phone: '9820000004', source: 'Cold Calling', status: 'Site Visit Completed', note: 'Outbound campaign.' }),
      // Lost → Revived (revival report)
      Object.assign(mk(8, { firstName: 'Rohan', lastName: 'Kapoor', phone: '9830000001', source: 'Referral', status: 'Revived', revivedCount: 1, note: 'Revived after going cold.' }), {}),
      mk(9, { firstName: 'Ananya', lastName: 'Desai', phone: '9830000002', source: 'Direct', status: 'Revived', revivedCount: 1, note: 'Revived after price drop.' }),
      mk(10, { firstName: 'Kabir', lastName: 'Singh', phone: '9830000003', source: 'Marketing', status: 'Revived', revivedCount: 1, note: 'Revived from remarketing.' }),
    ];
    // attach the realistic Lost→Revived journey to the revived ones
    docs[8].statusHistory = revivedHistory(8);
    docs[9].statusHistory = revivedHistory(9);
    docs[10].statusHistory = revivedHistory(10);

    for (const d of docs) await d.save();
    console.log(`✅ Created ${docs.length} showcase leads (4 Management, 4 Cold Calling, 3 Lost→Revived).`);

    // Summary
    const bySource = await Lead.aggregate([
      { $match: { organization: orgId } }, { $group: { _id: '$source', n: { $sum: 1 } } }, { $sort: { _id: 1 } },
    ]);
    const revived = await Lead.countDocuments({ organization: orgId, status: 'Revived' });
    const everRevived = await Lead.countDocuments({ organization: orgId, revivedCount: { $gt: 0 } });
    console.log('📊 source mix:', bySource.map((s) => `${s._id}:${s.n}`).join('  '));
    console.log(`📊 currently Revived: ${revived} | ever revived: ${everRevived}`);

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('❌ Showcase top-up failed:', err);
    process.exit(1);
  }
};

run();
