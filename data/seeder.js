// File: data/seeder.js
// Description: Enhanced robust seeder with comprehensive test data for AI scoring system
// Version: 2.0 - Complete data seeding with realistic scenarios
// Location: data/seeder.js

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import connectDB from '../config/db.js';

// Load Models
import Organization from '../models/organizationModel.js';
import User from '../models/userModel.js';
import Project from '../models/projectModel.js';
import Unit from '../models/unitModel.js';
import Lead from '../models/leadModel.js';
import Sale from '../models/salesModel.js';
import Interaction from '../models/interactionModel.js';

dotenv.config();
connectDB();

// --- ENHANCED SAMPLE DATA WITH REALISTIC SCENARIOS ---

const timestamp = Date.now();
const orgName = `PropVantage Builders ${timestamp}`;

const sampleData = {
  organization: {
    name: orgName,
    country: 'India',
    city: 'Mumbai',
    type: 'builder',
    contactInfo: {
      phone: '+91 22 1234 5678',
      website: 'https://propvantagebuilders.com',
      address: 'Tower A, Business District, Mumbai - 400001'
    },
    subscriptionPlan: 'professional'
  },

  // ENHANCED: Comprehensive user roles for testing RBAC
  users: [
    {
      firstName: 'Rajesh',
      lastName: 'Khanna',
      email: `ceo.${timestamp}@propvantage.com`,
      password: 'SecurePass123!',
      role: 'Business Head',
    },
    {
      firstName: 'Vikram',
      lastName: 'Singh',
      email: `sales.head.${timestamp}@propvantage.com`,
      password: 'SecurePass123!',
      role: 'Sales Head',
    },
    {
      firstName: 'Anita',
      lastName: 'Desai',
      email: `sales.mgr.${timestamp}@propvantage.com`,
      password: 'SecurePass123!',
      role: 'Sales Manager',
    },
    {
      firstName: 'Priya',
      lastName: 'Sharma',
      email: `sales.exec1.${timestamp}@propvantage.com`,
      password: 'SecurePass123!',
      role: 'Sales Executive',
    },
    {
      firstName: 'Amit',
      lastName: 'Kumar',
      email: `sales.exec2.${timestamp}@propvantage.com`,
      password: 'SecurePass123!',
      role: 'Sales Executive',
    },
    {
      firstName: 'Kavita',
      lastName: 'Patel',
      email: `finance.head.${timestamp}@propvantage.com`,
      password: 'SecurePass123!',
      role: 'Finance Head',
    },
    {
      firstName: 'Rohit',
      lastName: 'Mehta',
      email: `project.dir.${timestamp}@propvantage.com`,
      password: 'SecurePass123!',
      role: 'Project Director',
    }
  ],

  // ENHANCED: Diverse project portfolio with different price segments
  projects: [
    {
      _id: new mongoose.Types.ObjectId(),
      name: 'Skyline Towers Premium',
      type: 'apartment',
      totalUnits: 400,
      targetRevenue: 12000000000, // 12000 Cr - Premium segment
      location: { 
        city: 'Mumbai', 
        area: 'Bandra West',
        pincode: '400050',
        landmark: 'Near Bandra-Kurla Complex'
      },
      pricingRules: { 
        gstRate: 5, 
        floorRiseCharge: 75000, 
        plcCharges: { 
          parkFacing: 500000,
          seaFacing: 1500000,
          roadFacing: 200000 
        } 
      },
      additionalCharges: [
        { name: 'Premium Clubhouse', amount: 500000 },
        { name: 'Parking (Covered)', amount: 350000 },
        { name: 'IFMS Charges', amount: 150000 }
      ],
      configuration: { 
        gym: 'Premium', 
        swimmingPool: 'Infinity Pool', 
        powerBackup: '100%',
        security: '24x7 with CCTV',
        elevators: '4 High-speed',
        amenities: 'Spa, Library, Party Hall, Kids Play Area'
      },
    },
    {
      _id: new mongoose.Types.ObjectId(),
      name: 'Green Valley Villas',
      type: 'villa',
      totalUnits: 75,
      targetRevenue: 4500000000, // 4500 Cr - Luxury segment
      location: { 
        city: 'Goa', 
        area: 'Candolim',
        pincode: '403515',
        landmark: 'Near Candolim Beach'
      },
      pricingRules: { 
        gstRate: 5, 
        plcCharges: { 
          beachFacing: 2000000,
          cornerUnit: 1000000,
          endUnit: 500000 
        } 
      },
      additionalCharges: [
        { name: 'Private Pool Maintenance', amount: 100000, type: 'yearly' },
        { name: 'Landscaping', amount: 250000 },
        { name: 'Smart Home Setup', amount: 200000 }
      ],
      configuration: { 
        privatePool: 'true', 
        gatedCommunity: 'true',
        beachAccess: 'Private',
        staff: 'Housekeeping included'
      },
    },
    {
      _id: new mongoose.Types.ObjectId(),
      name: 'Affordable Heights',
      type: 'apartment',
      totalUnits: 200,
      targetRevenue: 2000000000, // 2000 Cr - Affordable segment
      location: { 
        city: 'Pune', 
        area: 'Wagholi',
        pincode: '412207',
        landmark: 'Near IT Park'
      },
      pricingRules: { 
        gstRate: 1, // Under affordable housing scheme
        floorRiseCharge: 25000,
        plcCharges: { 
          parkFacing: 100000,
          mainRoadFacing: 150000 
        } 
      },
      additionalCharges: [
        { name: 'Basic Amenities', amount: 75000 },
        { name: 'Parking (Open)', amount: 100000 }
      ],
      configuration: { 
        gym: 'Basic', 
        playground: 'true', 
        powerBackup: 'Essential areas only' 
      },
    },
    {
      _id: new mongoose.Types.ObjectId(),
      name: 'Tech City Plots',
      type: 'plot',
      totalUnits: 180,
      targetRevenue: 1800000000, // 1800 Cr - Plot development
      location: { 
        city: 'Hyderabad', 
        area: 'HITEC City',
        pincode: '500081',
        landmark: 'Near Cyber Towers'
      },
      pricingRules: { 
        gstRate: 5,
        developmentCharges: 200000 
      },
      additionalCharges: [
        { name: 'Infrastructure Development', amount: 400000 },
        { name: 'Utilities Connection', amount: 150000 }
      ],
    }
  ],

  units: [],
  leads: [],
  interactions: [],
  sales: []
};

// --- GENERATE COMPREHENSIVE UNIT DATA ---

// Premium Skyline Towers (2 Towers, 20 floors, 10 units per floor)
['Tower-A', 'Tower-B'].forEach(tower => {
  for (let floor = 1; floor <= 20; floor++) {
    for (let unitNum = 1; unitNum <= 10; unitNum++) {
      const unitNumber = `${tower}-${floor}${String(unitNum).padStart(2, '0')}`;
      const unitType = unitNum <= 3 ? '2BHK' : unitNum <= 7 ? '3BHK' : '3BHK+Study';
      const baseAreas = { '2BHK': 1150, '3BHK': 1450, '3BHK+Study': 1650 };
      const basePrices = { '2BHK': 25000000, '3BHK': 32000000, '3BHK+Study': 38000000 };
      
      // Premium pricing with floor rise
      const floorMultiplier = 1 + (floor * 0.02); // 2% per floor
      const finalPrice = Math.round(basePrices[unitType] * floorMultiplier);
      
      sampleData.units.push({
        project: sampleData.projects[0]._id,
        unitNumber,
        type: unitType,
        floor,
        areaSqft: baseAreas[unitType] + Math.floor(Math.random() * 100),
        basePrice: finalPrice,
        currentPrice: finalPrice,
        facing: ['North', 'South', 'East', 'West', 'North-East', 'South-West'][unitNum % 6],
        features: { 
          isParkFacing: unitNum % 4 === 0,
          isCornerUnit: unitNum === 1 || unitNum === 10,
          hasBalcony: true,
          hasServantRoom: unitType === '3BHK+Study'
        },
        status: Math.random() > 0.3 ? 'available' : 'blocked' // 70% available
      });
    }
  }
});

// Luxury Green Valley Villas
for (let i = 1; i <= 75; i++) {
  const villaTypes = ['4BHK Villa', '5BHK Villa', '4BHK Duplex'];
  const villaType = villaTypes[Math.floor(Math.random() * villaTypes.length)];
  const baseAreas = { '4BHK Villa': 3200, '5BHK Villa': 4000, '4BHK Duplex': 3500 };
  const basePrices = { '4BHK Villa': 60000000, '5BHK Villa': 80000000, '4BHK Duplex': 70000000 };
  
  // Add premium for special features
  let premiumMultiplier = 1;
  const isBeachFacing = i <= 25;
  const isCornerUnit = i % 10 === 0;
  
  if (isBeachFacing) premiumMultiplier += 0.25; // 25% premium for beach facing
  if (isCornerUnit) premiumMultiplier += 0.15; // 15% premium for corner units
  
  sampleData.units.push({
    project: sampleData.projects[1]._id,
    unitNumber: `Villa-${String(i).padStart(3, '0')}`,
    type: villaType,
    floor: villaType.includes('Duplex') ? 2 : 1,
    areaSqft: baseAreas[villaType],
    basePrice: Math.round(basePrices[villaType] * premiumMultiplier),
    currentPrice: Math.round(basePrices[villaType] * premiumMultiplier),
    facing: isBeachFacing ? 'West' : ['North', 'South', 'East'][i % 3],
    features: { 
      isCornerUnit,
      isBeachFacing,
      hasPrivatePool: true,
      hasGarden: true,
      smartHome: Math.random() > 0.5
    },
    status: Math.random() > 0.2 ? 'available' : 'booked' // 80% available
  });
}

// Affordable Heights (10 floors, 20 units per floor)
for (let floor = 1; floor <= 10; floor++) {
  for (let unitNum = 1; unitNum <= 20; unitNum++) {
    const unitNumber = `AH-${floor}${String(unitNum).padStart(2, '0')}`;
    const unitType = unitNum <= 10 ? '1BHK' : unitNum <= 16 ? '2BHK' : '2BHK+Study';
    const baseAreas = { '1BHK': 550, '2BHK': 750, '2BHK+Study': 850 };
    const basePrices = { '1BHK': 3500000, '2BHK': 4500000, '2BHK+Study': 5200000 };
    
    sampleData.units.push({
      project: sampleData.projects[2]._id,
      unitNumber,
      type: unitType,
      floor,
      areaSqft: baseAreas[unitType],
      basePrice: basePrices[unitType] + (floor * 25000),
      currentPrice: basePrices[unitType] + (floor * 25000),
      facing: ['North', 'South', 'East', 'West'][unitNum % 4],
      features: { 
        isParkFacing: unitNum % 6 === 0,
        hasBalcony: unitType !== '1BHK'
      },
      status: Math.random() > 0.25 ? 'available' : 'sold' // 75% available
    });
  }
}

// Tech City Plots (varied sizes)
for (let i = 1; i <= 180; i++) {
  const plotSizes = [1200, 1500, 2000, 2400, 3000];
  const area = plotSizes[Math.floor(Math.random() * plotSizes.length)];
  const pricePerSqft = 5000 + Math.floor(Math.random() * 1000); // 5000-6000 per sqft
  
  sampleData.units.push({
    project: sampleData.projects[3]._id,
    unitNumber: `Plot-${String(i).padStart(3, '0')}`,
    type: 'Residential Plot',
    floor: 0,
    areaSqft: area,
    basePrice: area * pricePerSqft,
    currentPrice: area * pricePerSqft,
    features: { 
      isCornerPlot: i % 15 === 0,
      hasRoadAccess: true,
      isGatedCommunity: true
    },
    status: Math.random() > 0.4 ? 'available' : 'blocked' // 60% available
  });
}

// --- GENERATE REALISTIC LEAD DATA WITH DIVERSE SCENARIOS ---

const leadSources = ['Website', 'Property Portal', 'Referral', 'Walk-in', 'Social Media', 'Advertisement', 'Cold Call'];
const leadStatuses = ['New', 'Contacted', 'Qualified', 'Site Visit Scheduled', 'Site Visit Completed', 'Negotiating'];
const timelineOptions = ['immediate', '1-3_months', '3-6_months', '6-12_months', '12+_months'];
const unitTypes = ['2BHK', '3BHK', '3BHK+Study', '4BHK Villa', '1BHK', 'Any'];

// Generate leads with realistic distribution across projects
const leadDistribution = [
  { project: 0, count: 80 },  // Premium project - more leads
  { project: 1, count: 40 },  // Luxury villas - fewer but high-value leads
  { project: 2, count: 60 },  // Affordable - good volume
  { project: 3, count: 30 }   // Plots - niche market
];

leadDistribution.forEach(({ project, count }, projectIndex) => {
  for (let i = 0; i < count; i++) {
    const leadAge = Math.floor(Math.random() * 90); // 0-90 days old
    const createdDate = new Date();
    createdDate.setDate(createdDate.getDate() - leadAge);
    
    // Generate realistic budget based on project
    let budgetRange;
    switch (projectIndex) {
      case 0: // Premium
        budgetRange = { min: 20000000, max: 45000000 };
        break;
      case 1: // Luxury villas
        budgetRange = { min: 50000000, max: 90000000 };
        break;
      case 2: // Affordable
        budgetRange = { min: 3000000, max: 6000000 };
        break;
      case 3: // Plots
        budgetRange = { min: 8000000, max: 20000000 };
        break;
    }
    
    // Add some variation to budgets
    const budgetVariation = 0.2; // 20% variation
    let minBudget = Math.round(budgetRange.min * (1 + (Math.random() - 0.5) * budgetVariation));
    let maxBudget = Math.round(budgetRange.max * (1 + (Math.random() - 0.5) * budgetVariation));
    
    // Generate realistic name combinations
    const firstNames = ['Rajesh', 'Priya', 'Amit', 'Kavita', 'Suresh', 'Meera', 'Vikram', 'Anita', 'Ravi', 'Deepa', 
                       'Sanjay', 'Neha', 'Arun', 'Pooja', 'Manoj', 'Sunita', 'Kiran', 'Swati', 'Ashok', 'Rekha'];
    const lastNames = ['Sharma', 'Patel', 'Kumar', 'Singh', 'Gupta', 'Mehta', 'Jain', 'Shah', 'Agarwal', 'Bansal',
                      'Verma', 'Aggarwal', 'Joshi', 'Malhotra', 'Tiwari', 'Saxena', 'Pandey', 'Chopra', 'Sinha', 'Yadav'];
    
    const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
    const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
    const phoneNumber = `9${Math.floor(Math.random() * 900000000) + 100000000}`;
    
    // Determine lead quality scenario
    const scenarioType = Math.random();
    let leadScenario;
    
    if (scenarioType < 0.2) {
      leadScenario = 'hot'; // 20% hot leads
    } else if (scenarioType < 0.5) {
      leadScenario = 'warm'; // 30% warm leads
    } else if (scenarioType < 0.8) {
      leadScenario = 'cold'; // 30% cold leads
    } else {
      leadScenario = 'poor'; // 20% poor quality leads
    }
    
    // Set lead properties based on scenario
    let source, status, timeline, unitType, hasEmail;
    
    switch (leadScenario) {
      case 'hot':
        source = Math.random() > 0.5 ? 'Referral' : 'Walk-in';
        status = ['Qualified', 'Site Visit Scheduled', 'Site Visit Completed', 'Negotiating'][Math.floor(Math.random() * 4)];
        timeline = Math.random() > 0.7 ? 'immediate' : '1-3_months';
        hasEmail = true;
        break;
      case 'warm':
        source = ['Website', 'Property Portal', 'Referral'][Math.floor(Math.random() * 3)];
        status = ['Contacted', 'Qualified', 'Site Visit Scheduled'][Math.floor(Math.random() * 3)];
        timeline = ['1-3_months', '3-6_months'][Math.floor(Math.random() * 2)];
        hasEmail = Math.random() > 0.3;
        break;
      case 'cold':
        source = ['Website', 'Property Portal', 'Social Media'][Math.floor(Math.random() * 3)];
        status = ['New', 'Contacted'][Math.floor(Math.random() * 2)];
        timeline = ['3-6_months', '6-12_months'][Math.floor(Math.random() * 2)];
        hasEmail = Math.random() > 0.5;
        break;
      case 'poor':
        source = ['Cold Call', 'Advertisement', 'Social Media'][Math.floor(Math.random() * 3)];
        status = 'New';
        timeline = '12+_months';
        hasEmail = Math.random() > 0.7;
        minBudget = Math.round(minBudget * 0.6); // Lower budget
        break;
    }
    
    // Enhanced lead object with AI scoring fields
    const lead = {
      project: sampleData.projects[project]._id,
      firstName,
      lastName,
      email: hasEmail ? `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.com` : null,
      phone: phoneNumber,
      source,
      status,
      
      // Enhanced budget information
      budget: {
        min: minBudget,
        max: maxBudget,
        isValidated: leadScenario === 'hot',
        budgetSource: leadScenario === 'hot' ? 'loan_approved' : 'self_reported',
        currency: 'INR',
        lastUpdated: createdDate
      },
      
      // Enhanced requirements
      requirements: {
        timeline,
        unitType: unitTypes[Math.floor(Math.random() * unitTypes.length)],
        floor: {
          preference: ['low', 'medium', 'high', 'any'][Math.floor(Math.random() * 4)]
        },
        facing: ['North', 'South', 'East', 'West', 'Any'][Math.floor(Math.random() * 5)],
        amenities: projectIndex === 1 ? ['Private Pool', 'Garden'] : 
                  projectIndex === 0 ? ['Gym', 'Swimming Pool'] : 
                  ['Parking', 'Security']
      },
      
      // Initialize scoring fields
      score: 0,
      scoreGrade: 'D',
      priority: 'Very Low',
      confidence: 60,
      lastScoreUpdate: createdDate,
      
      // Enhanced engagement metrics
      engagementMetrics: {
        totalInteractions: 0,
        responseRate: leadScenario === 'hot' ? 90 : leadScenario === 'warm' ? 70 : 40,
        preferredContactMethod: ['phone', 'email', 'whatsapp'][Math.floor(Math.random() * 3)]
      },
      
      // Follow-up scheduling
      followUpSchedule: leadScenario !== 'poor' ? {
        nextFollowUpDate: new Date(createdDate.getTime() + Math.random() * 7 * 24 * 60 * 60 * 1000), // Within next 7 days
        followUpType: 'call',
        notes: `Follow up on ${timeline} timeline interest`
      } : {},
      
      // Marketing attribution
      attribution: {
        campaign: source === 'Website' ? 'Digital Campaign Q4' : 
                 source === 'Social Media' ? 'Facebook Ads' : 
                 source === 'Advertisement' ? 'Print Media' : null,
        medium: source.toLowerCase().replace(' ', '_'),
        source: source.toLowerCase(),
        touchpointCount: Math.floor(Math.random() * 3) + 1
      },
      
      // Activity summary
      activitySummary: {
        callsCount: 0,
        emailsCount: 0,
        meetingsCount: 0,
        siteVisitsCount: 0
      },
      
      notes: `Generated lead for ${sampleData.projects[project].name}. ${leadScenario} quality lead with ${timeline} timeline.`,
      
      createdAt: createdDate,
      updatedAt: createdDate
    };
    
    sampleData.leads.push(lead);
  }
});

// --- GENERATE REALISTIC INTERACTION DATA ---

// Generate interactions for existing leads (focusing on non-new leads)
const generateInteractions = (leadIndex, leadData) => {
  const interactionTypes = ['Call', 'Email', 'SMS', 'Meeting', 'Site Visit', 'WhatsApp'];
  const callOutcomes = ['Interested', 'Not available', 'Call back later', 'Very interested', 'Not interested', 'Busy'];
  const emailTypes = ['Follow-up', 'Brochure sent', 'Price details', 'Site visit invitation'];
  
  // Generate 0-8 interactions per lead based on status
  let interactionCount;
  switch (leadData.status) {
    case 'New': interactionCount = Math.random() > 0.7 ? 1 : 0; break;
    case 'Contacted': interactionCount = Math.floor(Math.random() * 3) + 1; break;
    case 'Qualified': interactionCount = Math.floor(Math.random() * 4) + 2; break;
    case 'Site Visit Scheduled': interactionCount = Math.floor(Math.random() * 5) + 3; break;
    case 'Site Visit Completed': interactionCount = Math.floor(Math.random() * 6) + 4; break;
    case 'Negotiating': interactionCount = Math.floor(Math.random() * 8) + 5; break;
    default: interactionCount = 0;
  }
  
  for (let i = 0; i < interactionCount; i++) {
    const interactionDate = new Date(leadData.createdAt);
    interactionDate.setDate(interactionDate.getDate() + Math.floor(Math.random() * 
      Math.max(1, (new Date() - leadData.createdAt) / (24 * 60 * 60 * 1000))));
    
    const type = interactionTypes[Math.floor(Math.random() * interactionTypes.length)];
    
    const interaction = {
      leadIndex, // We'll replace with actual lead ID later
      type,
      direction: type === 'Email' ? (Math.random() > 0.7 ? 'Inbound' : 'Outbound') : 'Outbound',
      content: type === 'Call' ? `Call regarding ${leadData.requirements.unitType} requirement` :
               type === 'Email' ? emailTypes[Math.floor(Math.random() * emailTypes.length)] :
               type === 'Site Visit' ? `Site visit for ${sampleData.projects.find(p => p._id.equals(leadData.project)).name}` :
               `${type} interaction with ${leadData.firstName}`,
      outcome: type === 'Call' ? callOutcomes[Math.floor(Math.random() * callOutcomes.length)] :
               type === 'Site Visit' ? 'Completed successfully' : 'Positive response',
      nextAction: i === interactionCount - 1 ? 'Schedule follow-up call' : null,
      createdAt: interactionDate,
      updatedAt: interactionDate
    };
    
    sampleData.interactions.push(interaction);
  }
};

// Generate interactions for each lead
sampleData.leads.forEach((lead, index) => {
  generateInteractions(index, lead);
});

// --- DATABASE OPERATIONS WITH ENHANCED ERROR HANDLING ---

const importData = async () => {
  try {
    console.log('🚀 Starting enhanced data import...');
    
    // Clear existing data with confirmation
    console.log('🧹 Clearing existing data...');
    await Sale.deleteMany();
    await Interaction.deleteMany();
    await Lead.deleteMany();
    await Unit.deleteMany();
    await Project.deleteMany();
    await User.deleteMany();
    await Organization.deleteMany();
    console.log('✅ Existing data cleared');

    // Create Organization
    console.log('🏢 Creating organization...');
    const createdOrg = await Organization.create(sampleData.organization);
    console.log(`✅ Organization created: ${createdOrg.name}`);

    // Create Users with enhanced error handling
    console.log('👥 Creating users...');
    const createdUsers = [];
    for (const [index, userData] of sampleData.users.entries()) {
      try {
        const userWithOrg = { ...userData, organization: createdOrg._id };
        const createdUser = await User.create(userWithOrg);
        createdUsers.push(createdUser);
        console.log(`✅ User ${index + 1}/${sampleData.users.length}: ${createdUser.firstName} ${createdUser.lastName} (${createdUser.role})`);
      } catch (userError) {
        console.error(`❌ Failed to create user ${index + 1}:`, userError.message);
      }
    }

    // Create Projects
    console.log('🏗️ Creating projects...');
    const projectsWithOrg = sampleData.projects.map(p => ({ ...p, organization: createdOrg._id }));
    const createdProjects = await Project.insertMany(projectsWithOrg);
    console.log(`✅ ${createdProjects.length} projects created`);

    // Create Units
    console.log('🏠 Creating units...');
    const unitsWithOrg = sampleData.units.map(u => ({ ...u, organization: createdOrg._id }));
    const createdUnits = await Unit.insertMany(unitsWithOrg);
    console.log(`✅ ${createdUnits.length} units created`);

    // Create Leads with assignment to sales executives
    console.log('🎯 Creating leads...');
    const salesExecutives = createdUsers.filter(u => u.role === 'Sales Executive');
    const salesManager = createdUsers.find(u => u.role === 'Sales Manager');
    
    const leadsWithOrg = sampleData.leads.map((lead, index) => {
      // Assign leads to sales executives (round-robin)
      const assignedTo = salesExecutives.length > 0 ? 
        salesExecutives[index % salesExecutives.length]._id : 
        salesManager?._id || null;
      
      return {
        ...lead,
        organization: createdOrg._id,
        assignedTo
      };
    });
    
    const createdLeads = await Lead.insertMany(leadsWithOrg);
    console.log(`✅ ${createdLeads.length} leads created and assigned`);

    // Create Interactions
    console.log('💬 Creating interactions...');
    const interactionsWithData = sampleData.interactions.map(interaction => {
      const lead = createdLeads[interaction.leadIndex];
      const assignedUser = lead.assignedTo || createdUsers[0]._id;
      
      return {
        ...interaction,
        lead: lead._id,
        user: assignedUser,
        organization: createdOrg._id
      };
    });
    
    delete interactionsWithData.forEach(i => delete i.leadIndex); // Remove temp field
    const createdInteractions = await Interaction.insertMany(interactionsWithData);
    console.log(`✅ ${createdInteractions.length} interactions created`);

    // Create realistic sales data
    console.log('💰 Creating sample sales...');
    const availableUnits = await Unit.find({ status: 'available' }).limit(25);
    const qualifiedLeads = await Lead.find({ 
      status: { $in: ['Qualified', 'Site Visit Completed', 'Negotiating'] } 
    }).limit(25);
    
    if (availableUnits.length > 0 && qualifiedLeads.length > 0) {
      const numSales = Math.min(availableUnits.length, qualifiedLeads.length, 20);
      const salesData = [];
      
      for (let i = 0; i < numSales; i++) {
        const unit = availableUnits[i];
        const lead = qualifiedLeads[i];
        const salesPerson = lead.assignedTo || salesExecutives[0]._id;
        
        // Create realistic sale price (base price + some negotiation)
        const negotiationFactor = 0.95 + (Math.random() * 0.1); // 95% to 105% of base price
        const salePrice = Math.round(unit.currentPrice * negotiationFactor);
        
        const sale = {
          project: unit.project,
          unit: unit._id,
          lead: lead._id,
          organization: createdOrg._id,
          salesPerson,
          salePrice,
          costSheetSnapshot: {
            basePrice: unit.currentPrice,
            negotiatedPrice: salePrice,
            additionalCharges: 500000,
            gst: Math.round(salePrice * 0.05),
            totalAmount: Math.round(salePrice * 1.05) + 500000,
            timestamp: new Date()
          },
          bookingDate: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000), // Last 30 days
          status: 'Booked'
        };
        
        salesData.push(sale);
        
        // Update unit and lead status
        unit.status = 'sold';
        await unit.save();
        
        lead.status = 'Booked';
        await lead.save();
      }
      
      await Sale.insertMany(salesData);
      console.log(`✅ ${salesData.length} sample sales created`);
    }

    // Calculate initial lead scores
    console.log('🔢 Calculating initial lead scores...');
    try {
      const { updateLeadScore } = await import('../services/leadScoringService.js');
      let scoredCount = 0;
      
      for (const lead of createdLeads) {
        try {
          await updateLeadScore(lead._id);
          scoredCount++;
          if (scoredCount % 10 === 0) {
            console.log(`📊 Scored ${scoredCount}/${createdLeads.length} leads`);
          }
        } catch (scoreError) {
          console.warn(`⚠️ Could not score lead ${lead._id}: ${scoreError.message}`);
        }
      }
      console.log(`✅ ${scoredCount} leads scored successfully`);
    } catch (scoringError) {
      console.warn('⚠️ Lead scoring service not available, skipping initial scoring');
    }

    // Print summary
    console.log('\n🎉 Data import completed successfully!');
    console.log('📊 Summary:');
    console.log(`   Organization: ${createdOrg.name}`);
    console.log(`   Users: ${createdUsers.length}`);
    console.log(`   Projects: ${createdProjects.length}`);
    console.log(`   Units: ${createdUnits.length}`);
    console.log(`   Leads: ${createdLeads.length}`);
    console.log(`   Interactions: ${createdInteractions.length}`);
    console.log(`   Sales: ${await Sale.countDocuments()}`);
    
    console.log('\n🔑 Login Credentials:');
    console.log(`   Business Head: ${createdUsers[0]?.email} / SecurePass123!`);
    console.log(`   Sales Executive 1: ${createdUsers[3]?.email} / SecurePass123!`);
    console.log(`   Sales Executive 2: ${createdUsers[4]?.email} / SecurePass123!`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Error during data import:', error);
    process.exit(1);
  }
};

const destroyData = async () => {
  try {
    console.log('🗑️ Starting data destruction...');
    
    await Sale.deleteMany();
    await Interaction.deleteMany();
    await Lead.deleteMany();
    await Unit.deleteMany();
    await Project.deleteMany();
    await User.deleteMany();
    await Organization.deleteMany();

    console.log('✅ All data destroyed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during data destruction:', error);
    process.exit(1);
  }
};

// Command line execution
if (process.argv[2] === '-d') {
  destroyData();
} else {
  importData();
}