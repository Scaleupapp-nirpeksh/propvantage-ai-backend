// File: data/seedDemoData.js
// Description: Comprehensive demo data seed script for PropVantage AI
// Usage: node data/seedDemoData.js
// WARNING: This will create a new organization with demo data. Run only on dev/staging.

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Organization from '../models/organizationModel.js';
import User from '../models/userModel.js';
import Role from '../models/roleModel.js';
import Project from '../models/projectModel.js';
import Tower from '../models/towerModel.js';
import Unit from '../models/unitModel.js';
import Lead from '../models/leadModel.js';
import Sale from '../models/salesModel.js';
import Interaction from '../models/interactionModel.js';
import PaymentPlan from '../models/paymentPlanModel.js';
import Installment from '../models/installmentModel.js';
import PaymentTransaction from '../models/paymentTransactionModel.js';
import Invoice from '../models/invoiceModel.js';
import CommissionStructure from '../models/commissionStructureModel.js';
import PartnerCommission from '../models/partnerCommissionModel.js';
import Contractor from '../models/contractorModel.js';
import ConstructionMilestone from '../models/constructionMilestoneModel.js';
import DocumentCategory from '../models/documentCategoryModel.js';
import Task from '../models/taskModel.js';
import TaskTemplate from '../models/taskTemplateModel.js';
import Notification from '../models/notificationModel.js';
import Conversation from '../models/conversationModel.js';
import Message from '../models/messageModel.js';
import { seedDefaultRoles } from './defaultRoles.js';

dotenv.config();

// =============================================================================
// CONFIGURATION
// =============================================================================

const DEMO_PASSWORD = 'Demo@1234'; // Meets: uppercase, lowercase, number, special char
const DEMO_ORG_NAME = 'Prestige Horizon Developers';

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function daysFromNow(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function daysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// =============================================================================
// MAIN SEED FUNCTION
// =============================================================================

async function seedDemoData() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    // ─── HANDLE --clean FLAG ─────────────────────────────────────
    const isCleanOnly = process.argv.includes('--clean');
    const existingOrg = await Organization.findOne({ name: DEMO_ORG_NAME });

    if (isCleanOnly) {
      if (!existingOrg) {
        console.log('⚠️  No demo organization found to clean.');
        process.exit(0);
      }
      console.log('🧹 Cleaning existing demo data...');
      await cleanDemoData(existingOrg._id);
      console.log('✅ All demo data cleaned successfully.');
      process.exit(0);
    }

    if (existingOrg) {
      console.log(`⚠️  Organization "${DEMO_ORG_NAME}" already exists.`);
      console.log('   Run with --clean to delete first: node data/seedDemoData.js --clean');
      process.exit(0);
    }

    // ─── STEP 1: CREATE ORGANIZATION ───────────────────────────────
    console.log('1️⃣  Creating organization...');
    const org = await Organization.create({
      name: DEMO_ORG_NAME,
      type: 'builder',
      country: 'India',
      city: 'Pune',
      contactInfo: {
        phone: '+91-20-67891234',
        website: 'https://www.prestigehorizon.com',
        address: '14th Floor, Pinnacle Business Park, Baner Road, Pune 411045',
      },
      subscriptionPlan: 'enterprise',
      isActive: true,
    });
    console.log(`   ✅ Organization: ${org.name} (${org._id})\n`);

    // ─── STEP 2: SEED DEFAULT ROLES ────────────────────────────────
    console.log('2️⃣  Seeding default roles...');
    // We'll create a temp user ID for createdBy, then update after owner is created
    const tempUserId = new mongoose.Types.ObjectId();
    const roles = await seedDefaultRoles(org._id, tempUserId);
    const roleMap = {};
    roles.forEach((r) => {
      roleMap[r.slug] = r;
    });
    console.log(`   ✅ Created ${roles.length} roles\n`);

    // ─── STEP 3: CREATE USERS ──────────────────────────────────────
    console.log('3️⃣  Creating users...');
    const usersData = [
      {
        firstName: 'Rajesh',
        lastName: 'Kapoor',
        email: 'rajesh.kapoor@prestigehorizon.com',
        role: 'Business Head',
        roleSlug: 'organization-owner',
        phoneNumber: '+919876543210',
      },
      {
        firstName: 'Ananya',
        lastName: 'Sharma',
        email: 'ananya.sharma@prestigehorizon.com',
        role: 'Business Head',
        roleSlug: 'business-head',
        phoneNumber: '+919876543211',
      },
      {
        firstName: 'Vikram',
        lastName: 'Mehta',
        email: 'vikram.mehta@prestigehorizon.com',
        role: 'Project Director',
        roleSlug: 'project-director',
        phoneNumber: '+919876543212',
      },
      {
        firstName: 'Priya',
        lastName: 'Nair',
        email: 'priya.nair@prestigehorizon.com',
        role: 'Sales Head',
        roleSlug: 'sales-head',
        phoneNumber: '+919876543213',
      },
      {
        firstName: 'Arjun',
        lastName: 'Desai',
        email: 'arjun.desai@prestigehorizon.com',
        role: 'Marketing Head',
        roleSlug: 'marketing-head',
        phoneNumber: '+919876543214',
      },
      {
        firstName: 'Meera',
        lastName: 'Joshi',
        email: 'meera.joshi@prestigehorizon.com',
        role: 'Finance Head',
        roleSlug: 'finance-head',
        phoneNumber: '+919876543215',
      },
      {
        firstName: 'Sanjay',
        lastName: 'Patel',
        email: 'sanjay.patel@prestigehorizon.com',
        role: 'Sales Manager',
        roleSlug: 'sales-manager',
        phoneNumber: '+919876543216',
      },
      {
        firstName: 'Kavita',
        lastName: 'Reddy',
        email: 'kavita.reddy@prestigehorizon.com',
        role: 'Finance Manager',
        roleSlug: 'finance-manager',
        phoneNumber: '+919876543217',
      },
      {
        firstName: 'Deepak',
        lastName: 'Chauhan',
        email: 'deepak.chauhan@prestigehorizon.com',
        role: 'Channel Partner Manager',
        roleSlug: 'channel-partner-manager',
        phoneNumber: '+919876543218',
      },
      {
        firstName: 'Neha',
        lastName: 'Gupta',
        email: 'neha.gupta@prestigehorizon.com',
        role: 'Sales Executive',
        roleSlug: 'sales-executive',
        phoneNumber: '+919876543219',
      },
      {
        firstName: 'Rohit',
        lastName: 'Singh',
        email: 'rohit.singh@prestigehorizon.com',
        role: 'Sales Executive',
        roleSlug: 'sales-executive',
        phoneNumber: '+919876543220',
      },
      {
        firstName: 'Aisha',
        lastName: 'Khan',
        email: 'aisha.khan@prestigehorizon.com',
        role: 'Channel Partner Admin',
        roleSlug: 'channel-partner-admin',
        phoneNumber: '+919876543221',
      },
      {
        firstName: 'Manish',
        lastName: 'Verma',
        email: 'manish.verma@prestigehorizon.com',
        role: 'Channel Partner Agent',
        roleSlug: 'channel-partner-agent',
        phoneNumber: '+919876543222',
      },
    ];

    const users = {};
    for (const u of usersData) {
      const user = await User.create({
        organization: org._id,
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
        password: DEMO_PASSWORD,
        role: u.role,
        roleRef: roleMap[u.roleSlug]._id,
        isActive: true,
        invitationStatus: 'accepted',
        acceptedAt: new Date(),
        lastLogin: daysAgo(Math.floor(Math.random() * 7)),
        phoneNumber: u.phoneNumber,
      });
      users[u.roleSlug] = users[u.roleSlug] || [];
      users[u.roleSlug].push(user);
      console.log(`   ✅ ${u.firstName} ${u.lastName} — ${roleMap[u.roleSlug].name}`);
    }

    // Update roles createdBy to the actual owner
    const owner = users['organization-owner'][0];
    await Role.updateMany(
      { organization: org._id, createdBy: tempUserId },
      { $set: { createdBy: owner._id } }
    );

    console.log('');

    // ─── STEP 4: CREATE PROJECTS ───────────────────────────────────
    console.log('4️⃣  Creating projects...');

    const project1 = await Project.create({
      organization: org._id,
      name: 'Horizon Heights',
      description: 'Premium 3-tower residential complex in Baner with luxury amenities, rooftop infinity pool, and panoramic city views. Phase 1 launched with 180 units across 2BHK, 3BHK, and penthouse configurations.',
      type: 'apartment',
      status: 'under-construction',
      location: {
        city: 'Pune',
        area: 'Baner',
        pincode: '411045',
        state: 'Maharashtra',
        landmark: 'Near Baner-Pashan Link Road',
      },
      totalUnits: 180,
      totalArea: 250000,
      priceRange: { min: 7500000, max: 25000000 },
      targetRevenue: 2700000000, // 270 Cr
      launchDate: daysAgo(180),
      expectedCompletionDate: daysFromNow(540),
      amenities: [
        'Swimming Pool', 'Gymnasium', 'Clubhouse', 'Children Play Area',
        'Jogging Track', 'Landscaped Garden', '24/7 Security', 'CCTV',
        'Indoor Games Room', 'Party Hall', 'Rooftop Infinity Pool',
      ],
      pricingRules: {
        gstRate: 5,
        tdsRate: 1,
        floorRiseCharge: 50000,
        plcCharges: {
          parkFacing: 200000,
          cornerUnit: 150000,
        },
      },
      additionalCharges: [
        { name: 'Car Parking (Covered)', amount: 500000, type: 'one-time' },
        { name: 'Club Membership', amount: 200000, type: 'one-time' },
        { name: 'Maintenance Deposit', amount: 150000, type: 'one-time' },
        { name: 'Legal & Documentation', amount: 50000, type: 'one-time' },
      ],
      approvals: {
        rera: {
          number: 'P52100048971',
          date: daysAgo(200),
          validUntil: daysFromNow(900),
        },
        environmentClearance: {
          number: 'EC/MH/2024/0891',
          date: daysAgo(250),
        },
        buildingPlan: {
          number: 'PMC/BP/2024/1247',
          date: daysAgo(220),
        },
      },
      budgetTracking: {
        enabled: true,
        varianceThreshold: 10,
        targetPricePerUnit: 15000000,
        lastVarianceCheck: daysAgo(2),
        varianceCheckCount: 15,
        lastVariancePercentage: 3.2,
      },
    });

    const project2 = await Project.create({
      organization: org._id,
      name: 'Greenfield Villas',
      description: 'Exclusive gated villa community in Hinjewadi with 60 independent villas. Features private gardens, smart home automation, and proximity to Rajiv Gandhi Infotech Park.',
      type: 'villa',
      status: 'launched',
      location: {
        city: 'Pune',
        area: 'Hinjewadi',
        pincode: '411057',
        state: 'Maharashtra',
        landmark: 'Off Mumbai-Pune Expressway',
      },
      totalUnits: 60,
      totalArea: 180000,
      priceRange: { min: 15000000, max: 45000000 },
      targetRevenue: 1800000000, // 180 Cr
      launchDate: daysAgo(90),
      expectedCompletionDate: daysFromNow(720),
      amenities: [
        'Private Garden', 'Clubhouse', 'Swimming Pool', 'Tennis Court',
        'Jogging Track', '24/7 Security', 'Smart Home Automation',
        'Electric Vehicle Charging', 'Yoga Deck',
      ],
      pricingRules: {
        gstRate: 5,
        tdsRate: 1,
        floorRiseCharge: 0,
        plcCharges: {
          parkFacing: 500000,
          cornerUnit: 300000,
        },
      },
      approvals: {
        rera: {
          number: 'P52100052134',
          date: daysAgo(120),
          validUntil: daysFromNow(1000),
        },
      },
      budgetTracking: {
        enabled: true,
        varianceThreshold: 8,
        targetPricePerUnit: 30000000,
      },
    });

    const project3 = await Project.create({
      organization: org._id,
      name: 'Skyline Commercial Plaza',
      description: 'Grade-A commercial office space in Kharadi IT Park zone. 12-floor tower with flexible office configurations, co-working spaces, and retail units on ground floor.',
      type: 'commercial',
      status: 'pre-launch',
      location: {
        city: 'Pune',
        area: 'Kharadi',
        pincode: '411014',
        state: 'Maharashtra',
        landmark: 'Adjacent to EON IT Park',
      },
      totalUnits: 100,
      totalArea: 150000,
      priceRange: { min: 5000000, max: 50000000 },
      targetRevenue: 1500000000, // 150 Cr
      launchDate: daysFromNow(30),
      expectedCompletionDate: daysFromNow(900),
      amenities: [
        'High-speed Elevators', 'Centralized AC', 'Power Backup',
        'Cafeteria', 'Conference Rooms', 'Visitor Parking',
        'Fire Safety System', 'Rainwater Harvesting',
      ],
      budgetTracking: {
        enabled: true,
        varianceThreshold: 12,
        targetPricePerUnit: 15000000,
      },
    });

    console.log(`   ✅ ${project1.name} (${project1.type}, ${project1.status})`);
    console.log(`   ✅ ${project2.name} (${project2.type}, ${project2.status})`);
    console.log(`   ✅ ${project3.name} (${project3.type}, ${project3.status})\n`);

    // ─── STEP 4b: CREATE TOWERS ──────────────────────────────────
    console.log('🏗️  Creating towers...');

    const towersData = [
      // Horizon Heights - 3 towers
      {
        organization: org._id, project: project1._id, towerName: 'Tower A', towerCode: 'HHA',
        totalFloors: 10, unitsPerFloor: 5, totalUnits: 50, towerType: 'residential', status: 'under_construction',
        configuration: { elevators: { count: 3, type: 'passenger' }, staircases: { count: 2, type: 'fire_exit' }, powerBackup: 'full', waterSupply: 'mixed', parking: { levels: 2, capacity: 60 } },
        amenities: { lobby: true, security: true, cctv: true, intercom: true, mailbox: true, generator: true, waterTank: true, sewageTreatment: true, rainwaterHarvesting: true, solarPanels: false },
        pricingConfiguration: { basePriceModifier: 1.0, floorPremium: { startFloor: 5, premiumPerFloor: 50000 }, penthousePremium: { enabled: true, topFloors: 1, premiumPercentage: 15 }, cornerUnitPremium: { percentage: 5 } },
        construction: { plannedStartDate: daysAgo(365), plannedCompletionDate: daysFromNow(365), actualStartDate: daysAgo(350), progressPercentage: 55 },
        financials: { constructionCost: { budgeted: 450000000, actual: 247500000 }, revenueTarget: 750000000, revenueAchieved: 225000000 },
        approvals: { buildingPlan: { status: 'approved', approvalDate: daysAgo(400), validUntil: daysFromNow(600) }, fireNOC: { status: 'approved', approvalDate: daysAgo(300) }, elevatorCertificate: { status: 'pending' } },
        metadata: { architect: 'Hafeez Contractor & Associates', consultant: 'Jones Lang LaSalle', structuralEngineer: 'Mott MacDonald India', facingDirection: 'East', cornerTower: false, premiumLocation: true },
        createdBy: owner._id,
      },
      {
        organization: org._id, project: project1._id, towerName: 'Tower B', towerCode: 'HHB',
        totalFloors: 10, unitsPerFloor: 5, totalUnits: 50, towerType: 'residential', status: 'under_construction',
        configuration: { elevators: { count: 3, type: 'passenger' }, staircases: { count: 2, type: 'fire_exit' }, powerBackup: 'full', waterSupply: 'mixed', parking: { levels: 2, capacity: 60 } },
        amenities: { lobby: true, security: true, cctv: true, intercom: true, mailbox: true, generator: true, waterTank: true, sewageTreatment: true, rainwaterHarvesting: false, solarPanels: false },
        pricingConfiguration: { basePriceModifier: 1.05, floorPremium: { startFloor: 5, premiumPerFloor: 50000 }, penthousePremium: { enabled: true, topFloors: 1, premiumPercentage: 12 }, cornerUnitPremium: { percentage: 5 } },
        construction: { plannedStartDate: daysAgo(300), plannedCompletionDate: daysFromNow(420), actualStartDate: daysAgo(290), progressPercentage: 40 },
        financials: { constructionCost: { budgeted: 480000000, actual: 192000000 }, revenueTarget: 800000000, revenueAchieved: 160000000 },
        approvals: { buildingPlan: { status: 'approved', approvalDate: daysAgo(350) }, fireNOC: { status: 'pending' }, elevatorCertificate: { status: 'pending' } },
        metadata: { architect: 'Hafeez Contractor & Associates', structuralEngineer: 'Mott MacDonald India', facingDirection: 'West', cornerTower: false, premiumLocation: false },
        createdBy: owner._id,
      },
      {
        organization: org._id, project: project1._id, towerName: 'Tower C', towerCode: 'HHC',
        totalFloors: 8, unitsPerFloor: 5, totalUnits: 40, towerType: 'mixed_use', status: 'planning',
        configuration: { elevators: { count: 2, type: 'passenger' }, staircases: { count: 2, type: 'fire_exit' }, powerBackup: 'partial', waterSupply: 'municipal', parking: { levels: 1, capacity: 40 } },
        amenities: { lobby: true, security: true, cctv: true, intercom: false, mailbox: true, generator: true, waterTank: true },
        pricingConfiguration: { basePriceModifier: 0.9, floorPremium: { startFloor: 4, premiumPerFloor: 30000 }, cornerUnitPremium: { percentage: 3 } },
        construction: { plannedStartDate: daysFromNow(60), plannedCompletionDate: daysFromNow(600) },
        financials: { constructionCost: { budgeted: 300000000 }, revenueTarget: 500000000 },
        approvals: { buildingPlan: { status: 'pending' }, fireNOC: { status: 'pending' }, elevatorCertificate: { status: 'pending' } },
        metadata: { architect: 'Hafeez Contractor & Associates', facingDirection: 'North-East', cornerTower: true, premiumLocation: false },
        createdBy: owner._id,
      },
      // Greenfield Villas - 2 phases
      {
        organization: org._id, project: project2._id, towerName: 'Phase 1', towerCode: 'GFV1',
        totalFloors: 2, unitsPerFloor: 4, totalUnits: 8, towerType: 'residential', status: 'completed',
        configuration: { powerBackup: 'full', waterSupply: 'borewell', parking: { levels: 0, capacity: 16 } },
        amenities: { lobby: false, security: true, cctv: true, generator: true, waterTank: true, rainwaterHarvesting: true, solarPanels: true },
        pricingConfiguration: { basePriceModifier: 1.0, cornerUnitPremium: { percentage: 8 } },
        construction: { plannedStartDate: daysAgo(600), plannedCompletionDate: daysAgo(60), actualStartDate: daysAgo(590), actualCompletionDate: daysAgo(45), progressPercentage: 100 },
        financials: { constructionCost: { budgeted: 160000000, actual: 172000000 }, revenueTarget: 240000000, revenueAchieved: 195000000 },
        approvals: { buildingPlan: { status: 'approved', approvalDate: daysAgo(650) } },
        metadata: { architect: 'Studio Lotus', facingDirection: 'South', cornerTower: false, premiumLocation: true },
        createdBy: owner._id,
      },
      {
        organization: org._id, project: project2._id, towerName: 'Phase 2', towerCode: 'GFV2',
        totalFloors: 2, unitsPerFloor: 4, totalUnits: 8, towerType: 'residential', status: 'under_construction',
        configuration: { powerBackup: 'full', waterSupply: 'borewell', parking: { levels: 0, capacity: 16 } },
        amenities: { lobby: false, security: true, cctv: true, generator: true, waterTank: true, rainwaterHarvesting: true, solarPanels: true },
        pricingConfiguration: { basePriceModifier: 1.1, cornerUnitPremium: { percentage: 8 } },
        construction: { plannedStartDate: daysAgo(180), plannedCompletionDate: daysFromNow(300), actualStartDate: daysAgo(170), progressPercentage: 35 },
        financials: { constructionCost: { budgeted: 200000000, actual: 70000000 }, revenueTarget: 320000000, revenueAchieved: 64000000 },
        approvals: { buildingPlan: { status: 'approved', approvalDate: daysAgo(220) } },
        metadata: { architect: 'Studio Lotus', facingDirection: 'North', cornerTower: false, premiumLocation: false },
        createdBy: owner._id,
      },
      // Skyline Commercial - 1 tower
      {
        organization: org._id, project: project3._id, towerName: 'Tower 1', towerCode: 'SCP1',
        totalFloors: 12, unitsPerFloor: 4, totalUnits: 48, towerType: 'commercial', status: 'planning',
        configuration: { elevators: { count: 4, type: 'passenger' }, staircases: { count: 3, type: 'fire_exit' }, powerBackup: 'full', waterSupply: 'municipal', parking: { levels: 3, capacity: 150 } },
        amenities: { lobby: true, security: true, cctv: true, intercom: true, mailbox: true, generator: true, waterTank: true, sewageTreatment: true, rainwaterHarvesting: true },
        pricingConfiguration: { basePriceModifier: 1.0, floorPremium: { startFloor: 3, premiumPerFloor: 40000 }, cornerUnitPremium: { percentage: 7 } },
        construction: { plannedStartDate: daysFromNow(90), plannedCompletionDate: daysFromNow(900) },
        financials: { constructionCost: { budgeted: 550000000 }, revenueTarget: 1000000000 },
        approvals: { buildingPlan: { status: 'pending' }, fireNOC: { status: 'pending' }, elevatorCertificate: { status: 'pending' } },
        metadata: { architect: 'Morphogenesis', consultant: 'CBRE India', structuralEngineer: 'Thornton Tomasetti', facingDirection: 'South-West', cornerTower: false, premiumLocation: true },
        createdBy: owner._id,
      },
    ];

    const createdTowers = await Tower.insertMany(towersData);
    const towerMap = {};
    createdTowers.forEach(t => { towerMap[t.towerCode] = t; });
    console.log(`   ✅ Created ${createdTowers.length} towers\n`);

    // ─── STEP 4c: CREATE DOCUMENT CATEGORIES ─────────────────────
    console.log('📁  Creating document categories...');

    const docCategories = await DocumentCategory.insertMany([
      { organization: org._id, name: 'Sale Agreements & Contracts', type: 'Legal', description: 'All sale deeds, agreements, and legal contracts', color: '#EF4444', createdBy: owner._id },
      { organization: org._id, name: 'Financial Reports & Invoices', type: 'Financial', description: 'Invoices, payment receipts, and financial statements', color: '#F59E0B', createdBy: owner._id },
      { organization: org._id, name: 'Project Plans & Drawings', type: 'Project', description: 'Architectural drawings, floor plans, and project documents', color: '#3B82F6', createdBy: owner._id },
      { organization: org._id, name: 'Marketing Collateral', type: 'Marketing', description: 'Brochures, flyers, and promotional material', color: '#8B5CF6', createdBy: owner._id },
      { organization: org._id, name: 'Customer KYC Documents', type: 'Customer', description: 'Customer identity and address verification documents', color: '#10B981', createdBy: owner._id },
      { organization: org._id, name: 'RERA & Regulatory Compliance', type: 'Compliance', description: 'RERA certificates, environmental clearances, and compliance docs', color: '#EC4899', createdBy: owner._id },
      { organization: org._id, name: 'HR & Employee Records', type: 'HR', description: 'Employee documents, offer letters, and HR records', color: '#6366F1', createdBy: owner._id },
      { organization: org._id, name: 'Operational SOPs & Policies', type: 'Operations', description: 'Standard operating procedures and internal policies', color: '#14B8A6', createdBy: owner._id },
      { organization: org._id, name: 'Miscellaneous Documents', type: 'Other', description: 'Other documents that do not fit into specific categories', color: '#6B7280', createdBy: owner._id },
    ]);
    console.log(`   ✅ Created ${docCategories.length} document categories\n`);

    // ─── STEP 5: CREATE UNITS ──────────────────────────────────────
    console.log('5️⃣  Creating units...');

    const unitTypes = [
      { type: '2BHK', areaSqft: 1050, basePrice: 7500000 },
      { type: '2BHK Premium', areaSqft: 1200, basePrice: 9000000 },
      { type: '3BHK', areaSqft: 1500, basePrice: 12500000 },
      { type: '3BHK Premium', areaSqft: 1750, basePrice: 15000000 },
      { type: 'Penthouse', areaSqft: 2500, basePrice: 25000000 },
    ];

    const facings = ['North', 'South', 'East', 'West', 'North-East', 'South-East'];
    const unitsToCreate = [];

    // Project 1: Horizon Heights — 30 units (sample)
    for (let floor = 1; floor <= 6; floor++) {
      for (let unitIdx = 0; unitIdx < 5; unitIdx++) {
        const ut = unitTypes[unitIdx];
        const unitNum = `HH-${String(floor).padStart(2, '0')}${String(unitIdx + 1).padStart(2, '0')}`;
        const floorPremium = floor * 50000;
        const isCorner = unitIdx === 0 || unitIdx === 4;
        const isParkFacing = floor <= 3 && unitIdx <= 1;
        const statusOpts = ['available', 'available', 'available', 'booked', 'sold'];
        const status = floor <= 2 ? randomFrom(['sold', 'booked']) : randomFrom(statusOpts);

        unitsToCreate.push({
          project: project1._id,
          organization: org._id,
          unitNumber: unitNum,
          type: ut.type,
          floor,
          areaSqft: ut.areaSqft,
          basePrice: ut.basePrice,
          currentPrice: ut.basePrice + floorPremium + (isCorner ? 150000 : 0) + (isParkFacing ? 200000 : 0),
          facing: randomFrom(facings),
          status,
          features: {
            isParkFacing,
            isCornerUnit: isCorner,
            hasBalcony: true,
            hasServantRoom: ut.areaSqft >= 1500,
            hasParkingSlot: true,
            hasStudyRoom: ut.areaSqft >= 1750,
            hasUtilityArea: ut.areaSqft >= 1200,
          },
          specifications: {
            bedrooms: ut.type.includes('2BHK') ? 2 : ut.type === 'Penthouse' ? 4 : 3,
            bathrooms: ut.type.includes('2BHK') ? 2 : ut.type === 'Penthouse' ? 4 : 3,
            livingRooms: ut.type === 'Penthouse' ? 2 : 1,
            kitchen: 1,
            balconies: ut.type === 'Penthouse' ? 3 : isCorner ? 2 : 1,
            carpetArea: Math.round(ut.areaSqft * 0.7),
            builtUpArea: Math.round(ut.areaSqft * 0.85),
            superBuiltUpArea: ut.areaSqft,
          },
          parking: {
            covered: 1,
            open: ut.type === 'Penthouse' ? 1 : 0,
          },
        });
      }
    }

    // Project 2: Greenfield Villas — 15 units (sample)
    const villaTypes = [
      { type: '3BHK Villa', areaSqft: 2200, basePrice: 15000000 },
      { type: '4BHK Villa', areaSqft: 3000, basePrice: 25000000 },
      { type: '5BHK Villa', areaSqft: 4500, basePrice: 45000000 },
    ];

    for (let i = 1; i <= 15; i++) {
      const vt = villaTypes[i <= 6 ? 0 : i <= 12 ? 1 : 2];
      unitsToCreate.push({
        project: project2._id,
        organization: org._id,
        unitNumber: `GFV-${String(i).padStart(3, '0')}`,
        type: vt.type,
        floor: 0,
        areaSqft: vt.areaSqft,
        basePrice: vt.basePrice,
        currentPrice: vt.basePrice + (i % 5 === 0 ? 500000 : 0),
        facing: randomFrom(facings),
        status: i <= 4 ? 'sold' : i <= 7 ? 'booked' : 'available',
        features: {
          isParkFacing: i % 3 === 0,
          isCornerUnit: i <= 3 || i >= 13,
          hasBalcony: true,
          hasServantRoom: true,
          hasParkingSlot: true,
          hasStudyRoom: vt.areaSqft >= 3000,
          hasUtilityArea: true,
        },
        specifications: {
          bedrooms: vt.type.includes('3') ? 3 : vt.type.includes('4') ? 4 : 5,
          bathrooms: vt.type.includes('3') ? 3 : vt.type.includes('4') ? 4 : 5,
          livingRooms: vt.type.includes('5') ? 2 : 1,
          kitchen: 1,
          balconies: 2,
          carpetArea: Math.round(vt.areaSqft * 0.75),
          builtUpArea: Math.round(vt.areaSqft * 0.9),
          superBuiltUpArea: vt.areaSqft,
        },
        parking: { covered: 2, open: 1 },
      });
    }

    // Project 3: Skyline Commercial — 10 units (sample)
    const commercialTypes = [
      { type: 'Office Space (Small)', areaSqft: 800, basePrice: 5000000 },
      { type: 'Office Space (Large)', areaSqft: 2000, basePrice: 12000000 },
      { type: 'Retail Unit', areaSqft: 1500, basePrice: 15000000 },
      { type: 'Co-Working Suite', areaSqft: 3000, basePrice: 20000000 },
    ];

    for (let i = 1; i <= 10; i++) {
      const ct = commercialTypes[i <= 4 ? 0 : i <= 7 ? 1 : i <= 9 ? 2 : 3];
      unitsToCreate.push({
        project: project3._id,
        organization: org._id,
        unitNumber: `SCP-${String(i).padStart(3, '0')}`,
        type: ct.type,
        floor: i <= 4 ? 0 : Math.ceil(i / 2),
        areaSqft: ct.areaSqft,
        basePrice: ct.basePrice,
        currentPrice: ct.basePrice,
        facing: randomFrom(facings),
        status: 'available',
        features: {
          isParkFacing: false,
          isCornerUnit: i === 1 || i === 10,
          hasBalcony: false,
          hasParkingSlot: true,
        },
        parking: { covered: 1, open: 0 },
      });
    }

    const createdUnits = await Unit.insertMany(unitsToCreate);
    const p1Units = createdUnits.filter((u) => u.project.equals(project1._id));
    const p2Units = createdUnits.filter((u) => u.project.equals(project2._id));
    console.log(`   ✅ Created ${createdUnits.length} units (${p1Units.length} apartments, ${p2Units.length} villas, 10 commercial)\n`);

    // ─── STEP 6: CREATE LEADS ──────────────────────────────────────
    console.log('6️⃣  Creating leads...');

    const salesExecs = [...(users['sales-executive'] || []), ...(users['sales-manager'] || [])];
    const leadNames = [
      { firstName: 'Amit', lastName: 'Kulkarni', phone: '+919812345001', email: 'amit.kulkarni@gmail.com' },
      { firstName: 'Sunita', lastName: 'Bhosale', phone: '+919812345002', email: 'sunita.bhosale@yahoo.com' },
      { firstName: 'Rahul', lastName: 'Deshpande', phone: '+919812345003', email: 'rahul.deshpande@hotmail.com' },
      { firstName: 'Pooja', lastName: 'Patil', phone: '+919812345004', email: 'pooja.patil@gmail.com' },
      { firstName: 'Karan', lastName: 'Thakur', phone: '+919812345005', email: 'karan.thakur@outlook.com' },
      { firstName: 'Shreya', lastName: 'Iyer', phone: '+919812345006', email: 'shreya.iyer@gmail.com' },
      { firstName: 'Nikhil', lastName: 'Wagh', phone: '+919812345007', email: 'nikhil.wagh@gmail.com' },
      { firstName: 'Anjali', lastName: 'Naik', phone: '+919812345008', email: 'anjali.naik@yahoo.com' },
      { firstName: 'Vivek', lastName: 'Bhatt', phone: '+919812345009', email: 'vivek.bhatt@gmail.com' },
      { firstName: 'Ritu', lastName: 'Agarwal', phone: '+919812345010', email: 'ritu.agarwal@gmail.com' },
      { firstName: 'Suresh', lastName: 'Sawant', phone: '+919812345011', email: 'suresh.sawant@gmail.com' },
      { firstName: 'Divya', lastName: 'Rane', phone: '+919812345012', email: 'divya.rane@gmail.com' },
      { firstName: 'Manoj', lastName: 'Tiwari', phone: '+919812345013', email: 'manoj.tiwari@gmail.com' },
      { firstName: 'Pallavi', lastName: 'Chavan', phone: '+919812345014', email: 'pallavi.chavan@outlook.com' },
      { firstName: 'Ashish', lastName: 'Gokhale', phone: '+919812345015', email: 'ashish.gokhale@gmail.com' },
      { firstName: 'Nandini', lastName: 'Shetty', phone: '+919812345016', email: 'nandini.shetty@gmail.com' },
      { firstName: 'Prakash', lastName: 'More', phone: '+919812345017', email: 'prakash.more@yahoo.com' },
      { firstName: 'Swati', lastName: 'Pawar', phone: '+919812345018', email: 'swati.pawar@gmail.com' },
      { firstName: 'Gaurav', lastName: 'Jain', phone: '+919812345019', email: 'gaurav.jain@gmail.com' },
      { firstName: 'Tanvi', lastName: 'Deshmukh', phone: '+919812345020', email: 'tanvi.deshmukh@gmail.com' },
    ];

    const leadStatuses = ['New', 'Contacted', 'Qualified', 'Site Visit Scheduled', 'Site Visit Completed', 'Negotiating', 'Booked', 'Lost'];
    const leadSources = ['Website', 'Property Portal', 'Referral', 'Walk-in', 'Social Media', 'Advertisement'];
    const timelines = ['immediate', '1-3_months', '3-6_months', '6-12_months'];

    const leadsToCreate = leadNames.map((ln, idx) => {
      const project = idx < 12 ? project1 : idx < 17 ? project2 : project3;
      const status = leadStatuses[idx % leadStatuses.length];
      const source = leadSources[idx % leadSources.length];
      const score = Math.max(10, Math.min(95, 50 + (idx % 10) * 5 - (idx % 3) * 8));
      const gradeMap = { 90: 'A+', 80: 'A', 70: 'B+', 60: 'B', 50: 'C+', 40: 'C' };
      const scoreGrade = Object.entries(gradeMap).reverse().find(([threshold]) => score >= Number(threshold))?.[1] || 'D';
      const assignee = salesExecs[idx % salesExecs.length];

      return {
        organization: org._id,
        project: project._id,
        assignedTo: assignee._id,
        firstName: ln.firstName,
        lastName: ln.lastName,
        email: ln.email,
        phone: ln.phone,
        source,
        status,
        score,
        scoreGrade,
        priority: score >= 80 ? 'Critical' : score >= 65 ? 'High' : score >= 45 ? 'Medium' : 'Low',
        confidence: Math.min(95, 50 + idx * 2),
        budget: {
          min: 5000000 + idx * 500000,
          max: 15000000 + idx * 1000000,
          isValidated: idx % 3 === 0,
          budgetSource: idx % 4 === 0 ? 'pre_approved' : 'self_reported',
          currency: 'INR',
        },
        requirements: {
          timeline: timelines[idx % timelines.length],
          unitType: idx < 12 ? (idx % 3 === 0 ? '3BHK' : '2BHK') : idx < 17 ? '4BHK Villa' : 'Office Space',
          floor: { preference: randomFrom(['low', 'medium', 'high', 'any']) },
          facing: randomFrom(['North', 'South', 'East', 'West', 'North-East', 'South-East', 'Any']),
          amenities: ['Swimming Pool', 'Parking'],
        },
        qualificationStatus: ['Booked', 'Negotiating'].includes(status) ? 'Qualified' : status === 'New' ? 'Not Qualified' : 'In Progress',
        engagementMetrics: {
          totalInteractions: Math.floor(Math.random() * 12) + 1,
          lastInteractionDate: daysAgo(Math.floor(Math.random() * 14)),
          lastInteractionType: randomFrom(['Call', 'Email', 'Site Visit', 'WhatsApp']),
          responseRate: 40 + Math.floor(Math.random() * 50),
          averageResponseTime: 2 + Math.floor(Math.random() * 24),
        },
        followUpSchedule: {
          nextFollowUpDate: status === 'Lost' ? undefined : daysFromNow(Math.floor(Math.random() * 7)),
          followUpType: randomFrom(['call', 'email', 'site_visit', 'meeting']),
          notes: `Follow up on ${status === 'Negotiating' ? 'pricing discussion' : 'general interest'}`,
          isOverdue: idx % 5 === 0,
        },
        activitySummary: {
          callsCount: Math.floor(Math.random() * 8),
          emailsCount: Math.floor(Math.random() * 5),
          meetingsCount: Math.floor(Math.random() * 3),
          siteVisitsCount: Math.floor(Math.random() * 2),
        },
        attribution: {
          source: source.toLowerCase().replace(/\s+/g, '_'),
          medium: idx % 2 === 0 ? 'organic' : 'paid',
        },
        notes: `Lead from ${source}. Interested in ${idx < 12 ? 'Horizon Heights' : idx < 17 ? 'Greenfield Villas' : 'Skyline Commercial'}.`,
      };
    });

    const createdLeads = await Lead.insertMany(leadsToCreate);
    console.log(`   ✅ Created ${createdLeads.length} leads\n`);

    // ─── STEP 7: CREATE INTERACTIONS ───────────────────────────────
    console.log('7️⃣  Creating interactions...');

    const interactionsToCreate = [];
    for (const lead of createdLeads.slice(0, 12)) {
      const numInteractions = 2 + Math.floor(Math.random() * 4);
      for (let i = 0; i < numInteractions; i++) {
        const types = ['Call', 'Email', 'Meeting', 'Site Visit', 'WhatsApp', 'Note'];
        const interType = types[i % types.length];
        interactionsToCreate.push({
          lead: lead._id,
          user: salesExecs[Math.floor(Math.random() * salesExecs.length)]._id,
          organization: org._id,
          type: interType,
          direction: interType === 'Note' ? undefined : randomFrom(['Inbound', 'Outbound']),
          content: getInteractionContent(interType, lead.firstName),
          outcome: getInteractionOutcome(interType),
          nextAction: i < numInteractions - 1 ? 'Follow up with updated brochure' : undefined,
          scheduledAt: i < numInteractions - 1 ? daysFromNow(3 + i) : undefined,
        });
      }
    }

    await Interaction.insertMany(interactionsToCreate);
    console.log(`   ✅ Created ${interactionsToCreate.length} interactions\n`);

    // ─── STEP 8: CREATE SALES ──────────────────────────────────────
    console.log('8️⃣  Creating sales...');

    const soldUnits = p1Units.filter((u) => u.status === 'sold');
    const bookedLeads = createdLeads.filter((l) => l.status === 'Booked');
    const salesToCreate = [];

    for (let i = 0; i < Math.min(soldUnits.length, bookedLeads.length, 6); i++) {
      const unit = soldUnits[i];
      const lead = bookedLeads[i] || createdLeads[i];

      salesToCreate.push({
        project: project1._id,
        unit: unit._id,
        lead: lead._id,
        organization: org._id,
        salesPerson: salesExecs[i % salesExecs.length]._id,
        salePrice: unit.currentPrice,
        bookingDate: daysAgo(30 + i * 15),
        status: i < 2 ? 'Registered' : i < 4 ? 'Agreement Signed' : 'Booked',
        commission: {
          rate: 2,
          amount: Math.round(unit.currentPrice * 0.02),
        },
        discountAmount: i % 3 === 0 ? 100000 : 0,
        costSheetSnapshot: {
          basePrice: unit.basePrice,
          floorPremium: unit.floor * 50000,
          plcCharges: unit.features.isCornerUnit ? 150000 : 0,
          parkFacingPremium: unit.features.isParkFacing ? 200000 : 0,
          gst: Math.round(unit.currentPrice * 0.05),
          totalAmount: Math.round(unit.currentPrice * 1.05),
        },
      });
    }

    // Also add villa sales
    const soldVillas = p2Units.filter((u) => u.status === 'sold');
    for (let i = 0; i < Math.min(soldVillas.length, 3); i++) {
      const unit = soldVillas[i];
      const lead = createdLeads.find((l) => l.project.equals(project2._id) && l.status !== 'Lost') || createdLeads[12 + i];

      salesToCreate.push({
        project: project2._id,
        unit: unit._id,
        lead: lead._id,
        organization: org._id,
        salesPerson: salesExecs[i % salesExecs.length]._id,
        salePrice: unit.currentPrice,
        bookingDate: daysAgo(45 + i * 10),
        status: i === 0 ? 'Agreement Signed' : 'Booked',
        commission: {
          rate: 2.5,
          amount: Math.round(unit.currentPrice * 0.025),
        },
        costSheetSnapshot: {
          basePrice: unit.basePrice,
          gst: Math.round(unit.currentPrice * 0.05),
          totalAmount: Math.round(unit.currentPrice * 1.05),
        },
      });
    }

    const createdSales = await Sale.insertMany(salesToCreate);
    console.log(`   ✅ Created ${createdSales.length} sales\n`);

    // ─── STEP 8b: CREATE PAYMENT PLANS ───────────────────────────
    console.log('💳  Creating payment plans...');

    const financeManager = users['finance-manager'][0];
    const planTypes = ['construction_linked', 'time_based', 'milestone_based', 'custom'];
    const paymentPlansData = createdSales.map((sale, idx) => {
      const unit = createdUnits.find(u => u._id.equals(sale.unit));
      const lead = createdLeads.find(l => l._id.equals(sale.lead));
      const basePrice = sale.salePrice;
      const gst = Math.round(basePrice * 0.05);
      const stampDuty = Math.round(basePrice * 0.06);
      const registration = Math.round(basePrice * 0.01);
      const parking = 500000;
      const clubMembership = 200000;
      const maintenanceDeposit = 150000;
      const legalCharges = 50000;
      const discount = sale.discountAmount || 0;
      const totalAmount = basePrice + gst + stampDuty + registration + parking + clubMembership + maintenanceDeposit + legalCharges - discount;

      const paidPortion = idx < 2 ? 0.6 : idx < 4 ? 0.35 : 0.15;
      const totalPaid = Math.round(totalAmount * paidPortion);
      const totalOutstanding = totalAmount - totalPaid;
      const hasOverdue = idx === 0 || idx === 3;

      return {
        organization: org._id,
        project: sale.project,
        sale: sale._id,
        customer: lead ? lead._id : createdLeads[0]._id,
        planType: planTypes[idx % planTypes.length],
        totalAmount,
        baseAmount: basePrice,
        amountBreakdown: {
          basePrice,
          taxes: { gst, stampDuty, registrationFees: registration },
          additionalCharges: { parkingCharges: parking, clubMembership, maintenanceDeposit, legalCharges },
          discounts: { negotiatedDiscount: discount },
        },
        paymentTerms: {
          gracePeriodDays: 7,
          lateFeeRate: 2,
          interestRate: 12,
          compoundInterest: false,
        },
        status: idx < 2 ? 'active' : 'active',
        financialSummary: {
          totalPaid,
          totalOutstanding,
          totalOverdue: hasOverdue ? Math.round(totalAmount * 0.1) : 0,
          totalLateFees: hasOverdue ? 15000 : 0,
          nextDueAmount: Math.round(totalAmount * 0.1),
          nextDueDate: hasOverdue ? daysAgo(5) : daysFromNow(30),
          lastPaymentDate: daysAgo(15 + idx * 10),
          lastPaymentAmount: Math.round(totalAmount * 0.1),
        },
        notes: `Payment plan for ${unit ? unit.unitNumber : 'unit'} — ${planTypes[idx % planTypes.length]} plan`,
        createdBy: financeManager._id,
      };
    });

    const createdPlans = await PaymentPlan.insertMany(paymentPlansData);
    console.log(`   ✅ Created ${createdPlans.length} payment plans\n`);

    // ─── STEP 8c: CREATE INSTALLMENTS ────────────────────────────
    console.log('📋  Creating installments...');

    const installmentsToCreate = [];
    const milestoneTypes = ['booking', 'time_based', 'construction', 'possession', 'custom'];
    const installmentStatuses = ['paid', 'partially_paid', 'due', 'overdue', 'pending', 'waived', 'cancelled'];

    for (const plan of createdPlans) {
      const sale = createdSales.find(s => s._id.equals(plan.sale));
      const lead = createdLeads.find(l => l._id.equals(plan.customer));
      const numInstallments = 5;
      const installmentAmount = Math.round(plan.totalAmount / numInstallments);

      for (let i = 1; i <= numInstallments; i++) {
        let status;
        const paidPortion = plan.financialSummary.totalPaid / plan.totalAmount;
        if (i <= Math.floor(paidPortion * numInstallments)) {
          status = 'paid';
        } else if (i === Math.floor(paidPortion * numInstallments) + 1 && paidPortion > 0) {
          status = plan.financialSummary.totalOverdue > 0 ? 'overdue' : 'partially_paid';
        } else if (i === Math.floor(paidPortion * numInstallments) + 2) {
          status = 'due';
        } else {
          status = 'pending';
        }

        const dueDate = new Date(sale.bookingDate.getTime() + i * 45 * 24 * 60 * 60 * 1000);
        const paidAmount = status === 'paid' ? installmentAmount : status === 'partially_paid' ? Math.round(installmentAmount * 0.6) : 0;

        installmentsToCreate.push({
          organization: org._id,
          project: sale.project,
          paymentPlan: plan._id,
          sale: sale._id,
          customer: lead ? lead._id : createdLeads[0]._id,
          installmentNumber: i,
          description: i === 1 ? 'Booking Amount' : i === numInstallments ? 'Possession Payment' : `Installment ${i} — ${milestoneTypes[(i - 1) % milestoneTypes.length]}`,
          milestoneType: i === 1 ? 'booking' : i === numInstallments ? 'possession' : milestoneTypes[(i - 1) % milestoneTypes.length],
          originalAmount: installmentAmount,
          currentAmount: installmentAmount,
          paidAmount,
          pendingAmount: installmentAmount - paidAmount,
          originalDueDate: dueDate,
          currentDueDate: dueDate,
          gracePeriodEndDate: new Date(dueDate.getTime() + 7 * 24 * 60 * 60 * 1000),
          status,
          lateFeeApplicable: status === 'overdue',
          lateFeeRate: 2,
          lateFeeAccrued: status === 'overdue' ? 15000 : 0,
          remindersSent: status === 'overdue' ? [
            { reminderType: 'pre_due', sentDate: new Date(dueDate.getTime() - 3 * 24 * 60 * 60 * 1000), sentBy: financeManager._id, method: 'email' },
            { reminderType: 'overdue', sentDate: new Date(dueDate.getTime() + 3 * 24 * 60 * 60 * 1000), sentBy: financeManager._id, method: 'call', response: 'Will pay by end of week' },
          ] : status === 'due' ? [
            { reminderType: 'pre_due', sentDate: daysAgo(2), sentBy: financeManager._id, method: 'email' },
          ] : [],
          createdBy: financeManager._id,
        });
      }
    }

    // Use the last two installments as waived/cancelled for variety
    if (installmentsToCreate.length >= 2) {
      const lastIdx = installmentsToCreate.length - 1;
      installmentsToCreate[lastIdx].status = 'cancelled';
      installmentsToCreate[lastIdx].notes = 'Cancelled — sale restructured';
      installmentsToCreate[lastIdx - 1].status = 'waived';
      installmentsToCreate[lastIdx - 1].notes = 'Waived as goodwill gesture for early possession';
      installmentsToCreate[lastIdx - 1].canBeWaived = true;
    }

    const createdInstallments = await Installment.insertMany(installmentsToCreate);
    console.log(`   ✅ Created ${createdInstallments.length} installments\n`);

    // ─── STEP 8d: CREATE PAYMENT TRANSACTIONS ────────────────────
    console.log('💰  Creating payment transactions...');

    const paymentMethods = ['bank_transfer', 'cheque', 'online_payment', 'cash', 'demand_draft', 'home_loan', 'card_payment'];
    let txnCount = 0;

    // Helper to generate transaction numbers (pre-save hook requires it)
    function makeTxnNumber(orgId, seq) {
      return `TXN-${orgId.toString().slice(-6)}-${String(seq).padStart(6, '0')}`;
    }

    // Create transactions for paid/partially_paid installments
    const paidInstallments = createdInstallments.filter(i => ['paid', 'partially_paid'].includes(i.status));
    for (const inst of paidInstallments) {
      const plan = createdPlans.find(p => p._id.equals(inst.paymentPlan));
      const sale = createdSales.find(s => s._id.equals(inst.sale));
      const method = paymentMethods[txnCount % paymentMethods.length];
      const amount = inst.paidAmount;
      const isBounced = txnCount === 8; // One bounced transaction
      const isRefunded = txnCount === 12; // One refunded
      const status = isBounced ? 'bounced' : isRefunded ? 'refunded' : txnCount < 10 ? 'completed' : txnCount < 14 ? 'cleared' : 'completed';

      const methodDetails = {};
      if (method === 'cheque') {
        methodDetails.chequeNumber = `${100000 + txnCount}`;
        methodDetails.chequeDate = daysAgo(20 + txnCount);
        methodDetails.bankName = 'HDFC Bank';
        methodDetails.chequeStatus = isBounced ? 'bounced' : 'cleared';
      } else if (method === 'bank_transfer') {
        methodDetails.referenceNumber = `NEFT${Date.now()}${txnCount}`;
        methodDetails.transactionId = `UTR${Date.now()}${txnCount}`;
      } else if (method === 'online_payment') {
        methodDetails.paymentGateway = 'Razorpay';
        methodDetails.gatewayTransactionId = `pay_${Date.now()}${txnCount}`;
      } else if (method === 'cash') {
        methodDetails.receiptNumber = `RCP-${String(txnCount + 1).padStart(4, '0')}`;
      } else if (method === 'demand_draft') {
        methodDetails.ddNumber = `DD${200000 + txnCount}`;
        methodDetails.ddDate = daysAgo(15 + txnCount);
        methodDetails.bankName = 'SBI';
      } else if (method === 'home_loan') {
        methodDetails.loanAccountNumber = `HL${300000 + txnCount}`;
        methodDetails.lenderName = ['HDFC Bank', 'SBI', 'ICICI Bank'][txnCount % 3];
        methodDetails.loanReferenceNumber = `LR${Date.now()}${txnCount}`;
      } else if (method === 'card_payment') {
        methodDetails.cardLastFourDigits = `${4000 + txnCount}`;
        methodDetails.cardType = 'credit';
      }

      txnCount++;
      const txn = await PaymentTransaction.create({
        organization: org._id,
        project: sale.project,
        paymentPlan: plan._id,
        customer: inst.customer,
        transactionNumber: makeTxnNumber(org._id, txnCount),
        amount,
        originalAmount: amount,
        paymentDate: daysAgo(30 + txnCount * 5),
        receivedDate: daysAgo(29 + txnCount * 5),
        paymentMethod: method,
        paymentMethodDetails: methodDetails,
        status,
        paymentAllocations: [{
          installment: inst._id,
          allocatedAmount: amount,
          allocationType: 'principal',
        }],
        receivedInAccount: {
          accountNumber: '50100123456789',
          bankName: 'HDFC Bank',
          ifscCode: 'HDFC0001234',
        },
        verification: {
          verificationStatus: status === 'completed' || status === 'cleared' ? 'verified' : 'pending',
          verifiedBy: status === 'completed' || status === 'cleared' ? financeManager._id : undefined,
          verificationDate: status === 'completed' || status === 'cleared' ? daysAgo(25 + txnCount * 5) : undefined,
          bankStatementMatched: status === 'completed' || status === 'cleared',
        },
        receiptGenerated: status === 'completed' || status === 'cleared',
        receiptNumber: status === 'completed' || status === 'cleared' ? `REC-${String(txnCount + 1).padStart(6, '0')}` : undefined,
        notes: isBounced ? 'Cheque bounced — insufficient funds' : isRefunded ? 'Refunded due to plan restructuring' : undefined,
        recordedBy: financeManager._id,
      });
    }

    // Add a couple of pending/processing transactions for variety
    if (createdInstallments.length > 0 && createdPlans.length > 0) {
      const pendingInst = createdInstallments.find(i => i.status === 'due') || createdInstallments[createdInstallments.length - 3];
      const pendingPlan = createdPlans.find(p => p._id.equals(pendingInst.paymentPlan));
      if (pendingInst && pendingPlan) {
        txnCount++;
        await PaymentTransaction.create({
          organization: org._id,
          project: pendingInst.project,
          paymentPlan: pendingPlan._id,
          customer: pendingInst.customer,
          transactionNumber: makeTxnNumber(org._id, txnCount),
          amount: Math.round(pendingInst.currentAmount * 0.5),
          originalAmount: Math.round(pendingInst.currentAmount * 0.5),
          paymentDate: daysAgo(1),
          paymentMethod: 'bank_transfer',
          paymentMethodDetails: { referenceNumber: `NEFT${Date.now()}PEND`, transactionId: `UTR${Date.now()}PEND` },
          status: 'processing',
          receivedInAccount: { accountNumber: '50100123456789', bankName: 'HDFC Bank', ifscCode: 'HDFC0001234' },
          verification: { verificationStatus: 'pending' },
          notes: 'Processing — bank confirmation awaited',
          recordedBy: financeManager._id,
        });
      }
    }

    console.log(`   ✅ Created ${txnCount} payment transactions\n`);

    // ─── STEP 8e: CREATE INVOICES ────────────────────────────────
    console.log('🧾  Creating invoices...');

    const invoiceTypes = ['booking_invoice', 'milestone_invoice', 'final_invoice', 'adjustment_invoice', 'cancellation_invoice', 'additional_charges'];
    const invoiceStatuses = ['paid', 'partially_paid', 'sent', 'draft', 'generated', 'overdue', 'cancelled'];
    let invoiceCount = 0;

    for (let i = 0; i < Math.min(createdSales.length, 8); i++) {
      const sale = createdSales[i];
      const unit = createdUnits.find(u => u._id.equals(sale.unit));
      const lead = createdLeads.find(l => l._id.equals(sale.lead));
      const basePrice = sale.salePrice;
      const gstRate = 5;
      const gstAmount = Math.round(basePrice * gstRate / 100);
      const halfGst = Math.round(gstAmount / 2);
      const totalAmount = basePrice + gstAmount;
      const invoiceType = invoiceTypes[i % invoiceTypes.length];
      const invoiceStatus = invoiceStatuses[i % invoiceStatuses.length];
      const paidAmount = invoiceStatus === 'paid' ? totalAmount : invoiceStatus === 'partially_paid' ? Math.round(totalAmount * 0.5) : 0;

      // Generate financial year (Indian FY: April-March)
      const invDate = daysAgo(60 - i * 7);
      const invMonth = invDate.getMonth();
      const invYear = invDate.getFullYear();
      const fy = invMonth >= 3 ? `${invYear}-${(invYear + 1).toString().slice(2)}` : `${invYear - 1}-${invYear.toString().slice(2)}`;

      await Invoice.create({
        organization: org._id,
        sale: sale._id,
        project: sale.project,
        unit: unit._id,
        customer: lead ? lead._id : createdLeads[0]._id,
        financialYear: fy,
        generatedBy: financeManager._id,
        type: invoiceType,
        status: invoiceStatus,
        invoiceDate: daysAgo(60 - i * 7),
        dueDate: daysAgo(30 - i * 7),
        sentDate: ['sent', 'paid', 'partially_paid', 'overdue'].includes(invoiceStatus) ? daysAgo(58 - i * 7) : undefined,
        paidDate: invoiceStatus === 'paid' ? daysAgo(20 - i * 3) : undefined,
        lineItems: [
          { description: `Base Price — ${unit ? unit.unitNumber : 'Unit'}`, category: 'base_price', quantity: 1, unitPrice: basePrice, totalPrice: basePrice, taxable: true, gstRate, gstAmount },
          { description: 'Car Parking (Covered)', category: 'parking_charges', quantity: 1, unitPrice: 500000, totalPrice: 500000, taxable: true, gstRate: 18, gstAmount: 90000 },
          { description: 'Club Membership', category: 'club_membership', quantity: 1, unitPrice: 200000, totalPrice: 200000, taxable: true, gstRate: 18, gstAmount: 36000 },
        ],
        financialSummary: {
          subtotal: basePrice + 700000,
          discountAmount: sale.discountAmount || 0,
          taxableAmount: basePrice + 700000 - (sale.discountAmount || 0),
          cgstAmount: halfGst + 63000,
          sgstAmount: halfGst + 63000,
          igstAmount: 0,
          totalGstAmount: gstAmount + 126000,
          totalAmount: basePrice + 700000 + gstAmount + 126000 - (sale.discountAmount || 0),
          amountInWords: 'Amount in words placeholder',
        },
        paymentDetails: {
          totalPaid: paidAmount,
          pendingAmount: totalAmount - paidAmount,
          lastPaymentDate: paidAmount > 0 ? daysAgo(15 + i * 3) : undefined,
          paymentMethod: paidAmount > 0 ? 'bank_transfer' : undefined,
        },
        notes: {
          internalNotes: `Invoice for ${invoiceType.replace(/_/g, ' ')} — ${unit ? unit.unitNumber : 'unit'}`,
          paymentInstructions: 'Please transfer to HDFC Bank A/C 50100123456789, IFSC: HDFC0001234',
        },
        metadata: { generationMethod: 'manual', source: 'web_app' },
      });
      invoiceCount++;
    }

    console.log(`   ✅ Created ${invoiceCount} invoices\n`);

    // ─── STEP 8f: CREATE COMMISSION STRUCTURES ───────────────────
    console.log('📊  Creating commission structures...');

    const commStructures = [];
    // Percentage-based
    commStructures.push(await CommissionStructure.create({
      organization: org._id,
      structureName: 'Standard Channel Partner Commission',
      description: 'Standard 2% commission on sale price for all channel partners',
      calculationMethod: 'percentage',
      calculationBasis: 'sale_price',
      baseRate: 2,
      unitTypeRates: [
        { unitType: '2BHK', commissionRate: 2 },
        { unitType: '3BHK', commissionRate: 2 },
        { unitType: '4BHK', commissionRate: 2.5 },
        { unitType: 'Villa', commissionRate: 3 },
        { unitType: 'Commercial', commissionRate: 1.5 },
      ],
      performanceBonuses: [
        { bonusType: 'sales_target', bonusName: 'Monthly Target Bonus', criteriaValue: 5, bonusPercentage: 0.5, validFrom: daysAgo(365), validUntil: daysFromNow(365) },
      ],
      commissionDeductions: [
        { deductionType: 'tds', deductionName: 'TDS u/s 194H', deductionPercentage: 5, isAutoDeducted: true },
      ],
      paymentTerms: { paymentSchedule: 'on_possession', paymentDelay: 30 },
      taxSettings: { tdsRate: 5, gstApplicable: true, gstRate: 18 },
      eligibility: { partnerTypes: ['channel_partner', 'broker'] },
      validityPeriod: { startDate: daysAgo(365), endDate: daysFromNow(365) },
      isActive: true,
      createdBy: owner._id,
    }));

    // Tiered
    commStructures.push(await CommissionStructure.create({
      organization: org._id,
      structureName: 'Tiered Performance Commission',
      description: 'Tiered commission: 1.5% for first 3 sales, 2% for 4-7, 3% for 8+',
      calculationMethod: 'tiered',
      calculationBasis: 'sale_price',
      commissionTiers: [
        { tierName: 'Bronze', minSales: 1, maxSales: 3, commissionRate: 1.5 },
        { tierName: 'Silver', minSales: 4, maxSales: 7, commissionRate: 2 },
        { tierName: 'Gold', minSales: 8, maxSales: 999, commissionRate: 3 },
      ],
      performanceBonuses: [
        { bonusType: 'unit_count', bonusName: '10-Sale Milestone', criteriaValue: 10, bonusAmount: 100000, validFrom: daysAgo(180), validUntil: daysFromNow(545) },
      ],
      commissionDeductions: [
        { deductionType: 'tds', deductionName: 'TDS', deductionPercentage: 5, isAutoDeducted: true },
        { deductionType: 'processing_fee', deductionName: 'Processing Fee', deductionAmount: 1000 },
      ],
      paymentTerms: { paymentSchedule: 'quarterly', paymentDelay: 15 },
      taxSettings: { tdsRate: 5, gstApplicable: true, gstRate: 18 },
      eligibility: { partnerTypes: ['channel_partner', 'digital_partner'] },
      validityPeriod: { startDate: daysAgo(180), endDate: daysFromNow(545) },
      isActive: true,
      createdBy: owner._id,
    }));

    // Flat rate
    commStructures.push(await CommissionStructure.create({
      organization: org._id,
      structureName: 'Referral Flat Fee',
      description: 'Flat ₹50,000 per successful referral',
      calculationMethod: 'flat_rate',
      baseRate: 50000,
      paymentTerms: { paymentSchedule: 'immediate', paymentDelay: 7 },
      taxSettings: { tdsRate: 10, gstApplicable: false },
      eligibility: { partnerTypes: ['referral'] },
      validityPeriod: { startDate: daysAgo(90), endDate: daysFromNow(275) },
      isActive: true,
      createdBy: owner._id,
    }));

    console.log(`   ✅ Created ${commStructures.length} commission structures\n`);

    // ─── STEP 8g: CREATE PARTNER COMMISSIONS ─────────────────────
    console.log('🤝  Creating partner commissions...');

    const cpAdmin = users['channel-partner-admin'][0];
    const cpAgent = users['channel-partner-agent'][0];
    const cpManager = users['channel-partner-manager'][0];

    const partnerCommissionsData = [];
    // Create commissions for CP-facilitated sales
    for (let i = 0; i < Math.min(4, createdSales.length); i++) {
      const sale = createdSales[i];
      const partner = i % 2 === 0 ? cpAdmin : cpAgent;
      const struct = commStructures[i % commStructures.length];
      const gross = struct.calculationMethod === 'flat_rate' ? 50000 : Math.round(sale.salePrice * 0.02);
      const tds = Math.round(gross * 0.05);
      const gst = Math.round(gross * 0.18);
      const net = gross - tds;
      const statuses = ['paid', 'paid', 'approved', 'pending_approval'];

      partnerCommissionsData.push({
        organization: org._id,
        project: sale.project,
        sale: sale._id,
        partner: partner._id,
        commissionStructure: struct._id,
        status: statuses[i],
        saleDetails: {
          salePrice: sale.salePrice,
          basePrice: sale.salePrice - (sale.discountAmount || 0),
          unitType: i < 2 ? '3BHK' : i < 3 ? '4BHK' : 'Villa',
          saleDate: sale.bookingDate,
          bookingDate: sale.bookingDate,
        },
        commissionCalculation: {
          calculationMethod: struct.calculationMethod,
          calculationBasis: struct.calculationBasis || 'sale_price',
          baseRate: struct.baseRate || 2,
          grossCommission: gross,
          netCommission: net,
        },
        taxDetails: {
          tdsDeducted: tds,
          tdsRate: 5,
          gstAmount: gst,
          gstRate: 18,
          financialYear: '2025-26',
        },
        paymentSchedule: {
          paymentMethod: 'immediate',
          scheduledDate: statuses[i] === 'paid' ? daysAgo(15 + i * 10) : daysFromNow(30),
          installments: [{ installmentNumber: 1, amount: net, dueDate: statuses[i] === 'paid' ? daysAgo(15 + i * 10) : daysFromNow(30), status: statuses[i] === 'paid' ? 'paid' : 'pending' }],
        },
        approvalHistory: statuses[i] !== 'pending_approval' ? [{
          action: 'approved',
          performedBy: cpManager._id,
          performedAt: daysAgo(20 + i * 10),
          notes: 'Commission approved per standard structure',
        }] : [],
        createdBy: cpManager._id,
      });
    }

    const createdPartnerComms = await PartnerCommission.insertMany(partnerCommissionsData);
    console.log(`   ✅ Created ${createdPartnerComms.length} partner commissions\n`);

    // ─── STEP 8h: CREATE CONTRACTORS ─────────────────────────────
    console.log('👷  Creating contractors...');

    const contractorsData = [
      {
        organization: org._id, name: 'Rajendra Constructions Pvt Ltd', companyName: 'Rajendra Constructions',
        type: 'General Contractor', specialization: ['Civil Work', 'Architecture'],
        contactInfo: { primaryContact: { name: 'Rajendra Kulkarni', designation: 'Managing Director', phone: '+919820001001', email: 'rajendra@rajendraconstructions.com' }, officePhone: '+91-20-67001001' },
        address: { street: '42, Industrial Area', area: 'Hadapsar', city: 'Pune', state: 'Maharashtra', pincode: '411028', country: 'India' },
        businessInfo: { registrationNumber: 'RC-2010-MH-001', panNumber: 'AABCR1234A', gstNumber: '27AABCR1234A1Z5', licenseNumber: 'PWD-MH-2020-1234', licenseType: 'PWD', establishedYear: 2010, companySize: 'Large (51-200)' },
        financialInfo: { bankDetails: { accountHolderName: 'Rajendra Constructions Pvt Ltd', bankName: 'HDFC Bank', ifscCode: 'HDFC0001234' }, paymentTerms: 'Net 30', creditLimit: 5000000 },
        rating: { overall: 4.5, quality: 4.6, timeliness: 4.3, communication: 4.5, costEffectiveness: 4.4, totalReviews: 12 },
        workHistory: { totalProjects: 45, completedProjects: 38, ongoingProjects: 5, cancelledProjects: 2, totalContractValue: 250000000, onTimeCompletionRate: 85 },
        capacity: { maxSimultaneousProjects: 8, currentWorkload: 60, teamSize: 120 },
        status: 'Active', isPreferred: true, createdBy: owner._id,
      },
      {
        organization: org._id, name: 'Sparkle Electricals', companyName: 'Sparkle Electricals & Engineering',
        type: 'Subcontractor', specialization: ['Electrical Work', 'HVAC'],
        contactInfo: { primaryContact: { name: 'Vinay Sharma', designation: 'Owner', phone: '+919820001002', email: 'vinay@sparkleelectricals.com' } },
        address: { street: '15, Shivaji Nagar', city: 'Pune', state: 'Maharashtra', pincode: '411005' },
        businessInfo: { panNumber: 'AABCS5678B', gstNumber: '27AABCS5678B1Z3', establishedYear: 2015, companySize: 'Medium (11-50)' },
        financialInfo: { paymentTerms: 'Net 15' },
        rating: { overall: 4.2, quality: 4.4, timeliness: 4.0, communication: 4.1, costEffectiveness: 4.3, totalReviews: 8 },
        workHistory: { totalProjects: 30, completedProjects: 26, ongoingProjects: 3 },
        capacity: { maxSimultaneousProjects: 5, currentWorkload: 55, teamSize: 35 },
        status: 'Active', isPreferred: true, createdBy: owner._id,
      },
      {
        organization: org._id, name: 'Aqua Plumbing Solutions', companyName: 'Aqua Plumbing Solutions',
        type: 'Specialist', specialization: ['Plumbing Work'],
        contactInfo: { primaryContact: { name: 'Sunil More', phone: '+919820001003', email: 'sunil@aquaplumbing.in' } },
        address: { street: '78, Kothrud', city: 'Pune', state: 'Maharashtra', pincode: '411038' },
        businessInfo: { panNumber: 'AABCA9012C', gstNumber: '27AABCA9012C1Z1', establishedYear: 2012, companySize: 'Small (1-10)' },
        financialInfo: { paymentTerms: 'On Delivery' },
        rating: { overall: 4.0, quality: 4.2, timeliness: 3.8, communication: 4.0, costEffectiveness: 4.1, totalReviews: 6 },
        workHistory: { totalProjects: 22, completedProjects: 19, ongoingProjects: 2 },
        capacity: { maxSimultaneousProjects: 3, currentWorkload: 70, teamSize: 8 },
        status: 'Active', createdBy: owner._id,
      },
      {
        organization: org._id, name: 'Decor Masters', companyName: 'Decor Masters Interiors',
        type: 'Specialist', specialization: ['Interior Design', 'Painting', 'Flooring'],
        contactInfo: { primaryContact: { name: 'Priya Khandelwal', designation: 'Creative Director', phone: '+919820001004', email: 'priya@decormasters.com' } },
        address: { street: '22, FC Road', city: 'Pune', state: 'Maharashtra', pincode: '411004' },
        businessInfo: { panNumber: 'AABCD3456D', gstNumber: '27AABCD3456D1Z9', establishedYear: 2018, companySize: 'Medium (11-50)' },
        rating: { overall: 4.7, quality: 4.9, timeliness: 4.4, communication: 4.8, costEffectiveness: 4.5, totalReviews: 15 },
        workHistory: { totalProjects: 55, completedProjects: 50, ongoingProjects: 4 },
        capacity: { maxSimultaneousProjects: 6, currentWorkload: 80, teamSize: 40 },
        status: 'Active', isPreferred: true, createdBy: owner._id,
      },
      {
        organization: org._id, name: 'BuildMart Supplies', companyName: 'BuildMart Material Suppliers',
        type: 'Supplier', specialization: ['Material Supply', 'Equipment Rental'],
        contactInfo: { primaryContact: { name: 'Anil Jain', phone: '+919820001005', email: 'anil@buildmart.com' } },
        address: { street: '100, MIDC Bhosari', city: 'Pune', state: 'Maharashtra', pincode: '411026' },
        businessInfo: { panNumber: 'AABCB7890E', gstNumber: '27AABCB7890E1Z7', establishedYear: 2008, companySize: 'Large (51-200)' },
        financialInfo: { paymentTerms: 'Net 45', creditLimit: 10000000 },
        rating: { overall: 4.3, quality: 4.5, timeliness: 4.1, communication: 4.2, costEffectiveness: 4.4, totalReviews: 20 },
        workHistory: { totalProjects: 80, completedProjects: 72 },
        capacity: { maxSimultaneousProjects: 15, currentWorkload: 45, teamSize: 85 },
        status: 'Active', createdBy: owner._id,
      },
      {
        organization: org._id, name: 'SecureGuard Services', companyName: 'SecureGuard Facility Management',
        type: 'Service Provider', specialization: ['Security', 'Cleaning'],
        contactInfo: { primaryContact: { name: 'Deepak Rathod', phone: '+919820001006' } },
        address: { street: '5, Aundh', city: 'Pune', state: 'Maharashtra', pincode: '411007' },
        businessInfo: { panNumber: 'AABCS2345F', establishedYear: 2016, companySize: 'Medium (11-50)' },
        financialInfo: { paymentTerms: 'Net 30' },
        rating: { overall: 3.8, quality: 3.9, timeliness: 3.7, communication: 3.8, costEffectiveness: 3.9, totalReviews: 5 },
        workHistory: { totalProjects: 15, completedProjects: 12, ongoingProjects: 3 },
        capacity: { maxSimultaneousProjects: 4, currentWorkload: 75, teamSize: 50 },
        status: 'Active', createdBy: owner._id,
      },
      {
        organization: org._id, name: 'GreenScape Landscaping', companyName: 'GreenScape',
        type: 'Specialist', specialization: ['Landscaping'],
        contactInfo: { primaryContact: { name: 'Meera Deshpande', phone: '+919820001007' } },
        address: { street: '30, Koregaon Park', city: 'Pune', state: 'Maharashtra', pincode: '411001' },
        businessInfo: { establishedYear: 2020, companySize: 'Small (1-10)' },
        rating: { overall: 4.1, quality: 4.3, timeliness: 3.9, communication: 4.0, costEffectiveness: 4.2, totalReviews: 4 },
        workHistory: { totalProjects: 10, completedProjects: 8, ongoingProjects: 1 },
        capacity: { maxSimultaneousProjects: 2, currentWorkload: 40, teamSize: 6 },
        status: 'Inactive', createdBy: owner._id,
      },
      {
        organization: org._id, name: 'Titan Engineering Consultants', companyName: 'Titan Engineering',
        type: 'Consultant', specialization: ['Engineering', 'Architecture'],
        contactInfo: { primaryContact: { name: 'Dr. Ashok Naik', designation: 'Principal Consultant', phone: '+919820001008', email: 'ashok@titanengineering.in' } },
        address: { street: '12, SB Road', city: 'Pune', state: 'Maharashtra', pincode: '411016' },
        businessInfo: { panNumber: 'AABCT6789G', gstNumber: '27AABCT6789G1Z5', establishedYear: 2005, companySize: 'Medium (11-50)' },
        rating: { overall: 4.8, quality: 4.9, timeliness: 4.7, communication: 4.8, costEffectiveness: 4.6, totalReviews: 18 },
        workHistory: { totalProjects: 100, completedProjects: 95, ongoingProjects: 4 },
        capacity: { maxSimultaneousProjects: 10, currentWorkload: 50, teamSize: 25 },
        status: 'Under Review', createdBy: owner._id,
      },
    ];

    const createdContractors = await Contractor.insertMany(contractorsData);
    console.log(`   ✅ Created ${createdContractors.length} contractors\n`);

    // ─── USER REFERENCES FOR REMAINING SECTIONS ──────────────────
    const projectDirector = users['project-director'][0];
    const salesHead = users['sales-head'][0];
    const financeHead = users['finance-head'][0];
    const salesManager = users['sales-manager'][0];
    const salesExec1 = users['sales-executive'][0];
    const salesExec2 = users['sales-executive'][1];

    // ─── STEP 8i: CREATE CONSTRUCTION MILESTONES ─────────────────
    console.log('🏗️  Creating construction milestones...');

    const milestonesData = [
      // Pre-Construction Phase (Completed)
      { name: 'Site Survey & Soil Testing', type: 'Planning', category: 'Civil Work', phase: 'Pre-Construction', status: 'Completed', priority: 'High',
        plannedStartDate: daysAgo(400), plannedEndDate: daysAgo(380), actualStartDate: daysAgo(398), actualEndDate: daysAgo(378),
        progress: { percentage: 100, lastUpdated: daysAgo(378), updatedBy: projectDirector._id },
        budget: { plannedCost: 500000, actualCost: 480000, costVariance: -20000 },
        qualityChecks: [{ checkName: 'Soil bearing capacity test', status: 'Passed', checkedBy: projectDirector._id, checkedAt: daysAgo(380) }],
      },
      { name: 'Building Plan Approval', type: 'Planning', category: 'Approval', phase: 'Pre-Construction', status: 'Completed', priority: 'Critical',
        plannedStartDate: daysAgo(380), plannedEndDate: daysAgo(340), actualStartDate: daysAgo(378), actualEndDate: daysAgo(335),
        progress: { percentage: 100, lastUpdated: daysAgo(335) },
        budget: { plannedCost: 200000, actualCost: 250000, costVariance: 50000 },
      },
      // Foundation Phase (Completed / In Progress)
      { name: 'Excavation & Earthwork — Tower A', type: 'Foundation', category: 'Civil Work', phase: 'Foundation Phase', status: 'Completed', priority: 'High',
        plannedStartDate: daysAgo(335), plannedEndDate: daysAgo(300), actualStartDate: daysAgo(330), actualEndDate: daysAgo(295),
        progress: { percentage: 100, lastUpdated: daysAgo(295) },
        budget: { plannedCost: 3000000, actualCost: 3200000, costVariance: 200000 },
        contractor: createdContractors[0]._id,
        qualityChecks: [{ checkName: 'Excavation depth verification', status: 'Passed', checkedBy: projectDirector._id, checkedAt: daysAgo(300) }],
      },
      { name: 'RCC Foundation — Tower A', type: 'Foundation', category: 'Civil Work', phase: 'Foundation Phase', status: 'Completed', priority: 'Critical',
        plannedStartDate: daysAgo(295), plannedEndDate: daysAgo(250), actualStartDate: daysAgo(290), actualEndDate: daysAgo(248),
        progress: { percentage: 100, lastUpdated: daysAgo(248) },
        budget: { plannedCost: 8000000, actualCost: 8500000, costVariance: 500000 },
        contractor: createdContractors[0]._id,
      },
      { name: 'Excavation & Earthwork — Tower B', type: 'Foundation', category: 'Civil Work', phase: 'Foundation Phase', status: 'In Progress', priority: 'High',
        plannedStartDate: daysAgo(250), plannedEndDate: daysAgo(215), actualStartDate: daysAgo(245),
        progress: { percentage: 75, lastUpdated: daysAgo(2), updatedBy: projectDirector._id },
        budget: { plannedCost: 3000000, actualCost: 2400000, costVariance: -600000 },
        contractor: createdContractors[0]._id,
      },
      // Structure Phase (In Progress / Not Started)
      { name: 'Column & Beam Casting — Tower A (Floors 1-5)', type: 'Structure', category: 'Civil Work', phase: 'Structure Phase', status: 'In Progress', priority: 'Critical',
        plannedStartDate: daysAgo(245), plannedEndDate: daysAgo(150), actualStartDate: daysAgo(240),
        progress: { percentage: 60, lastUpdated: daysAgo(1), updatedBy: projectDirector._id },
        budget: { plannedCost: 20000000, actualCost: 12500000 },
        contractor: createdContractors[0]._id,
        resources: [
          { type: 'Material', name: 'TMT Steel Bars', quantity: 50, unit: 'tonnes', costPerUnit: 55000, totalCost: 2750000, status: 'Delivered' },
          { type: 'Material', name: 'M30 Grade Concrete', quantity: 500, unit: 'cubic meters', costPerUnit: 6500, totalCost: 3250000, status: 'Ordered' },
        ],
      },
      { name: 'Column & Beam Casting — Tower A (Floors 6-10)', type: 'Structure', category: 'Civil Work', phase: 'Structure Phase', status: 'Not Started', priority: 'High',
        plannedStartDate: daysAgo(150), plannedEndDate: daysAgo(50),
        progress: { percentage: 0 },
        budget: { plannedCost: 22000000 },
        contractor: createdContractors[0]._id,
      },
      { name: 'Slab Casting — Tower A', type: 'Structure', category: 'Civil Work', phase: 'Structure Phase', status: 'Not Started', priority: 'High',
        plannedStartDate: daysAgo(100), plannedEndDate: daysFromNow(30),
        progress: { percentage: 0 },
        budget: { plannedCost: 15000000 },
      },
      // MEP Phase
      { name: 'Electrical Conduit Laying — Tower A', type: 'Electrical', category: 'Electrical Work', phase: 'MEP Phase', status: 'Not Started', priority: 'Medium',
        plannedStartDate: daysFromNow(30), plannedEndDate: daysFromNow(120),
        progress: { percentage: 0 },
        budget: { plannedCost: 5000000 },
        contractor: createdContractors[1]._id,
      },
      { name: 'Plumbing Rough-In — Tower A', type: 'Plumbing', category: 'Plumbing Work', phase: 'MEP Phase', status: 'Planning', priority: 'Medium',
        plannedStartDate: daysFromNow(45), plannedEndDate: daysFromNow(135),
        progress: { percentage: 0 },
        budget: { plannedCost: 4000000 },
        contractor: createdContractors[2]._id,
      },
      { name: 'HVAC Ductwork Installation', type: 'Other', category: 'Other', phase: 'MEP Phase', status: 'Not Started', priority: 'Low',
        plannedStartDate: daysFromNow(60), plannedEndDate: daysFromNow(150),
        progress: { percentage: 0 },
        budget: { plannedCost: 6000000 },
      },
      // Finishing Phase
      { name: 'Flooring & Tiling — Tower A', type: 'Flooring', category: 'Finishing Work', phase: 'Finishing Phase', status: 'Not Started', priority: 'Medium',
        plannedStartDate: daysFromNow(120), plannedEndDate: daysFromNow(210),
        progress: { percentage: 0 },
        budget: { plannedCost: 8000000 },
        contractor: createdContractors[3]._id,
      },
      { name: 'Wall Plastering & Painting', type: 'Walls', category: 'Finishing Work', phase: 'Finishing Phase', status: 'Not Started', priority: 'Medium',
        plannedStartDate: daysFromNow(150), plannedEndDate: daysFromNow(240),
        progress: { percentage: 0 },
        budget: { plannedCost: 6000000 },
        contractor: createdContractors[3]._id,
      },
      { name: 'Door & Window Installation', type: 'Finishing', category: 'Finishing Work', phase: 'Finishing Phase', status: 'Not Started', priority: 'Medium',
        plannedStartDate: daysFromNow(180), plannedEndDate: daysFromNow(260),
        progress: { percentage: 0 },
        budget: { plannedCost: 10000000 },
      },
      { name: 'Roofing & Waterproofing', type: 'Roofing', category: 'Civil Work', phase: 'Finishing Phase', status: 'Not Started', priority: 'High',
        plannedStartDate: daysFromNow(200), plannedEndDate: daysFromNow(260),
        progress: { percentage: 0 },
        budget: { plannedCost: 5000000 },
      },
      // Inspection Phase
      { name: 'Fire Safety Inspection', type: 'Inspection', category: 'Inspection', phase: 'Inspection Phase', status: 'Not Started', priority: 'Critical',
        plannedStartDate: daysFromNow(270), plannedEndDate: daysFromNow(290),
        progress: { percentage: 0 },
        budget: { plannedCost: 300000 },
      },
      { name: 'Structural Integrity Audit', type: 'Inspection', category: 'Inspection', phase: 'Inspection Phase', status: 'Not Started', priority: 'Critical',
        plannedStartDate: daysFromNow(280), plannedEndDate: daysFromNow(300),
        progress: { percentage: 0 },
        budget: { plannedCost: 500000 },
        contractor: createdContractors[7]._id,
      },
      // Handover Phase
      { name: 'Snag List Rectification', type: 'Handover', category: 'Other', phase: 'Handover Phase', status: 'Not Started', priority: 'High',
        plannedStartDate: daysFromNow(300), plannedEndDate: daysFromNow(340),
        progress: { percentage: 0 },
        budget: { plannedCost: 2000000 },
      },
      { name: 'Occupation Certificate Handover', type: 'Handover', category: 'Documentation', phase: 'Handover Phase', status: 'Not Started', priority: 'Critical',
        plannedStartDate: daysFromNow(340), plannedEndDate: daysFromNow(365),
        progress: { percentage: 0 },
        budget: { plannedCost: 100000 },
      },
      // Delayed milestone
      { name: 'Landscaping & Garden Setup', type: 'Other', category: 'Other', phase: 'Finishing Phase', status: 'Delayed', priority: 'Low',
        plannedStartDate: daysAgo(30), plannedEndDate: daysAgo(5), actualStartDate: daysAgo(25),
        progress: { percentage: 40, lastUpdated: daysAgo(3), updatedBy: projectDirector._id },
        budget: { plannedCost: 3000000, actualCost: 1800000 },
        contractor: createdContractors[6] ? createdContractors[6]._id : undefined,
      },
    ];

    const createdMilestones = [];
    for (const msData of milestonesData) {
      const milestone = await ConstructionMilestone.create({
        organization: org._id,
        project: project1._id,
        assignedTo: projectDirector._id,
        createdBy: owner._id,
        ...msData,
      });
      createdMilestones.push(milestone);
    }

    // Set dependencies (foundation depends on pre-construction, structure depends on foundation, etc.)
    if (createdMilestones.length >= 6) {
      createdMilestones[2].dependencies = [{ milestone: createdMilestones[1]._id, type: 'finish-to-start' }];
      await createdMilestones[2].save();
      createdMilestones[5].dependencies = [{ milestone: createdMilestones[3]._id, type: 'finish-to-start' }];
      await createdMilestones[5].save();
    }

    console.log(`   ✅ Created ${createdMilestones.length} construction milestones\n`);

    // ─── STEP 9: CREATE TASKS ──────────────────────────────────────
    console.log('9️⃣  Creating tasks...');

    const tasksData = [
      // Lead & Sales tasks
      {
        title: 'Follow up with Amit Kulkarni on 3BHK pricing',
        description: 'Amit showed strong interest in 3BHK units at Horizon Heights during the site visit. He wants a revised cost sheet with the early-bird discount applied. Send updated brochure and schedule a call.',
        category: 'Lead & Sales',
        priority: 'High',
        status: 'In Progress',
        assignedTo: salesExec1._id,
        assignedBy: salesManager._id,
        dueDate: daysFromNow(2),
        startDate: daysAgo(1),
        watchers: [salesManager._id, salesHead._id],
        linkedEntity: { entityType: 'Lead', entityId: createdLeads[0]._id, displayLabel: `${createdLeads[0].firstName} ${createdLeads[0].lastName}` },
        checklist: [
          { text: 'Prepare updated cost sheet with early-bird discount', isCompleted: true, completedBy: salesExec1._id, completedAt: daysAgo(0), order: 1 },
          { text: 'Email cost sheet and brochure to client', isCompleted: false, order: 2 },
          { text: 'Schedule follow-up call', isCompleted: false, order: 3 },
          { text: 'Update lead status in CRM', isCompleted: false, order: 4 },
        ],
        tags: ['follow-up', 'pricing', 'high-value'],
      },
      {
        title: 'Schedule site visit for Sunita Bhosale',
        description: 'Sunita is a qualified lead interested in 2BHK Premium at Horizon Heights. She is available this weekend for a site visit. Coordinate with site team.',
        category: 'Lead & Sales',
        priority: 'Medium',
        status: 'Open',
        assignedTo: salesExec2._id,
        assignedBy: salesManager._id,
        dueDate: daysFromNow(3),
        watchers: [salesManager._id],
        linkedEntity: { entityType: 'Lead', entityId: createdLeads[1]._id, displayLabel: `${createdLeads[1].firstName} ${createdLeads[1].lastName}` },
        checklist: [
          { text: 'Confirm client availability', isCompleted: false, order: 1 },
          { text: 'Book site visit slot', isCompleted: false, order: 2 },
          { text: 'Prepare unit availability list', isCompleted: false, order: 3 },
        ],
        tags: ['site-visit', 'scheduling'],
      },
      {
        title: 'Collect pending KYC documents from Rahul Deshpande',
        description: 'Rahul has booked a unit but KYC documents are incomplete. Missing: PAN card copy and address proof. Follow up immediately as agreement signing is pending.',
        category: 'Document & Compliance',
        priority: 'High',
        status: 'Open',
        assignedTo: salesExec1._id,
        assignedBy: salesHead._id,
        dueDate: daysFromNow(1),
        watchers: [salesHead._id, financeHead._id],
        linkedEntity: { entityType: 'Lead', entityId: createdLeads[2]._id, displayLabel: `${createdLeads[2].firstName} ${createdLeads[2].lastName}` },
        tags: ['kyc', 'compliance', 'urgent'],
      },
      // Payment & Collection tasks
      {
        title: 'Follow up on overdue installment - Unit HH-0101',
        description: 'Second installment of Rs 15,00,000 is overdue by 8 days. Customer was contacted once but did not respond. Escalate if no payment by end of week.',
        category: 'Payment & Collection',
        priority: 'Critical',
        status: 'In Progress',
        assignedTo: salesExec1._id,
        assignedBy: financeHead._id,
        dueDate: daysAgo(2), // overdue
        startDate: daysAgo(5),
        watchers: [financeHead._id, salesManager._id],
        linkedEntity: createdSales[0] ? { entityType: 'Sale', entityId: createdSales[0]._id, displayLabel: `SAL-${createdSales[0]._id.toString().slice(-6).toUpperCase()}` } : undefined,
        tags: ['payment', 'overdue', 'escalation-risk'],
        sla: { targetResolutionHours: 48, warningThresholdHours: 24 },
        autoGenerated: {
          isAutoGenerated: true,
          triggerType: 'overdue_payment',
        },
      },
      {
        title: 'Process registration charges for Unit GFV-001',
        description: 'Villa GFV-001 sale is at Agreement Signed stage. Collect stamp duty and registration fees. Coordinate with legal team for registration date.',
        category: 'Payment & Collection',
        priority: 'High',
        status: 'Open',
        assignedTo: users['finance-manager'][0]._id,
        assignedBy: financeHead._id,
        dueDate: daysFromNow(7),
        watchers: [financeHead._id],
        linkedEntity: createdSales[createdSales.length - 1] ? { entityType: 'Sale', entityId: createdSales[createdSales.length - 1]._id, displayLabel: `SAL-${createdSales[createdSales.length - 1]._id.toString().slice(-6).toUpperCase()}` } : undefined,
        tags: ['registration', 'legal'],
      },
      // Construction tasks
      {
        title: 'Review foundation inspection report - Tower A',
        description: 'Foundation work for Tower A is complete. Review the structural engineer report and sign off on the inspection. Quality team has flagged minor observations.',
        category: 'Construction',
        priority: 'High',
        status: 'Under Review',
        assignedTo: projectDirector._id,
        assignedBy: owner._id,
        dueDate: daysFromNow(1),
        startDate: daysAgo(3),
        watchers: [owner._id],
        linkedEntity: { entityType: 'Project', entityId: project1._id, displayLabel: 'Horizon Heights' },
        checklist: [
          { text: 'Review structural engineer report', isCompleted: true, completedBy: projectDirector._id, completedAt: daysAgo(1), order: 1 },
          { text: 'Address quality team observations', isCompleted: true, completedBy: projectDirector._id, completedAt: daysAgo(0), order: 2 },
          { text: 'Sign off on inspection certificate', isCompleted: false, order: 3 },
        ],
        tags: ['construction', 'inspection', 'foundation'],
      },
      {
        title: 'Coordinate plumbing contractor for Tower B',
        description: 'Structure phase for Tower B is nearing completion. Plumbing work needs to start in 2 weeks. Finalize contractor, review BOQ, and ensure material procurement is on track.',
        category: 'Construction',
        priority: 'Medium',
        status: 'Open',
        assignedTo: projectDirector._id,
        assignedBy: owner._id,
        dueDate: daysFromNow(14),
        watchers: [owner._id],
        linkedEntity: { entityType: 'Project', entityId: project1._id, displayLabel: 'Horizon Heights' },
        tags: ['construction', 'plumbing', 'contractor'],
      },
      // Approval tasks
      {
        title: 'Get RERA extension approval for Greenfield Villas',
        description: 'Current RERA validity needs extension. Prepare and submit application with updated project timeline and sales progress report.',
        category: 'Approval',
        priority: 'High',
        status: 'In Progress',
        assignedTo: projectDirector._id,
        assignedBy: owner._id,
        dueDate: daysFromNow(21),
        startDate: daysAgo(7),
        watchers: [owner._id, users['business-head'][0]._id],
        linkedEntity: { entityType: 'Project', entityId: project2._id, displayLabel: 'Greenfield Villas' },
        tags: ['rera', 'approval', 'regulatory'],
      },
      // Customer Service tasks
      {
        title: 'Resolve parking allocation complaint - HH-0204',
        description: 'Customer Pooja Patil (Unit HH-0204) has raised a complaint about parking slot allocation. She was promised covered parking near the elevator but got a slot at the far end. Review and resolve.',
        category: 'Customer Service',
        priority: 'High',
        status: 'Open',
        assignedTo: salesManager._id,
        assignedBy: salesHead._id,
        dueDate: daysFromNow(2),
        watchers: [salesHead._id],
        tags: ['complaint', 'parking', 'customer-service'],
      },
      // General/Team tasks
      {
        title: 'Prepare monthly sales report - January 2026',
        description: 'Compile sales data across all projects for January 2026. Include lead conversion rate, revenue collected, pipeline value, and team performance metrics.',
        category: 'General',
        priority: 'Medium',
        status: 'Open',
        assignedTo: salesHead._id,
        assignedBy: owner._id,
        dueDate: daysFromNow(5),
        watchers: [owner._id, users['business-head'][0]._id],
        tags: ['report', 'monthly', 'analytics'],
      },
      {
        title: 'Update project brochure with new amenity renders',
        description: 'Marketing team has new 3D renders for the rooftop infinity pool and clubhouse. Update the digital brochure and send to all active leads.',
        category: 'General',
        priority: 'Low',
        status: 'Open',
        assignedTo: users['marketing-head'][0]._id,
        assignedBy: owner._id,
        dueDate: daysFromNow(10),
        watchers: [salesHead._id],
        linkedEntity: { entityType: 'Project', entityId: project1._id, displayLabel: 'Horizon Heights' },
        tags: ['marketing', 'brochure'],
      },
      // Completed tasks (for analytics)
      {
        title: 'Complete agreement signing for Unit HH-0102',
        description: 'All documents verified. Agreement signing completed at registrar office.',
        category: 'Document & Compliance',
        priority: 'High',
        status: 'Completed',
        assignedTo: salesExec1._id,
        assignedBy: salesManager._id,
        dueDate: daysAgo(5),
        startDate: daysAgo(15),
        completedAt: daysAgo(3),
        resolution: { summary: 'Agreement registered successfully. Registration number: PMC/REG/2026/12345', resolvedBy: salesExec1._id, resolvedAt: daysAgo(3) },
        tags: ['agreement', 'completed'],
      },
      {
        title: 'Send welcome kit to new buyer - GFV-002',
        description: 'Prepare and dispatch welcome kit including project handbook, floor plan, payment schedule, and emergency contacts.',
        category: 'Customer Service',
        priority: 'Medium',
        status: 'Completed',
        assignedTo: salesExec2._id,
        assignedBy: salesManager._id,
        dueDate: daysAgo(10),
        startDate: daysAgo(12),
        completedAt: daysAgo(9),
        resolution: { summary: 'Welcome kit dispatched via courier. Tracking ID: DHL-IN-987654', resolvedBy: salesExec2._id, resolvedAt: daysAgo(9) },
        tags: ['welcome-kit', 'onboarding'],
      },
      // Cancelled task
      {
        title: 'Arrange site visit for Gaurav Jain',
        description: 'Lead expressed interest in commercial space but later decided to postpone.',
        category: 'Lead & Sales',
        priority: 'Low',
        status: 'Cancelled',
        assignedTo: salesExec1._id,
        assignedBy: salesManager._id,
        dueDate: daysAgo(3),
        tags: ['cancelled', 'site-visit'],
      },
      // On Hold task
      {
        title: 'Finalize interior vendor for model apartment',
        description: 'Three vendors shortlisted. Waiting for revised quotations from Vendor B before final decision.',
        category: 'Construction',
        priority: 'Medium',
        status: 'On Hold',
        assignedTo: projectDirector._id,
        assignedBy: owner._id,
        dueDate: daysFromNow(14),
        startDate: daysAgo(10),
        linkedEntity: { entityType: 'Project', entityId: project1._id, displayLabel: 'Horizon Heights' },
        tags: ['interior', 'vendor', 'on-hold'],
      },
    ];

    const createdTasks = [];
    for (const taskData of tasksData) {
      const task = await Task.create({
        organization: org._id,
        createdBy: taskData.assignedBy || owner._id,
        ...taskData,
        activityLog: [
          {
            action: 'created',
            performedBy: taskData.assignedBy || owner._id,
            details: { title: taskData.title, category: taskData.category },
          },
        ],
      });
      createdTasks.push(task);
    }
    console.log(`   ✅ Created ${createdTasks.length} tasks\n`);

    // ─── STEP 10: ADD COMMENTS TO TASKS ────────────────────────────
    console.log('🔟  Adding task comments...');

    // Add comments to the first few tasks
    const task1 = createdTasks[0]; // Follow up with Amit
    task1.comments.push(
      { text: 'Spoke to Amit. He is comparing with a project in Wakad. Need to highlight our amenities advantage.', author: salesExec1._id, createdAt: daysAgo(1) },
      { text: '@sanjay.patel Can we offer the early-bird discount (3%)? Amit is close to converting.', author: salesExec1._id, mentions: [salesManager._id], createdAt: daysAgo(0) },
      { text: 'Approved. Go ahead with 3% early-bird. Make sure to mention the pool completion timeline.', author: salesManager._id, createdAt: daysAgo(0) }
    );
    await task1.save();

    const task4 = createdTasks[3]; // Overdue installment
    task4.comments.push(
      { text: 'Called customer twice. No response. Left voicemail both times.', author: salesExec1._id, createdAt: daysAgo(3) },
      { text: '@meera.joshi Please check if we need to apply late fee as per policy.', author: salesExec1._id, mentions: [financeHead._id], createdAt: daysAgo(1) },
      { text: 'Late fee will be applicable after 15 days grace period. We have 7 more days. Escalate to manager if no response by Thursday.', author: financeHead._id, createdAt: daysAgo(0) }
    );
    task4.escalations.push({
      level: 1,
      escalatedTo: salesManager._id,
      reason: 'Customer unresponsive for 5+ days on overdue payment',
      acknowledged: false,
    });
    task4.currentEscalationLevel = 1;
    await task4.save();

    console.log('   ✅ Added comments and escalations\n');

    // ─── STEP 11: CREATE TASK TEMPLATES ────────────────────────────
    console.log('1️⃣1️⃣ Creating task templates...');

    const templates = await TaskTemplate.insertMany([
      {
        organization: org._id,
        name: 'New Sale Onboarding Checklist',
        description: 'Standard checklist to follow when a new unit is booked. Covers documentation, payment setup, and welcome communication.',
        category: 'Lead & Sales',
        defaultTitle: 'New Booking Onboarding: {{customerName}}',
        defaultPriority: 'High',
        defaultDueDays: 7,
        defaultTags: ['onboarding', 'new-sale'],
        checklist: [
          { text: 'Verify customer KYC documents', order: 1 },
          { text: 'Generate booking confirmation letter', order: 2 },
          { text: 'Create payment plan', order: 3 },
          { text: 'Send first installment demand note', order: 4 },
          { text: 'Dispatch welcome kit', order: 5 },
          { text: 'Schedule agreement signing date', order: 6 },
          { text: 'Update CRM status to Booked', order: 7 },
        ],
        triggerType: 'new_sale_onboarding',
        isSystemTemplate: true,
        createdBy: owner._id,
      },
      {
        organization: org._id,
        name: 'Overdue Payment Follow-up',
        description: 'Process for handling overdue installment payments. Includes customer outreach, escalation steps, and late fee assessment.',
        category: 'Payment & Collection',
        defaultTitle: 'Overdue Payment Follow-up: {{unitNumber}}',
        defaultPriority: 'Critical',
        defaultDueDays: 3,
        defaultTags: ['payment', 'overdue', 'follow-up'],
        checklist: [
          { text: 'Call customer to remind about payment', order: 1 },
          { text: 'Send payment reminder email with demand note', order: 2 },
          { text: 'Assess late fee applicability', order: 3 },
          { text: 'Escalate to manager if no response in 48 hours', order: 4 },
          { text: 'Send formal notice if overdue > 15 days', order: 5 },
        ],
        triggerType: 'overdue_payment',
        isSystemTemplate: true,
        createdBy: owner._id,
      },
      {
        organization: org._id,
        name: 'Construction Milestone Review',
        description: 'Template for reviewing and signing off on construction milestones. Covers inspection, quality checks, and documentation.',
        category: 'Construction',
        defaultTitle: 'Milestone Review: {{milestoneName}}',
        defaultPriority: 'High',
        defaultDueDays: 5,
        defaultTags: ['construction', 'milestone', 'review'],
        checklist: [
          { text: 'Review contractor submission and photographs', order: 1 },
          { text: 'Conduct physical inspection', order: 2 },
          { text: 'Verify quality check parameters', order: 3 },
          { text: 'Review material test reports', order: 4 },
          { text: 'Sign off on milestone completion', order: 5 },
          { text: 'Update construction dashboard', order: 6 },
        ],
        triggerType: 'delayed_milestone',
        isSystemTemplate: true,
        createdBy: owner._id,
      },
      {
        organization: org._id,
        name: 'Lead Follow-up — Missed',
        description: 'Triggered when a scheduled follow-up was missed. Re-engage the lead with updated information.',
        category: 'Lead & Sales',
        defaultTitle: 'Missed Follow-up: {{leadName}}',
        defaultPriority: 'High',
        defaultDueDays: 1,
        defaultTags: ['follow-up', 'missed', 'lead'],
        checklist: [
          { text: 'Call the lead to apologize and reschedule', order: 1 },
          { text: 'Send updated project information', order: 2 },
          { text: 'Reschedule follow-up in CRM', order: 3 },
        ],
        triggerType: 'missed_follow_up',
        isSystemTemplate: true,
        createdBy: owner._id,
      },
      {
        organization: org._id,
        name: 'Weekly Site Inspection',
        description: 'Recurring weekly inspection of all active construction sites. Report progress, issues, and safety compliance.',
        category: 'Construction',
        defaultTitle: 'Weekly Site Inspection — {{date}}',
        defaultPriority: 'Medium',
        defaultDueDays: 7,
        defaultTags: ['inspection', 'weekly', 'recurring'],
        checklist: [
          { text: 'Inspect foundation/structure progress', order: 1 },
          { text: 'Check safety equipment and compliance', order: 2 },
          { text: 'Review material inventory on site', order: 3 },
          { text: 'Take progress photographs', order: 4 },
          { text: 'Update progress dashboard', order: 5 },
        ],
        triggerType: 'recurring_schedule',
        isSystemTemplate: true,
        createdBy: owner._id,
      },
    ]);

    console.log(`   ✅ Created ${templates.length} task templates\n`);

    // ─── STEP 12: CREATE NOTIFICATIONS ─────────────────────────────
    console.log('1️⃣2️⃣ Creating notifications...');

    const notificationsToCreate = [
      // For Sales Exec 1 (Neha)
      {
        recipient: salesExec1._id,
        type: 'task_assigned',
        title: `Task assigned: ${createdTasks[0].taskNumber}`,
        message: `${salesManager.firstName} ${salesManager.lastName} assigned you "Follow up with Amit Kulkarni on 3BHK pricing" — Priority: High`,
        actionUrl: `/tasks/${createdTasks[0]._id}`,
        relatedEntity: { entityType: 'Task', entityId: createdTasks[0]._id, displayLabel: createdTasks[0].taskNumber },
        priority: 'high',
        actor: salesManager._id,
        metadata: { taskNumber: createdTasks[0].taskNumber, taskPriority: 'High', taskCategory: 'Lead & Sales' },
      },
      {
        recipient: salesExec1._id,
        type: 'task_overdue',
        title: '1 overdue task',
        message: 'You have 1 overdue task — "Follow up on overdue installment - Unit HH-0101" is 2 days overdue',
        actionUrl: '/tasks/my',
        priority: 'urgent',
        metadata: { taskCount: 1, date: new Date().toISOString().split('T')[0] },
      },
      {
        recipient: salesExec1._id,
        type: 'task_due_today',
        title: '2 tasks due today',
        message: '"Collect pending KYC documents from Rahul Deshpande" and 1 more task are due today',
        actionUrl: '/tasks/my',
        priority: 'high',
        metadata: { taskCount: 2, date: new Date().toISOString().split('T')[0] },
      },
      {
        recipient: salesExec1._id,
        type: 'task_mention',
        title: `Mentioned in ${createdTasks[3].taskNumber}`,
        message: `${financeHead.firstName} mentioned you: "Late fee will be applicable after 15 days grace period..."`,
        actionUrl: `/tasks/${createdTasks[3]._id}`,
        relatedEntity: { entityType: 'Task', entityId: createdTasks[3]._id, displayLabel: createdTasks[3].taskNumber },
        priority: 'high',
        actor: financeHead._id,
        isRead: true,
        readAt: daysAgo(0),
        metadata: { taskNumber: createdTasks[3].taskNumber },
      },
      // For Sales Manager (Sanjay)
      {
        recipient: salesManager._id,
        type: 'task_escalated',
        title: `Escalation L1: ${createdTasks[3].taskNumber}`,
        message: 'Task overdue by 2 days — "Follow up on overdue installment - Unit HH-0101". Customer unresponsive for 5+ days.',
        actionUrl: `/tasks/${createdTasks[3]._id}`,
        relatedEntity: { entityType: 'Task', entityId: createdTasks[3]._id, displayLabel: createdTasks[3].taskNumber },
        priority: 'urgent',
        metadata: { taskNumber: createdTasks[3].taskNumber, escalationLevel: 1 },
      },
      {
        recipient: salesManager._id,
        type: 'task_comment',
        title: `Comment on ${createdTasks[0].taskNumber}`,
        message: `${salesExec1.firstName}: "Spoke to Amit. He is comparing with a project in Wakad..."`,
        actionUrl: `/tasks/${createdTasks[0]._id}`,
        relatedEntity: { entityType: 'Task', entityId: createdTasks[0]._id, displayLabel: createdTasks[0].taskNumber },
        priority: 'medium',
        actor: salesExec1._id,
        metadata: { taskNumber: createdTasks[0].taskNumber },
      },
      {
        recipient: salesManager._id,
        type: 'task_mention',
        title: `Mentioned in ${createdTasks[0].taskNumber}`,
        message: `${salesExec1.firstName} mentioned you: "Can we offer the early-bird discount (3%)? Amit is close to converting."`,
        actionUrl: `/tasks/${createdTasks[0]._id}`,
        relatedEntity: { entityType: 'Task', entityId: createdTasks[0]._id, displayLabel: createdTasks[0].taskNumber },
        priority: 'high',
        actor: salesExec1._id,
        metadata: { taskNumber: createdTasks[0].taskNumber },
      },
      // For Project Director (Vikram)
      {
        recipient: projectDirector._id,
        type: 'task_assigned',
        title: `Task assigned: ${createdTasks[5].taskNumber}`,
        message: `${owner.firstName} ${owner.lastName} assigned you "Review foundation inspection report - Tower A" — Priority: High`,
        actionUrl: `/tasks/${createdTasks[5]._id}`,
        relatedEntity: { entityType: 'Task', entityId: createdTasks[5]._id, displayLabel: createdTasks[5].taskNumber },
        priority: 'high',
        actor: owner._id,
        isRead: true,
        readAt: daysAgo(2),
        metadata: { taskNumber: createdTasks[5].taskNumber, taskPriority: 'High', taskCategory: 'Construction' },
      },
      {
        recipient: projectDirector._id,
        type: 'task_due_soon',
        title: `Due soon: ${createdTasks[5].taskNumber}`,
        message: '"Review foundation inspection report - Tower A" is due within 24 hours — Priority: High',
        actionUrl: `/tasks/${createdTasks[5]._id}`,
        relatedEntity: { entityType: 'Task', entityId: createdTasks[5]._id, displayLabel: createdTasks[5].taskNumber },
        priority: 'medium',
        metadata: { taskNumber: createdTasks[5].taskNumber, taskPriority: 'High', dueDate: daysFromNow(1).toISOString() },
      },
      // For Finance Head (Meera)
      {
        recipient: financeHead._id,
        type: 'task_mention',
        title: `Mentioned in ${createdTasks[3].taskNumber}`,
        message: `${salesExec1.firstName} mentioned you: "Please check if we need to apply late fee as per policy."`,
        actionUrl: `/tasks/${createdTasks[3]._id}`,
        relatedEntity: { entityType: 'Task', entityId: createdTasks[3]._id, displayLabel: createdTasks[3].taskNumber },
        priority: 'high',
        actor: salesExec1._id,
        isRead: true,
        readAt: daysAgo(0),
        metadata: { taskNumber: createdTasks[3].taskNumber },
      },
      // For Owner (Rajesh)
      {
        recipient: owner._id,
        type: 'task_completed',
        title: `${createdTasks[11].taskNumber} completed`,
        message: `${salesExec1.firstName} ${salesExec1.lastName} completed "Complete agreement signing for Unit HH-0102"`,
        actionUrl: `/tasks/${createdTasks[11]._id}`,
        relatedEntity: { entityType: 'Task', entityId: createdTasks[11]._id, displayLabel: createdTasks[11].taskNumber },
        priority: 'medium',
        actor: salesExec1._id,
        isRead: true,
        readAt: daysAgo(2),
        metadata: { taskNumber: createdTasks[11].taskNumber, taskCategory: 'Document & Compliance' },
      },
      {
        recipient: owner._id,
        type: 'task_status_changed',
        title: `${createdTasks[5].taskNumber}: In Progress → Under Review`,
        message: `${projectDirector.firstName} ${projectDirector.lastName} changed the status of "Review foundation inspection report - Tower A"`,
        actionUrl: `/tasks/${createdTasks[5]._id}`,
        relatedEntity: { entityType: 'Task', entityId: createdTasks[5]._id, displayLabel: createdTasks[5].taskNumber },
        priority: 'medium',
        actor: projectDirector._id,
        metadata: { taskNumber: createdTasks[5].taskNumber, oldStatus: 'In Progress', newStatus: 'Under Review' },
      },
      // Auto-generated task notification
      {
        recipient: salesExec1._id,
        type: 'task_auto_generated',
        title: `New task: ${createdTasks[3].taskNumber}`,
        message: '[Overdue Payment] "Follow up on overdue installment - Unit HH-0101" has been created and assigned to you',
        actionUrl: `/tasks/${createdTasks[3]._id}`,
        relatedEntity: { entityType: 'Task', entityId: createdTasks[3]._id, displayLabel: createdTasks[3].taskNumber },
        priority: 'high',
        metadata: { taskNumber: createdTasks[3].taskNumber, triggerType: 'overdue_payment', taskPriority: 'Critical' },
      },
      // Sales Exec 2 notifications
      {
        recipient: salesExec2._id,
        type: 'task_assigned',
        title: `Task assigned: ${createdTasks[1].taskNumber}`,
        message: `${salesManager.firstName} ${salesManager.lastName} assigned you "Schedule site visit for Sunita Bhosale" — Priority: Medium`,
        actionUrl: `/tasks/${createdTasks[1]._id}`,
        relatedEntity: { entityType: 'Task', entityId: createdTasks[1]._id, displayLabel: createdTasks[1].taskNumber },
        priority: 'medium',
        actor: salesManager._id,
        metadata: { taskNumber: createdTasks[1].taskNumber, taskPriority: 'Medium', taskCategory: 'Lead & Sales' },
      },
    ];

    await Notification.insertMany(
      notificationsToCreate.map((n) => ({
        organization: org._id,
        isRead: false,
        ...n,
        createdAt: daysAgo(Math.floor(Math.random() * 3)),
      }))
    );

    console.log(`   ✅ Created ${notificationsToCreate.length} notifications\n`);

    // ─── STEP 13: CREATE CHAT CONVERSATIONS & MESSAGES ────────────
    console.log('1️⃣3️⃣ Creating chat conversations & messages...');

    const businessHead = users['business-head'][0];
    const marketingHead = users['marketing-head'][0];

    // --- Direct Conversations ---

    // 1. Rajesh (Owner) <-> Ananya (Business Head) — strategy discussion
    const dmRajeshAnanya = await Conversation.findOrCreateDirect(org._id, owner._id, businessHead._id, owner._id);
    const dmRAMessages = [
      { org: org._id, conversation: dmRajeshAnanya._id, sender: owner._id, type: 'text', content: { text: 'Ananya, have you reviewed the Q4 revenue projections for Horizon Heights?' }, createdAt: daysAgo(3) },
      { org: org._id, conversation: dmRajeshAnanya._id, sender: businessHead._id, type: 'text', content: { text: 'Yes, we are tracking at 85% of target. The 3BHK inventory is moving well but 2BHK Premium needs a push.' }, createdAt: daysAgo(3) },
      { org: org._id, conversation: dmRajeshAnanya._id, sender: owner._id, type: 'text', content: { text: 'Should we consider a limited-period early-bird offer on 2BHK Premium? Maybe 3% discount for bookings this month?' }, createdAt: daysAgo(2) },
      { org: org._id, conversation: dmRajeshAnanya._id, sender: businessHead._id, type: 'text', content: { text: 'That could work. Let me run the numbers with Meera on the margin impact and get back to you by tomorrow.' }, createdAt: daysAgo(2) },
      { org: org._id, conversation: dmRajeshAnanya._id, sender: businessHead._id, type: 'text', content: { text: 'Checked with finance. A 3% early-bird on 2BHK Premium still keeps us above 18% margin. I say we go for it.' }, createdAt: daysAgo(1) },
      { org: org._id, conversation: dmRajeshAnanya._id, sender: owner._id, type: 'text', content: { text: 'Perfect. Ask Priya to brief the sales team and Arjun to prepare the campaign material.' }, createdAt: daysAgo(1) },
    ];
    const raCreated = await Message.insertMany(dmRAMessages.map(m => ({ organization: m.org, conversation: m.conversation, sender: m.sender, type: m.type, content: m.content, createdAt: m.createdAt })));
    dmRajeshAnanya.updateLastMessage(raCreated[raCreated.length - 1], `${owner.firstName} ${owner.lastName}`);
    await dmRajeshAnanya.save();

    // 2. Priya (Sales Head) <-> Sanjay (Sales Manager) — pipeline discussion
    const dmPriyaSanjay = await Conversation.findOrCreateDirect(org._id, salesHead._id, salesManager._id, salesHead._id);
    const dmPSMessages = [
      { org: org._id, conversation: dmPriyaSanjay._id, sender: salesHead._id, type: 'text', content: { text: 'Sanjay, what is the current pipeline status for this week? We have the leadership review on Friday.' }, createdAt: daysAgo(2) },
      { org: org._id, conversation: dmPriyaSanjay._id, sender: salesManager._id, type: 'text', content: { text: '12 active leads in negotiation stage. 3 are likely to close this week — Amit Kulkarni, Sunita Bhosale, and one walk-in from the Baner event.' }, createdAt: daysAgo(2) },
      { org: org._id, conversation: dmPriyaSanjay._id, sender: salesHead._id, type: 'text', content: { text: 'Great. Make sure Neha follows up with Amit today. He was comparing with a Wakad project last I heard.' }, createdAt: daysAgo(1) },
      { org: org._id, conversation: dmPriyaSanjay._id, sender: salesManager._id, type: 'text', content: { text: 'Already on it. Neha sent him the revised cost sheet with the 3% early-bird discount. He seemed positive.' }, createdAt: daysAgo(1) },
      { org: org._id, conversation: dmPriyaSanjay._id, sender: salesHead._id, type: 'text', content: { text: 'Good. Also, there is a new early-bird offer approved for 2BHK Premium. Brief the team in the morning standup.' }, createdAt: daysAgo(0) },
    ];
    const psCreated = await Message.insertMany(dmPSMessages.map(m => ({ organization: m.org, conversation: m.conversation, sender: m.sender, type: m.type, content: m.content, createdAt: m.createdAt })));
    dmPriyaSanjay.updateLastMessage(psCreated[psCreated.length - 1], `${salesHead.firstName} ${salesHead.lastName}`);
    await dmPriyaSanjay.save();

    // 3. Neha (Sales Exec) <-> Sanjay (Sales Manager) — lead follow-up
    const dmNehaSanjay = await Conversation.findOrCreateDirect(org._id, salesExec1._id, salesManager._id, salesExec1._id);
    const dmNSMessages = [
      { org: org._id, conversation: dmNehaSanjay._id, sender: salesExec1._id, type: 'text', content: { text: 'Sir, Amit Kulkarni just confirmed he wants to proceed with Unit HH-0503 (3BHK). He is ready to pay the booking amount this week!' }, createdAt: daysAgo(1) },
      { org: org._id, conversation: dmNehaSanjay._id, sender: salesManager._id, type: 'text', content: { text: 'Excellent news! Send him the booking form and KYC checklist. Block the unit in the system immediately.' }, createdAt: daysAgo(1) },
      { org: org._id, conversation: dmNehaSanjay._id, sender: salesExec1._id, type: 'text', content: { text: 'Done. Unit blocked. Booking form and KYC docs sent via email. He said he will submit everything by Wednesday.' }, createdAt: daysAgo(0) },
      { org: org._id, conversation: dmNehaSanjay._id, sender: salesManager._id, type: 'text', content: { text: 'Great work Neha. Keep me posted. Also, how is Sunita Bhosale looking? Any update from the site visit?' }, createdAt: daysAgo(0) },
    ];
    const nsCreated = await Message.insertMany(dmNSMessages.map(m => ({ organization: m.org, conversation: m.conversation, sender: m.sender, type: m.type, content: m.content, createdAt: m.createdAt })));
    dmNehaSanjay.updateLastMessage(nsCreated[nsCreated.length - 1], `${salesManager.firstName} ${salesManager.lastName}`);
    await dmNehaSanjay.save();

    // 4. Vikram (Project Director) <-> Meera (Finance Head) — budget discussion
    const dmVikramMeera = await Conversation.findOrCreateDirect(org._id, projectDirector._id, financeHead._id, projectDirector._id);
    const dmVMMessages = [
      { org: org._id, conversation: dmVikramMeera._id, sender: projectDirector._id, type: 'text', content: { text: 'Meera, the Tower A structural work is running 6% over budget. Steel prices went up after we locked the contract.' }, createdAt: daysAgo(2) },
      { org: org._id, conversation: dmVikramMeera._id, sender: financeHead._id, type: 'text', content: { text: 'How much are we talking about? I need exact numbers to flag in the variance report.' }, createdAt: daysAgo(2) },
      { org: org._id, conversation: dmVikramMeera._id, sender: projectDirector._id, type: 'text', content: { text: 'Rs 5.2L over on steel alone for floors 1-5. I have asked the contractor for a revised BOQ. Will share by end of day.' }, createdAt: daysAgo(1) },
      { org: org._id, conversation: dmVikramMeera._id, sender: financeHead._id, type: 'text', content: { text: 'Ok. We have some buffer in the contingency fund. But if floors 6-10 follow the same trend, we need to renegotiate.' }, createdAt: daysAgo(1) },
    ];
    const vmCreated = await Message.insertMany(dmVMMessages.map(m => ({ organization: m.org, conversation: m.conversation, sender: m.sender, type: m.type, content: m.content, createdAt: m.createdAt })));
    dmVikramMeera.updateLastMessage(vmCreated[vmCreated.length - 1], `${financeHead.firstName} ${financeHead.lastName}`);
    await dmVikramMeera.save();

    let totalChatMessages = raCreated.length + psCreated.length + nsCreated.length + vmCreated.length;

    // --- Group Conversations ---

    // 1. Sales Leadership group
    const salesLeadershipGroup = await Conversation.create({
      organization: org._id,
      type: 'group',
      name: 'Sales Leadership',
      description: 'Weekly sales pipeline sync and strategy discussions',
      participants: [
        { user: owner._id, role: 'admin', isActive: true },
        { user: salesHead._id, role: 'admin', isActive: true },
        { user: salesManager._id, role: 'member', isActive: true },
        { user: businessHead._id, role: 'member', isActive: true },
        { user: marketingHead._id, role: 'member', isActive: true },
      ],
      createdBy: owner._id,
    });
    const slgMessages = [
      { sender: owner._id, text: 'Team, we have approved a 3% early-bird discount on 2BHK Premium at Horizon Heights. Valid for bookings this month only.', createdAt: daysAgo(1) },
      { sender: salesHead._id, text: 'Great move. Our 2BHK inventory has been slow. This should help close at least 4-5 fence-sitters.', createdAt: daysAgo(1) },
      { sender: marketingHead._id, text: 'I will prepare the digital campaign and emailers by tomorrow. Should we also do a WhatsApp blast to our lead database?', createdAt: daysAgo(1) },
      { sender: owner._id, text: 'Yes, but only to leads that have shown interest in 2BHK. Do not spam the entire database.', createdAt: daysAgo(1) },
      { sender: salesManager._id, text: 'We have 28 leads who specifically asked about 2BHK in the last 60 days. I will share the list with Arjun.', createdAt: daysAgo(0) },
      { sender: salesHead._id, text: 'Perfect. Lets track conversions from this campaign separately. Sanjay, add a tag in CRM for attribution.', createdAt: daysAgo(0) },
    ];
    const slgCreated = await Message.insertMany(slgMessages.map(m => ({
      organization: org._id, conversation: salesLeadershipGroup._id, sender: m.sender, type: 'text', content: { text: m.text }, createdAt: m.createdAt,
    })));
    salesLeadershipGroup.updateLastMessage(slgCreated[slgCreated.length - 1], `${salesHead.firstName} ${salesHead.lastName}`);
    // Add unread counts for members who haven't "seen" the latest
    salesLeadershipGroup.participants.forEach(p => {
      if (p.user.toString() !== salesHead._id.toString()) p.unreadCount = 2;
    });
    await salesLeadershipGroup.save();
    totalChatMessages += slgCreated.length;

    // 2. Horizon Heights — Project Team group
    const projectTeamGroup = await Conversation.create({
      organization: org._id,
      type: 'group',
      name: 'Horizon Heights — Project Team',
      description: 'Construction updates, issue tracking, and coordination for Horizon Heights',
      participants: [
        { user: projectDirector._id, role: 'admin', isActive: true },
        { user: owner._id, role: 'member', isActive: true },
        { user: financeHead._id, role: 'member', isActive: true },
        { user: salesHead._id, role: 'member', isActive: true },
      ],
      createdBy: projectDirector._id,
    });
    const ptgMessages = [
      { sender: projectDirector._id, text: 'Tower A update: Floors 1-5 column and beam casting is at 60%. On track for completion by end of month.', createdAt: daysAgo(2) },
      { sender: owner._id, text: 'What about Tower B excavation? I noticed it is showing 75% — are we ahead of schedule there?', createdAt: daysAgo(2) },
      { sender: projectDirector._id, text: 'Yes, Tower B excavation is actually 5 days ahead. Good soil conditions helped. We can start foundation by next week.', createdAt: daysAgo(2) },
      { sender: financeHead._id, text: 'Budget note: Tower A structural work is running 6% over due to steel price increase. Vikram and I are working on a revised forecast.', createdAt: daysAgo(1) },
      { sender: projectDirector._id, text: 'I have attached the updated progress photos from yesterday. Foundation inspection for Tower A is signed off.', createdAt: daysAgo(1) },
      { sender: salesHead._id, text: 'From sales side — we are getting questions from booked customers about possession timeline. Can we share an updated construction timeline?', createdAt: daysAgo(0) },
      { sender: projectDirector._id, text: 'Will prepare an updated Gantt chart by Friday. Current estimate: Tower A possession by Q3 2027, Tower B by Q4 2027.', createdAt: daysAgo(0) },
    ];
    const ptgCreated = await Message.insertMany(ptgMessages.map(m => ({
      organization: org._id, conversation: projectTeamGroup._id, sender: m.sender, type: 'text', content: { text: m.text }, createdAt: m.createdAt,
    })));
    projectTeamGroup.updateLastMessage(ptgCreated[ptgCreated.length - 1], `${projectDirector.firstName} ${projectDirector.lastName}`);
    projectTeamGroup.participants.forEach(p => {
      if (p.user.toString() !== projectDirector._id.toString()) p.unreadCount = 1;
    });
    await projectTeamGroup.save();
    totalChatMessages += ptgCreated.length;

    // 3. Finance & Collections group
    const financeGroup = await Conversation.create({
      organization: org._id,
      type: 'group',
      name: 'Finance & Collections',
      description: 'Payment tracking, overdue follow-ups, and financial updates',
      participants: [
        { user: financeHead._id, role: 'admin', isActive: true },
        { user: users['finance-manager'][0]._id, role: 'member', isActive: true },
        { user: salesManager._id, role: 'member', isActive: true },
        { user: salesExec1._id, role: 'member', isActive: true },
      ],
      createdBy: financeHead._id,
    });
    const fgMessages = [
      { sender: financeHead._id, text: 'Team, we have 3 overdue installments this week totalling Rs 45L. Neha, the HH-0101 customer has been unresponsive for 5 days now.', createdAt: daysAgo(1) },
      { sender: salesExec1._id, text: 'I have called them twice and left voicemails. Will try reaching the spouse contact number today.', createdAt: daysAgo(1) },
      { sender: users['finance-manager'][0]._id, text: 'Late fee policy kicks in after 15 days grace period. We still have 7 days before that. But we should send the formal reminder letter now.', createdAt: daysAgo(0) },
      { sender: financeHead._id, text: 'Kavita, please generate the reminder letter. Neha, one more attempt today. If no response by Thursday, we escalate to Sanjay.', createdAt: daysAgo(0) },
    ];
    const fgCreated = await Message.insertMany(fgMessages.map(m => ({
      organization: org._id, conversation: financeGroup._id, sender: m.sender, type: 'text', content: { text: m.text }, createdAt: m.createdAt,
    })));
    financeGroup.updateLastMessage(fgCreated[fgCreated.length - 1], `${financeHead.firstName} ${financeHead.lastName}`);
    financeGroup.participants.forEach(p => {
      if (p.user.toString() !== financeHead._id.toString()) p.unreadCount = 1;
    });
    await financeGroup.save();
    totalChatMessages += fgCreated.length;

    // --- Entity-Linked Conversations ---

    // 1. Lead: Amit Kulkarni (first lead)
    if (createdLeads.length > 0) {
      const amitLead = createdLeads[0];
      const amitConv = await Conversation.findOrCreateEntity(
        org._id, 'Lead', amitLead._id,
        `Lead: ${amitLead.firstName} ${amitLead.lastName}`,
        salesExec1._id,
        [salesExec1._id, salesManager._id]
      );
      const amitMessages = [
        { sender: salesExec1._id, text: `Site visit completed with ${amitLead.firstName}. He loved the 5th floor view from Unit HH-0503. Very keen on 3BHK.`, createdAt: daysAgo(5) },
        { sender: salesManager._id, text: 'Good. What is his budget range? And has he mentioned the timeline for decision?', createdAt: daysAgo(5) },
        { sender: salesExec1._id, text: 'Budget is 1.2-1.5 Cr. He has a pre-approved home loan from HDFC. Wants to decide within 2 weeks. Only concern: he is comparing with a Wakad project.', createdAt: daysAgo(4) },
        { sender: salesManager._id, text: 'Send him the comparison sheet highlighting our amenities and connectivity advantage over Wakad options. Also mention the early-bird discount.', createdAt: daysAgo(4) },
        { sender: salesExec1._id, text: 'Update: Amit has confirmed booking for HH-0503! Booking amount payment expected this week. Sending KYC docs now.', createdAt: daysAgo(1) },
        { sender: salesManager._id, text: 'Fantastic! Make sure the unit is blocked and payment plan is set up. Great job Neha!', createdAt: daysAgo(0) },
      ];
      const amitCreated = await Message.insertMany(amitMessages.map(m => ({
        organization: org._id, conversation: amitConv._id, sender: m.sender, type: 'text', content: { text: m.text }, createdAt: m.createdAt,
      })));
      amitConv.updateLastMessage(amitCreated[amitCreated.length - 1], `${salesManager.firstName} ${salesManager.lastName}`);
      await amitConv.save();
      totalChatMessages += amitCreated.length;
    }

    // 2. Project: Horizon Heights
    const hhConv = await Conversation.findOrCreateEntity(
      org._id, 'Project', project1._id,
      `Project: ${project1.name}`,
      projectDirector._id,
      [projectDirector._id, owner._id, salesHead._id]
    );
    const hhMessages = [
      { sender: projectDirector._id, text: 'Weekly progress summary: Tower A structural 60%, Tower B excavation 75%, landscaping delayed by vendor.', createdAt: daysAgo(1) },
      { sender: salesHead._id, text: 'Can we get updated construction photos for the sales team? Customers are asking during site visits.', createdAt: daysAgo(1) },
      { sender: projectDirector._id, text: 'Will upload fresh photos by end of today. Also preparing the updated timeline chart Rajesh requested.', createdAt: daysAgo(0) },
    ];
    const hhCreated = await Message.insertMany(hhMessages.map(m => ({
      organization: org._id, conversation: hhConv._id, sender: m.sender, type: 'text', content: { text: m.text }, createdAt: m.createdAt,
    })));
    hhConv.updateLastMessage(hhCreated[hhCreated.length - 1], `${projectDirector.firstName} ${projectDirector.lastName}`);
    await hhConv.save();
    totalChatMessages += hhCreated.length;

    // Add a pinned message in the project group
    if (ptgCreated.length > 0) {
      const pinnedMsg = await Message.findById(ptgCreated[0]._id);
      pinnedMsg.togglePin(projectDirector._id);
      await pinnedMsg.save();
    }

    // Add a reaction to a message in the sales leadership group
    if (slgCreated.length > 0) {
      const reactMsg = await Message.findById(slgCreated[0]._id);
      reactMsg.toggleReaction(salesHead._id, 'thumbsup');
      reactMsg.toggleReaction(salesManager._id, 'thumbsup');
      await reactMsg.save();
    }

    const totalConversations = 4 + 3 + 2; // 4 DMs + 3 groups + 2 entity
    console.log(`   ✅ Created ${totalConversations} conversations, ${totalChatMessages} messages\n`);

    // ─── SUMMARY ───────────────────────────────────────────────────
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  DEMO DATA SEED COMPLETE');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');
    console.log(`  Organization: ${org.name}`);
    console.log(`  Org ID:       ${org._id}`);
    console.log('');
    console.log('  DATA CREATED:');
    console.log(`    Roles:                  ${roles.length}`);
    console.log(`    Users:                  ${usersData.length}`);
    console.log(`    Projects:               3`);
    console.log(`    Towers:                 ${createdTowers.length}`);
    console.log(`    Document Categories:    ${docCategories.length}`);
    console.log(`    Units:                  ${createdUnits.length}`);
    console.log(`    Leads:                  ${createdLeads.length}`);
    console.log(`    Interactions:           ${interactionsToCreate.length}`);
    console.log(`    Sales:                  ${createdSales.length}`);
    console.log(`    Payment Plans:          ${createdPlans.length}`);
    console.log(`    Installments:           ${createdInstallments.length}`);
    console.log(`    Payment Transactions:   ${txnCount}`);
    console.log(`    Invoices:               ${invoiceCount}`);
    console.log(`    Commission Structures:  ${commStructures.length}`);
    console.log(`    Partner Commissions:    ${createdPartnerComms.length}`);
    console.log(`    Contractors:            ${createdContractors.length}`);
    console.log(`    Construction Milestones:${createdMilestones.length}`);
    console.log(`    Tasks:                  ${createdTasks.length}`);
    console.log(`    Task Templates:         ${templates.length}`);
    console.log(`    Notifications:          ${notificationsToCreate.length}`);
    console.log(`    Chat Conversations:     ${totalConversations}`);
    console.log(`    Chat Messages:          ${totalChatMessages}`);
    console.log('');
    console.log('  PASSWORD FOR ALL USERS: Demo@1234');
    console.log('');
    console.log('  LOGIN CREDENTIALS:');
    console.log('  ─────────────────────────────────────────────────────────');
    for (const u of usersData) {
      const roleName = roleMap[u.roleSlug].name;
      console.log(`  ${roleName.padEnd(28)} ${u.email}`);
    }
    console.log('  ─────────────────────────────────────────────────────────');
    console.log('');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Seed failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// =============================================================================
// CLEANUP FUNCTION
// =============================================================================

async function cleanDemoData(orgId) {
  // Delete in reverse dependency order
  console.log('   Deleting chat messages...');
  await Message.deleteMany({ organization: orgId });
  console.log('   Deleting chat conversations...');
  await Conversation.deleteMany({ organization: orgId });
  console.log('   Deleting notifications...');
  await Notification.deleteMany({ organization: orgId });
  console.log('   Deleting task templates...');
  await TaskTemplate.deleteMany({ organization: orgId });
  console.log('   Deleting tasks...');
  await Task.deleteMany({ organization: orgId });
  console.log('   Deleting construction milestones...');
  await ConstructionMilestone.deleteMany({ organization: orgId });
  console.log('   Deleting contractors...');
  await Contractor.deleteMany({ organization: orgId });
  console.log('   Deleting partner commissions...');
  await PartnerCommission.deleteMany({ organization: orgId });
  console.log('   Deleting commission structures...');
  await CommissionStructure.deleteMany({ organization: orgId });
  console.log('   Deleting invoices...');
  await Invoice.deleteMany({ organization: orgId });
  console.log('   Deleting payment transactions...');
  await PaymentTransaction.deleteMany({ organization: orgId });
  console.log('   Deleting installments...');
  await Installment.deleteMany({ organization: orgId });
  console.log('   Deleting payment plans...');
  await PaymentPlan.deleteMany({ organization: orgId });
  console.log('   Deleting interactions...');
  await Interaction.deleteMany({ organization: orgId });
  console.log('   Deleting sales...');
  await Sale.deleteMany({ organization: orgId });
  console.log('   Deleting leads...');
  await Lead.deleteMany({ organization: orgId });
  console.log('   Deleting units...');
  await Unit.deleteMany({ organization: orgId });
  console.log('   Deleting document categories...');
  await DocumentCategory.deleteMany({ organization: orgId });
  console.log('   Deleting towers...');
  await Tower.deleteMany({ organization: orgId });
  console.log('   Deleting projects...');
  await Project.deleteMany({ organization: orgId });
  console.log('   Deleting users...');
  await User.deleteMany({ organization: orgId });
  console.log('   Deleting roles...');
  await Role.deleteMany({ organization: orgId });
  console.log('   Deleting organization...');
  await Organization.findByIdAndDelete(orgId);
}

// =============================================================================
// HELPER: INTERACTION CONTENT
// =============================================================================

function getInteractionContent(type, firstName) {
  const contents = {
    Call: `Called ${firstName}. Discussed project timeline and pricing. ${firstName} is interested but wants to compare with other options.`,
    Email: `Sent detailed cost sheet and payment plan options to ${firstName}. Included project brochure and amenity list.`,
    Meeting: `In-person meeting at office with ${firstName}. Discussed unit preferences, budget range, and available discounts. Showed 3D walkthrough.`,
    'Site Visit': `Accompanied ${firstName} for site visit. Showed model apartment, construction progress, and common amenities area. ${firstName} was impressed with the view from 5th floor units.`,
    WhatsApp: `WhatsApp conversation with ${firstName}. Shared latest construction progress photos and available unit list.`,
    Note: `Internal note: ${firstName} is a high-priority lead. Has pre-approved home loan from HDFC. Decision expected within 2 weeks.`,
  };
  return contents[type] || `Interaction with ${firstName}`;
}

function getInteractionOutcome(type) {
  const outcomes = {
    Call: randomFrom(['Interested', 'Wants callback', 'Requested more info', 'Thinking about it']),
    Email: 'Information sent',
    Meeting: randomFrom(['Very interested', 'Will discuss with family', 'Wants to visit site']),
    'Site Visit': randomFrom(['Impressed', 'Wants specific unit', 'Comparing options']),
    WhatsApp: randomFrom(['Acknowledged', 'Asked questions', 'Requested call']),
    Note: undefined,
  };
  return outcomes[type];
}

// =============================================================================
// RUN
// =============================================================================

seedDemoData();
