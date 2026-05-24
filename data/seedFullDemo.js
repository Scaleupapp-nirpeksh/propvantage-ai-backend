// File: data/seedFullDemo.js
// Description: MASTER demo seeder for PropVantage AI.
//   Wipes the entire MongoDB database and re-seeds an end-to-end, pitch-grade
//   Mumbai 2026 dataset spanning the developer + channel-partner platform
//   surfaces. Composes three pitch-ready seeders that already ship in
//   data/:
//     1. data/mumbaiLuxuryDemoSeeder.js       (PropVantage Demo Realty + projects + units + leads)
//     2. data/mumbaiLuxuryDemoSeederPart2.js  (sales + payments + competitors + AI cache + tasks)
//     3. data/mumbaiLuxuryCPSeeder.js         (developer-side CP firms + commission records)
//   …then layers on additional developer orgs (Crestline, Sunbridge) and
//   channel-partner orgs (Mumbai Realty Network, PrimeHomes, Asha Realty,
//   QuickClose, BlueWave) so the dataset shows EVERY platform surface:
//     • Partnerships marketplace (active + pending)
//     • CP prospects (platform + external context)
//     • Pushed leads in every lifecycle stage
//     • Sales in every status (Pending Approval, Booked, Cancelled)
//     • Commission invoices in every state (draft / submitted / approved / paid)
//     • The "≥20% paid → commission invoice auto-drafted" trigger
//
// Usage:
//   node data/seedFullDemo.js
//
// Idempotent — wipes everything first; re-running is safe.

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ─── Models ──────────────────────────────────────────────────────────
import Organization from '../models/organizationModel.js';
import User from '../models/userModel.js';
import Role from '../models/roleModel.js';
import Project from '../models/projectModel.js';
import Tower from '../models/towerModel.js';
import Unit from '../models/unitModel.js';
import Lead from '../models/leadModel.js';
import Interaction from '../models/interactionModel.js';
import Sale from '../models/salesModel.js';
import PaymentPlan from '../models/paymentPlanModel.js';
import Installment from '../models/installmentModel.js';
import PaymentTransaction from '../models/paymentTransactionModel.js';
import ProjectAssignment from '../models/projectAssignmentModel.js';
import Task from '../models/taskModel.js';
import Notification from '../models/notificationModel.js';
import ChannelPartner from '../models/channelPartnerModel.js';
import ChannelPartnerAgent from '../models/channelPartnerAgentModel.js';
import CommissionRule from '../models/commissionRuleModel.js';
import CommissionRecord from '../models/commissionRecordModel.js';
import CommissionInvoice from '../models/commissionInvoiceModel.js';
import Partnership from '../models/partnershipModel.js';
import Prospect from '../models/prospectModel.js';
import ExternalDeveloper from '../models/externalDeveloperModel.js';

// ─── Role / approval seeders ────────────────────────────────────────
import { seedDefaultRoles } from './defaultRoles.js';
import { seedChannelPartnerRoles } from './defaultChannelPartnerRoles.js';
import { seedDefaultApprovalPolicies } from './seedDefaultApprovalPolicies.js';

// ─── Existing Mumbai seeder functions (re-exported helpers) ─────────
import {
  seedOrgAndUsers,
  seedProjects,
  seedProjectAssignments,
  seedTowers,
  seedUnits,
  seedLeadsAndInteractions,
  daysFromNow,
  daysAgo,
  pick,
  pickN,
  intBetween,
  crToINR,
  lakhsToINR,
  roundTo,
  HNI_FIRST_NAMES,
  HNI_LAST_NAMES,
  DEMO_PASSWORD,
} from './mumbaiLuxuryDemoSeeder.js';
import {
  seedSales,
  seedCompetitors,
  seedCompetitiveAnalysis,
  seedTasksAndNotifications,
} from './mumbaiLuxuryDemoSeederPart2.js';
import { seedCPDataForDemoOrg } from './mumbaiLuxuryCPSeeder.js';

// ─── Real service calls (so commission engine fires properly) ───────
import { syncCommissionForSale } from '../services/commissionService.js';
import { checkAndFireTrigger } from '../services/commissionInvoiceTriggerService.js';

dotenv.config();

// =============================================================================
// CONFIG
// =============================================================================

const PASSWORD = 'Demo@1234'; // Must satisfy User model validator: A-Z, a-z, 0-9, special.

// Reusable phone counter — must be globally unique across seeded orgs.
let _phoneCounter = 20000;
const phoneIN = () => '+91 9' + String(98 * 1000000 + _phoneCounter++).padStart(9, '0');

// Helpers (mirroring the existing seeders' style)
const chance = (p) => Math.random() < p;
const pickWeighted = (items) => {
  // items: [{ value, weight }]
  const total = items.reduce((s, i) => s + i.weight, 0);
  const r = Math.random() * total;
  let acc = 0;
  for (const i of items) {
    acc += i.weight;
    if (r <= acc) return i.value;
  }
  return items[items.length - 1].value;
};

const realisticEmail = (firstName, lastName, salt = '') => {
  const f = String(firstName).toLowerCase().replace(/[^a-z]/g, '');
  const l = String(lastName).toLowerCase().replace(/[^a-z]/g, '');
  const seed = salt ? `.${salt}` : '';
  return `${f}.${l}${seed}@gmail.com`;
};

// =============================================================================
// CONNECT / DISCONNECT
// =============================================================================

async function connect() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is not set in .env');
  await mongoose.connect(process.env.MONGO_URI);
  console.log('✅ Connected to MongoDB');
}

async function disconnect() {
  await mongoose.disconnect();
  console.log('🔌 Disconnected from MongoDB');
}

// =============================================================================
// PHASE A — NUKE EVERYTHING
// =============================================================================

async function nukeDatabase() {
  console.log('\n' + '═'.repeat(70));
  console.log('💥  PHASE A — WIPING ENTIRE DATABASE');
  console.log('═'.repeat(70));
  const db = mongoose.connection.db;
  const collections = await db.collections();
  let dropped = 0;
  for (const coll of collections) {
    const name = coll.collectionName;
    if (name.startsWith('system.')) continue;
    try {
      await coll.drop();
      dropped++;
      console.log(`   dropped collection: ${name}`);
    } catch (err) {
      // ns-not-found is fine if a previous drop already removed it.
      if (err.code !== 26) console.warn(`   ⚠️  drop ${name} failed: ${err.message}`);
    }
  }
  console.log(`✅ ${dropped} collection(s) dropped — database is empty.\n`);
}

// =============================================================================
// PHASE B — BUILDER ORG BUILDER (generic factory for the new dev orgs)
// =============================================================================

async function buildDeveloperOrg({
  orgName,
  contactPhone,
  contactWebsite,
  contactAddress,
  city = 'Mumbai',
  invoicePolicyTriggerPct = 0.20,
  users: userSpecs,
  projects: projectSpecs,
  commissionPercent = 4,
}) {
  console.log(`\n🏢 Creating organization "${orgName}"…`);

  const org = await Organization.create({
    name: orgName,
    type: 'builder',
    country: 'India',
    city,
    contactInfo: { phone: contactPhone, website: contactWebsite, address: contactAddress },
    subscriptionPlan: 'enterprise',
    isActive: true,
    invoicePolicy: { commissionInvoiceTriggerPct: invoicePolicyTriggerPct },
  });

  // Roles + approval policies
  await seedDefaultRoles(org._id);
  await seedDefaultApprovalPolicies(org._id);
  const allRoles = await Role.find({ organization: org._id });
  const roleByName = Object.fromEntries(allRoles.map((r) => [r.name, r]));
  console.log(`   ✅ org created + ${allRoles.length} roles + approval policies seeded`);

  // Users
  const users = {};
  for (const spec of userSpecs) {
    const role = roleByName[spec.roleRefName];
    if (!role) {
      console.warn(`   ⚠️  role "${spec.roleRefName}" not found — skipping ${spec.firstName}`);
      continue;
    }
    const u = await User.create({
      organization: org._id,
      firstName: spec.firstName,
      lastName: spec.lastName,
      email: spec.email,
      password: PASSWORD,
      role: spec.legacyRole,
      roleRef: role._id,
      isActive: true,
      invitationStatus: 'accepted',
      acceptedAt: daysAgo(intBetween(30, 200)),
    });
    users[spec.key] = u;
  }
  console.log(`   ✅ ${Object.keys(users).length} users created`);

  const owner = users[userSpecs[0].key];

  // Projects + towers + units
  const projectsCreated = [];
  const allUnits = [];
  const allTowers = [];
  for (const ps of projectSpecs) {
    const project = await Project.create({
      organization: org._id,
      name: ps.name,
      description: ps.description,
      type: 'apartment',
      status: ps.status,
      location: { city, area: ps.area, pincode: ps.pincode, state: 'Maharashtra' },
      totalUnits: ps.unitCount,
      totalArea: ps.totalArea,
      priceRange: { min: ps.priceMin, max: ps.priceMax },
      targetRevenue: ps.targetRevenue,
      launchDate: daysAgo(ps.launchDaysAgo),
      expectedCompletionDate: daysFromNow(ps.completionDaysAhead),
      amenities: ps.amenities,
      pricingRules: { gstRate: 5, tdsRate: 1, floorRiseCharge: 100000 },
      additionalCharges: [
        { name: 'Covered Parking', amount: 1500000, type: 'one-time' },
        { name: 'Club Membership', amount: 800000, type: 'one-time' },
        { name: 'Maintenance Deposit', amount: 600000, type: 'one-time' },
      ],
      approvals: {
        rera: { number: `P51900${intBetween(60000, 79999)}`, date: daysAgo(ps.launchDaysAgo + 30), validUntil: daysFromNow(ps.completionDaysAhead + 200) },
      },
      budgetTracking: { enabled: true, varianceThreshold: 10, targetPricePerUnit: (ps.priceMin + ps.priceMax) / 2 },
    });
    projectsCreated.push(project);
    console.log(`   ✅ project "${project.name}" (${ps.area})`);

    // Towers + units
    for (const tspec of ps.towers) {
      const tower = await Tower.create({
        organization: org._id,
        project: project._id,
        towerName: tspec.name,
        towerCode: tspec.code,
        totalFloors: tspec.floors,
        unitsPerFloor: tspec.unitsPerFloor,
        totalUnits: tspec.floors * tspec.unitsPerFloor,
        towerType: 'residential',
        status: project.status === 'completed' ? 'completed' : project.status === 'launched' ? 'planning' : 'under_construction',
        construction: { progress: project.status === 'completed' ? 100 : project.status === 'launched' ? 5 : intBetween(25, 70) },
        createdBy: owner._id,
      });
      allTowers.push(tower);

      const unitDocs = [];
      for (let f = 1; f <= tspec.floors; f++) {
        for (let u = 1; u <= tspec.unitsPerFloor; u++) {
          const unitType = pick(tspec.unitTypes);
          const carpet = intBetween(unitType.carpetMin, unitType.carpetMax);
          const sbp = Math.round(carpet * 1.42);
          const basePrice = roundTo(sbp * unitType.pricePerSqft, 50000);
          // Status mix — favor available for new launches; sold for completed
          const statusMix =
            project.status === 'completed' ? { available: 0.10, sold: 0.85, blocked: 0.05 } :
            project.status === 'launched' ? { available: 0.80, sold: 0.10, booked: 0.05, blocked: 0.05 } :
            { available: 0.50, sold: 0.35, booked: 0.05, blocked: 0.10 };
          const r = Math.random();
          let status = 'available', acc = 0;
          for (const [k, v] of Object.entries(statusMix)) { acc += v; if (r <= acc) { status = k; break; } }
          unitDocs.push({
            organization: org._id,
            project: project._id,
            tower: tower._id,
            unitNumber: `${tspec.code}-${f}0${u}`,
            type: unitType.type,
            floor: f,
            areaSqft: sbp,
            carpetArea: carpet,
            builtUpArea: Math.round(carpet * 1.20),
            superBuiltUpArea: sbp,
            basePrice,
            currentPrice: basePrice,
            facing: pick(['North', 'South', 'East', 'West', 'North-East', 'South-East']),
            status,
            features: {
              isParkFacing: chance(0.30), isCornerUnit: chance(0.25),
              hasBalcony: true, hasServantRoom: chance(0.4), hasParkingSlot: true,
            },
            specifications: {
              bedrooms: unitType.type.startsWith('1') ? 1 : unitType.type.startsWith('2') ? 2 : unitType.type.startsWith('3') ? 3 : 4,
              bathrooms: unitType.type.startsWith('1') ? 1 : unitType.type.startsWith('2') ? 2 : 3,
              livingRooms: 1, kitchen: 1, balconies: 2,
              carpetArea: carpet, builtUpArea: Math.round(carpet * 1.20), superBuiltUpArea: sbp,
            },
            parking: { covered: 1, open: 0 },
            createdBy: owner._id,
          });
        }
      }
      const inserted = await Unit.insertMany(unitDocs);
      allUnits.push(...inserted);
    }
  }
  console.log(`   ✅ ${allTowers.length} towers + ${allUnits.length} units`);

  // Project assignments — give every user access to every project
  const assignments = [];
  for (const project of projectsCreated) {
    for (const u of Object.values(users)) {
      assignments.push({
        organization: org._id, user: u._id, project: project._id,
        assignedBy: owner._id, assignedAt: daysAgo(intBetween(10, 90)),
      });
    }
  }
  await ProjectAssignment.insertMany(assignments);

  // Org-wide commission rule
  await CommissionRule.create({
    organization: org._id,
    name: `${orgName} Standard CP Commission`,
    description: `${commissionPercent}% of sale price, paid on booking.`,
    appliesToProject: null,
    rate: { method: 'percentage', percentage: commissionPercent, basis: 'sale_price' },
    payout: { schedule: 'lump_sum', tranches: [] },
    tdsPercent: 5,
    status: 'active',
  });

  return { org, users, owner, projects: projectsCreated, units: allUnits, towers: allTowers, roleByName };
}

// =============================================================================
// PHASE C — LEADS / SALES / PAYMENTS / INVOICES FOR A NEW DEV ORG
// =============================================================================

async function seedLeadsForOrg({ org, users, projects, units }) {
  console.log(`\n🎯 Creating leads + interactions for "${org.name}"…`);
  const salesExecs = Object.values(users).filter((u) => u.role === 'Sales Executive' || u.role === 'Sales Manager');
  if (salesExecs.length === 0) salesExecs.push(...Object.values(users)); // fallback

  const leadsToCreate = [];
  const interactionsToCreate = [];

  // Generate 50-80 leads spread across projects
  const leadsPerProject = Math.floor(intBetween(50, 80) / projects.length);
  for (const project of projects) {
    const projectMid = (project.priceRange.min + project.priceRange.max) / 2;
    for (let i = 0; i < leadsPerProject; i++) {
      const firstName = pick(HNI_FIRST_NAMES);
      const lastName = pick(HNI_LAST_NAMES);
      const exec = pick(salesExecs);
      const ageInDays = intBetween(2, 180);
      const interactionCount = ageInDays <= 30 ? intBetween(1, 4) : intBetween(2, 7);
      const daysSinceLast = Math.min(ageInDays, intBetween(0, 25));
      const source = pickWeighted([
        { value: 'Referral', weight: 25 }, { value: 'Walk-in', weight: 18 },
        { value: 'Property Portal', weight: 22 }, { value: 'Website', weight: 15 },
        { value: 'Social Media', weight: 12 }, { value: 'Advertisement', weight: 8 },
      ]);
      const timeline = pick(['immediate', '1-3_months', '3-6_months', '6-12_months', '12+_months']);
      const dev = (Math.random() - 0.5) * 0.5;
      const midBudget = projectMid * (1 + dev);
      const budget = {
        min: Math.round(midBudget * 0.85),
        max: Math.round(midBudget * 1.15),
        isValidated: source === 'Referral',
        budgetSource: source === 'Referral' ? 'pre_approved' : 'self_reported',
      };

      // Status weighting
      const status = pickWeighted([
        { value: 'New', weight: 18 }, { value: 'Contacted', weight: 22 },
        { value: 'Qualified', weight: 18 }, { value: 'Site Visit Scheduled', weight: 10 },
        { value: 'Site Visit Completed', weight: 10 }, { value: 'Negotiating', weight: 8 },
        { value: 'Lost', weight: 8 }, { value: 'Booked', weight: 6 },
      ]);

      const score = Math.max(30, Math.min(95, 60 + Math.round((Math.random() - 0.5) * 50)));
      const scoreGrade = score >= 85 ? 'A+' : score >= 75 ? 'A' : score >= 65 ? 'B+' : score >= 55 ? 'B' : score >= 45 ? 'C+' : score >= 35 ? 'C' : 'D';

      leadsToCreate.push({
        organization: org._id,
        project: project._id,
        assignedTo: exec._id,
        firstName, lastName,
        email: realisticEmail(firstName, lastName, String(i)),
        phone: phoneIN(),
        source, status,
        score, scoreGrade,
        priority: score >= 85 ? 'Critical' : score >= 70 ? 'High' : score >= 55 ? 'Medium' : score >= 40 ? 'Low' : 'Very Low',
        confidence: intBetween(70, 95),
        budget,
        requirements: {
          timeline,
          unitType: pick(['1BHK', '2BHK', '3BHK']),
          floor: { preference: pick(['low', 'medium', 'high', 'any']) },
          facing: pick(['North', 'South', 'East', 'West', 'Any']),
        },
        scoreBreakdown: {
          budgetAlignment: { rawScore: 70, weightedScore: 21, reasoning: 'Budget aligned with project pricing' },
          engagementLevel: { rawScore: interactionCount * 12, weightedScore: Math.round(interactionCount * 3), reasoning: `${interactionCount} interactions`, interactionCount },
          timelineUrgency: { rawScore: 70, weightedScore: 14, reasoning: 'Active buyer', timeline },
          sourceQuality: { rawScore: 70, weightedScore: 10, reasoning: source, source },
          recencyFactor: { rawScore: 70, weightedScore: 7, reasoning: 'Recent', ageInDays },
        },
        lastScoreUpdate: daysAgo(intBetween(0, 5)),
        notes: pick([
          'Looking for ready-to-move',
          'Investment + end-use',
          'Wife wants high floor',
          'Relocating from another city',
          'Budget validated by their banker',
        ]),
        createdAt: daysAgo(ageInDays),
      });
    }
  }

  const leads = await Lead.insertMany(leadsToCreate);
  console.log(`   ✅ ${leads.length} leads`);

  // Interactions per lead
  for (const lead of leads) {
    const count = lead.scoreBreakdown.engagementLevel.interactionCount;
    for (let k = 0; k < count; k++) {
      const t = pick(['Call', 'Email', 'WhatsApp', 'Meeting', 'Site Visit', 'Note']);
      interactionsToCreate.push({
        organization: org._id,
        project: lead.project,
        lead: lead._id,
        user: lead.assignedTo,
        type: t,
        direction: pick(['Inbound', 'Outbound']),
        content: pick(['Discussed pricing options', 'Sent floor plans', 'Scheduled site visit', 'Negotiating final price']),
        summary: pick(['Positive interest', 'Awaiting follow-up']),
        outcome: pick(['Positive', 'Neutral', 'Positive — moving to next step']),
        nextAction: pick(['Follow up in 3 days', 'Send pricing options', 'Schedule site visit']),
        createdBy: lead.assignedTo,
        createdAt: daysAgo(intBetween(0, 60)),
      });
    }
  }
  if (interactionsToCreate.length) await Interaction.insertMany(interactionsToCreate);
  console.log(`   ✅ ${interactionsToCreate.length} interactions`);

  return leads;
}

async function seedSalesForOrg({ org, owner, users, projects, units, leads }) {
  console.log(`\n💰 Creating sales + payment plans for "${org.name}"…`);
  const financeUsers = Object.values(users).filter((u) => /finance/i.test(u.role || ''));
  const finance = financeUsers[0] || owner;
  const salesExecs = Object.values(users).filter((u) => u.role === 'Sales Executive' || u.role === 'Sales Manager' || u.role === 'Sales Head');

  // 10-15 sales total (with status variety) — pick lead/unit pairs from each project
  const salesToCreate = [];
  const paymentPlansData = [];
  const installmentsToCreate = [];
  const txnsToCreate = [];
  const usedUnitIds = new Set();
  const createdSales = [];

  let saleCounter = 0;

  // Distribution: 1 Pending Approval, 1 Cancelled, rest Booked/Agreement Signed
  const targetCount = intBetween(10, 14);
  const statusPlan = [];
  for (let i = 0; i < targetCount; i++) {
    if (i === 0) statusPlan.push('Pending Approval');
    else if (i === 1) statusPlan.push('Cancelled');
    else statusPlan.push(chance(0.6) ? 'Agreement Signed' : 'Booked');
  }

  // Paid-pct ladder — guarantees variety so dashboard demos
  // show different states of customer collection. Includes 3 entries
  // > 0.20 so the commission trigger demo fires for CP-attributed ones.
  const paidPctPlan = [0, 0.15, 0.25, 0.30, 0.50, 0.80, 1.00, 0.25, 0.10, 0.55, 0.80, 0.30, 0.45, 0.20];

  for (const project of projects) {
    const projectAvailableUnits = units.filter((u) => u.project.equals(project._id) && !usedUnitIds.has(u._id.toString()));
    const projectLeads = leads.filter((l) => l.project.equals(project._id));
    const perProject = Math.ceil(targetCount / projects.length);
    for (let i = 0; i < perProject && saleCounter < targetCount; i++) {
      const unit = projectAvailableUnits[i];
      if (!unit) break;
      usedUnitIds.add(unit._id.toString());
      const lead = projectLeads[i % projectLeads.length];
      if (!lead) break;

      const exec = pick(salesExecs) || owner;
      const saleStatus = statusPlan[saleCounter];
      const targetPaidPct = paidPctPlan[saleCounter % paidPctPlan.length];
      saleCounter++;

      const saleDate = daysAgo(intBetween(20, 200));
      const basePrice = unit.basePrice;
      const totalSalePrice = Math.round(basePrice * 1.15);
      const discount = chance(0.3) ? Math.round(basePrice * 0.01) : 0;
      const finalPrice = totalSalePrice - discount;

      const saleId = new mongoose.Types.ObjectId();
      salesToCreate.push({
        _id: saleId,
        organization: org._id,
        project: unit.project,
        unit: unit._id,
        lead: lead._id,
        salesPerson: exec._id,
        customerDetails: {
          firstName: lead.firstName, lastName: lead.lastName,
          email: lead.email, phone: lead.phone,
          address: 'Mumbai, Maharashtra, India',
          panNumber: `ABCDE${intBetween(1000, 9999)}F`,
        },
        salePrice: finalPrice,
        discountAmount: discount,
        bookingDate: saleDate,
        status: saleStatus,
        commission: { rate: 1.5, amount: Math.round(finalPrice * 0.015) },
        costSheetSnapshot: {
          basePrice,
          floorPremium: unit.floor * 100000,
          plcCharges: 0,
          gst: Math.round(basePrice * 0.05),
          tds: Math.round(basePrice * 0.01),
          additionalCharges: 2900000,
          discount,
          totalAmount: finalPrice,
        },
        notes: saleStatus === 'Cancelled' ? 'Customer withdrew due to relocation' : 'Booking confirmed; processing agreement',
        cancellationReason: saleStatus === 'Cancelled' ? 'Customer withdrew booking due to job relocation' : undefined,
        cancelledBy: saleStatus === 'Cancelled' ? exec._id : undefined,
        cancelledAt: saleStatus === 'Cancelled' ? daysAgo(intBetween(5, 30)) : undefined,
        createdBy: exec._id,
      });

      // Mark lead Booked (unless cancelled)
      if (saleStatus !== 'Cancelled') {
        lead.status = 'Booked';
      }

      // Payment plan (10-20-70)
      const planId = new mongoose.Types.ObjectId();
      const installmentDefs = [
        { number: 1, name: 'Booking', percentage: 10, type: 'booking', dueDate: saleDate },
        { number: 2, name: 'Within 60 days', percentage: 20, type: 'time_based', dueDate: new Date(saleDate.getTime() + 60 * 86400000) },
        { number: 3, name: 'Slab 10', percentage: 17.5, type: 'construction', dueDate: new Date(saleDate.getTime() + 180 * 86400000) },
        { number: 4, name: 'Slab 20', percentage: 17.5, type: 'construction', dueDate: new Date(saleDate.getTime() + 360 * 86400000) },
        { number: 5, name: 'Slab 30', percentage: 17.5, type: 'construction', dueDate: new Date(saleDate.getTime() + 540 * 86400000) },
        { number: 6, name: 'Possession', percentage: 17.5, type: 'possession', dueDate: new Date(saleDate.getTime() + 720 * 86400000) },
      ];
      paymentPlansData.push({
        _id: planId,
        organization: org._id,
        project: unit.project,
        sale: saleId,
        unit: unit._id,
        customer: lead._id,
        planType: 'construction_linked',
        templateName: 'Construction-Linked Plan (10-20-70)',
        baseAmount: basePrice,
        totalAmount: finalPrice,
        scheduledTotal: finalPrice,
        amountBreakdown: {
          basePrice,
          taxes: { gst: Math.round(basePrice * 0.05) },
          additionalCharges: { parkingCharges: 1500000, clubMembership: 800000, maintenanceDeposit: 600000 },
          discounts: { total: discount },
        },
        currency: 'INR',
        terms: { startDate: saleDate },
        status: saleStatus === 'Cancelled' ? 'cancelled' : 'active',
        createdBy: exec._id,
      });

      // Cumulative paid target
      const targetPaidAmount = saleStatus === 'Cancelled' ? finalPrice * 0.05 : finalPrice * targetPaidPct;
      let remainingToPay = targetPaidAmount;

      for (const def of installmentDefs) {
        const amount = Math.round(finalPrice * (def.percentage / 100));
        const isPastDue = def.dueDate < new Date();
        let paidAmount = 0, instStatus = 'pending';

        if (saleStatus !== 'Cancelled' && remainingToPay > 0) {
          if (remainingToPay >= amount) {
            paidAmount = amount;
            instStatus = 'paid';
            remainingToPay -= amount;
          } else if (remainingToPay > 0) {
            paidAmount = Math.round(remainingToPay);
            instStatus = 'partially_paid';
            remainingToPay = 0;
          }
        }
        if (paidAmount === 0 && isPastDue && saleStatus !== 'Cancelled') {
          instStatus = 'overdue';
        }

        const instId = new mongoose.Types.ObjectId();
        installmentsToCreate.push({
          _id: instId,
          organization: org._id,
          project: unit.project,
          sale: saleId,
          paymentPlan: planId,
          unit: unit._id,
          customer: lead._id,
          installmentNumber: def.number,
          installmentName: def.name,
          description: def.name,
          milestoneType: def.type,
          milestoneDescription: def.name,
          originalAmount: amount,
          currentAmount: amount,
          paidAmount,
          dueDate: def.dueDate,
          currentDueDate: def.dueDate,
          originalDueDate: def.dueDate,
          status: instStatus,
          currency: 'INR',
          createdBy: exec._id,
        });

        if (paidAmount > 0) {
          txnsToCreate.push({
            organization: org._id,
            project: unit.project,
            sale: saleId,
            paymentPlan: planId,
            customer: lead._id,
            transactionNumber: `TXN-${saleId.toString().slice(-6)}-${def.number}`,
            paymentDate: new Date(def.dueDate.getTime() - 3 * 86400000),
            originalAmount: paidAmount,
            amount: paidAmount,
            currency: 'INR',
            paymentMethod: pick(['bank_transfer', 'cheque', 'online_payment']),
            paymentMethodDetails: { transactionReference: `REF${intBetween(100000, 999999)}`, status: 'cleared' },
            allocations: [{ installment: instId, amount: paidAmount, allocationType: 'principal', allocatedAt: new Date() }],
            verification: { status: 'verified', verifiedBy: finance._id, verifiedAt: new Date() },
            status: 'completed',
            recordedBy: exec._id,
            createdBy: exec._id,
          });
        }
      }

      // Persist lead status update
      if (saleStatus !== 'Cancelled') {
        await Lead.findByIdAndUpdate(lead._id, { status: 'Booked' });
      }
    }
  }

  const createdSalesDocs = await Sale.insertMany(salesToCreate);
  createdSales.push(...createdSalesDocs);
  await PaymentPlan.insertMany(paymentPlansData);
  await Installment.insertMany(installmentsToCreate);
  if (txnsToCreate.length) await PaymentTransaction.insertMany(txnsToCreate);
  console.log(`   ✅ ${createdSales.length} sales, ${paymentPlansData.length} payment plans, ${installmentsToCreate.length} installments, ${txnsToCreate.length} transactions`);

  return createdSales;
}

// =============================================================================
// PHASE D — CHANNEL PARTNER ORG BUILDER
// =============================================================================

async function buildChannelPartnerOrg({
  orgName, rera, category = 'broker_firm',
  contactPhone, contactWebsite, contactAddress,
  marketingProfile = {},
  users: userSpecs,
}) {
  console.log(`\n🤝 Creating CP organization "${orgName}"…`);

  const org = await Organization.create({
    name: orgName,
    type: 'channel_partner',
    country: 'India',
    city: 'Mumbai',
    category,
    reraRegistrationNumber: rera,
    contactInfo: { phone: contactPhone, website: contactWebsite, address: contactAddress },
    subscriptionPlan: 'professional',
    isActive: true,
    channelPartnerProfile: {
      logoUrl: null,
      about: marketingProfile.about || '',
      areasServed: marketingProfile.areasServed || ['Mumbai'],
      trackRecord: marketingProfile.trackRecord || '',
    },
  });

  // CP-side roles
  await seedChannelPartnerRoles(org._id);
  // No approval policies for CP orgs (developer-only feature)
  const allRoles = await Role.find({ organization: org._id });
  const roleByName = Object.fromEntries(allRoles.map((r) => [r.name, r]));
  console.log(`   ✅ CP org + ${allRoles.length} CP roles seeded`);

  // Users (CP Owner / Manager / Agent)
  const users = {};
  for (const spec of userSpecs) {
    const role = roleByName[spec.roleRefName];
    if (!role) {
      console.warn(`   ⚠️  CP role "${spec.roleRefName}" not found — skipping ${spec.firstName}`);
      continue;
    }
    const u = await User.create({
      organization: org._id,
      firstName: spec.firstName,
      lastName: spec.lastName,
      email: spec.email,
      password: PASSWORD,
      role: spec.legacyRole,
      roleRef: role._id,
      isActive: true,
      invitationStatus: 'accepted',
      acceptedAt: daysAgo(intBetween(30, 200)),
    });
    users[spec.key] = u;
  }
  console.log(`   ✅ ${Object.keys(users).length} CP users created`);

  return { org, users, owner: users[userSpecs[0].key] };
}

// =============================================================================
// PHASE E — PARTNERSHIPS (DEV ↔ CP)
// =============================================================================

async function createPartnership({ devOrg, devOwner, cpOrg, cpOwner, initiatedBy, status = 'active', projects = [], commissionPct = 4 }) {
  const now = new Date();
  const requestedAt = daysAgo(intBetween(30, 180));
  const historyEntries = [
    {
      status: 'pending', action: initiatedBy === 'channel_partner' ? 'applied' : 'invited',
      actor: initiatedBy === 'channel_partner' ? cpOwner._id : devOwner._id,
      actorOrg: initiatedBy === 'channel_partner' ? cpOrg._id : devOrg._id,
      at: requestedAt,
      note: initiatedBy === 'channel_partner' ? 'Applied via marketplace' : 'Invited by developer',
    },
  ];
  if (status === 'active') {
    historyEntries.push({
      status: 'active',
      action: initiatedBy === 'channel_partner' ? 'approved' : 'accepted',
      actor: initiatedBy === 'channel_partner' ? devOwner._id : cpOwner._id,
      actorOrg: initiatedBy === 'channel_partner' ? devOrg._id : cpOrg._id,
      at: new Date(requestedAt.getTime() + 2 * 86400000),
      note: 'Partnership active',
    });
  }

  const partnership = await Partnership.create({
    developerOrg: devOrg._id,
    channelPartnerOrg: cpOrg._id,
    status,
    initiatedBy,
    projects: projects.map((p) => p._id),
    application: { message: 'We would like to partner on your luxury Mumbai inventory.', attachments: [] },
    commissionTerms: status === 'active' ? { type: 'percentage', value: commissionPct, notes: `${commissionPct}% of sale price` } : null,
    requestedAt,
    decidedAt: status === 'active' ? new Date(requestedAt.getTime() + 2 * 86400000) : null,
    decidedBy: status === 'active' ? (initiatedBy === 'channel_partner' ? devOwner._id : cpOwner._id) : null,
    history: historyEntries,
  });

  // Reconciliation — for active partnerships, create a dev-side ChannelPartner
  // shadow record pointing back to the CP org.
  if (status === 'active') {
    await ChannelPartner.create({
      organization: devOrg._id,
      channelPartnerOrg: cpOrg._id,
      firmName: cpOrg.name,
      reraRegistrationNumber: cpOrg.reraRegistrationNumber || '',
      primaryContact: {
        name: `${cpOwner.firstName} ${cpOwner.lastName}`,
        email: cpOwner.email,
        phone: cpOwner.phoneNumber || '',
      },
      address: cpOrg.contactInfo?.address || 'Mumbai, India',
      approvedProjects: projects.map((p) => p._id),
      status: 'active',
      category: cpOrg.category || 'broker_firm',
      bankDetails: {
        accountName: cpOrg.name,
        accountNumber: String(intBetween(100000000000, 999999999999)),
        ifsc: `HDFC000${intBetween(1000, 9999)}`,
        bankName: 'HDFC Bank',
      },
      agreementNotes: `Partnership activated via marketplace on ${partnership.decidedAt?.toDateString() || new Date().toDateString()}.`,
      onboardedBy: devOwner._id,
    });
  }

  return partnership;
}

// =============================================================================
// PHASE F — PROSPECTS / PUSHED LEADS / COMMISSION INVOICES (CP-SIDE WORK)
// =============================================================================

async function seedProspectsAndPushedLeads({ cpOrg, cpUsers, partnerships, externalDevelopers = [], opts = {} }) {
  const { prospectCount = 15, pushedCount = 3 } = opts;
  console.log(`\n📋 CP "${cpOrg.name}" — seeding ${prospectCount} prospects + ${pushedCount} pushed leads…`);

  const cpAgentUsers = Object.values(cpUsers).filter((u) => u.role === 'Channel Partner Agent' || u.role === 'Channel Partner Admin');
  const fallbackAgents = cpAgentUsers.length ? cpAgentUsers : Object.values(cpUsers);

  const prospectsCreated = [];
  const pushedLeadsCreated = [];

  // 1. Platform-context prospects (linked to a partnership)
  for (let i = 0; i < prospectCount; i++) {
    const usePlatform = partnerships.length > 0 && (externalDevelopers.length === 0 || chance(0.8));
    const firstName = pick(HNI_FIRST_NAMES);
    const lastName = pick(HNI_LAST_NAMES);
    const agent = pick(fallbackAgents);
    const timeline = pick(['immediate', '1-3_months', '3-6_months', '6-12_months']);
    const status = pickWeighted([
      { value: 'New', weight: 25 }, { value: 'Contacted', weight: 20 },
      { value: 'Qualified', weight: 15 }, { value: 'Site Visit Scheduled', weight: 10 },
      { value: 'Site Visit Completed', weight: 10 }, { value: 'Negotiating', weight: 8 },
      { value: 'Lost', weight: 7 }, { value: 'Booked', weight: 5 },
    ]);

    let prospectData = {
      organization: cpOrg._id,
      firstName, lastName,
      email: realisticEmail(firstName, lastName, String(i)),
      phone: phoneIN(),
      assignedAgent: agent._id,
      status,
      priority: pick(['Low', 'Medium', 'High']),
      budget: { min: intBetween(70, 600) * 100000, max: intBetween(800, 1500) * 100000, currency: 'INR' },
      requirements: { timeline, unitType: pick(['1BHK', '2BHK', '3BHK']) },
      notes: pick(['Looking for ready-to-move', 'Investment focus', 'First-time buyer', 'Referred by existing customer']),
      score: intBetween(45, 90),
      scoreGrade: pick(['Hot', 'Warm', 'Cold']),
      lastScoreUpdate: daysAgo(intBetween(0, 7)),
      activities: [
        { type: 'note', note: 'Initial intake', at: daysAgo(intBetween(5, 60)), by: agent._id },
        { type: 'call', note: 'First contact call', at: daysAgo(intBetween(1, 30)), by: agent._id },
      ],
      createdAt: daysAgo(intBetween(5, 90)),
    };

    if (usePlatform) {
      const partnership = pick(partnerships);
      // Need a project from the partnership's developer
      const devProjects = await Project.find({ organization: partnership.developerOrg }).limit(5);
      if (devProjects.length === 0) continue;
      const project = pick(devProjects);
      prospectData.developerContext = { type: 'platform', partnership: partnership._id };
      prospectData.project = { platform: project._id };
    } else if (externalDevelopers.length > 0) {
      const ext = pick(externalDevelopers);
      prospectData.developerContext = { type: 'external', externalDeveloper: ext._id };
      prospectData.project = { external: { name: pick(ext.projects)?.name || 'Unnamed Project', location: 'Mumbai', type: 'Residential' } };
    } else {
      continue;
    }

    try {
      const p = await Prospect.create(prospectData);
      prospectsCreated.push(p);
    } catch (err) {
      console.warn(`     ⚠️  prospect create failed: ${err.message}`);
    }
  }
  console.log(`   ✅ ${prospectsCreated.length} prospects`);

  // 2. Pushed leads — pick a few platform-context prospects and create a Lead on the dev side
  const platformProspects = prospectsCreated.filter((p) => p.developerContext.type === 'platform');
  const toPush = platformProspects.slice(0, pushedCount);
  for (const prospect of toPush) {
    const partnership = partnerships.find((pa) => pa._id.equals(prospect.developerContext.partnership));
    if (!partnership) continue;
    const devOrgId = partnership.developerOrg;
    // Find a sales exec from the dev org
    const devSalesExec = await User.findOne({ organization: devOrgId, role: { $in: ['Sales Executive', 'Sales Manager'] } });
    if (!devSalesExec) continue;
    // Find dev-side CP shadow record for this CP org
    const cpShadow = await ChannelPartner.findOne({ organization: devOrgId, channelPartnerOrg: cpOrg._id });
    const leadStatus = pickWeighted([
      { value: 'pending', weight: 20 }, // awaiting registration acceptance
      { value: 'New', weight: 25 },
      { value: 'Contacted', weight: 20 },
      { value: 'Qualified', weight: 15 },
      { value: 'Negotiating', weight: 10 },
      { value: 'Booked', weight: 10 },
    ]);
    try {
      const lead = await Lead.create({
        organization: devOrgId,
        project: prospect.project.platform,
        assignedTo: devSalesExec._id,
        sourceProspect: prospect._id,
        firstName: prospect.firstName, lastName: prospect.lastName,
        email: prospect.email, phone: prospect.phone,
        source: 'Channel Partner',
        status: leadStatus,
        score: prospect.score,
        scoreGrade: prospect.score >= 75 ? 'A' : 'B',
        budget: prospect.budget,
        requirements: prospect.requirements,
        channelPartnerAttribution: {
          viaChannelPartner: true,
          partners: [{
            channelPartner: cpShadow?._id || null,
            agent: null,
            agentUser: prospect.assignedAgent,
            sharePct: 100,
          }],
          status: 'tagged',
          taggedBy: prospect.assignedAgent,
          taggedAt: new Date(),
        },
        createdAt: daysAgo(intBetween(3, 60)),
      });
      // Link back
      prospect.pushedToLead = lead._id;
      prospect.pushedAt = lead.createdAt;
      prospect.pushedBy = prospect.assignedAgent;
      await prospect.save();
      pushedLeadsCreated.push(lead);
    } catch (err) {
      console.warn(`     ⚠️  push-to-lead failed: ${err.message}`);
    }
  }
  console.log(`   ✅ ${pushedLeadsCreated.length} pushed leads`);

  return { prospects: prospectsCreated, pushedLeads: pushedLeadsCreated };
}

// =============================================================================
// PHASE G — GENERAL NOTIFICATIONS
// =============================================================================

async function seedNotifications({ org, users, sampleCount = 8 }) {
  const recipients = Object.values(users);
  if (recipients.length === 0) return;
  const types = ['task_assigned', 'lead_assigned' /* not in enum */, 'sale_booked', 'payment_overdue', 'lead_follow_up_due'];
  const validTypes = ['task_assigned', 'sale_booked', 'payment_overdue', 'lead_follow_up_due', 'task_due_soon'];
  const messages = {
    task_assigned: 'You have been assigned a new task',
    sale_booked: 'New booking confirmed',
    payment_overdue: 'An installment is overdue',
    lead_follow_up_due: 'Lead follow-up is due',
    task_due_soon: 'Task due in 24 hours',
  };
  const docs = [];
  for (const rec of recipients) {
    const count = intBetween(3, sampleCount);
    for (let i = 0; i < count; i++) {
      const t = pick(validTypes);
      docs.push({
        organization: org._id,
        recipient: rec._id,
        type: t,
        title: messages[t],
        message: messages[t],
        priority: pick(['low', 'medium', 'high']),
        isRead: chance(0.4),
        createdAt: daysAgo(intBetween(0, 12)),
      });
    }
  }
  if (docs.length) await Notification.insertMany(docs, { ordered: false }).catch(() => {});
}

// =============================================================================
// PHASE H — COMMISSION INVOICE SEEDING (state variety)
// =============================================================================

async function seedCommissionInvoicesForCpAttributedSales({ cpOrg, cpOwner, devOrg }) {
  // Find sales in devOrg that are CP-attributed to cpOrg via the shadow record
  const shadow = await ChannelPartner.findOne({ organization: devOrg._id, channelPartnerOrg: cpOrg._id });
  if (!shadow) return { created: 0, byStatus: {} };

  // Find leads in devOrg attributed to this CP shadow
  const attributedLeads = await Lead.find({
    organization: devOrg._id,
    'channelPartnerAttribution.partners.channelPartner': shadow._id,
  }).select('_id').lean();
  const leadIds = attributedLeads.map((l) => l._id);
  if (leadIds.length === 0) return { created: 0, byStatus: {} };

  const sales = await Sale.find({ lead: { $in: leadIds }, status: { $in: ['Booked', 'Agreement Signed', 'Registered', 'Completed'] } }).limit(6);
  if (sales.length === 0) return { created: 0, byStatus: {} };

  // Find a dev-side approver
  const devApprover = await User.findOne({ organization: devOrg._id, role: { $in: ['Sales Head', 'Finance Head', 'Business Head'] } });
  // Partnership
  const partnership = await Partnership.findOne({ developerOrg: devOrg._id, channelPartnerOrg: cpOrg._id, status: 'active' });
  if (!partnership) return { created: 0, byStatus: {} };

  const byStatus = { draft: 0, submitted: 0, approved: 0, paid: 0 };
  // Status plan: variety
  const statusPlan = ['draft', 'submitted', 'approved', 'paid'];
  let i = 0;

  for (const sale of sales) {
    if (i >= statusPlan.length) break;
    const targetStatus = statusPlan[i++];

    // Find paid amount > threshold so it's realistic
    const paidAgg = await Installment.aggregate([
      { $match: { sale: sale._id } },
      { $group: { _id: null, paid: { $sum: '$paidAmount' } } },
    ]);
    const paid = paidAgg[0]?.paid || 0;
    const total = sale.salePrice || 0;
    if (total === 0) continue;
    const paidPct = paid / total;

    // Ensure paid >= 20%; otherwise skip (the trigger only fires above threshold)
    if (paidPct < 0.20) continue;

    const baseAmount = Math.round(sale.salePrice * 0.04); // 4% commission

    // Update sale.commissionInvoiceTriggered (idempotent flag)
    if (!sale.commissionInvoiceTriggered?.at) {
      sale.commissionInvoiceTriggered = { at: new Date(), paidPct: Math.round(paidPct * 1000) / 1000, cpOrg: cpOrg._id };
      await sale.save();
    }

    const lead = await Lead.findById(sale.lead).lean();
    if (!lead) continue;

    // Allocate invoice number if not draft
    let invoiceNumber = null;
    if (targetStatus !== 'draft') {
      const fy = (() => {
        const now = new Date();
        const y = now.getFullYear();
        const m = now.getMonth();
        const startY = m >= 3 ? y : y - 1;
        return `${startY}-${String((startY + 1) % 100).padStart(2, '0')}`;
      })();
      invoiceNumber = await CommissionInvoice.allocateInvoiceNumber(devOrg._id, fy, 'CP-INV');
    }

    const invoiceDoc = {
      cpOrg: cpOrg._id,
      developerOrg: devOrg._id,
      partnership: partnership._id,
      lead: lead._id,
      sale: sale._id,
      prospect: lead.sourceProspect || null,
      baseAmount,
      gstPct: 18,
      tdsPct: 5,
      currency: 'INR',
      status: targetStatus,
      cpParty: {
        legalName: cpOrg.name,
        gstin: `27AAACP${intBetween(1000, 9999)}K1Z5`,
        pan: `AAACP${intBetween(1000, 9999)}K`,
        bankAccountName: cpOrg.name,
        bankAccountNumber: String(intBetween(100000000000, 999999999999)),
        bankIfsc: `HDFC000${intBetween(1000, 9999)}`,
        bankName: 'HDFC Bank',
        address: cpOrg.contactInfo?.address || 'Mumbai, India',
      },
      createdBy: cpOwner._id,
      submittedAt: targetStatus !== 'draft' ? daysAgo(intBetween(5, 30)) : null,
      submittedBy: targetStatus !== 'draft' ? cpOwner._id : null,
      decidedAt: ['approved', 'paid'].includes(targetStatus) ? daysAgo(intBetween(2, 15)) : null,
      decidedBy: ['approved', 'paid'].includes(targetStatus) ? (devApprover?._id || null) : null,
      decisionNote: ['approved', 'paid'].includes(targetStatus) ? 'Approved — payment terms verified' : '',
      paidAt: targetStatus === 'paid' ? daysAgo(intBetween(1, 10)) : null,
      paidBy: targetStatus === 'paid' ? (devApprover?._id || null) : null,
      paymentReference: targetStatus === 'paid' ? `NEFT-${intBetween(100000, 999999)}` : '',
      paymentMethod: targetStatus === 'paid' ? 'bank_transfer' : '',
      history: [
        { at: daysAgo(intBetween(15, 30)), by: cpOwner._id, byOrg: cpOrg._id, action: 'created', note: 'Draft invoice auto-created at 20% payment threshold' },
        ...(targetStatus !== 'draft' ? [{ at: daysAgo(intBetween(5, 14)), by: cpOwner._id, byOrg: cpOrg._id, action: 'submitted', note: 'Submitted for developer review' }] : []),
        ...(['approved', 'paid'].includes(targetStatus) ? [{ at: daysAgo(intBetween(2, 7)), by: devApprover?._id || null, byOrg: devOrg._id, action: 'approved', note: 'Approved by developer' }] : []),
        ...(targetStatus === 'paid' ? [{ at: daysAgo(intBetween(0, 3)), by: devApprover?._id || null, byOrg: devOrg._id, action: 'paid', note: 'Payment released' }] : []),
      ],
    };
    // Only attach invoiceNumber when non-null — otherwise the sparse-unique
    // index collides on multiple null values (Mongo's sparse-unique skips
    // missing fields only, not explicit nulls).
    if (invoiceNumber) invoiceDoc.invoiceNumber = invoiceNumber;
    const invoice = await CommissionInvoice.create(invoiceDoc);
    byStatus[targetStatus] = (byStatus[targetStatus] || 0) + 1;
  }

  return { created: Object.values(byStatus).reduce((a, b) => a + b, 0), byStatus };
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  await connect();
  try {
    // ─── PHASE A: NUKE ─────────────────────────────────────────
    await nukeDatabase();

    // ─── PHASE B1: Run existing Mumbai luxury demo (Part 1) ────
    console.log('\n' + '═'.repeat(70));
    console.log('🌟  PHASE B1 — PROPVANTAGE DEMO REALTY (ultra-luxury Mumbai)');
    console.log('═'.repeat(70));
    const { org: pvOrg, users: pvUsers } = await seedOrgAndUsers();
    await seedDefaultApprovalPolicies(pvOrg._id);
    const projectsObj = await seedProjects(pvOrg);
    const projects = [projectsObj.bkcProject, projectsObj.worliProject, projectsObj.bandraProject];
    await seedProjectAssignments(pvOrg, pvUsers, projects);
    const pvTowers = await seedTowers(pvOrg, pvUsers, projectsObj);
    const pvUnits = await seedUnits(pvOrg, pvUsers, projectsObj, pvTowers);
    const pvLeads = await seedLeadsAndInteractions(pvOrg, pvUsers, projectsObj, pvUnits);

    // ─── PHASE B2: Part 2 (sales, payments, competitors, AI cache, tasks) ──
    console.log('\n' + '═'.repeat(70));
    console.log('💰  PHASE B2 — PROPVANTAGE SALES + PAYMENTS + COMPETITORS + AI CACHE');
    console.log('═'.repeat(70));
    const refreshedPvUnits = await Unit.find({ organization: pvOrg._id });
    const { sales: pvSales } = await seedSales(pvOrg, pvUsers, projectsObj, refreshedPvUnits, pvLeads);
    const pvCompetitors = await seedCompetitors(pvOrg, pvUsers, projectsObj);
    await seedCompetitiveAnalysis(pvOrg, pvUsers, projectsObj, pvCompetitors);
    await seedTasksAndNotifications(pvOrg, pvUsers, projectsObj, pvLeads, pvSales);

    // ─── PHASE B3: Mumbai CP demo (legacy / "Offplatform Test Partner") ──
    console.log('\n' + '═'.repeat(70));
    console.log('🤝  PHASE B3 — LEGACY CP DEMO (firms, agents, commission records)');
    console.log('═'.repeat(70));
    await seedCPDataForDemoOrg({ skipCleanup: true, manageConnection: false });

    // ─── PHASE C1: Crestline Estates (mid-luxury) ────────────
    console.log('\n' + '═'.repeat(70));
    console.log('🏢  PHASE C1 — CRESTLINE ESTATES PVT LTD (mid-luxury)');
    console.log('═'.repeat(70));
    const crestline = await buildDeveloperOrg({
      orgName: 'Crestline Estates Pvt Ltd',
      contactPhone: '+91 22 6555-2200',
      contactWebsite: 'https://crestline-demo.example.com',
      contactAddress: 'Crestline House, Andheri West, Mumbai - 400053',
      commissionPercent: 4,
      users: [
        { key: 'Vikram',  firstName: 'Vikram',  lastName: 'Sethi',     email: 'vikram.sethi@crestline-demo.com',   roleRefName: 'Organization Owner', legacyRole: 'Business Head' },
        { key: 'Anita',   firstName: 'Anita',   lastName: 'Kapoor',    email: 'anita.kapoor@crestline-demo.com',   roleRefName: 'Business Head',      legacyRole: 'Business Head' },
        { key: 'Rajiv',   firstName: 'Rajiv',   lastName: 'Malhotra',  email: 'rajiv.malhotra@crestline-demo.com', roleRefName: 'Sales Head',         legacyRole: 'Sales Head' },
        { key: 'Sneha',   firstName: 'Sneha',   lastName: 'Reddy',     email: 'sneha.reddy@crestline-demo.com',    roleRefName: 'Project Director',   legacyRole: 'Project Director' },
        { key: 'Karan',   firstName: 'Karan',   lastName: 'Arora',     email: 'karan.arora@crestline-demo.com',    roleRefName: 'Sales Executive',    legacyRole: 'Sales Executive' },
        { key: 'Pooja',   firstName: 'Pooja',   lastName: 'Verma',     email: 'pooja.verma@crestline-demo.com',    roleRefName: 'Sales Executive',    legacyRole: 'Sales Executive' },
        { key: 'Aditya',  firstName: 'Aditya',  lastName: 'Sharma',    email: 'aditya.sharma@crestline-demo.com',  roleRefName: 'Sales Executive',    legacyRole: 'Sales Executive' },
        { key: 'Meera',   firstName: 'Meera',   lastName: 'Iyer',      email: 'meera.iyer@crestline-demo.com',     roleRefName: 'Finance Head',       legacyRole: 'Finance Head' },
        { key: 'Tanvi',   firstName: 'Tanvi',   lastName: 'Bhat',      email: 'tanvi.bhat@crestline-demo.com',     roleRefName: 'Marketing Head',     legacyRole: 'Marketing Head' },
      ],
      projects: [
        {
          name: 'Crestline Bay View', area: 'Andheri West', pincode: '400053', status: 'under-construction',
          description: 'Premium 2/3 BHK residences in Andheri West, near completion.',
          unitCount: 180, totalArea: 350000, priceMin: crToINR(2.8), priceMax: crToINR(4.2),
          targetRevenue: crToINR(560), launchDaysAgo: 720, completionDaysAhead: 120,
          amenities: ['Pool', 'Gym', 'Clubhouse', 'Sky Lounge', 'EV Charging', 'Concierge'],
          towers: [
            { name: 'Bay View A', code: 'BV-A', floors: 28, unitsPerFloor: 3, unitTypes: [
              { type: '2BHK', carpetMin: 850, carpetMax: 1050, pricePerSqft: 28000 },
              { type: '3BHK', carpetMin: 1300, carpetMax: 1500, pricePerSqft: 30000 },
            ] },
            { name: 'Bay View B', code: 'BV-B', floors: 28, unitsPerFloor: 3, unitTypes: [
              { type: '2BHK', carpetMin: 850, carpetMax: 1050, pricePerSqft: 28000 },
              { type: '3BHK', carpetMin: 1300, carpetMax: 1500, pricePerSqft: 30000 },
            ] },
            { name: 'Bay View C', code: 'BV-C', floors: 22, unitsPerFloor: 2, unitTypes: [
              { type: '3BHK', carpetMin: 1300, carpetMax: 1600, pricePerSqft: 31000 },
            ] },
          ],
        },
        {
          name: 'Crestline Verde', area: 'Powai', pincode: '400076', status: 'under-construction',
          description: 'Lakeside 2/3 BHK residences in Powai, mid-construction.',
          unitCount: 240, totalArea: 480000, priceMin: crToINR(2.4), priceMax: crToINR(3.8),
          targetRevenue: crToINR(700), launchDaysAgo: 450, completionDaysAhead: 540,
          amenities: ['Pool', 'Gym', 'Clubhouse', 'Lake View Deck', 'Garden', 'Concierge'],
          towers: [
            { name: 'Verde A', code: 'VR-A', floors: 32, unitsPerFloor: 3, unitTypes: [
              { type: '2BHK', carpetMin: 800, carpetMax: 950, pricePerSqft: 26000 },
              { type: '3BHK', carpetMin: 1200, carpetMax: 1450, pricePerSqft: 28000 },
            ] },
            { name: 'Verde B', code: 'VR-B', floors: 32, unitsPerFloor: 3, unitTypes: [
              { type: '2BHK', carpetMin: 800, carpetMax: 950, pricePerSqft: 26000 },
              { type: '3BHK', carpetMin: 1200, carpetMax: 1450, pricePerSqft: 28000 },
            ] },
            { name: 'Verde C', code: 'VR-C', floors: 25, unitsPerFloor: 3, unitTypes: [
              { type: '3BHK', carpetMin: 1200, carpetMax: 1500, pricePerSqft: 29000 },
            ] },
          ],
        },
        {
          name: 'Crestline Skygarden', area: 'Goregaon East', pincode: '400063', status: 'launched',
          description: 'New launch — 1/2/3 BHK with sky gardens.',
          unitCount: 300, totalArea: 420000, priceMin: crToINR(1.6), priceMax: crToINR(3.2),
          targetRevenue: crToINR(640), launchDaysAgo: 75, completionDaysAhead: 1020,
          amenities: ['Pool', 'Gym', 'Sky Garden', 'Co-working', 'EV Charging'],
          towers: [
            { name: 'Sky A', code: 'SK-A', floors: 35, unitsPerFloor: 3, unitTypes: [
              { type: '1BHK', carpetMin: 450, carpetMax: 550, pricePerSqft: 22000 },
              { type: '2BHK', carpetMin: 750, carpetMax: 900, pricePerSqft: 24000 },
            ] },
            { name: 'Sky B', code: 'SK-B', floors: 35, unitsPerFloor: 3, unitTypes: [
              { type: '2BHK', carpetMin: 750, carpetMax: 900, pricePerSqft: 24000 },
              { type: '3BHK', carpetMin: 1100, carpetMax: 1350, pricePerSqft: 26000 },
            ] },
            { name: 'Sky C', code: 'SK-C', floors: 30, unitsPerFloor: 3, unitTypes: [
              { type: '3BHK', carpetMin: 1100, carpetMax: 1350, pricePerSqft: 26000 },
            ] },
          ],
        },
      ],
    });
    const crestlineLeads = await seedLeadsForOrg({ org: crestline.org, users: crestline.users, projects: crestline.projects, units: crestline.units });
    const refreshedCrestlineUnits = await Unit.find({ organization: crestline.org._id, status: { $in: ['available', 'blocked', 'booked', 'sold'] } });
    const crestlineSales = await seedSalesForOrg({ org: crestline.org, owner: crestline.owner, users: crestline.users, projects: crestline.projects, units: refreshedCrestlineUnits, leads: crestlineLeads });
    await seedNotifications({ org: crestline.org, users: crestline.users });

    // ─── PHASE C2: Sunbridge Habitat (mid-market) ────────────
    console.log('\n' + '═'.repeat(70));
    console.log('🏢  PHASE C2 — SUNBRIDGE HABITAT (mid-market)');
    console.log('═'.repeat(70));
    const sunbridge = await buildDeveloperOrg({
      orgName: 'Sunbridge Habitat',
      contactPhone: '+91 22 6555-3300',
      contactWebsite: 'https://sunbridge-demo.example.com',
      contactAddress: 'Sunbridge Plaza, Borivali East, Mumbai - 400066',
      commissionPercent: 5,
      users: [
        { key: 'Manish',  firstName: 'Manish', lastName: 'Joshi',  email: 'manish.joshi@sunbridge-demo.com',  roleRefName: 'Organization Owner', legacyRole: 'Business Head' },
        { key: 'Divya',   firstName: 'Divya',  lastName: 'Pillai', email: 'divya.pillai@sunbridge-demo.com',  roleRefName: 'Business Head',      legacyRole: 'Business Head' },
        { key: 'Amit',    firstName: 'Amit',   lastName: 'Khanna', email: 'amit.khanna@sunbridge-demo.com',   roleRefName: 'Sales Head',         legacyRole: 'Sales Head' },
        { key: 'Suresh',  firstName: 'Suresh', lastName: 'Naik',   email: 'suresh.naik@sunbridge-demo.com',   roleRefName: 'Sales Executive',    legacyRole: 'Sales Executive' },
        { key: 'Geeta',   firstName: 'Geeta',  lastName: 'Rao',    email: 'geeta.rao@sunbridge-demo.com',     roleRefName: 'Sales Executive',    legacyRole: 'Sales Executive' },
      ],
      projects: [
        {
          name: 'Sunbridge Greens', area: 'Mira Road', pincode: '401107', status: 'completed',
          description: 'OC-received 1/2 BHK in Mira Road; ready to move.',
          unitCount: 200, totalArea: 280000, priceMin: lakhsToINR(85), priceMax: crToINR(1.6),
          targetRevenue: crToINR(220), launchDaysAgo: 1100, completionDaysAhead: -60,
          amenities: ['Pool', 'Gym', 'Garden', 'Security'],
          towers: [
            { name: 'Greens A', code: 'GR-A', floors: 20, unitsPerFloor: 4, unitTypes: [
              { type: '1BHK', carpetMin: 450, carpetMax: 550, pricePerSqft: 16000 },
              { type: '2BHK', carpetMin: 700, carpetMax: 850, pricePerSqft: 17000 },
            ] },
            { name: 'Greens B', code: 'GR-B', floors: 20, unitsPerFloor: 4, unitTypes: [
              { type: '1BHK', carpetMin: 450, carpetMax: 550, pricePerSqft: 16000 },
              { type: '2BHK', carpetMin: 700, carpetMax: 850, pricePerSqft: 17000 },
            ] },
          ],
        },
        {
          name: 'Sunbridge Heights', area: 'Thane West', pincode: '400606', status: 'under-construction',
          description: 'Mid-construction 2/3 BHK in Thane West.',
          unitCount: 220, totalArea: 360000, priceMin: crToINR(1.4), priceMax: crToINR(2.4),
          targetRevenue: crToINR(380), launchDaysAgo: 450, completionDaysAhead: 540,
          amenities: ['Pool', 'Gym', 'Clubhouse', 'Garden', 'Children Play Area'],
          towers: [
            { name: 'Heights A', code: 'HT-A', floors: 28, unitsPerFloor: 4, unitTypes: [
              { type: '2BHK', carpetMin: 750, carpetMax: 900, pricePerSqft: 18000 },
              { type: '3BHK', carpetMin: 1100, carpetMax: 1300, pricePerSqft: 19000 },
            ] },
            { name: 'Heights B', code: 'HT-B', floors: 28, unitsPerFloor: 4, unitTypes: [
              { type: '2BHK', carpetMin: 750, carpetMax: 900, pricePerSqft: 18000 },
              { type: '3BHK', carpetMin: 1100, carpetMax: 1300, pricePerSqft: 19000 },
            ] },
          ],
        },
      ],
    });
    const sunbridgeLeads = await seedLeadsForOrg({ org: sunbridge.org, users: sunbridge.users, projects: sunbridge.projects, units: sunbridge.units });
    const refreshedSunbridgeUnits = await Unit.find({ organization: sunbridge.org._id, status: { $in: ['available', 'blocked', 'booked', 'sold'] } });
    const sunbridgeSales = await seedSalesForOrg({ org: sunbridge.org, owner: sunbridge.owner, users: sunbridge.users, projects: sunbridge.projects, units: refreshedSunbridgeUnits, leads: sunbridgeLeads });
    await seedNotifications({ org: sunbridge.org, users: sunbridge.users });

    // ─── PHASE D: Channel-Partner orgs ──────────────────────
    console.log('\n' + '═'.repeat(70));
    console.log('🤝  PHASE D — CHANNEL-PARTNER ORGANIZATIONS');
    console.log('═'.repeat(70));

    // D.1 Mumbai Realty Network
    const mrn = await buildChannelPartnerOrg({
      orgName: 'Mumbai Realty Network',
      rera: 'MahaRERA-A52400003123',
      category: 'corporate',
      contactPhone: '+91 22 6500-5001',
      contactWebsite: 'https://mrn-cp.example.com',
      contactAddress: 'MRN House, Lower Parel, Mumbai - 400013',
      marketingProfile: {
        about: 'Corporate brokerage with 50+ agents covering Mumbai BKC / Worli / Bandra HNI segment.',
        areasServed: ['BKC', 'Worli', 'Bandra West', 'Andheri West', 'Powai'],
        trackRecord: '650+ closed deals across luxury and mid-luxury Mumbai inventory since 2020.',
      },
      users: [
        { key: 'Raghav',    firstName: 'Raghav',    lastName: 'Saraf',   email: 'raghav.saraf@mrn-cp.com',    roleRefName: 'CP Owner',   legacyRole: 'Channel Partner Manager' },
        { key: 'Priyanka',  firstName: 'Priyanka',  lastName: 'Joshi',   email: 'priyanka.joshi@mrn-cp.com',  roleRefName: 'CP Manager', legacyRole: 'Channel Partner Manager' },
        { key: 'Vikrant',   firstName: 'Vikrant',   lastName: 'Patil',   email: 'vikrant.patil@mrn-cp.com',   roleRefName: 'CP Agent',   legacyRole: 'Channel Partner Agent' },
        { key: 'Nidhi',     firstName: 'Nidhi',     lastName: 'Sharma',  email: 'nidhi.sharma@mrn-cp.com',    roleRefName: 'CP Agent',   legacyRole: 'Channel Partner Agent' },
        { key: 'Akash',     firstName: 'Akash',     lastName: 'Bharti',  email: 'akash.bharti@mrn-cp.com',    roleRefName: 'CP Agent',   legacyRole: 'Channel Partner Agent' },
        { key: 'Ritu',      firstName: 'Ritu',      lastName: 'Nair',    email: 'ritu.nair@mrn-cp.com',       roleRefName: 'CP Agent',   legacyRole: 'Channel Partner Agent' },
      ],
    });

    // D.2 PrimeHomes Consultants (luxury-focused)
    const prime = await buildChannelPartnerOrg({
      orgName: 'PrimeHomes Consultants',
      rera: 'MahaRERA-A52400003124',
      category: 'broker_firm',
      contactPhone: '+91 22 6500-5002',
      contactWebsite: 'https://primehomes-cp.example.com',
      contactAddress: 'Prime Tower, Pali Hill, Bandra West, Mumbai - 400050',
      marketingProfile: {
        about: 'Boutique luxury-only brokerage — Bandra / BKC / Worli HNI specialists.',
        areasServed: ['BKC', 'Worli', 'Bandra West'],
        trackRecord: '120+ ultra-luxury deals (₹15Cr+) since 2021.',
      },
      users: [
        { key: 'Sanjana',  firstName: 'Sanjana', lastName: 'Goel',  email: 'sanjana.goel@primehomes-cp.com',   roleRefName: 'CP Owner',   legacyRole: 'Channel Partner Manager' },
        { key: 'Faisal',   firstName: 'Faisal',  lastName: 'Khan',  email: 'faisal.khan@primehomes-cp.com',    roleRefName: 'CP Manager', legacyRole: 'Channel Partner Manager' },
        { key: 'Ananya',   firstName: 'Ananya',  lastName: 'Bose',  email: 'ananya.bose@primehomes-cp.com',    roleRefName: 'CP Agent',   legacyRole: 'Channel Partner Agent' },
        { key: 'Karan',    firstName: 'Karan',   lastName: 'Iyer',  email: 'karan.iyer@primehomes-cp.com',     roleRefName: 'CP Agent',   legacyRole: 'Channel Partner Agent' },
      ],
    });

    // D.3 Asha Realty Services (mid-market)
    const asha = await buildChannelPartnerOrg({
      orgName: 'Asha Realty Services',
      rera: 'MahaRERA-A52400003125',
      category: 'broker_firm',
      contactPhone: '+91 22 6500-5003',
      contactWebsite: 'https://asha-cp.example.com',
      contactAddress: 'Asha Building, Thane West, Mumbai - 400606',
      marketingProfile: {
        about: 'Mid-market specialists — Thane / Mira Road / Andheri / Powai.',
        areasServed: ['Thane West', 'Mira Road', 'Andheri West', 'Powai', 'Goregaon East'],
        trackRecord: '420+ deals in the ₹80L–₹3Cr segment.',
      },
      users: [
        { key: 'Tushar',   firstName: 'Tushar',  lastName: 'Bhatia',  email: 'tushar.bhatia@asha-cp.com',  roleRefName: 'CP Owner',   legacyRole: 'Channel Partner Manager' },
        { key: 'Shilpa',   firstName: 'Shilpa',  lastName: 'Rao',     email: 'shilpa.rao@asha-cp.com',     roleRefName: 'CP Manager', legacyRole: 'Channel Partner Manager' },
        { key: 'Deepak',   firstName: 'Deepak',  lastName: 'Singh',   email: 'deepak.singh@asha-cp.com',   roleRefName: 'CP Agent',   legacyRole: 'Channel Partner Agent' },
        { key: 'Mona',     firstName: 'Mona',    lastName: 'Pillai',  email: 'mona.pillai@asha-cp.com',    roleRefName: 'CP Agent',   legacyRole: 'Channel Partner Agent' },
        { key: 'Yuvraj',   firstName: 'Yuvraj',  lastName: 'Kapoor',  email: 'yuvraj.kapoor@asha-cp.com',  roleRefName: 'CP Agent',   legacyRole: 'Channel Partner Agent' },
      ],
    });

    // D.4 QuickClose Brokers (volume player)
    const quick = await buildChannelPartnerOrg({
      orgName: 'QuickClose Brokers',
      rera: 'MahaRERA-A52400003126',
      category: 'digital_aggregator',
      contactPhone: '+91 22 6500-5004',
      contactWebsite: 'https://quickclose-cp.example.com',
      contactAddress: 'QuickClose HQ, Andheri East, Mumbai - 400069',
      marketingProfile: {
        about: 'High-volume mid-market brokerage; digital-first.',
        areasServed: ['Mira Road', 'Thane West', 'Borivali', 'Kandivali', 'Malad'],
        trackRecord: '900+ deals annually across Mumbai mid-market.',
      },
      users: [
        { key: 'Harish',     firstName: 'Harish',     lastName: 'Mehta',    email: 'harish.mehta@quickclose-cp.com',    roleRefName: 'CP Owner',   legacyRole: 'Channel Partner Manager' },
        { key: 'Pratiksha',  firstName: 'Pratiksha',  lastName: 'Naik',     email: 'pratiksha.naik@quickclose-cp.com',  roleRefName: 'CP Manager', legacyRole: 'Channel Partner Manager' },
        { key: 'Sanya',      firstName: 'Sanya',      lastName: 'Dutt',     email: 'sanya.dutt@quickclose-cp.com',      roleRefName: 'CP Agent',   legacyRole: 'Channel Partner Agent' },
        { key: 'Mihir',      firstName: 'Mihir',      lastName: 'Wadhwa',   email: 'mihir.wadhwa@quickclose-cp.com',    roleRefName: 'CP Agent',   legacyRole: 'Channel Partner Agent' },
        { key: 'Reema',      firstName: 'Reema',      lastName: 'Khanna',   email: 'reema.khanna@quickclose-cp.com',    roleRefName: 'CP Agent',   legacyRole: 'Channel Partner Agent' },
        { key: 'Aniket',     firstName: 'Aniket',     lastName: 'Pandey',   email: 'aniket.pandey@quickclose-cp.com',   roleRefName: 'CP Agent',   legacyRole: 'Channel Partner Agent' },
      ],
    });

    // D.5 BlueWave (pending partnership demo)
    const bluewave = await buildChannelPartnerOrg({
      orgName: 'BlueWave Property Solutions',
      rera: 'MahaRERA-A52400003127',
      category: 'broker_firm',
      contactPhone: '+91 22 6500-5005',
      contactWebsite: 'https://bluewave-cp.example.com',
      contactAddress: 'BlueWave Office, Goregaon West, Mumbai - 400062',
      marketingProfile: {
        about: 'Generalist Mumbai brokerage — applying to expand into developer partnerships.',
        areasServed: ['Goregaon', 'Malad', 'Kandivali', 'Borivali'],
        trackRecord: '180+ deals since 2022.',
      },
      users: [
        { key: 'Neelam',    firstName: 'Neelam',  lastName: 'Choudhary', email: 'neelam.choudhary@bluewave-cp.com', roleRefName: 'CP Owner',   legacyRole: 'Channel Partner Manager' },
        { key: 'Arnav',     firstName: 'Arnav',   lastName: 'Verma',     email: 'arnav.verma@bluewave-cp.com',      roleRefName: 'CP Agent',   legacyRole: 'Channel Partner Agent' },
        { key: 'Shreya',    firstName: 'Shreya',  lastName: 'Bose',      email: 'shreya.bose@bluewave-cp.com',      roleRefName: 'CP Agent',   legacyRole: 'Channel Partner Agent' },
      ],
    });

    // ─── PHASE E: Partnerships matrix ──────────────────────
    console.log('\n' + '═'.repeat(70));
    console.log('🔗  PHASE E — PARTNERSHIPS MATRIX');
    console.log('═'.repeat(70));
    const partnerships = [];

    // PropVantage Demo ↔ Mumbai Realty Network
    partnerships.push(await createPartnership({
      devOrg: pvOrg, devOwner: pvUsers.Rohan,
      cpOrg: mrn.org, cpOwner: mrn.owner,
      initiatedBy: 'channel_partner', status: 'active',
      projects: projects, commissionPct: 2,
    }));
    console.log('   • PropVantage Demo ↔ Mumbai Realty Network — ACTIVE');

    // PropVantage Demo ↔ PrimeHomes
    partnerships.push(await createPartnership({
      devOrg: pvOrg, devOwner: pvUsers.Rohan,
      cpOrg: prime.org, cpOwner: prime.owner,
      initiatedBy: 'developer', status: 'active',
      projects: projects, commissionPct: 2.5,
    }));
    console.log('   • PropVantage Demo ↔ PrimeHomes Consultants — ACTIVE');

    // Crestline ↔ Mumbai Realty Network
    partnerships.push(await createPartnership({
      devOrg: crestline.org, devOwner: crestline.owner,
      cpOrg: mrn.org, cpOwner: mrn.owner,
      initiatedBy: 'channel_partner', status: 'active',
      projects: crestline.projects, commissionPct: 4,
    }));
    console.log('   • Crestline ↔ Mumbai Realty Network — ACTIVE');

    // Crestline ↔ Asha Realty
    partnerships.push(await createPartnership({
      devOrg: crestline.org, devOwner: crestline.owner,
      cpOrg: asha.org, cpOwner: asha.owner,
      initiatedBy: 'channel_partner', status: 'active',
      projects: crestline.projects, commissionPct: 4,
    }));
    console.log('   • Crestline ↔ Asha Realty Services — ACTIVE');

    // Crestline ↔ BlueWave (PENDING)
    partnerships.push(await createPartnership({
      devOrg: crestline.org, devOwner: crestline.owner,
      cpOrg: bluewave.org, cpOwner: bluewave.owner,
      initiatedBy: 'channel_partner', status: 'pending',
      projects: [], commissionPct: 4,
    }));
    console.log('   • Crestline ↔ BlueWave Property Solutions — PENDING');

    // Sunbridge ↔ Asha Realty
    partnerships.push(await createPartnership({
      devOrg: sunbridge.org, devOwner: sunbridge.owner,
      cpOrg: asha.org, cpOwner: asha.owner,
      initiatedBy: 'channel_partner', status: 'active',
      projects: sunbridge.projects, commissionPct: 5,
    }));
    console.log('   • Sunbridge ↔ Asha Realty Services — ACTIVE');

    // Sunbridge ↔ QuickClose
    partnerships.push(await createPartnership({
      devOrg: sunbridge.org, devOwner: sunbridge.owner,
      cpOrg: quick.org, cpOwner: quick.owner,
      initiatedBy: 'channel_partner', status: 'active',
      projects: sunbridge.projects, commissionPct: 5,
    }));
    console.log('   • Sunbridge ↔ QuickClose Brokers — ACTIVE');

    // ─── PHASE F: Prospects + pushed leads ────────────────
    console.log('\n' + '═'.repeat(70));
    console.log('📋  PHASE F — PROSPECTS + PUSHED LEADS');
    console.log('═'.repeat(70));

    // MRN: partnerships are with PV and Crestline (active)
    const mrnActivePartnerships = await Partnership.find({ channelPartnerOrg: mrn.org._id, status: 'active' });
    // Create one external developer record for MRN
    const mrnExtDev = await ExternalDeveloper.create({
      organization: mrn.org._id,
      name: 'Galaxy Realtors (off-platform)',
      description: 'Off-platform developer we work with.',
      contact: { person: 'Mahesh Galaxy', email: 'mahesh@galaxy-offplatform.example.com', phone: '+91 9876512345' },
      city: 'Mumbai',
      projects: [{ name: 'Galaxy Heights', location: 'Goregaon East', type: 'Residential' }],
      // Provide a unique invite token so the sparse-unique index doesn't
      // collide with other ExternalDevelopers (Mongoose stores `invite: {}`
      // as `{ token: null }` and a second null key would collide).
      invite: { token: 'seed-' + new mongoose.Types.ObjectId().toString() },
    });
    await seedProspectsAndPushedLeads({ cpOrg: mrn.org, cpUsers: mrn.users, partnerships: mrnActivePartnerships, externalDevelopers: [mrnExtDev], opts: { prospectCount: 22, pushedCount: 4 } });

    // PrimeHomes
    const primeActive = await Partnership.find({ channelPartnerOrg: prime.org._id, status: 'active' });
    await seedProspectsAndPushedLeads({ cpOrg: prime.org, cpUsers: prime.users, partnerships: primeActive, opts: { prospectCount: 10, pushedCount: 2 } });

    // Asha Realty
    const ashaActive = await Partnership.find({ channelPartnerOrg: asha.org._id, status: 'active' });
    await seedProspectsAndPushedLeads({ cpOrg: asha.org, cpUsers: asha.users, partnerships: ashaActive, opts: { prospectCount: 25, pushedCount: 5 } });

    // QuickClose
    const quickActive = await Partnership.find({ channelPartnerOrg: quick.org._id, status: 'active' });
    await seedProspectsAndPushedLeads({ cpOrg: quick.org, cpUsers: quick.users, partnerships: quickActive, opts: { prospectCount: 18, pushedCount: 3 } });

    // BlueWave — pending partnerships only, so seed external prospects
    const blueExtDev = await ExternalDeveloper.create({
      organization: bluewave.org._id,
      name: 'Lakeside Estates (off-platform)',
      description: 'Off-platform developer.',
      contact: { person: 'Ramesh Lake', email: 'ramesh@lakeside-offplatform.example.com', phone: '+91 9876523456' },
      city: 'Mumbai',
      projects: [{ name: 'Lakeside Park', location: 'Borivali', type: 'Residential' }],
      invite: { token: 'seed-' + new mongoose.Types.ObjectId().toString() },
    });
    await seedProspectsAndPushedLeads({ cpOrg: bluewave.org, cpUsers: bluewave.users, partnerships: [], externalDevelopers: [blueExtDev], opts: { prospectCount: 5, pushedCount: 0 } });

    // ─── PHASE G: CP-attributed sales for the new orgs ────
    // We need a few CP-attributed BOOKED sales so the commission invoice
    // demo flow works. Take some of the booked sales from Crestline and
    // Sunbridge and tag them with CP attribution.
    console.log('\n' + '═'.repeat(70));
    console.log('🏷️  PHASE G — TAG CP ATTRIBUTION ON A FEW BOOKED SALES');
    console.log('═'.repeat(70));

    const tagSalesWithCp = async (devOrg, cpOrg, cpAgentUserId, maxCount = 2) => {
      const shadow = await ChannelPartner.findOne({ organization: devOrg._id, channelPartnerOrg: cpOrg._id });
      if (!shadow) return 0;
      // Prefer sales with high cumulative payments — gives a richer commission
      // invoice demo (most are above the 20% threshold).
      const candidates = await Sale.find({
        organization: devOrg._id,
        status: { $in: ['Booked', 'Agreement Signed'] },
        'channelPartnerAttribution.viaChannelPartner': { $ne: true },
      }).limit(50);
      const ranked = [];
      for (const s of candidates) {
        const agg = await Installment.aggregate([
          { $match: { sale: s._id } },
          { $group: { _id: null, paid: { $sum: '$paidAmount' } } },
        ]);
        const paid = agg[0]?.paid || 0;
        const pct = s.salePrice > 0 ? paid / s.salePrice : 0;
        ranked.push({ sale: s, pct });
      }
      ranked.sort((a, b) => b.pct - a.pct);
      const sales = ranked.slice(0, maxCount).map((r) => r.sale);
      // Guarantee at least 25% paid on each tagged sale so the 20% trigger
      // fires for the commission-invoice demo even if the random ladder
      // assigned a low paid pct earlier.
      for (const sale of sales) {
        const total = sale.salePrice || 0;
        if (total === 0) continue;
        const agg = await Installment.aggregate([
          { $match: { sale: sale._id } },
          { $group: { _id: null, paid: { $sum: '$paidAmount' } } },
        ]);
        const paid = agg[0]?.paid || 0;
        const pct = paid / total;
        if (pct < 0.25) {
          // Bump the booking installment + second installment to paid.
          const insts = await Installment.find({ sale: sale._id }).sort({ installmentNumber: 1 });
          for (const inst of insts) {
            if (inst.installmentNumber <= 2 && inst.status !== 'paid') {
              inst.paidAmount = inst.originalAmount;
              inst.status = 'paid';
              await inst.save();
            }
          }
        }
      }
      let tagged = 0;
      for (const sale of sales) {
        sale.channelPartnerAttribution = {
          viaChannelPartner: true,
          partners: [{
            channelPartner: shadow._id,
            agent: null,
            sharePct: 100,
          }],
          status: 'tagged',
          taggedBy: cpAgentUserId,
          taggedAt: new Date(),
          history: [{ at: new Date(), by: cpAgentUserId, action: 'tagged', note: 'Seeded CP attribution' }],
        };
        await sale.save();
        // Also tag the lead
        await Lead.findByIdAndUpdate(sale.lead, {
          $set: {
            'channelPartnerAttribution.viaChannelPartner': true,
            'channelPartnerAttribution.partners': [{ channelPartner: shadow._id, agent: null, agentUser: cpAgentUserId, sharePct: 100 }],
            'channelPartnerAttribution.status': 'tagged',
            'channelPartnerAttribution.taggedAt': new Date(),
          },
        });
        try {
          await syncCommissionForSale(sale._id, cpAgentUserId);
        } catch (err) {
          console.warn(`     ⚠️ syncCommissionForSale failed (non-fatal): ${err.message}`);
        }
        tagged++;
      }
      return tagged;
    };

    let cpTagged = 0;
    cpTagged += await tagSalesWithCp(crestline.org, mrn.org, mrn.users.Vikrant._id, 4);
    cpTagged += await tagSalesWithCp(crestline.org, asha.org, asha.users.Deepak._id, 4);
    cpTagged += await tagSalesWithCp(sunbridge.org, asha.org, asha.users.Mona._id, 4);
    cpTagged += await tagSalesWithCp(sunbridge.org, quick.org, quick.users.Sanya._id, 4);
    console.log(`   ✅ ${cpTagged} CP-attributed sales tagged`);

    // ─── PHASE H: Commission invoices (state variety) ────
    console.log('\n' + '═'.repeat(70));
    console.log('🧾  PHASE H — COMMISSION INVOICES IN EVERY STATE');
    console.log('═'.repeat(70));
    const allInvoiceStats = { draft: 0, submitted: 0, approved: 0, paid: 0 };
    for (const [cpData, devData] of [
      [mrn, crestline], [asha, crestline], [asha, sunbridge], [quick, sunbridge],
    ]) {
      const stats = await seedCommissionInvoicesForCpAttributedSales({
        cpOrg: cpData.org, cpOwner: cpData.owner, devOrg: devData.org,
      });
      console.log(`   • ${cpData.org.name} → ${devData.org.name}: ${stats.created} invoices (${JSON.stringify(stats.byStatus)})`);
      for (const [s, n] of Object.entries(stats.byStatus)) allInvoiceStats[s] = (allInvoiceStats[s] || 0) + n;
    }

    // ─── PHASE I: Notifications across CP orgs ──────────
    for (const cp of [mrn, prime, asha, quick, bluewave]) {
      await seedNotifications({ org: cp.org, users: cp.users });
    }

    // ─── FINAL SUMMARY ──────────────────────────────────
    console.log('\n' + '═'.repeat(70));
    console.log('🎉  FULL DEMO SEED COMPLETE — SUMMARY');
    console.log('═'.repeat(70));

    const orgCount = await Organization.countDocuments();
    const devOrgCount = await Organization.countDocuments({ type: 'builder' });
    const cpOrgCount = await Organization.countDocuments({ type: 'channel_partner' });
    const projectCount = await Project.countDocuments();
    const towerCount = await Tower.countDocuments();
    const unitCount = await Unit.countDocuments();
    const leadCount = await Lead.countDocuments();
    const saleCount = await Sale.countDocuments();
    const prospectCount = await Prospect.countDocuments();
    const partnershipCount = await Partnership.countDocuments();
    const partnershipActive = await Partnership.countDocuments({ status: 'active' });
    const partnershipPending = await Partnership.countDocuments({ status: 'pending' });
    const invoiceCount = await CommissionInvoice.countDocuments();
    const userCount = await User.countDocuments();

    const unitStatusAgg = await Unit.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]);
    const leadStatusAgg = await Lead.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]);
    const saleStatusAgg = await Sale.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]);
    const invoiceStatusAgg = await CommissionInvoice.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]);

    console.log(`Orgs:           ${orgCount} total (${devOrgCount} developers + ${cpOrgCount} channel partners)`);
    console.log(`Users:          ${userCount}`);
    console.log(`Projects:       ${projectCount}`);
    console.log(`Towers:         ${towerCount}`);
    console.log(`Units:          ${unitCount} | ${unitStatusAgg.map((s) => `${s._id}:${s.n}`).join(', ')}`);
    console.log(`Leads:          ${leadCount} | ${leadStatusAgg.map((s) => `${s._id}:${s.n}`).join(', ')}`);
    console.log(`Sales:          ${saleCount} | ${saleStatusAgg.map((s) => `${s._id}:${s.n}`).join(', ')}`);
    console.log(`Prospects:      ${prospectCount}`);
    console.log(`Partnerships:   ${partnershipCount} (${partnershipActive} active, ${partnershipPending} pending)`);
    console.log(`CP Invoices:    ${invoiceCount} | ${invoiceStatusAgg.map((s) => `${s._id}:${s.n}`).join(', ')}`);
    console.log('═'.repeat(70));

    // ─── Write credentials doc ──────────────────────────
    await writeCredentialsDoc({
      pv: { org: pvOrg, users: pvUsers },
      crestline, sunbridge,
      cpOrgs: { mrn, prime, asha, quick, bluewave },
    });
    console.log('\n📝 docs/DEMO_CREDENTIALS.md written.');
  } catch (err) {
    console.error('\n❌ Master seeder failed:', err);
    console.error(err.stack);
    process.exitCode = 1;
  } finally {
    await disconnect();
  }
}

// =============================================================================
// CREDENTIALS DOC
// =============================================================================

async function writeCredentialsDoc({ pv, crestline, sunbridge, cpOrgs }) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const docsDir = path.resolve(__dirname, '..', 'docs');
  if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });
  const outPath = path.join(docsDir, 'DEMO_CREDENTIALS.md');

  const today = new Date().toISOString().slice(0, 10);

  const renderUsers = async (orgId) => {
    const users = await User.find({ organization: orgId }).populate('roleRef', 'name').sort({ 'roleRef.level': 1, firstName: 1 });
    return users.map((u) => `- **${u.firstName} ${u.lastName}** — \`${u.email}\` | ${u.roleRef?.name || u.role}`).join('\n');
  };

  let out = `# PropVantage AI — Demo Credentials & Pitch Guide

Generated: ${today}
API: https://api.prop-vantage.com/api
Frontend: https://app.prop-vantage.com
Password (all users): \`${PASSWORD}\`

> Everything you need to walk a real-estate developer or channel partner through the platform.

## Developer Organizations

### PropVantage Demo Realty (ultra-luxury Mumbai)
Positioning: ₹18Cr–₹95Cr, BKC / Worli / Bandra West. Three projects with full sales pipeline.
${await renderUsers(pv.org._id)}

### ${crestline.org.name} (mid-luxury, Andheri / Powai / Goregaon)
Positioning: ₹1.6Cr–₹4.2Cr. Three projects across the under-construction lifecycle.
${await renderUsers(crestline.org._id)}

### ${sunbridge.org.name} (mid-market, Mira Road / Thane)
Positioning: ₹85L–₹2.4Cr. Two projects — one ready-to-move + one under construction.
${await renderUsers(sunbridge.org._id)}

## Channel Partner Organizations

### ${cpOrgs.mrn.org.name}
Corporate brokerage; partners with PropVantage Demo + Crestline.
${await renderUsers(cpOrgs.mrn.org._id)}

### ${cpOrgs.prime.org.name}
Boutique luxury-only brokerage; partners with PropVantage Demo.
${await renderUsers(cpOrgs.prime.org._id)}

### ${cpOrgs.asha.org.name}
Mid-market specialists; partners with Crestline + Sunbridge.
${await renderUsers(cpOrgs.asha.org._id)}

### ${cpOrgs.quick.org.name}
Volume broker; partners with Sunbridge.
${await renderUsers(cpOrgs.quick.org._id)}

### ${cpOrgs.bluewave.org.name}
Has a PENDING application to Crestline — used to demo developer-side approval queue.
${await renderUsers(cpOrgs.bluewave.org._id)}

## Active Partnerships

| Developer Org | Channel Partner | Status | Initiated By |
|---|---|---|---|
| PropVantage Demo Realty | Mumbai Realty Network | active | channel_partner |
| PropVantage Demo Realty | PrimeHomes Consultants | active | developer |
| PropVantage Demo Realty | (legacy Mumbai CP firms — Crest Luxury, Marine Drive, Sterling, Pinnacle, Bandra Bay, Heritage) | active/suspended | various |
| Crestline Estates | Mumbai Realty Network | active | channel_partner |
| Crestline Estates | Asha Realty Services | active | channel_partner |
| Crestline Estates | BlueWave Property Solutions | **pending** | channel_partner |
| Sunbridge Habitat | Asha Realty Services | active | channel_partner |
| Sunbridge Habitat | QuickClose Brokers | active | channel_partner |

## Pitch Walkthrough Suggestions

### 1. The "20% trigger → auto-drafted commission invoice" flow
1. Log in as **Vikrant Patil** (\`vikrant.patil@mrn-cp.com\`, Mumbai Realty Network).
2. Open the prospects list — see prospects pushed to Crestline.
3. Switch to the Commission Invoices tab — see a draft already auto-created at ≥20% customer payment.
4. Submit the draft. Then log in as **Vikram Sethi** (Crestline owner) → Commission Invoices inbox → approve.
5. As the same dev user, record payment → status flips to **paid** → CP gets notification.

### 2. Marketplace + partnership approval
1. Log in as **Vikram Sethi** (Crestline owner).
2. Visit Partnerships → Incoming Applications → see **BlueWave Property Solutions** pending application.
3. Either approve (commission terms 4%) or reject — both flows are wired.

### 3. Multi-project leadership view (developer)
1. Log in as **Rohan Marwah** (PropVantage Demo owner).
2. Leadership Dashboard — see absorption by project (BKC selling fast, Worli leak, Bandra new launch).
3. Project drill-down → competitive analysis is pre-cached → instant AI insights.

### 4. CP business overview
1. Log in as **Raghav Saraf** (\`raghav.saraf@mrn-cp.com\`).
2. Dashboard shows prospects across both partner devs (PropVantage Demo + Crestline).
3. Marketplace tab — discover and apply to additional developers.
4. Analytics → commission revenue split + reconciliation view.

### 5. Sale lifecycle: Pending Approval → Booked → Cancellation
- In Crestline, one sale is **Pending Approval** (discount > threshold) — log in as Rajiv Malhotra to see the approval flow.
- One Crestline sale is **Cancelled** — shows the cancellation cascade on the lead, payment plan, installments.

### 6. CP-side external developer
- Mumbai Realty Network has an off-platform record for "Galaxy Realtors" — useful to show how CPs track non-platform devs and the "invite to platform" flow.
`;
  fs.writeFileSync(outPath, out, 'utf8');
}

main();
