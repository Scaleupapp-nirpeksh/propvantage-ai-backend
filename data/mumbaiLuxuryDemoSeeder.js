// File: data/mumbaiLuxuryDemoSeeder.js
// Description: Pitch-ready demo dataset for ultra-luxury Mumbai real estate.
//
//   Organization:  PropVantage Demo Realty (fictional Mumbai developer)
//   Projects:      3 — BKC (selling well), Worli (cash-flow leak), Bandra West (new launch)
//   Coverage:      org, users, roles, projects, towers, units, leads (with rich score
//                  breakdowns), interactions, sales, payment plans, installments,
//                  payment transactions, real Mumbai competitors, pre-cached
//                  competitive analysis (so the AI screens load instantly), tasks,
//                  notifications, construction milestones, partner commissions.
//
// Usage:
//   node data/mumbaiLuxuryDemoSeeder.js          # create or refresh demo data
//   node data/mumbaiLuxuryDemoSeeder.js --clean  # delete demo org and exit
//
// Idempotent: re-running drops everything tied to the demo org and recreates it.

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

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
import CompetitorProject from '../models/competitorProjectModel.js';
import CompetitiveAnalysis from '../models/competitiveAnalysisModel.js';
import Task from '../models/taskModel.js';
import Notification from '../models/notificationModel.js';
import ConstructionMilestone from '../models/constructionMilestoneModel.js';
import { seedDefaultRoles } from './defaultRoles.js';

dotenv.config();

// =============================================================================
// CONFIG
// =============================================================================

const DEMO_ORG_NAME = 'PropVantage Demo Realty';
const DEMO_PASSWORD = 'Demo@1234';
const DEMO_PHONE_PREFIX = '+91 99999-';

// =============================================================================
// HELPERS
// =============================================================================

const daysFromNow = (d) => new Date(Date.now() + d * 86400000);
const daysAgo = (d) => new Date(Date.now() - d * 86400000);
const minutesAgo = (m) => new Date(Date.now() - m * 60000);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const pickN = (arr, n) => [...arr].sort(() => 0.5 - Math.random()).slice(0, n);
const intBetween = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const roundTo = (n, step = 100000) => Math.round(n / step) * step;
const lakhsToINR = (l) => Math.round(l * 100000);
const crToINR = (cr) => Math.round(cr * 10000000);

const HNI_FIRST_NAMES = [
  'Aditya', 'Arjun', 'Aryan', 'Akshay', 'Aniket', 'Aman', 'Aanya', 'Devika',
  'Harshit', 'Ishaan', 'Kabir', 'Karan', 'Kunal', 'Manav', 'Meera', 'Mihir',
  'Neha', 'Nikhil', 'Nisha', 'Pranav', 'Priya', 'Rahul', 'Rajat', 'Riya',
  'Rohan', 'Rohini', 'Sanya', 'Shaan', 'Shivani', 'Tanvi', 'Tarun', 'Vihaan',
  'Vikram', 'Vivek', 'Yash', 'Zara', 'Ananya', 'Ishita', 'Kiran', 'Sameer',
];
const HNI_LAST_NAMES = [
  'Mehta', 'Shah', 'Agarwal', 'Bagree', 'Kothari', 'Bafna', 'Goenka', 'Mittal',
  'Khanna', 'Singhania', 'Hinduja', 'Mahindra', 'Wadia', 'Mistry', 'Piramal',
  'Godrej', 'Bajaj', 'Munjal', 'Kapoor', 'Khurana', 'Patel', 'Desai', 'Jhaveri',
  'Doshi', 'Saraf', 'Jindal', 'Modi', 'Bansal', 'Bhansali', 'Choksi',
];

const LEAD_SOURCES = ['Referral', 'Walk-in', 'Property Portal', 'Website', 'Social Media', 'Advertisement'];
const LEAD_SOURCE_WEIGHTS = [0.35, 0.20, 0.18, 0.10, 0.10, 0.07]; // referrals dominant for ultra-luxury
const weightedPick = (arr, weights) => {
  const r = Math.random();
  let acc = 0;
  for (let i = 0; i < arr.length; i++) {
    acc += weights[i];
    if (r <= acc) return arr[i];
  }
  return arr[arr.length - 1];
};

const randomPhone = () => DEMO_PHONE_PREFIX + String(intBetween(10000, 99999));
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

let phoneCounter = 10000;
const uniquePhone = () => DEMO_PHONE_PREFIX + String(phoneCounter++);

// =============================================================================
// CONNECT
// =============================================================================

async function connect() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is not set in .env');
  await mongoose.connect(process.env.MONGO_URI);
  console.log('✅ Connected to MongoDB');
}

async function disconnect() {
  await mongoose.disconnect();
}

// =============================================================================
// CLEAN (delete only demo-org data)
// =============================================================================

async function cleanDemoOrg() {
  const existing = await Organization.findOne({ name: DEMO_ORG_NAME });
  if (!existing) {
    console.log('   (no existing demo org to clean)');
    return;
  }
  const orgId = existing._id;
  console.log(`🧹 Cleaning existing demo org ${orgId}...`);
  const collections = [
    [ConstructionMilestone, 'milestones'],
    [Notification, 'notifications'],
    [Task, 'tasks'],
    [CompetitiveAnalysis, 'competitive analyses'],
    [CompetitorProject, 'competitors'],
    [PaymentTransaction, 'payment transactions'],
    [Installment, 'installments'],
    [PaymentPlan, 'payment plans'],
    [Sale, 'sales'],
    [Interaction, 'interactions'],
    [Lead, 'leads'],
    [Unit, 'units'],
    [Tower, 'towers'],
    [ProjectAssignment, 'project assignments'],
    [Project, 'projects'],
    [User, 'users'],
    [Role, 'roles'],
    [Organization, 'organization'],
  ];
  for (const [Model, label] of collections) {
    const filter = Model === Organization ? { _id: orgId } : { organization: orgId };
    const res = await Model.deleteMany(filter);
    if (res.deletedCount > 0) console.log(`   - removed ${res.deletedCount} ${label}`);
  }
}

// =============================================================================
// SEED — ORG + ROLES + USERS
// =============================================================================

async function seedOrgAndUsers() {
  console.log('\n🏢 Creating organization...');
  const org = await Organization.create({
    name: DEMO_ORG_NAME,
    type: 'builder',
    country: 'India',
    city: 'Mumbai',
    contactInfo: {
      phone: '+91 22 6789-1234',
      website: 'https://propvantage-demo-realty.example.com',
      address: 'Express Towers, 4th Floor, Nariman Point, Mumbai - 400021',
    },
    subscriptionPlan: 'enterprise',
    isActive: true,
  });
  console.log(`   ✅ ${org.name}`);

  console.log('\n🔐 Seeding default roles...');
  const roleResult = await seedDefaultRoles(org._id);
  const ownerRole = await Role.findOne({ organization: org._id, isOwnerRole: true });
  const roleByName = {};
  for (const r of await Role.find({ organization: org._id })) {
    roleByName[r.name] = r;
  }
  console.log(`   ✅ ${roleResult?.totalRoles || Object.keys(roleByName).length} roles seeded`);

  console.log('\n👥 Creating users...');
  // NOTE: pass plain password — the User model's pre('save') hook hashes it.
  // Pre-hashing would double-hash and break login.

  // The user.role string is a legacy enum that doesn't include "Organization Owner";
  // owners are flagged via roleRef → role.isOwnerRole. We map legacyRole separately
  // so the owner record sets role='Business Head' but roleRef → Organization Owner.
  const userSpecs = [
    { firstName: 'Rohan',   lastName: 'Marwah',    roleRefName: 'Organization Owner', legacyRole: 'Business Head',    title: 'Promoter / Founder' },
    { firstName: 'Aditya',  lastName: 'Bhatia',    roleRefName: 'Business Head',      legacyRole: 'Business Head',    title: 'CEO' },
    { firstName: 'Karan',   lastName: 'Goenka',    roleRefName: 'Project Director',   legacyRole: 'Project Director', title: 'Head of Projects' },
    { firstName: 'Vikram',  lastName: 'Khanna',    roleRefName: 'Sales Head',         legacyRole: 'Sales Head',       title: 'Director - Sales' },
    { firstName: 'Anjali',  lastName: 'Sheth',     roleRefName: 'Sales Manager',      legacyRole: 'Sales Manager',    title: 'Sales Manager - BKC' },
    { firstName: 'Priya',   lastName: 'Mehta',     roleRefName: 'Sales Executive',    legacyRole: 'Sales Executive',  title: 'Sr. Sales - Worli' },
    { firstName: 'Rahul',   lastName: 'Kapoor',    roleRefName: 'Sales Executive',    legacyRole: 'Sales Executive',  title: 'Sr. Sales - BKC' },
    { firstName: 'Tanvi',   lastName: 'Bafna',     roleRefName: 'Sales Executive',    legacyRole: 'Sales Executive',  title: 'Sales - Bandra' },
    { firstName: 'Neha',    lastName: 'Singhania', roleRefName: 'Finance Head',       legacyRole: 'Finance Head',     title: 'CFO' },
    { firstName: 'Sameer',  lastName: 'Doshi',     roleRefName: 'Marketing Head',     legacyRole: 'Marketing Head',   title: 'Head - Marketing' },
  ];

  const users = {};
  for (let i = 0; i < userSpecs.length; i++) {
    const spec = userSpecs[i];
    const role = roleByName[spec.roleRefName];
    if (!role) {
      console.warn(`   ⚠️  role "${spec.roleRefName}" not found — skipping ${spec.firstName}`);
      continue;
    }
    const u = await User.create({
      organization: org._id,
      firstName: spec.firstName,
      lastName: spec.lastName,
      email: `${spec.firstName.toLowerCase()}.${spec.lastName.toLowerCase()}@propvantage-demo.com`,
      password: DEMO_PASSWORD,
      role: spec.legacyRole,
      roleRef: role._id,
      jobTitle: spec.title,
      isActive: true,
      isInvitationAccepted: true,
      invitationStatus: 'accepted',
      invitationAcceptedAt: daysAgo(intBetween(30, 180)),
    });
    users[spec.firstName] = u;
  }
  console.log(`   ✅ ${Object.keys(users).length} users created`);
  console.log(`   📧 Owner login: rohan.marwah@propvantage-demo.com / ${DEMO_PASSWORD}`);
  return { org, users, ownerRole, roleByName };
}

// =============================================================================
// SEED — PROJECTS
// =============================================================================

async function seedProjects(org) {
  console.log('\n🏗️  Creating 3 Mumbai luxury projects...');

  // Project 1: BKC — selling well, premium pricing, ~60% sold
  const bkcProject = await Project.create({
    organization: org._id,
    name: 'Heliconia BKC',
    description: 'Boutique ultra-luxury tower in the heart of BKC. 78 residences — 3.5 BHK, 4 BHK, and signature duplexes. Floor-to-ceiling views, private elevators, dedicated concierge.',
    type: 'apartment',
    status: 'under-construction',
    location: { city: 'Mumbai', area: 'BKC', pincode: '400051', state: 'Maharashtra', landmark: 'G Block, Bandra Kurla Complex' },
    totalUnits: 78,
    totalArea: 280000,
    priceRange: { min: crToINR(22), max: crToINR(58) },
    targetRevenue: crToINR(2800),
    launchDate: daysAgo(420),
    expectedCompletionDate: daysFromNow(540),
    amenities: ['Private Elevators', 'Sky Lounge', 'Infinity Pool', 'Concierge', 'Wine Cellar', 'Cigar Room', 'Spa', 'EV Charging', 'Helipad Access'],
    pricingRules: { gstRate: 5, tdsRate: 1, floorRiseCharge: 250000, plcCharges: { parkFacing: 1500000, cornerUnit: 1000000, seaFacing: 0 } },
    additionalCharges: [
      { name: 'Premium Car Parking (2 covered)', amount: 4000000, type: 'one-time' },
      { name: 'Club Membership (Lifetime)', amount: 2500000, type: 'one-time' },
      { name: 'Maintenance Deposit (5 years)', amount: 1500000, type: 'one-time' },
    ],
    approvals: {
      rera: { number: 'P51900048221', date: daysAgo(440), validUntil: daysFromNow(900) },
      environmentClearance: { number: 'EC/MH/2024/0721', date: daysAgo(460) },
    },
    budgetTracking: { enabled: true, varianceThreshold: 8, targetPricePerUnit: crToINR(36) },
  });
  console.log(`   ✅ ${bkcProject.name} — BKC, premium absorption`);

  // Project 2: Worli — cash-flow leak, slower absorption, 25% sold
  const worliProject = await Project.create({
    organization: org._id,
    name: 'Marquis Sea Face',
    description: 'Flagship sea-facing tower in Worli. 52 residences across 4 BHK XL and 5 BHK duplexes. South-facing Arabian Sea views. Designed in collaboration with WOHA Singapore.',
    type: 'apartment',
    status: 'under-construction',
    location: { city: 'Mumbai', area: 'Worli', pincode: '400018', state: 'Maharashtra', landmark: 'Worli Sea Face' },
    totalUnits: 52,
    totalArea: 320000,
    priceRange: { min: crToINR(38), max: crToINR(95) },
    targetRevenue: crToINR(3400),
    launchDate: daysAgo(540),
    expectedCompletionDate: daysFromNow(720),
    amenities: ['Private Yacht Concierge', 'Rooftop Infinity Pool', 'Sky Lobby', '2-floor Health Club', 'Cinema', 'Wine Tasting Room', 'Butler Service', 'EV Fleet'],
    pricingRules: { gstRate: 5, tdsRate: 1, floorRiseCharge: 400000, plcCharges: { parkFacing: 2000000, cornerUnit: 1500000, seaFacing: 5000000 } },
    additionalCharges: [
      { name: 'Premium Parking (3 covered)', amount: 6000000, type: 'one-time' },
      { name: 'Club Membership (Lifetime, Family)', amount: 4000000, type: 'one-time' },
      { name: 'Maintenance Deposit (10 years)', amount: 3000000, type: 'one-time' },
    ],
    approvals: {
      rera: { number: 'P51900046112', date: daysAgo(560), validUntil: daysFromNow(800) },
    },
    budgetTracking: { enabled: true, varianceThreshold: 10, targetPricePerUnit: crToINR(58) },
  });
  console.log(`   ✅ ${worliProject.name} — Worli, slower absorption (the leak)`);

  // Project 3: Bandra West / Pali Hill — new launch, mostly leads
  const bandraProject = await Project.create({
    organization: org._id,
    name: 'Pali Crest',
    description: 'New launch in Pali Hill. 32 residences — limited-edition 4 BHK XL and twin-bay penthouses. Private gardens, designer interiors by Yabu Pushelberg.',
    type: 'apartment',
    status: 'launched',
    location: { city: 'Mumbai', area: 'Bandra West', pincode: '400050', state: 'Maharashtra', landmark: 'Off Pali Hill, near Carter Road' },
    totalUnits: 32,
    totalArea: 142000,
    priceRange: { min: crToINR(18), max: crToINR(42) },
    targetRevenue: crToINR(900),
    launchDate: daysAgo(85),
    expectedCompletionDate: daysFromNow(1020),
    amenities: ['Private Garden', 'Sky Lounge', 'Pool', 'Library', 'Wellness Studio', 'Concierge', 'EV Charging'],
    pricingRules: { gstRate: 5, tdsRate: 1, floorRiseCharge: 200000, plcCharges: { parkFacing: 1200000, cornerUnit: 800000 } },
    additionalCharges: [
      { name: 'Covered Parking (2)', amount: 3000000, type: 'one-time' },
      { name: 'Club Membership', amount: 2000000, type: 'one-time' },
      { name: 'Maintenance Deposit', amount: 1200000, type: 'one-time' },
    ],
    approvals: {
      rera: { number: 'P51900052998', date: daysAgo(95), validUntil: daysFromNow(1100) },
    },
    budgetTracking: { enabled: true, varianceThreshold: 12, targetPricePerUnit: crToINR(28) },
  });
  console.log(`   ✅ ${bandraProject.name} — Bandra West, new launch`);

  return { bkcProject, worliProject, bandraProject };
}

// =============================================================================
// SEED — PROJECT ASSIGNMENTS
// =============================================================================

async function seedProjectAssignments(org, users, projects) {
  console.log('\n🔑 Assigning users to projects...');
  const owner = users.Rohan;
  const docs = [];
  for (const proj of projects) {
    for (const u of Object.values(users)) {
      docs.push({ organization: org._id, user: u._id, project: proj._id, assignedBy: owner._id, assignedAt: daysAgo(intBetween(10, 60)) });
    }
  }
  await ProjectAssignment.insertMany(docs);
  console.log(`   ✅ ${docs.length} assignments`);
}

// =============================================================================
// SEED — TOWERS
// =============================================================================

async function seedTowers(org, users, projects) {
  console.log('\n🏗️  Creating towers...');
  const owner = users.Rohan;
  const tdata = [
    // BKC: 1 boutique tower
    { project: projects.bkcProject._id, name: 'The Heliconia', code: 'HEL-A', totalFloors: 32, unitsPerFloor: 2, totalUnits: 64, towerType: 'residential', status: 'under_construction',
      construction: { progress: 38 } },
    { project: projects.bkcProject._id, name: 'The Heliconia — Sky Duplex Wing', code: 'HEL-S', totalFloors: 7, unitsPerFloor: 2, totalUnits: 14, towerType: 'residential', status: 'under_construction',
      construction: { progress: 42 } },
    // Worli: 1 tall sea-facing tower
    { project: projects.worliProject._id, name: 'Marquis North', code: 'MQ-N', totalFloors: 42, unitsPerFloor: 1, totalUnits: 42, towerType: 'residential', status: 'under_construction',
      construction: { progress: 24 } },
    { project: projects.worliProject._id, name: 'Marquis South — Penthouse Wing', code: 'MQ-S', totalFloors: 10, unitsPerFloor: 1, totalUnits: 10, towerType: 'residential', status: 'under_construction',
      construction: { progress: 22 } },
    // Bandra: 2 small towers
    { project: projects.bandraProject._id, name: 'Pali Crest — East', code: 'PC-E', totalFloors: 12, unitsPerFloor: 1, totalUnits: 12, towerType: 'residential', status: 'planning',
      construction: { progress: 5 } },
    { project: projects.bandraProject._id, name: 'Pali Crest — West', code: 'PC-W', totalFloors: 18, unitsPerFloor: 1, totalUnits: 18, towerType: 'residential', status: 'planning',
      construction: { progress: 4 } },
    { project: projects.bandraProject._id, name: 'Pali Crest — Penthouse Pavilion', code: 'PC-P', totalFloors: 2, unitsPerFloor: 1, totalUnits: 2, towerType: 'residential', status: 'planning',
      construction: { progress: 3 } },
  ];

  const towers = await Tower.insertMany(
    tdata.map((t) => ({
      organization: org._id,
      project: t.project,
      towerName: t.name,
      towerCode: t.code,
      totalFloors: t.totalFloors,
      unitsPerFloor: t.unitsPerFloor,
      totalUnits: t.totalUnits,
      towerType: t.towerType,
      status: t.status,
      construction: t.construction,
      createdBy: users.Karan._id,
    }))
  );
  console.log(`   ✅ ${towers.length} towers across 3 projects`);
  return towers;
}

// =============================================================================
// SEED — UNITS
// =============================================================================

const UNIT_PRESETS = {
  // [unitType, carpetMin, carpetMax, pricePerSqft, sb upMultiplier]
  'BKC-4BHK':       { type: '4BHK',         carpetRange: [3000, 3400], pricePerSqft: 68000, sbpFactor: 1.45 },
  'BKC-4BHK_XL':    { type: '4BHK XL',      carpetRange: [3500, 3900], pricePerSqft: 72000, sbpFactor: 1.45 },
  'BKC-DUPLEX':     { type: 'Duplex',       carpetRange: [5200, 6200], pricePerSqft: 78000, sbpFactor: 1.40 },
  'WORLI-4BHK_XL':  { type: '4BHK XL',      carpetRange: [3800, 4400], pricePerSqft: 88000, sbpFactor: 1.42 },
  'WORLI-5BHK':     { type: '5BHK',         carpetRange: [5200, 6000], pricePerSqft: 95000, sbpFactor: 1.42 },
  'WORLI-PH':       { type: 'Penthouse',    carpetRange: [8500, 10500], pricePerSqft: 110000, sbpFactor: 1.38 },
  'BANDRA-4BHK':    { type: '4BHK',         carpetRange: [2800, 3200], pricePerSqft: 62000, sbpFactor: 1.45 },
  'BANDRA-4BHK_XL': { type: '4BHK XL',      carpetRange: [3400, 3900], pricePerSqft: 68000, sbpFactor: 1.45 },
  'BANDRA-PH':      { type: 'Penthouse',    carpetRange: [6500, 7800], pricePerSqft: 78000, sbpFactor: 1.40 },
};

const STATUS_MIX = {
  BKC:    { available: 0.30, booked: 0.10, sold: 0.55, blocked: 0.05 },   // BKC selling well — 55% sold
  WORLI:  { available: 0.65, booked: 0.05, sold: 0.25, blocked: 0.05 },   // Worli slow — only 25% sold
  BANDRA: { available: 0.85, booked: 0.03, sold: 0.08, blocked: 0.04 },   // Bandra new launch — 8% sold
};

const mixToStatus = (mix) => {
  const r = Math.random();
  let acc = 0;
  for (const [k, v] of Object.entries(mix)) {
    acc += v;
    if (r <= acc) return k;
  }
  return 'available';
};

async function seedUnits(org, users, projects, towers) {
  console.log('\n🏠 Creating units...');
  const towersByCode = Object.fromEntries(towers.map((t) => [t.towerCode, t]));
  const unitsData = [];

  const makeUnit = ({ project, tower, unitNumber, floor, preset, statusGroup }) => {
    const p = UNIT_PRESETS[preset];
    const carpet = intBetween(p.carpetRange[0], p.carpetRange[1]);
    const sbp = Math.round(carpet * p.sbpFactor);
    const basePrice = roundTo(sbp * p.pricePerSqft, 100000);
    const facing = pick(['North', 'South', 'East', 'West', 'North-East', 'North-West', 'South-East', 'South-West']);
    const isSeaFacing = project.location.area === 'Worli' && (facing === 'West' || facing === 'South-West');
    const isParkFacing = !isSeaFacing && Math.random() < 0.4;
    const isCornerUnit = Math.random() < 0.30;
    const status = mixToStatus(STATUS_MIX[statusGroup]);

    return {
      organization: org._id,
      project: project._id,
      tower: tower._id,
      unitNumber,
      type: p.type,
      floor,
      areaSqft: sbp,
      carpetArea: carpet,
      builtUpArea: Math.round(carpet * 1.20),
      superBuiltUpArea: sbp,
      basePrice,
      currentPrice: basePrice,
      facing,
      status,
      features: {
        isParkFacing, isCornerUnit,
        isSeaFacing,
        hasBalcony: true, hasServantRoom: true, hasParkingSlot: true,
        hasStudyRoom: Math.random() < 0.5, hasUtilityArea: true,
      },
      specifications: {
        bedrooms: p.type.startsWith('5') ? 5 : p.type.includes('Duplex') ? 5 : p.type === 'Penthouse' ? 6 : 4,
        bathrooms: p.type === 'Penthouse' ? 7 : 5,
        livingRooms: p.type === 'Penthouse' || p.type === 'Duplex' ? 2 : 1,
        kitchen: 1,
        balconies: p.type === 'Penthouse' ? 4 : 2,
        terraceArea: p.type === 'Penthouse' ? intBetween(800, 1500) : 0,
        carpetArea: carpet, builtUpArea: Math.round(carpet * 1.20), superBuiltUpArea: sbp,
      },
      parking: { covered: p.type === 'Penthouse' ? 4 : 2, open: 0 },
      createdBy: users.Karan._id,
    };
  };

  // BKC — Heliconia main (32 floors × 2 = 64) and Sky Duplex wing (7 × 2 = 14)
  const helA = towersByCode['HEL-A'];
  for (let f = 1; f <= helA.totalFloors; f++) {
    for (let i = 1; i <= helA.unitsPerFloor; i++) {
      const preset = f >= 25 ? 'BKC-4BHK_XL' : 'BKC-4BHK';
      unitsData.push(makeUnit({ project: projects.bkcProject, tower: helA, unitNumber: `${helA.towerCode}-${f}0${i}`, floor: f, preset, statusGroup: 'BKC' }));
    }
  }
  const helS = towersByCode['HEL-S'];
  for (let f = 1; f <= helS.totalFloors; f++) {
    for (let i = 1; i <= helS.unitsPerFloor; i++) {
      unitsData.push(makeUnit({ project: projects.bkcProject, tower: helS, unitNumber: `${helS.towerCode}-${f}0${i}`, floor: f * 4, preset: 'BKC-DUPLEX', statusGroup: 'BKC' }));
    }
  }
  // Worli — Marquis North (42 floors × 1) + Marquis South Penthouse wing (10 × 1)
  const mqN = towersByCode['MQ-N'];
  for (let f = 1; f <= mqN.totalFloors; f++) {
    const preset = f >= 35 ? 'WORLI-5BHK' : 'WORLI-4BHK_XL';
    unitsData.push(makeUnit({ project: projects.worliProject, tower: mqN, unitNumber: `${mqN.towerCode}-${f}01`, floor: f, preset, statusGroup: 'WORLI' }));
  }
  const mqS = towersByCode['MQ-S'];
  for (let f = 1; f <= mqS.totalFloors; f++) {
    unitsData.push(makeUnit({ project: projects.worliProject, tower: mqS, unitNumber: `${mqS.towerCode}-${f}01`, floor: f * 4, preset: 'WORLI-PH', statusGroup: 'WORLI' }));
  }
  // Bandra — Pali Crest East/West/Pavilion
  const pcE = towersByCode['PC-E'];
  for (let f = 1; f <= pcE.totalFloors; f++) {
    unitsData.push(makeUnit({ project: projects.bandraProject, tower: pcE, unitNumber: `${pcE.towerCode}-${f}01`, floor: f, preset: 'BANDRA-4BHK', statusGroup: 'BANDRA' }));
  }
  const pcW = towersByCode['PC-W'];
  for (let f = 1; f <= pcW.totalFloors; f++) {
    unitsData.push(makeUnit({ project: projects.bandraProject, tower: pcW, unitNumber: `${pcW.towerCode}-${f}01`, floor: f, preset: 'BANDRA-4BHK_XL', statusGroup: 'BANDRA' }));
  }
  const pcP = towersByCode['PC-P'];
  for (let f = 1; f <= pcP.totalFloors; f++) {
    unitsData.push(makeUnit({ project: projects.bandraProject, tower: pcP, unitNumber: `${pcP.towerCode}-${f}01`, floor: f * 4, preset: 'BANDRA-PH', statusGroup: 'BANDRA' }));
  }

  const units = await Unit.insertMany(unitsData);
  console.log(`   ✅ ${units.length} units created`);
  return units;
}

// =============================================================================
// SEED — LEADS + INTERACTIONS (with rich score breakdowns)
// =============================================================================

function scoreBreakdownFor({ interactionCount, daysSinceLastInteraction, source, timeline, budget, avgUnitPrice, ageInDays }) {
  // Mimic the real scoring service's output shape so the lead-detail screen renders.
  const sourceScores = {
    'Referral': 95, 'Walk-in': 85, 'Property Portal': 60, 'Website': 50,
    'Social Media': 45, 'Advertisement': 40, 'Cold Call': 35, 'Other': 30,
  };
  const sourceRaw = sourceScores[source] ?? 40;
  const timelineMap = { immediate: 100, '1-3_months': 85, '3-6_months': 65, '6-12_months': 45, '12+_months': 25 };
  const timelineRaw = timelineMap[timeline] ?? 50;

  const engagementRaw = Math.min(100, interactionCount * 12 + (daysSinceLastInteraction !== null && daysSinceLastInteraction <= 7 ? 20 : 0));
  const recencyRaw = ageInDays <= 7 ? 90 : ageInDays <= 30 ? 70 : ageInDays <= 60 ? 55 : ageInDays <= 120 ? 40 : 25;

  // Budget alignment: how close is mid-budget to avgUnitPrice
  const mid = (budget.min + budget.max) / 2;
  const dev = Math.abs(mid - avgUnitPrice) / avgUnitPrice;
  const budgetRaw = dev < 0.05 ? 95 : dev < 0.15 ? 80 : dev < 0.30 ? 60 : dev < 0.50 ? 40 : 20;
  const alignmentPct = Math.max(0, Math.round(100 - dev * 100));

  // weights: budget 0.30, engagement 0.25, timeline 0.20, source 0.15, recency 0.10
  const score = Math.round(
    budgetRaw * 0.30 + engagementRaw * 0.25 + timelineRaw * 0.20 + sourceRaw * 0.15 + recencyRaw * 0.10
  );
  const grade =
    score >= 90 ? 'A+' : score >= 80 ? 'A' : score >= 70 ? 'B+' :
    score >= 60 ? 'B' : score >= 50 ? 'C+' : score >= 40 ? 'C' : 'D';
  const priority =
    score >= 85 ? 'Critical' : score >= 70 ? 'High' : score >= 55 ? 'Medium' :
    score >= 40 ? 'Low' : 'Very Low';

  return {
    score, grade, priority,
    breakdown: {
      budgetAlignment: {
        rawScore: budgetRaw, weightedScore: Math.round(budgetRaw * 0.30),
        reasoning: dev < 0.15 ? 'Stated budget tightly aligned with project mid-pricing' : dev < 0.30 ? 'Budget directionally aligned with project pricing' : 'Budget significantly off from project pricing',
        budgetRange: `₹${(budget.min / 10000000).toFixed(1)}–${(budget.max / 10000000).toFixed(1)} Cr`,
        avgUnitPrice: `₹${(avgUnitPrice / 10000000).toFixed(1)} Cr`,
        alignmentPercentage: alignmentPct,
        deviation: Math.round(dev * 100),
      },
      engagementLevel: {
        rawScore: engagementRaw, weightedScore: Math.round(engagementRaw * 0.25),
        reasoning: interactionCount >= 5 ? `${interactionCount} interactions in 60 days — high engagement` : interactionCount >= 3 ? `${interactionCount} interactions — sustained interest` : 'Limited engagement so far',
        interactionCount,
        recencyBonus: daysSinceLastInteraction !== null && daysSinceLastInteraction <= 7 ? 20 : 0,
        lastInteractionDate: daysSinceLastInteraction !== null ? daysAgo(daysSinceLastInteraction) : null,
        daysSinceLastInteraction,
      },
      timelineUrgency: {
        rawScore: timelineRaw, weightedScore: Math.round(timelineRaw * 0.20),
        reasoning: timeline === 'immediate' ? 'Buyer indicated immediate close' : timeline === '1-3_months' ? 'Close window within quarter' : 'Long horizon',
        timeline: timeline,
      },
      sourceQuality: {
        rawScore: sourceRaw, weightedScore: Math.round(sourceRaw * 0.15),
        reasoning: source === 'Referral' ? 'Referred by existing buyer — highest-converting source' : source === 'Walk-in' ? 'Walk-in — buyer self-selected' : `${source} — average source quality`,
        source,
      },
      recencyFactor: {
        rawScore: recencyRaw, weightedScore: Math.round(recencyRaw * 0.10),
        reasoning: ageInDays <= 7 ? 'Brand-new lead' : ageInDays <= 30 ? 'Recent lead, still warm' : 'Aging lead',
        ageInDays,
        createdDate: daysAgo(ageInDays),
      },
    },
  };
}

async function seedLeadsAndInteractions(org, users, projects, units) {
  console.log('\n🎯 Creating leads + interactions...');
  const salesExecs = [users.Priya, users.Rahul, users.Tanvi];
  const projectMidPrices = {
    [projects.bkcProject._id]:    crToINR(36),
    [projects.worliProject._id]:  crToINR(58),
    [projects.bandraProject._id]: crToINR(28),
  };

  const leadsToCreate = [];
  const interactionsToCreate = [];

  // 130 leads spread across projects roughly proportional to inventory
  const projectAlloc = [
    { project: projects.bkcProject,    n: 55, mid: crToINR(36) },
    { project: projects.worliProject,  n: 45, mid: crToINR(58) },
    { project: projects.bandraProject, n: 35, mid: crToINR(28) },
  ];

  for (const { project, n, mid } of projectAlloc) {
    for (let i = 0; i < n; i++) {
      const firstName = pick(HNI_FIRST_NAMES);
      const lastName = pick(HNI_LAST_NAMES);
      const source = weightedPick(LEAD_SOURCES, LEAD_SOURCE_WEIGHTS);
      const exec = pick(salesExecs);
      const ageInDays = intBetween(2, 180);
      const interactionCount = ageInDays <= 14 ? intBetween(1, 3) : ageInDays <= 45 ? intBetween(2, 6) : intBetween(3, 9);
      const daysSinceLast = Math.min(ageInDays, intBetween(0, 25));
      const timeline = pick(['immediate', '1-3_months', '3-6_months', '6-12_months', '12+_months']);

      // Budget: realistic spread around project mid-price
      const dev = (Math.random() - 0.4) * 0.6;
      const midBudget = mid * (1 + dev);
      const budget = { min: Math.round(midBudget * 0.85), max: Math.round(midBudget * 1.20), isValidated: source === 'Referral', budgetSource: source === 'Referral' ? 'pre_approved' : 'self_reported' };

      const sb = scoreBreakdownFor({
        interactionCount, daysSinceLastInteraction: daysSinceLast,
        source, timeline, budget, avgUnitPrice: mid, ageInDays,
      });

      // Status logic: high-scoring + project-status driven
      let status;
      if (sb.score >= 85 && Math.random() < 0.4) status = 'Negotiating';
      else if (sb.score >= 75) status = pick(['Site Visit Completed', 'Site Visit Scheduled', 'Qualified']);
      else if (sb.score >= 55) status = pick(['Contacted', 'Qualified']);
      else status = pick(['New', 'Contacted']);

      const lead = {
        organization: org._id,
        project: project._id,
        assignedTo: exec._id,
        firstName, lastName,
        email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}.${i}@demo-buyers.example.com`,
        phone: uniquePhone(),
        source,
        status,
        score: sb.score,
        scoreGrade: sb.grade,
        priority: sb.priority,
        confidence: intBetween(70, 95),
        scoreBreakdown: sb.breakdown,
        lastScoreUpdate: daysAgo(intBetween(0, 7)),
        budget,
        requirements: {
          timeline,
          unitType: project.location.area === 'Worli' ? '4BHK XL' : '4BHK',
          notes: pick([
            'Looking for sea-facing unit, high floor preferred',
            'Wife wants 3+ bedrooms, no compromise on parking',
            'Investment + end-use. 2-3 year horizon.',
            'Family relocating from Delhi, kids in international school',
            'Wants ready-to-move or possession in 18 months',
            'Specifically interested in penthouse / duplex options',
          ]),
        },
        createdAt: daysAgo(ageInDays),
      };
      leadsToCreate.push(lead);
    }
  }

  const leads = await Lead.insertMany(leadsToCreate);
  console.log(`   ✅ ${leads.length} leads created`);

  // Interactions — generate per lead
  const INTERACTION_TYPES = ['Call', 'Email', 'WhatsApp', 'Meeting', 'Site Visit', 'Note'];
  const interactionContent = {
    'Call': ['Brief intro call, discussed requirements', 'Discussed pricing and floor plans', 'Follow-up call — buyer requested floor 30+ options'],
    'Email': ['Sent floor plans + price sheet', 'Sent payment plan options', 'Sent invoice for site visit booking'],
    'WhatsApp': ['Shared 3D walkthrough link', 'Confirmed site visit for Saturday 11am', 'Sent video tour of unit'],
    'Meeting': ['Site office meeting with family', 'Pricing negotiation meeting', 'Closure discussion with sales head'],
    'Site Visit': ['First site visit — wife and designer attended', 'Second site visit — finalized unit', 'Construction tour — showed sample flat'],
    'Note': ['Buyer mentioned competing offer from Lodha', 'Booking imminent, awaiting confirmation', 'Cooling off — needs follow-up next week'],
  };

  for (const lead of leads) {
    const count = lead.scoreBreakdown.engagementLevel.interactionCount;
    const ageDays = lead.scoreBreakdown.recencyFactor.ageInDays;
    for (let k = 0; k < count; k++) {
      const t = pick(INTERACTION_TYPES);
      const ago = intBetween(0, ageDays);
      const summary = pick(interactionContent[t]);
      interactionsToCreate.push({
        organization: org._id,
        project: lead.project,
        lead: lead._id,
        user: lead.assignedTo,
        type: t,
        direction: t === 'Note' ? 'Outbound' : pick(['Inbound', 'Outbound']),
        content: summary,
        summary,
        outcome: pick(['Positive — high interest', 'Neutral — gathering info', 'Negative — concerns raised', 'Positive — moving to next step']),
        nextAction: pick(['Follow up in 3 days', 'Send pricing options', 'Schedule site visit', 'Wait for buyer response', 'Loop in sales head']),
        createdBy: lead.assignedTo,
        createdAt: daysAgo(ago),
      });
    }
  }
  await Interaction.insertMany(interactionsToCreate);
  console.log(`   ✅ ${interactionsToCreate.length} interactions inserted`);

  return leads;
}

export {
  connect,
  disconnect,
  cleanDemoOrg,
  seedOrgAndUsers,
  seedProjects,
  seedProjectAssignments,
  seedTowers,
  seedUnits,
  seedLeadsAndInteractions,
  DEMO_ORG_NAME,
  DEMO_PASSWORD,
  daysFromNow, daysAgo, pick, pickN, intBetween, crToINR, lakhsToINR, roundTo, md5,
  HNI_FIRST_NAMES, HNI_LAST_NAMES, uniquePhone,
};
