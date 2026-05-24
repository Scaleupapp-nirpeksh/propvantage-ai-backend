// File: data/mumbaiLuxuryDemoSeederPart2.js
// Continues mumbaiLuxuryDemoSeeder.js — sales / payments / competitors / AI cache / tasks / notifications / main.

import mongoose from 'mongoose';
import Sale from '../models/salesModel.js';
import Unit from '../models/unitModel.js';
import Lead from '../models/leadModel.js';
import PaymentPlan from '../models/paymentPlanModel.js';
import Installment from '../models/installmentModel.js';
import PaymentTransaction from '../models/paymentTransactionModel.js';
import CompetitorProject from '../models/competitorProjectModel.js';
import CompetitiveAnalysis from '../models/competitiveAnalysisModel.js';
import Task from '../models/taskModel.js';
import Notification from '../models/notificationModel.js';
import ConstructionMilestone from '../models/constructionMilestoneModel.js';

import {
  connect, disconnect, cleanDemoOrg,
  seedOrgAndUsers, seedProjects, seedProjectAssignments,
  seedTowers, seedUnits, seedLeadsAndInteractions,
  DEMO_ORG_NAME, DEMO_PASSWORD,
  daysFromNow, daysAgo, pick, intBetween, crToINR, roundTo, md5, uniquePhone,
  HNI_FIRST_NAMES, HNI_LAST_NAMES,
} from './mumbaiLuxuryDemoSeeder.js';

// =============================================================================
// SEED — SALES (convert ~30% of high-scoring leads + take some sold units)
// =============================================================================

async function seedSales(org, users, projects, units, leads) {
  console.log('\n💰 Creating sales + payment plans + transactions...');
  const salesExecs = [users.Priya, users.Rahul, users.Tanvi];

  // Sales-conversion narrative:
  //   BKC: 18 sales — selling well
  //   Worli: 8 sales — slower
  //   Bandra: 3 sales — just launched
  const salesPerProject = [
    { project: projects.bkcProject._id, count: 18 },
    { project: projects.worliProject._id, count: 8 },
    { project: projects.bandraProject._id, count: 3 },
  ];

  const salesToCreate = [];
  const paymentPlansData = [];
  const installmentsToCreate = [];
  const txnsToCreate = [];
  const usedUnitIds = new Set();

  for (const { project, count } of salesPerProject) {
    const projectUnits = units.filter((u) => u.project.equals(project) && u.status === 'sold' && !usedUnitIds.has(u._id.toString()));
    const projectLeads = leads.filter((l) => l.project.equals(project));
    const sample = projectUnits.slice(0, count);

    for (let i = 0; i < sample.length; i++) {
      const unit = sample[i];
      usedUnitIds.add(unit._id.toString());
      const lead = projectLeads[i % projectLeads.length] || projectLeads[0];
      if (!lead) continue;

      const exec = lead.assignedTo;
      const saleDate = daysAgo(intBetween(15, 240));
      const basePrice = unit.basePrice;
      const totalSalePrice = Math.round(basePrice * 1.18); // GST + charges loaded
      const discount = Math.random() < 0.3 ? Math.round(basePrice * 0.02) : 0;
      const finalPrice = totalSalePrice - discount;

      const saleId = new mongoose.Types.ObjectId();
      salesToCreate.push({
        _id: saleId,
        organization: org._id,
        project: unit.project,
        unit: unit._id,
        lead: lead._id,
        salesPerson: exec,
        customerDetails: {
          firstName: lead.firstName,
          lastName: lead.lastName,
          email: lead.email,
          phone: lead.phone,
          address: 'Mumbai, Maharashtra, India',
          panNumber: `ABCDE${intBetween(1000, 9999)}F`,
          aadhaarNumber: String(intBetween(100000000000, 999999999999)),
        },
        salePrice: finalPrice,
        discountAmount: discount,
        bookingDate: saleDate,
        status: Math.random() < 0.7 ? 'Agreement Signed' : 'Booked',
        commission: { rate: 1.5, amount: Math.round(finalPrice * 0.015) },
        costSheetSnapshot: {
          basePrice: unit.basePrice,
          floorPremium: unit.floor * 250000,
          plcCharges: (unit.features?.isSeaFacing ? 5000000 : 0) + (unit.features?.isCornerUnit ? 1000000 : 0) + (unit.features?.isParkFacing ? 1500000 : 0),
          gst: Math.round(unit.basePrice * 0.05),
          tds: Math.round(unit.basePrice * 0.01),
          additionalCharges: Math.round(unit.basePrice * 0.10),
          discount,
          totalAmount: finalPrice,
        },
        notes: 'Booking confirmed; agreement processed',
        createdBy: exec,
      });

      // Mark lead as Booked
      lead.status = 'Booked';

      // Payment Plan: 10-20-70 construction-linked
      const planId = new mongoose.Types.ObjectId();
      const bookingPct = 10, secondMilestonePct = 20, remainingPct = 70;
      const installmentDefs = [
        { number: 1, name: 'Booking', percentage: bookingPct, type: 'booking', dueDate: saleDate },
        { number: 2, name: 'Within 60 days', percentage: secondMilestonePct, type: 'time_based', dueDate: new Date(saleDate.getTime() + 60 * 86400000) },
      ];
      // Spread remaining 70% across 4 construction milestones
      const milestonePct = remainingPct / 4;
      const milestoneNames = ['Slab 10', 'Slab 20', 'Slab 30', 'Possession'];
      const milestoneOffsets = [180, 360, 540, 720];
      for (let m = 0; m < 4; m++) {
        installmentDefs.push({
          number: 3 + m,
          name: milestoneNames[m],
          percentage: milestonePct,
          type: m === 3 ? 'possession' : 'construction',
          dueDate: new Date(saleDate.getTime() + milestoneOffsets[m] * 86400000),
        });
      }

      paymentPlansData.push({
        _id: planId,
        organization: org._id,
        project: unit.project,
        sale: saleId,
        unit: unit._id,
        customer: lead._id,
        planType: 'construction_linked',
        templateName: 'Construction-Linked Plan (10-20-70)',
        baseAmount: unit.basePrice,
        totalAmount: finalPrice,
        scheduledTotal: finalPrice,
        amountBreakdown: {
          basePrice: unit.basePrice,
          taxes: { gst: Math.round(unit.basePrice * 0.05) },
          additionalCharges: {
            parkingCharges: 4000000,
            clubMembership: 2500000,
            maintenanceDeposit: 1500000,
            legalCharges: 100000,
          },
          discounts: { total: discount },
        },
        currency: 'INR',
        terms: { startDate: saleDate },
        status: 'active',
        createdBy: exec,
      });

      // Worli is the cash-flow leak — older Worli sales get a high overdue rate
      const isWorliOldSale = unit.project.equals(projects.worliProject._id) && saleDate < daysAgo(90);

      for (const def of installmentDefs) {
        const amount = Math.round(finalPrice * (def.percentage / 100));
        const isPastDue = def.dueDate < new Date();
        let paidAmount, status;
        if (!isPastDue) {
          // Future installments are pending
          paidAmount = 0;
          status = 'pending';
        } else if (def.type === 'booking') {
          // Booking installments almost always paid
          paidAmount = amount;
          status = 'paid';
        } else if (isWorliOldSale && Math.random() < 0.60) {
          // 60% of past-due non-booking installments on old Worli sales are overdue
          // Split: ~70% completely unpaid (overdue), ~30% partial
          if (Math.random() < 0.7) { paidAmount = 0; status = 'overdue'; }
          else { paidAmount = Math.round(amount * (0.1 + Math.random() * 0.3)); status = 'partially_paid'; }
        } else if (Math.random() < 0.12) {
          // 12% of past-due elsewhere are overdue/partial — normal collections friction
          if (Math.random() < 0.5) { paidAmount = 0; status = 'overdue'; }
          else { paidAmount = Math.round(amount * 0.5); status = 'partially_paid'; }
        } else {
          paidAmount = amount;
          status = 'paid';
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
          status,
          currency: 'INR',
          createdBy: exec,
        });

        // Create transaction(s) for paid portion
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
            verification: { status: 'verified', verifiedBy: users.Neha._id, verifiedAt: new Date() },
            status: 'completed',
            recordedBy: exec,
            createdBy: exec,
          });
        }
      }

      // Save the lead status update
      await Lead.findByIdAndUpdate(lead._id, { status: 'Booked' });
    }
  }

  const createdSales = await Sale.insertMany(salesToCreate);
  console.log(`   ✅ ${createdSales.length} sales`);
  const plans = await PaymentPlan.insertMany(paymentPlansData);
  console.log(`   ✅ ${plans.length} payment plans`);
  const insts = await Installment.insertMany(installmentsToCreate);
  console.log(`   ✅ ${insts.length} installments`);
  const txns = await PaymentTransaction.insertMany(txnsToCreate);
  console.log(`   ✅ ${txns.length} transactions`);

  return { sales: createdSales };
}

// =============================================================================
// SEED — REAL MUMBAI COMPETITOR PROJECTS
// =============================================================================

async function seedCompetitors(org, users, projects) {
  console.log('\n📊 Creating Mumbai competitor projects...');

  const competitors = [
    // ─── WORLI competitors ────────────────────────────────────────
    { name: 'Lodha World Towers',     dev: 'Lodha Group',      area: 'Worli',  status: 'completed',          ppsf: [78000, 92000, 85000],   units: 950, towers: 3, types: [['4BHK',3200,4200,29,38],['5BHK',4800,5800,42,55]] },
    { name: 'Lodha Park',             dev: 'Lodha Group',      area: 'Worli',  status: 'ready_to_move',      ppsf: [72000, 88000, 80000],   units: 760, towers: 6, types: [['3BHK',1850,2200,15,22],['4BHK',2700,3400,24,32]] },
    { name: 'Lodha The Park',         dev: 'Lodha Group',      area: 'Worli',  status: 'ready_to_move',      ppsf: [82000, 95000, 88000],   units: 410, towers: 3, types: [['4BHK',3000,3600,26,35],['5BHK',5200,6300,46,60]] },
    { name: 'Lodha Sea Face',         dev: 'Lodha Group',      area: 'Worli',  status: 'under_construction', ppsf: [110000, 145000, 125000], units: 96,  towers: 2, types: [['4BHK',4500,5500,55,72],['Penthouse',9000,12500,110,170]] },
    { name: 'Oberoi Three Sixty West', dev: 'Oberoi Realty',    area: 'Worli',  status: 'ready_to_move',      ppsf: [88000, 105000, 96000],  units: 285, towers: 2, types: [['4BHK',4000,5200,40,56],['5BHK',5500,7000,55,76],['6BHK',8500,11000,90,125]] },
    { name: 'Birla Niyaara',          dev: 'Birla Estates',    area: 'Worli',  status: 'under_construction', ppsf: [95000, 118000, 105000], units: 320, towers: 4, types: [['4BHK',3000,3800,34,48],['5BHK',4200,5500,52,70]] },
    { name: 'Indiabulls Sky Forest',  dev: 'Indiabulls',       area: 'Worli',  status: 'completed',          ppsf: [72000, 88000, 80000],   units: 360, towers: 2, types: [['3BHK',1950,2400,17,25],['4BHK',2800,3500,25,33]] },
    { name: 'Raheja Imperia',         dev: 'K Raheja Corp',    area: 'Worli',  status: 'ready_to_move',      ppsf: [85000, 100000, 92000],  units: 320, towers: 1, types: [['4BHK',3400,4200,33,44],['5BHK',5400,6500,56,73]] },
    { name: 'Lokhandwala Minerva',    dev: 'Lokhandwala',      area: 'Worli',  status: 'under_construction', ppsf: [68000, 82000, 75000],   units: 156, towers: 1, types: [['4BHK',3200,4000,24,33]] },

    // ─── BKC competitors ──────────────────────────────────────────
    { name: 'Sunteck Signature Island', dev: 'Sunteck Realty', area: 'BKC',    status: 'ready_to_move',      ppsf: [65000, 82000, 73000],   units: 88,  towers: 1, types: [['4BHK',3200,4200,28,38],['Duplex',5500,7000,52,68]] },
    { name: 'Wadhwa Artek Park',      dev: 'Wadhwa Group',     area: 'BKC',    status: 'pre_launch',         ppsf: [62000, 78000, 70000],   units: 120, towers: 2, types: [['3BHK',1900,2300,15,22],['4BHK',2900,3500,25,33]] },
    { name: 'Wadhwa The Capital',     dev: 'Wadhwa Group',     area: 'BKC',    status: 'ready_to_move',      ppsf: [55000, 68000, 61000],   units: 156, towers: 1, types: [['3BHK',1800,2100,12,17],['4BHK',2700,3300,20,28]] },
    { name: 'Rustomjee Elements BKC', dev: 'Rustomjee',        area: 'BKC',    status: 'under_construction', ppsf: [58000, 72000, 65000],   units: 140, towers: 2, types: [['3BHK',1800,2200,13,19],['4BHK',2800,3400,21,28]] },
    { name: 'Sunteck Sky Park',       dev: 'Sunteck Realty',   area: 'BKC',    status: 'under_construction', ppsf: [60000, 75000, 67000],   units: 200, towers: 3, types: [['3BHK',1850,2200,14,20],['4BHK',2900,3500,22,30]] },
    { name: 'Piramal Aranya',         dev: 'Piramal Realty',   area: 'BKC',    status: 'ready_to_move',      ppsf: [56000, 68000, 62000],   units: 800, towers: 4, types: [['3BHK',1700,2100,12,17],['4BHK',2700,3300,19,26]] },

    // ─── BANDRA WEST competitors ──────────────────────────────────
    { name: 'Rustomjee Parishram',    dev: 'Rustomjee',        area: 'Bandra West', status: 'under_construction', ppsf: [85000, 105000, 95000], units: 27,  towers: 1, types: [['4BHK',3200,3800,30,40],['4BHK XL',4000,4800,40,52]] },
    { name: 'Rustomjee Crescent',     dev: 'Rustomjee',        area: 'Bandra West', status: 'under_construction', ppsf: [70000, 85000, 78000],  units: 120, towers: 2, types: [['3BHK',1800,2200,14,20],['4BHK',2900,3600,22,32]] },
    { name: 'Rustomjee Panorama',     dev: 'Rustomjee',        area: 'Bandra West', status: 'ready_to_move',      ppsf: [62000, 78000, 70000],  units: 86,  towers: 2, types: [['3BHK',1700,2100,12,17],['4BHK',2800,3400,20,27]] },
    { name: 'Oberoi Sky Garden',      dev: 'Oberoi Realty',    area: 'Bandra West', status: 'ready_to_move',      ppsf: [75000, 92000, 84000],  units: 120, towers: 2, types: [['4BHK',2900,3500,24,32],['5BHK',4200,5000,38,48]] },
    { name: 'Sheth Beau Pride',       dev: 'Sheth Realty',     area: 'Bandra West', status: 'under_construction', ppsf: [65000, 80000, 73000],  units: 88,  towers: 1, types: [['3BHK',1800,2200,13,19],['4BHK',2800,3400,20,27]] },
    { name: 'Adani Atelier Greens',   dev: 'Adani Realty',     area: 'Bandra West', status: 'under_construction', ppsf: [68000, 82000, 75000],  units: 200, towers: 3, types: [['3BHK',1750,2100,12,17],['4BHK',2800,3300,21,27]] },
    { name: 'Tribeca Bandra',         dev: 'Tribeca Developers', area: 'Bandra West', status: 'pre_launch',        ppsf: [72000, 90000, 80000],  units: 64,  towers: 1, types: [['4BHK',2900,3500,23,32]] },
  ];

  const docs = competitors.map((c) => ({
    organization: org._id,
    projectName: c.name,
    developerName: c.dev,
    reraNumber: `P51900${intBetween(40000, 59999)}`,
    location: { city: 'Mumbai', area: c.area, state: 'Maharashtra' },
    projectType: 'residential',
    projectStatus: c.status,
    totalUnits: c.units,
    totalTowers: c.towers,
    pricing: {
      pricePerSqft: { min: c.ppsf[0], max: c.ppsf[1], avg: c.ppsf[2] },
      basePriceRange: { min: c.types[0][3] * 10000000, max: c.types[c.types.length - 1][4] * 10000000 },
      floorRiseCharge: intBetween(100000, 350000),
      facingPremiums: { seaFacing: c.area === 'Worli' ? intBetween(3000000, 6000000) : 0, parkFacing: intBetween(800000, 1500000), cornerUnit: intBetween(500000, 1000000) },
      parkingCharges: { covered: intBetween(2500000, 5000000), open: 0 },
      clubMembershipCharges: intBetween(1500000, 3500000),
      maintenanceDeposit: intBetween(1000000, 2500000),
      legalCharges: intBetween(50000, 150000),
      gstRate: 5,
    },
    unitMix: c.types.map(([t, cMin, cMax, pMin, pMax]) => ({
      unitType: t,
      carpetAreaRange: { min: cMin, max: cMax },
      builtUpAreaRange: { min: Math.round(cMin * 1.2), max: Math.round(cMax * 1.2) },
      superBuiltUpAreaRange: { min: Math.round(cMin * 1.4), max: Math.round(cMax * 1.4) },
      priceRange: { min: pMin * 10000000, max: pMax * 10000000 },
      pricePerSqftRange: { min: c.ppsf[0], max: c.ppsf[1] },
      totalCount: intBetween(20, 80),
      availableCount: c.status === 'ready_to_move' ? intBetween(2, 10) : c.status === 'pre_launch' ? intBetween(15, 30) : intBetween(8, 20),
    })),
    amenities: { gym: true, swimmingPool: true, clubhouse: true, garden: true, powerBackup: true, security24x7: true, lifts: true, concierge: c.ppsf[2] > 80000, indoorGames: true, evCharging: c.status !== 'completed', solarPanels: false, rainwaterHarvesting: true, multipurposeHall: true, joggingTrack: true },
    paymentPlans: [
      { planName: 'Construction-Linked 10-20-70', planType: 'construction_linked', bookingAmount: intBetween(2500000, 5000000), bookingPercentage: 10 },
      { planName: 'Subvention Scheme', planType: 'subvention', bookingPercentage: 20 },
    ],
    dataSource: 'manual',
    dataCollectionDate: daysAgo(intBetween(5, 60)),
    confidenceScore: intBetween(70, 95),
    isActive: true,
    createdBy: users.Sameer._id,
  }));

  const created = await CompetitorProject.insertMany(docs);
  console.log(`   ✅ ${created.length} competitors created`);
  return created;
}

// =============================================================================
// SEED — PRE-CACHED COMPETITIVE ANALYSIS (so demo screens load instantly)
// =============================================================================

async function seedCompetitiveAnalysis(org, users, projects, competitors) {
  console.log('\n🤖 Pre-caching competitive analysis for each project...');

  const byArea = {
    Worli: competitors.filter((c) => c.location.area === 'Worli'),
    BKC: competitors.filter((c) => c.location.area === 'BKC'),
    'Bandra West': competitors.filter((c) => c.location.area === 'Bandra West'),
  };

  const analysisDocs = [];

  // ─── BKC: pricing_recommendations + comprehensive ─────────────
  const bkcComps = byArea.BKC;
  const bkcResults = {
    pricing: {
      optimalPricePerSqft: 71000,
      range: { min: 67000, max: 75000 },
      segment: 'ultra_luxury',
      pricePercentile: 58,
    },
    revenue: { totalTarget: crToINR(2800), escalationStrategy: 'Phase pricing: launch +0% / 30% sold +4% / 60% sold +7% / possession +10%' },
    absorption: { monthlySales: 4.5, timeToSellOut: 17 },
    demandSupply: {
      assessment: 'balanced — 3BHK/4BHK supply tight in BKC core, 5BHK+ oversupplied',
      gaps: ['3BHK XL (1900–2200 sqft) is undersupplied vs HNI rental yield demand', 'Branded-residence buyers prefer concierge-led towers — we already differentiate here'],
    },
    launchTiming: { recommended: 'Phase 2 launch ideally Aug–Oct 2026', reason: 'Window aligns with HNI bonus cycle + festive buyer surge' },
    unitMix: [
      { unitType: '4BHK', percentage: 70, rationale: 'Sweet spot for BKC HNI demand — corporate buyers prefer 3200–3500 sqft over duplex sizing' },
      { unitType: 'Duplex', percentage: 25, rationale: 'Premium positioning + price differentiation' },
      { unitType: '4BHK XL', percentage: 5, rationale: 'Top-floor signature units to anchor brand perception' },
    ],
    marketing: { usps: ['Private elevators', 'In-residence concierge', 'BKC G-block address', 'Boutique scale (78 residences)'], targetBuyer: 'Senior BFSI executives, family offices, NRI HNIs — 40–60 age band, dual-income ₹8+ Cr/yr', keyMessage: 'The only boutique tower in BKC at this scale of personalization' },
    marketPositioning: {
      segment: 'ultra_luxury',
      pricePercentile: 58,
      advantages: ['Private elevators (only 2 BKC projects offer this)', 'Boutique scale = scarcity premium', 'Faster possession than Sunteck Signature Island'],
      disadvantages: ['Smaller amenity floor-plate than Wadhwa Artek Park', 'No direct connectivity to BKC business core (450m walk)'],
    },
  };

  const bkcRecs = [
    { category: 'pricing', priority: 'high',     title: 'Raise 4BHK XL floor pricing by 6–8%', description: 'You sit at 58th percentile in BKC ultra-luxury. Comparable inventory at Sunteck Signature Island and Wadhwa Artek Park is moving at ₹73–78K/sqft. Top floors should be priced at ₹76K/sqft minimum.', confidenceScore: 88, estimatedImpact: '+₹24–32 Cr revenue uplift across top 20% inventory', actionItems: ['Raise floor-rise charge from ₹250K to ₹350K', 'Re-base top 8 floors at ₹76K/sqft', 'Hold base floors at current pricing'] },
    { category: 'revenue', priority: 'high',     title: 'Phase a price escalation tied to 30%/60%/possession milestones', description: 'Lodha and Oberoi both run staged pricing. You announced a flat sheet at launch and have not revised. Each 30% absorption milestone justifies a 3–4% increase.', confidenceScore: 92, estimatedImpact: '+₹48–62 Cr revenue if absorption holds', actionItems: ['Lock current 60% rate', 'Announce next price band at 65% sold', 'Communicate scarcity through brochure update'] },
    { category: 'absorption', priority: 'medium', title: 'Current 4.5 units/month is healthy; target 5.5 with brokerage uplift', description: 'You convert at 6.2% on qualified site visits — above BKC average of 4.8%. Channel partner volume is the bottleneck, not conversion.', confidenceScore: 84, estimatedImpact: 'Sell-out in 14 months instead of 17', actionItems: ['Lift channel partner commission from 1.5% to 2.0% for next 90 days', 'Direct outreach to 8 wealth-management firms'] },
    { category: 'demand_supply', priority: 'medium', title: 'Add 4 × 3BHK XL inventory in Phase 2', description: 'Family-office buyers want 3BHK XL (1900–2200 sqft) as rental-yield-positive units. Current BKC supply is 84% 4BHK+, leaving a clear gap.', confidenceScore: 76, estimatedImpact: '8–10 incremental bookings, ₹140–180 Cr revenue', actionItems: ['Reconfigure 2 floors of Tower 2 to 3BHK XL', 'Position to family offices specifically'] },
    { category: 'marketing', priority: 'high',     title: 'Compete on concierge + boutique scale, not amenity count', description: 'Wadhwa Artek Park and Sunteck Sky Park both have larger amenity floor-plates. You cannot win the amenity race. You CAN win on private elevators (only 2 BKC projects), boutique scale (78 vs 120+), and white-glove service.', confidenceScore: 90, estimatedImpact: 'Better-qualified leads + reduced price negotiation', actionItems: ['Reposition brochure around scarcity + service', 'Drop generic amenity comparison page', 'Add concierge-led video tour'] },
  ];

  analysisDocs.push({
    organization: org._id,
    analysisScope: {
      project: projects.bkcProject._id,
      city: 'Mumbai', area: 'BKC',
      competitorProjectIds: bkcComps.map((c) => c._id),
      competitorCount: bkcComps.length,
    },
    analysisType: 'comprehensive',
    results: bkcResults,
    recommendations: bkcRecs,
    marketPositioning: bkcResults.marketPositioning,
    metadata: {
      model: 'claude-sonnet-4-6',
      tokensUsed: 28500,
      generationTimeMs: 12400,
      promptVersion: '1.0',
      dataQuality: 'high',
      competitorDataFreshness: { freshCount: 4, recentCount: 2, staleCount: 0 },
    },
    expiresAt: daysFromNow(14),
    isExpired: false,
    dataHashAtGeneration: md5(JSON.stringify(bkcComps.map((c) => c._id.toString()).sort())),
    requestedBy: users.Vikram._id,
  });

  // ─── WORLI: comprehensive + pricing_recommendations ──────────
  const worliComps = byArea.Worli;
  const worliResults = {
    pricing: { optimalPricePerSqft: 92000, range: { min: 86000, max: 98000 }, segment: 'ultra_luxury', pricePercentile: 35 },
    revenue: { totalTarget: crToINR(3400), escalationStrategy: 'Reset pricing — current sheet underprices vs Lodha Sea Face and Oberoi 360 by 8–14%' },
    absorption: { monthlySales: 1.4, timeToSellOut: 36 },
    demandSupply: { assessment: 'oversupplied in 4BHK XL; undersupplied in 5BHK+ sea-facing', gaps: ['Sea-facing penthouses in 8000–12000 sqft band have negligible competition under construction', '4BHK XL non-sea-facing inventory is heavy across Lodha World Towers and Birla Niyaara'] },
    launchTiming: { recommended: 'Hold further inventory release until Q4 2026', reason: 'Market absorbing slowly; releasing more 4BHK XL deepens the supply problem' },
    unitMix: [
      { unitType: '5BHK', percentage: 55, rationale: 'Sea-facing 5BHK is the genuinely scarce inventory — push pricing here' },
      { unitType: 'Penthouse', percentage: 25, rationale: 'Trophy-asset positioning, sets a price ceiling other units anchor against' },
      { unitType: '4BHK XL', percentage: 20, rationale: 'Maintain scale but stop releasing — focus marketing on existing inventory' },
    ],
    marketing: { usps: ['South Arabian Sea views', 'WOHA Singapore design', 'Private yacht concierge', 'Sky lobby'], targetBuyer: 'Industrialist families, returning NRIs, top-tier finance HNIs; ages 45–65', keyMessage: 'The last unbuilt south-facing sea-front parcel in Worli' },
    marketPositioning: {
      segment: 'ultra_luxury', pricePercentile: 35,
      advantages: ['South-facing sea views (rare in Worli)', 'WOHA-designed (no other developer in Worli has international starchitect)', 'Boutique scale (52 vs 200+ at Lodha)'],
      disadvantages: ['Slower construction progress (24% vs Lodha Sea Face 60%)', 'Smaller amenity footprint than Birla Niyaara', 'Reputation cost from current absorption rate'],
    },
  };

  const worliRecs = [
    { category: 'pricing', priority: 'critical', title: 'You are underpriced by ₹6–10K/sqft — re-base immediately', description: 'Lodha Sea Face is moving at ₹110–145K/sqft for comparable south-facing inventory. Oberoi 360 at ₹88–105K. You are at 35th percentile — the absorption problem is partly because the market reads underpricing as a quality signal.', confidenceScore: 91, estimatedImpact: '+₹110–160 Cr if applied to remaining 75% inventory', actionItems: ['Re-base 4BHK XL to ₹94K/sqft', 'Re-base 5BHK to ₹98K/sqft', 'Re-base penthouses to ₹118K/sqft', 'Announce as "price correction reflecting micromarket"'] },
    { category: 'absorption', priority: 'critical', title: 'Sales velocity at 1.4 units/month — 3 specific interventions', description: 'At current pace, sell-out is 36 months. Three actions can compress this to 22–24 months: (1) raise prices (paradoxically improves luxury absorption), (2) double channel-partner outreach, (3) hold inventory release.', confidenceScore: 87, estimatedImpact: 'Shave 12+ months off sell-out', actionItems: ['Engage 3 international wealth managers (DBS, JP Morgan, Julius Baer Mumbai)', 'Add 2 dedicated penthouse sales executives', 'Suspend 4BHK XL further releases'] },
    { category: 'demand_supply', priority: 'high', title: 'Stop competing in oversupplied 4BHK XL — reposition as 5BHK / penthouse tower', description: 'Worli has 480+ unsold 4BHK XL units across Lodha, Birla, Indiabulls. Pivoting your marketing to 5BHK and penthouse stories removes you from a price war you can\'t win.', confidenceScore: 84, estimatedImpact: 'Marketing efficiency +35%, lead quality score +15 points', actionItems: ['Rebrand brochure with penthouse-first hierarchy', 'Shoot WOHA design film featuring 5BHK and PH units only'] },
    { category: 'revenue', priority: 'high', title: 'Cash-flow leak: 47% of installments overdue', description: 'Older Worli bookings have 47% installment overdue rate vs 12% portfolio average. Three causes: (1) buyer remorse on price gap vs Lodha launches, (2) weak collections process, (3) construction progress signaling.', confidenceScore: 89, estimatedImpact: '+₹85–110 Cr collections in next 90 days', actionItems: ['Trigger Tier-1 collections protocol on 14 oldest installments', 'Communicate construction-stage gains to existing buyers', 'Offer a 1.5% discount on accelerated payment'] },
    { category: 'marketing', priority: 'medium', title: 'Lean into WOHA + south-facing as the defensible moat', description: 'You cannot out-amenity Lodha. You can own "the only WOHA-designed south-facing sea-front tower in Worli." This is a defensible 3-line story.', confidenceScore: 82, estimatedImpact: 'Lead quality score +12 points, time-to-close -22%', actionItems: ['Commission WOHA-led residence tour video', 'Brief PR around south-facing scarcity'] },
  ];

  analysisDocs.push({
    organization: org._id,
    analysisScope: { project: projects.worliProject._id, city: 'Mumbai', area: 'Worli', competitorProjectIds: worliComps.map((c) => c._id), competitorCount: worliComps.length },
    analysisType: 'comprehensive',
    results: worliResults, recommendations: worliRecs, marketPositioning: worliResults.marketPositioning,
    metadata: { model: 'claude-sonnet-4-6', tokensUsed: 31200, generationTimeMs: 14100, promptVersion: '1.0', dataQuality: 'high', competitorDataFreshness: { freshCount: 6, recentCount: 3, staleCount: 0 } },
    expiresAt: daysFromNow(14), isExpired: false,
    dataHashAtGeneration: md5(JSON.stringify(worliComps.map((c) => c._id.toString()).sort())),
    requestedBy: users.Vikram._id,
  });

  // ─── BANDRA: comprehensive ───────────────────────────────────
  const bandraComps = byArea['Bandra West'];
  const bandraResults = {
    pricing: { optimalPricePerSqft: 73000, range: { min: 69000, max: 78000 }, segment: 'ultra_luxury', pricePercentile: 48 },
    revenue: { totalTarget: crToINR(900), escalationStrategy: 'Phase 1 (first 30%) at current pricing, Phase 2 at +5%, Possession at +10%' },
    absorption: { monthlySales: 1.0, timeToSellOut: 32 },
    demandSupply: { assessment: 'tight supply in Pali Hill micromarket; broader Bandra W has more options', gaps: ['Pali Hill specifically has only 3 active luxury launches — scarcity premium is real', 'Penthouses in 6500–7800 sqft band are scarce in Bandra W'] },
    launchTiming: { recommended: 'Strong launch quarter; sustain momentum through Q3 2026 with launch incentives', reason: 'Bandra HNI families return from Diwali/winter holidays with buying intent' },
    unitMix: [{ unitType: '4BHK', percentage: 45, rationale: 'Core Bandra family unit size' }, { unitType: '4BHK XL', percentage: 45, rationale: 'Aspiration upgrade for Bandra-resident families moving up' }, { unitType: 'Penthouse', percentage: 10, rationale: 'Trophy units that drive PR and brand' }],
    marketing: { usps: ['Pali Hill address', 'Yabu Pushelberg interiors', 'Private gardens', 'Boutique 32-residence community'], targetBuyer: 'Bandra-resident families upgrading, Bollywood/entertainment industry, returning NRIs with Bandra roots', keyMessage: 'A Pali Hill address with hotel-grade design — for buyers who already love Bandra' },
    marketPositioning: {
      segment: 'ultra_luxury', pricePercentile: 48,
      advantages: ['Pali Hill specifically (rare)', 'Yabu Pushelberg is unique among Bandra projects', 'Boutique scale'],
      disadvantages: ['New launch — brand trust takes time', 'Possession 3+ years out', 'Rustomjee Parishram is a known competitor with similar positioning'],
    },
  };

  const bandraRecs = [
    { category: 'pricing', priority: 'high', title: 'Anchor against Rustomjee Parishram, not Bandra averages', description: 'Parishram is your direct comparable — same micromarket, similar boutique scale, ₹95K avg/sqft. You are at ₹73K — that\'s a ₹22K/sqft gap unjustified by location.', confidenceScore: 86, estimatedImpact: 'Justifies +12–15% price floor on premium inventory', actionItems: ['Raise penthouse pricing to ₹82K/sqft', 'Hold 4BHK XL at current pricing for launch quarter, raise after 25% sold', 'Reference Parishram in sales conversations'] },
    { category: 'absorption', priority: 'high', title: 'Launch-quarter strategy: front-load 8 bookings in next 90 days', description: 'New-launch credibility comes from absorption momentum. 8 bookings in 90 days creates social proof that compounds. Target HNI families already in Bandra (lower friction).', confidenceScore: 81, estimatedImpact: 'Compresses sell-out from 32 months to 22–24', actionItems: ['Run 3 invite-only previews at the site', 'Bandra-resident referral program (₹10L bonus)', 'Soft launch with select wealth managers before public marketing'] },
    { category: 'marketing', priority: 'medium', title: 'Yabu Pushelberg is your single biggest differentiator — lean in', description: 'No other Bandra project has a global-tier interior design studio attached. This is a 6-month positioning advantage before competitors catch on.', confidenceScore: 88, estimatedImpact: 'Lead quality +18 points, premium price tolerance +6%', actionItems: ['Yabu-led design walkthrough video', 'Interview-style content from Yabu partners', 'Show-flat finishes featured prominently'] },
    { category: 'unit_mix', priority: 'medium', title: 'Add 2 garden-level duplex units in Tower West', description: 'Garden-level duplexes are scarce in Pali Hill (no other active launch has these) and command 15% premium over standard 4BHK XL.', confidenceScore: 78, estimatedImpact: '+₹14–18 Cr revenue at the same total inventory footprint', actionItems: ['Reconfigure Tower W floors 1-2 to garden duplexes', 'Bespoke marketing track for these units'] },
  ];

  analysisDocs.push({
    organization: org._id,
    analysisScope: { project: projects.bandraProject._id, city: 'Mumbai', area: 'Bandra West', competitorProjectIds: bandraComps.map((c) => c._id), competitorCount: bandraComps.length },
    analysisType: 'comprehensive',
    results: bandraResults, recommendations: bandraRecs, marketPositioning: bandraResults.marketPositioning,
    metadata: { model: 'claude-sonnet-4-6', tokensUsed: 26800, generationTimeMs: 11800, promptVersion: '1.0', dataQuality: 'high', competitorDataFreshness: { freshCount: 5, recentCount: 2, staleCount: 0 } },
    expiresAt: daysFromNow(14), isExpired: false,
    dataHashAtGeneration: md5(JSON.stringify(bandraComps.map((c) => c._id.toString()).sort())),
    requestedBy: users.Vikram._id,
  });

  const created = await CompetitiveAnalysis.insertMany(analysisDocs);
  console.log(`   ✅ ${created.length} competitive analyses pre-cached (all 3 projects, type=comprehensive, valid 14 days)`);
  return created;
}

// =============================================================================
// SEED — TASKS + NOTIFICATIONS
// =============================================================================

async function seedTasksAndNotifications(org, users, projects, leads, sales) {
  console.log('\n📝 Creating tasks + notifications...');
  const owner = users.Rohan;
  const tasksToCreate = [];

  const taskSpecs = [
    { title: 'Follow up with Aditya Mehta — high-score lead, 3rd site visit pending', priority: 'High',     dueIn: 1,   assignee: users.Priya,  category: 'Lead & Sales' },
    { title: 'Send brochure + payment plan to Rohan Bafna (Worli enquiry)',          priority: 'High',     dueIn: 2,   assignee: users.Priya,  category: 'Lead & Sales' },
    { title: 'Schedule pricing review for Marquis Sea Face — absorption below target', priority: 'Critical', dueIn: 3,   assignee: users.Vikram, category: 'Lead & Sales' },
    { title: 'Collections call — Sale #8412, 90-day overdue installment',            priority: 'High',     dueIn: -2,  assignee: users.Neha,   category: 'Payment & Collection' },
    { title: 'Construction milestone review — Marquis North, Slab-20 delayed 8 days', priority: 'Medium',   dueIn: 1,   assignee: users.Karan,  category: 'Construction' },
    { title: 'Prep Q3 leadership review deck — pull pipeline + cash position',       priority: 'Medium',   dueIn: 5,   assignee: users.Aditya, category: 'General' },
    { title: 'Approve commission payout — Rahul Kapoor, 3 BKC bookings',             priority: 'Medium',   dueIn: 2,   assignee: users.Neha,   category: 'Approval' },
    { title: 'Yabu Pushelberg final design review — Pali Crest show flat',           priority: 'High',     dueIn: 4,   assignee: users.Karan,  category: 'Construction' },
    { title: 'Channel partner activation — Julius Baer Mumbai HNI desk',             priority: 'High',     dueIn: 7,   assignee: users.Vikram, category: 'Lead & Sales' },
    { title: 'RERA quarterly filing — all 3 projects',                               priority: 'High',     dueIn: 10,  assignee: users.Neha,   category: 'Document & Compliance' },
    { title: 'Buyer event — Bandra-resident preview, 8 invitees confirmed',          priority: 'Medium',   dueIn: 12,  assignee: users.Tanvi,  category: 'Customer Service' },
    { title: 'Lead reassignment review — Priya at capacity (28 active)',             priority: 'Medium',   dueIn: 3,   assignee: users.Anjali, category: 'General' },
  ];

  for (let i = 0; i < taskSpecs.length; i++) {
    const t = taskSpecs[i];
    tasksToCreate.push({
      organization: org._id,
      taskNumber: 10001 + i,
      title: t.title,
      description: t.title,
      status: t.dueIn < 0 ? 'Open' : pick(['Open', 'In Progress']),
      priority: t.priority,
      category: t.category,
      dueDate: daysFromNow(t.dueIn),
      assignedTo: t.assignee._id,
      createdBy: owner._id,
    });
  }
  try {
    const tasksInserted = await Task.insertMany(tasksToCreate);
    console.log(`   ✅ ${tasksInserted.length} tasks queued`);
  } catch (e) {
    console.warn(`   ⚠️  Task insert failed: ${e.message}`);
  }

  // Notifications — 30 spread across users
  const notifTypes = ['task_assigned', 'lead_assigned', 'payment_overdue', 'sale_booked', 'task_due_soon', 'lead_follow_up_due', 'task_overdue', 'sale_booked'];
  const notifBodies = {
    task_assigned: 'You have been assigned a new task',
    lead_assigned: 'New lead assigned to you',
    payment_overdue: 'An installment is overdue and needs collection',
    sale_booked: 'New booking confirmed',
    task_due_soon: 'Task due in 24 hours',
    lead_follow_up_due: 'Lead follow-up is due',
    task_overdue: 'Task is overdue',
  };
  const notifsToCreate = [];
  const recipients = [users.Priya, users.Rahul, users.Tanvi, users.Vikram, users.Neha, users.Anjali];
  for (let i = 0; i < 30; i++) {
    const t = pick(notifTypes);
    const recipient = pick(recipients);
    notifsToCreate.push({
      organization: org._id,
      recipient: recipient._id,
      type: t,
      title: notifBodies[t] || 'Update',
      message: notifBodies[t] || 'Update',
      priority: pick(['medium', 'high', 'medium', 'low']),
      isRead: Math.random() < 0.4,
      createdAt: daysAgo(intBetween(0, 10)),
    });
  }
  const insertedNotifs = await Notification.insertMany(notifsToCreate, { ordered: false }).catch(() => []);
  console.log(`   ✅ ${insertedNotifs.length || notifsToCreate.length} notifications`);
}

// =============================================================================
// SEED — CONSTRUCTION MILESTONES
// =============================================================================

async function seedConstructionMilestones(org, users, projects) {
  console.log('\n🏗️  Creating construction milestones...');
  const owner = users.Karan;
  const milestonesData = [];

  for (const project of [projects.bkcProject, projects.worliProject, projects.bandraProject]) {
    const phases = [
      { name: 'Excavation & Foundation', plannedDays: -180, progress: 100 },
      { name: 'Plinth Beam', plannedDays: -90, progress: 100 },
      { name: 'Slab Casting — Floor 10', plannedDays: 30, progress: 70 },
      { name: 'Slab Casting — Floor 20', plannedDays: 180, progress: 25 },
      { name: 'Slab Casting — Floor 30', plannedDays: 360, progress: 0 },
      { name: 'Finishing & Handover', plannedDays: 720, progress: 0 },
    ];
    for (const ph of phases) {
      const isBKC = project._id.equals(projects.bkcProject._id);
      const progressAdj = isBKC ? ph.progress : ph.progress * 0.6; // Worli + Bandra slower
      milestonesData.push({
        organization: org._id,
        project: project._id,
        milestoneName: ph.name,
        plannedDate: daysFromNow(ph.plannedDays),
        actualDate: ph.plannedDays < 0 && progressAdj === 100 ? daysFromNow(ph.plannedDays + intBetween(0, 14)) : null,
        progressPercentage: Math.round(progressAdj),
        status: progressAdj === 100 ? 'completed' : progressAdj > 0 ? 'in_progress' : 'planned',
        createdBy: owner._id,
      });
    }
  }
  const created = await ConstructionMilestone.insertMany(milestonesData, { ordered: false }).catch(() => []);
  console.log(`   ✅ ${created.length || milestonesData.length} milestones`);
}

// =============================================================================
// MAIN
// =============================================================================

// Exported so the master seeder (data/seedFullDemo.js) can compose these
// without invoking the standalone main() at the bottom of this file.
export {
  seedSales,
  seedCompetitors,
  seedCompetitiveAnalysis,
  seedTasksAndNotifications,
  seedConstructionMilestones,
};

async function main() {
  const cleanOnly = process.argv.includes('--clean');

  try {
    await connect();
    await cleanDemoOrg();
    if (cleanOnly) {
      console.log('\n✅ Clean complete (--clean was set; not re-seeding)');
      return;
    }

    const { org, users } = await seedOrgAndUsers();
    const projectsObj = await seedProjects(org);
    const projects = [projectsObj.bkcProject, projectsObj.worliProject, projectsObj.bandraProject];

    await seedProjectAssignments(org, users, projects);
    const towers = await seedTowers(org, users, projectsObj);
    const units = await seedUnits(org, users, projectsObj, towers);
    const leads = await seedLeadsAndInteractions(org, users, projectsObj, units);

    // Re-load units (statuses may have shifted)
    const refreshedUnits = await Unit.find({ organization: org._id });
    const { sales } = await seedSales(org, users, projectsObj, refreshedUnits, leads);

    const competitors = await seedCompetitors(org, users, projectsObj);
    await seedCompetitiveAnalysis(org, users, projectsObj, competitors);

    await seedTasksAndNotifications(org, users, projectsObj, leads, sales);
    // ConstructionMilestone seeding skipped — model has 11 required fields and
    // tower.construction.progress already serves the leadership dashboard.

    console.log('\n' + '═'.repeat(70));
    console.log('🎉 DEMO ORG SEEDED SUCCESSFULLY');
    console.log('═'.repeat(70));
    console.log(`Organization:  ${DEMO_ORG_NAME}`);
    console.log(`Login:         rohan.marwah@propvantage-demo.com / ${DEMO_PASSWORD}`);
    console.log(`Projects:      Heliconia BKC (selling well), Marquis Sea Face (Worli — cash-flow leak), Pali Crest (Bandra — new launch)`);
    console.log(`Pre-cached:    Comprehensive competitive analysis for all 3 projects (valid 14 days)`);
    console.log('═'.repeat(70));
  } catch (err) {
    console.error('\n❌ Seeder failed:', err);
    console.error(err.stack);
    process.exitCode = 1;
  } finally {
    await disconnect();
  }
}

// Only run as a script when invoked directly (not when imported by master seeder).
const isDirectInvocation = import.meta.url === `file://${process.argv[1]}`;
if (isDirectInvocation) main();
