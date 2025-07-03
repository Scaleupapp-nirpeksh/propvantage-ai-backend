// File: data/seeder.js
// Description: A script to seed the database with a large amount of sample data.

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

dotenv.config();
connectDB();

// --- SAMPLE DATA ---
// This is where you can define all the data you want to seed.

const orgName = `Mega Builders ${Date.now()}`;
const adminEmail = `ceo.${Date.now()}@megabuilders.com`;
const salesManagerEmail = `manager.sales.${Date.now()}@megabuilders.com`;
const salesExecEmail = `sales.exec.${Date.now()}@megabuilders.com`;

const sampleData = {
  organization: {
    name: orgName,
    country: 'India',
    city: 'Mumbai',
    type: 'builder',
  },
  users: [
    {
      firstName: 'Rohan',
      lastName: 'Mehra',
      email: adminEmail,
      password: 'password123',
      role: 'Business Head',
    },
    {
      firstName: 'Vikram',
      lastName: 'Singh',
      email: salesManagerEmail,
      password: 'password123',
      role: 'Sales Manager',
    },
    {
      firstName: 'Priya',
      lastName: 'Sharma',
      email: salesExecEmail,
      password: 'password123',
      role: 'Sales Executive',
    },
  ],
  projects: [
    {
      _id: new mongoose.Types.ObjectId(),
      name: 'Skyline Towers',
      type: 'apartment',
      totalUnits: 400,
      targetRevenue: 8000000000,
      location: { city: 'Mumbai' },
      pricingRules: { gstRate: 5, floorRiseCharge: 50000, plcCharges: { parkFacing: 200000 } },
      additionalCharges: [{ name: 'Clubhouse Membership', amount: 250000 }],
      configuration: { gym: 'true', swimmingPool: 'true', powerBackup: '100%' },
    },
    {
      _id: new mongoose.Types.ObjectId(),
      name: 'Orchid Villas',
      type: 'villa',
      totalUnits: 50,
      targetRevenue: 2500000000,
      location: { city: 'Goa' },
      pricingRules: { gstRate: 5, plcCharges: { cornerUnit: 1000000 } },
      additionalCharges: [{ name: 'Private Garden Maintenance', amount: 50000, type: 'yearly' }],
      configuration: { privatePool: 'true', gatedCommunity: 'true' },
    },
    {
      _id: new mongoose.Types.ObjectId(),
      name: 'Serene Acres',
      type: 'plot',
      totalUnits: 150,
      targetRevenue: 1200000000,
      location: { city: 'Hyderabad' },
      pricingRules: { gstRate: 5 },
      additionalCharges: [{ name: 'Infrastructural Development', amount: 300000 }],
    },
  ],
  units: [],
  leads: [],
};

// --- DYNAMIC DATA GENERATION ---

// For Skyline Towers (2 Towers, 20 floors each, 10 units per floor)
['A', 'B'].forEach(tower => {
  for (let floor = 1; floor <= 20; floor++) {
    for (let unitNum = 1; unitNum <= 10; unitNum++) {
      const unitNumber = `${tower}-${floor}${String(unitNum).padStart(2, '0')}`;
      const is2BHK = unitNum <= 4;
      sampleData.units.push({
        project: sampleData.projects[0]._id,
        unitNumber: unitNumber,
        type: is2BHK ? '2BHK' : '3BHK',
        floor: floor,
        areaSqft: is2BHK ? 1250 : 1650,
        basePrice: (is2BHK ? 18000000 : 22000000) + (floor * 50000),
        currentPrice: (is2BHK ? 18000000 : 22000000) + (floor * 50000),
        facing: ['East', 'West', 'North', 'South'][unitNum % 4],
        features: { isParkFacing: unitNum % 3 === 0 },
      });
    }
  }
});

// For Orchid Villas (50 villas)
for (let i = 1; i <= 50; i++) {
  sampleData.units.push({
    project: sampleData.projects[1]._id,
    unitNumber: `V-${i}`,
    type: '4BHK Villa',
    floor: 2,
    areaSqft: 3500,
    basePrice: 50000000,
    currentPrice: 50000000,
    features: { isCornerUnit: i % 5 === 0 },
  });
}

// For Serene Acres (150 plots)
for (let i = 1; i <= 150; i++) {
  const area = 1500 + Math.floor(Math.random() * 10) * 100;
  sampleData.units.push({
    project: sampleData.projects[2]._id,
    unitNumber: `P-${i}`,
    type: 'Residential Plot',
    floor: 0,
    areaSqft: area,
    basePrice: area * 4000,
    currentPrice: area * 4000,
  });
}

// Generate sample leads
for (let i = 0; i < 50; i++) { // Increased leads to 50
    sampleData.leads.push({
        project: sampleData.projects[0]._id, // All leads for Skyline Towers
        firstName: `LeadUser${i}`,
        phone: `98765432${String(i).padStart(2, '0')}`,
        source: i % 2 === 0 ? 'Website' : 'Property Portal',
        status: i < 25 ? 'Contacted' : 'New', // Increased contacted leads
    });
}


// --- DATABASE OPERATIONS ---

const importData = async () => {
  try {
    // Clear existing data
    await Sale.deleteMany();
    await Lead.deleteMany();
    await Unit.deleteMany();
    await Project.deleteMany();
    await User.deleteMany();
    await Organization.deleteMany();

    // Create Organization
    const createdOrg = await Organization.create(sampleData.organization);
    console.log('Organization Created...');

    // Create Users and associate with Organization (FIXED: Create one by one to trigger hashing)
    const createdUsers = [];
    for (const user of sampleData.users) {
        const userWithOrg = { ...user, organization: createdOrg._id };
        const createdUser = await User.create(userWithOrg);
        createdUsers.push(createdUser);
    }
    console.log(`${createdUsers.length} Users Created...`);

    // Associate projects with Organization
    const projectsWithOrg = sampleData.projects.map(p => ({ ...p, organization: createdOrg._id }));
    await Project.insertMany(projectsWithOrg);
    console.log(`${projectsWithOrg.length} Projects Created...`);

    // Associate units with Organization
    const unitsWithOrg = sampleData.units.map(u => ({ ...u, organization: createdOrg._id }));
    await Unit.insertMany(unitsWithOrg);
    console.log(`${unitsWithOrg.length} Units Created...`);
    
    // Associate leads with Organization and assign some to the sales exec
    const salesExec = createdUsers.find(u => u.role === 'Sales Executive');
    const leadsWithOrg = sampleData.leads.map((l, i) => ({ 
        ...l, 
        organization: createdOrg._id,
        assignedTo: i < 25 ? salesExec._id : null, // Assign first 25 leads to Priya
    }));
    await Lead.insertMany(leadsWithOrg);
    console.log(`${leadsWithOrg.length} Leads Created...`);

    // --- Create multiple sample sales AFTER all other data exists ---
    console.log('Creating multiple sample sales...');
    const availableUnits = await Unit.find({ project: sampleData.projects[0]._id, status: 'available' }).limit(15);
    const availableLeads = await Lead.find({ project: sampleData.projects[0]._id, status: { $ne: 'Booked' } }).limit(15);

    if (availableUnits.length > 0 && availableLeads.length > 0 && salesExec) {
        const numSales = Math.min(availableUnits.length, availableLeads.length, 15);

        for (let i = 0; i < numSales; i++) {
            const unit = availableUnits[i];
            const lead = availableLeads[i];

            // Create sale record individually
            await Sale.create({
                project: unit.project,
                unit: unit._id,
                lead: lead._id,
                organization: createdOrg._id,
                salesPerson: salesExec._id,
                salePrice: unit.currentPrice + 250000,
                costSheetSnapshot: { message: `This is a placeholder snapshot for seeded sale #${i + 1}.` },
            });

            // Update unit and lead status
            unit.status = 'sold';
            await unit.save();
            lead.status = 'Booked';
            await lead.save();
        }
        
        console.log(`${numSales} Sample Sales Created...`);
    } else {
        console.log('Could not create sample sales, required data not found.');
    }

    console.log('Data Imported Successfully!');
    process.exit();
  } catch (error) {
    console.error(`Error: ${error}`);
    process.exit(1);
  }
};

const destroyData = async () => {
  try {
    await Sale.deleteMany();
    await Lead.deleteMany();
    await Unit.deleteMany();
    await Project.deleteMany();
    await User.deleteMany();
    await Organization.deleteMany();

    console.log('Data Destroyed Successfully!');
    process.exit();
  } catch (error) {
    console.error(`Error: ${error}`);
    process.exit(1);
  }
};

if (process.argv[2] === '-d') {
  destroyData();
} else {
  importData();
}
