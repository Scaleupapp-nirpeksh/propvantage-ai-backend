// File: data/seeder.js
// Description: Enhanced robust seeder with comprehensive test data for AI scoring system + AI Conversation
// Version: 2.1 - Complete data seeding with realistic scenarios + AI conversation content
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

// --- AI CONVERSATION TEMPLATES ---

// Realistic conversation templates for different interaction types
const conversationTemplates = {
  initial_call: [
    "Hello {firstName}, this is {salesPerson} from {projectName}. I understand you're interested in our property. What specific requirements are you looking for?",
    "Customer: Hi, yes I saw your advertisement. I'm looking for a {unitType} within my budget of {budget}.",
    "That's great! Our {projectName} has excellent {unitType} options. The location offers great connectivity and premium amenities. When would be a good time for you to visit our site?",
    "Customer: I'm quite busy this week, but maybe next weekend would work. What's the price range we're talking about?",
    "For {unitType} units, we're looking at {priceRange}. This includes all premium amenities and we have flexible payment plans. Would you like me to send you the detailed brochure?",
    "Customer: Yes, please send me the details. I'll discuss with my family and get back to you."
  ],
  
  follow_up_call: [
    "Hi {firstName}, I had sent you the brochure for {projectName} last week. Were you able to review it?",
    "Customer: Yes, I looked at it. The project looks nice but the price is a bit higher than I expected.",
    "I understand your concern about pricing. Let me explain the value proposition - we have {amenities} and the location will see significant appreciation. Also, if you decide this month, I can offer you a special discount.",
    "Customer: What kind of discount are we talking about? And what about the loan arrangements?",
    "We can offer up to 2-3% discount on the base price, and we have tie-ups with major banks for easy loan approval. Our loan officer can help you with pre-approval. When can you visit our site?",
    "Customer: Let me check with my wife and get back to you in a couple of days."
  ],
  
  site_visit: [
    "Welcome to {projectName}, {firstName}! I'm excited to show you around. Which unit configuration were you most interested in?",
    "Customer: We're looking at the {unitType}. The layout looks good in the brochure, but I want to see the actual space and check the view.",
    "Perfect! Let me show you our sample flat first, and then we can visit the actual units available on different floors. You'll love the {facing} facing units.",
    "Customer: This is quite spacious! What about the amenities? When will the gym and swimming pool be ready?",
    "All amenities will be completed 6 months before possession. The gym will be fully equipped and the swimming pool is going to be our highlight feature. What do you think about the overall space?",
    "Customer: It's good. We like it. What are the next steps if we decide to book?"
  ],
  
  negotiation: [
    "Hi {firstName}, I understand you're interested in booking the {unitType} unit we showed you. Have you made a decision?",
    "Customer: We really like the property, but we need to discuss the pricing. The total cost is coming to {totalPrice} which is stretching our budget.",
    "I appreciate your honesty. Let me see what I can do. Since you've been seriously considering this for a while, I can speak to my manager about additional discount options.",
    "Customer: We were hoping to get it closer to {targetPrice}. Is that possible?",
    "That's quite a stretch, but let me make some calls. I can possibly offer you {discount}% additional discount and also waive some charges. This would bring it down significantly.",
    "Customer: That sounds better. Can you give me the revised quotation? Also, what about the payment schedule?"
  ],
  
  objection_handling: [
    "Hi {firstName}, I noticed you haven't gotten back to me since our site visit. Is there anything specific you'd like to discuss?",
    "Customer: Well, we're concerned about the construction timeline. What if there are delays?",
    "That's a very valid concern. We have a track record of timely delivery - our last 3 projects were completed on schedule. Plus, we provide delay compensation if we miss the promised date.",
    "Customer: What about the resale value? The area is still developing.",
    "Actually, that's the best part! You're getting in early before the area fully develops. The metro connectivity coming up will increase property values by at least 20-30% in 2 years.",
    "Customer: Hmm, that sounds promising. But the EMI along with rent is going to be tough for us.",
    "I understand. Have you considered our subvention scheme? The builder pays your EMI for the first 12 months. This way you don't pay both rent and EMI.",
    "Customer: That's interesting. Can you send me more details about this scheme?"
  ],
  
  closing_attempt: [
    "Hi {firstName}, I have some great news! The {unitType} unit you liked is still available, but we have only 2 units left in that configuration.",
    "Customer: Oh, I was planning to decide by next month. Are you sure it won't be available?",
    "We've had a lot of inquiries this week. To secure the unit, we'd need at least the booking amount. I can also offer you our festive discount if you book today.",
    "Customer: What's the booking amount and what's this festive discount?",
    "Booking amount is just {bookingAmount}, fully adjustable against the total price. The festive discount is {discount}% off, which saves you around {savings}.",
    "Customer: That's a substantial saving. What if we change our mind?",
    "You have a 30-day cooling period where you can cancel and get a full refund if you're not satisfied. But I'm confident you'll love being part of our community.",
    "Customer: Alright, let's go ahead with the booking. What documents do I need?"
  ]
};

// Function to generate realistic conversation content
const generateConversationContent = (template, leadData, projectData, interactionType) => {
  const salesPersonNames = ['Rahul Kumar', 'Priya Singh', 'Amit Sharma', 'Kavita Patel'];
  const salesPerson = salesPersonNames[Math.floor(Math.random() * salesPersonNames.length)];
  
  // Calculate price ranges based on project
  let priceRange, bookingAmount, discount, savings;
  const budget = leadData.budget ? `₹${(leadData.budget.min / 10000000).toFixed(1)}-${(leadData.budget.max / 10000000).toFixed(1)} Cr` : '₹50-80 Lakhs';
  
  switch (projectData.name) {
    case 'Skyline Towers Premium':
      priceRange = '₹2.5-4 Cr';
      bookingAmount = '₹5 Lakhs';
      discount = '3';
      savings = '₹9 Lakhs';
      break;
    case 'Green Valley Villas':
      priceRange = '₹6-9 Cr';
      bookingAmount = '₹10 Lakhs';
      discount = '2';
      savings = '₹12 Lakhs';
      break;
    case 'Affordable Heights':
      priceRange = '₹35-55 Lakhs';
      bookingAmount = '₹2 Lakhs';
      discount = '4';
      savings = '₹1.8 Lakhs';
      break;
    default:
      priceRange = '₹1-3 Cr';
      bookingAmount = '₹3 Lakhs';
      discount = '2.5';
      savings = '₹5 Lakhs';
  }
  
  const replacements = {
    '{firstName}': leadData.firstName,
    '{salesPerson}': salesPerson,
    '{projectName}': projectData.name,
    '{unitType}': leadData.requirements?.unitType || '3BHK',
    '{budget}': budget,
    '{priceRange}': priceRange,
    '{amenities}': projectData.configuration?.gym ? 'gym, swimming pool, and clubhouse' : 'basic amenities',
    '{facing}': leadData.requirements?.facing || 'East',
    '{totalPrice}': priceRange,
    '{targetPrice}': budget,
    '{discount}': discount,
    '{bookingAmount}': bookingAmount,
    '{savings}': savings
  };
  
  let conversation = template.join('\n\n');
  
  // Replace placeholders
  Object.keys(replacements).forEach(placeholder => {
    conversation = conversation.replace(new RegExp(placeholder, 'g'), replacements[placeholder]);
  });
  
  return conversation;
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

// --- ENHANCED INTERACTION DATA WITH CONVERSATION CONTENT ---

// Enhanced interaction generation with conversation content
const generateEnhancedInteractions = (leadIndex, leadData, projectData) => {
  const interactionTypes = [
    { type: 'Call', weight: 0.4, hasConversation: true },
    { type: 'Email', weight: 0.25, hasConversation: false },
    { type: 'WhatsApp', weight: 0.15, hasConversation: true },
    { type: 'Meeting', weight: 0.15, hasConversation: true },
    { type: 'Site Visit', weight: 0.05, hasConversation: true }
  ];
  
  const callOutcomes = ['connected', 'not_answered', 'busy', 'callback_requested'];
  const callSentiments = ['positive', 'neutral', 'negative'];
  
  // Generate interaction count based on lead status and scenario
  let interactionCount;
  const leadScenario = leadData.notes?.includes('hot') ? 'hot' : 
                      leadData.notes?.includes('warm') ? 'warm' : 
                      leadData.notes?.includes('cold') ? 'cold' : 'poor';
  
  switch (leadData.status) {
    case 'New': 
      interactionCount = leadScenario === 'poor' ? 0 : Math.floor(Math.random() * 2); 
      break;
    case 'Contacted': 
      interactionCount = Math.floor(Math.random() * 3) + 1; 
      break;
    case 'Qualified': 
      interactionCount = Math.floor(Math.random() * 4) + 2; 
      break;
    case 'Site Visit Scheduled': 
      interactionCount = Math.floor(Math.random() * 5) + 3; 
      break;
    case 'Site Visit Completed': 
      interactionCount = Math.floor(Math.random() * 6) + 4; 
      break;
    case 'Negotiating': 
      interactionCount = Math.floor(Math.random() * 8) + 5; 
      break;
    default: 
      interactionCount = 0;
  }
  
  const interactions = [];
  
  for (let i = 0; i < interactionCount; i++) {
    const interactionDate = new Date(leadData.createdAt);
    const dayOffset = Math.floor((i + 1) * (Math.max(1, (new Date() - leadData.createdAt) / (24 * 60 * 60 * 1000)) / interactionCount));
    interactionDate.setDate(interactionDate.getDate() + dayOffset);
    
    // Select interaction type based on weights and progression
    let selectedType;
    if (i === 0) {
      selectedType = 'Call'; // First interaction is usually a call
    } else if (leadData.status === 'Site Visit Scheduled' || leadData.status === 'Site Visit Completed') {
      selectedType = Math.random() > 0.3 ? 'Call' : 'Site Visit';
    } else if (leadData.status === 'Negotiating') {
      selectedType = Math.random() > 0.2 ? 'Call' : 'Meeting';
    } else {
      const rand = Math.random();
      if (rand < 0.5) selectedType = 'Call';
      else if (rand < 0.7) selectedType = 'Email';
      else if (rand < 0.85) selectedType = 'WhatsApp';
      else selectedType = 'Meeting';
    }
    
    // Determine conversation template based on interaction progression
    let conversationTemplate;
    if (i === 0) {
      conversationTemplate = 'initial_call';
    } else if (leadData.status === 'Negotiating') {
      conversationTemplate = Math.random() > 0.5 ? 'negotiation' : 'closing_attempt';
    } else if (leadData.status === 'Site Visit Completed' || leadData.status === 'Site Visit Scheduled') {
      conversationTemplate = selectedType === 'Site Visit' ? 'site_visit' : 'follow_up_call';
    } else if (Math.random() > 0.7) {
      conversationTemplate = 'objection_handling';
    } else {
      conversationTemplate = 'follow_up_call';
    }
    
    // Generate conversation content
    let conversationContent = '';
    let summary = '';
    let outcome = 'completed';
    let sentiment = 'neutral';
    let duration = null;
    
    if (selectedType === 'Call') {
      outcome = callOutcomes[Math.floor(Math.random() * callOutcomes.length)];
      duration = outcome === 'connected' ? Math.floor(Math.random() * 25) + 5 : 0; // 5-30 minutes
      sentiment = outcome === 'connected' ? 
        (leadScenario === 'hot' ? 'positive' : 
         leadScenario === 'warm' ? (Math.random() > 0.3 ? 'positive' : 'neutral') :
         callSentiments[Math.floor(Math.random() * callSentiments.length)]) : 'neutral';
      
      if (outcome === 'connected') {
        conversationContent = generateConversationContent(
          conversationTemplates[conversationTemplate], 
          leadData, 
          projectData, 
          selectedType
        );
        summary = `${duration}-minute call discussing ${leadData.requirements?.unitType || '3BHK'} requirements. Customer showed ${sentiment} interest.`;
      } else {
        summary = `Call attempt - ${outcome.replace('_', ' ')}`;
      }
    } else if (selectedType === 'WhatsApp') {
      conversationContent = `Sales: Hi ${leadData.firstName}, this is regarding ${projectData.name}. Are you still interested in ${leadData.requirements?.unitType || '3BHK'} units?\n\nCustomer: Yes, but I have some questions about pricing and payment plans.\n\nSales: I'd be happy to help! Can we schedule a call to discuss in detail?\n\nCustomer: Sure, let's talk tomorrow evening.`;
      summary = 'WhatsApp conversation about pricing and payment plans';
      sentiment = 'positive';
    } else if (selectedType === 'Email') {
      summary = i === 0 ? 'Initial welcome email with project brochure' :
                i === 1 ? 'Follow-up email with floor plans and pricing' :
                Math.random() > 0.5 ? 'Payment plan and loan assistance details' : 'Site visit invitation';
      sentiment = 'neutral';
    } else if (selectedType === 'Meeting' || selectedType === 'Site Visit') {
      conversationContent = generateConversationContent(
        conversationTemplates[selectedType === 'Site Visit' ? 'site_visit' : conversationTemplate], 
        leadData, 
        projectData, 
        selectedType
      );
      summary = selectedType === 'Site Visit' ? 
        `Site visit completed. Customer liked the ${leadData.requirements?.unitType || '3BHK'} unit.` :
        'Office meeting to discuss project details and address concerns';
      sentiment = leadScenario === 'hot' ? 'positive' : 
                 leadScenario === 'warm' ? 'positive' : 
                 Math.random() > 0.4 ? 'positive' : 'neutral';
      duration = selectedType === 'Site Visit' ? Math.floor(Math.random() * 60) + 30 : Math.floor(Math.random() * 45) + 15;
    }
    
    const interaction = {
      leadIndex,
      type: selectedType,
      direction: 'Outbound',
      content: conversationContent || summary, // Use content instead of notes
      outcome: outcome,
      nextAction: i === interactionCount - 1 ? 
        (leadData.status === 'Negotiating' ? 'Send revised quotation' : 
         leadData.status === 'Site Visit Scheduled' ? 'Confirm site visit timing' :
         'Schedule follow-up call in 3 days') : null,
      
      // Additional fields that may be useful but not in the schema
      summary: summary,
      duration: duration,
      sentiment: sentiment,
      followUpRequired: i === interactionCount - 1 && leadData.status !== 'Booked',
      
      // AI-relevant metadata
      aiMetadata: {
        keyTopics: selectedType === 'Call' && outcome === 'connected' ? 
          ['pricing', 'amenities', 'location', 'timeline'] : [],
        buyingSignals: sentiment === 'positive' ? 
          ['asked about pricing', 'interested in site visit', 'discussed timeline'] : [],
        objections: sentiment === 'negative' ? 
          ['price too high', 'location concerns', 'timeline issues'] : [],
        nextStepSuggested: i === interactionCount - 1,
        conversationQuality: outcome === 'connected' ? 'high' : 'low'
      },
      
      createdAt: interactionDate,
      updatedAt: interactionDate
    };
    
    interactions.push(interaction);
  }
  
  return interactions;
};

// Generate enhanced interactions for each lead
sampleData.leads.forEach((lead, index) => {
  const projectData = sampleData.projects.find(p => p._id.equals(lead.project));
  const enhancedInteractions = generateEnhancedInteractions(index, lead, projectData);
  sampleData.interactions.push(...enhancedInteractions);
});

// --- DATABASE OPERATIONS WITH ENHANCED ERROR HANDLING ---

const importData = async () => {
  try {
    console.log('🚀 Starting enhanced data import with AI conversation content...');
    
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

    // Create Enhanced Interactions with Conversation Content
    console.log('💬 Creating interactions with AI conversation content...');
    const interactionsWithData = sampleData.interactions.map(interaction => {
      const lead = createdLeads[interaction.leadIndex];
      const assignedUser = lead.assignedTo || createdUsers[0]._id;
      
      // Remove the leadIndex property and add proper references
      const { leadIndex, summary, duration, sentiment, followUpRequired, aiMetadata, ...interactionData } = interaction;
      
      return {
        ...interactionData,
        lead: lead._id,
        user: assignedUser, // Use 'user' instead of 'createdBy'
        organization: createdOrg._id
      };
    });
    
    const createdInteractions = await Interaction.insertMany(interactionsWithData);
    console.log(`✅ ${createdInteractions.length} interactions with conversation content created`);

    // Add summary of conversation content
    const conversationInteractions = createdInteractions.filter(i => i.content && i.content.length > 100);
    console.log(`📝 ${conversationInteractions.length} interactions contain detailed conversation content for AI analysis`);

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
    
    // Enhanced AI-specific summary
    console.log('\n🤖 AI Conversation Features Ready:');
    console.log(`   Interactions with conversation content: ${conversationInteractions.length}`);
    console.log(`   Average conversation length: ${Math.round(conversationInteractions.reduce((sum, i) => sum + i.content.length, 0) / conversationInteractions.length)} characters`);
    console.log(`   Call interactions: ${createdInteractions.filter(i => i.type === 'Call').length}`);
    console.log(`   Connected calls with conversations: ${createdInteractions.filter(i => i.type === 'Call' && i.outcome === 'connected').length}`);
    console.log(`   Site visit interactions: ${createdInteractions.filter(i => i.type === 'Site Visit').length}`);
    console.log(`   WhatsApp conversations: ${createdInteractions.filter(i => i.type === 'WhatsApp').length}`);
    console.log(`   Email interactions: ${createdInteractions.filter(i => i.type === 'Email').length}`);
    
    console.log('\n🔑 Login Credentials:');
    console.log(`   Business Head: ${createdUsers[0]?.email} / SecurePass123!`);
    console.log(`   Sales Executive 1: ${createdUsers[3]?.email} / SecurePass123!`);
    console.log(`   Sales Executive 2: ${createdUsers[4]?.email} / SecurePass123!`);

    console.log('\n🚀 AI Testing Ready:');
    console.log('   • Conversation Analysis: Real conversation content available');
    console.log('   • Sentiment Detection: Positive/Neutral/Negative sentiments included');
    console.log('   • Buying Signals: Embedded in conversation templates');
    console.log('   • Objection Handling: Common real estate objections included');
    console.log('   • Follow-up Recommendations: Next actions suggested');
    console.log('   • Interaction Patterns: Multi-touch customer journeys');
    console.log('\n🧪 Test the AI features: node tests/aiConversationTest.js');

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