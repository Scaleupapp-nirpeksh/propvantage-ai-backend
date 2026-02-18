// File: data/migrateProjectAccess.js
// Description: One-time migration to assign all existing active users to all existing projects
// Usage: node data/migrateProjectAccess.js
// Safe to run multiple times — skips duplicates via unique compound index

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Organization from '../models/organizationModel.js';
import User from '../models/userModel.js';
import Project from '../models/projectModel.js';
import ProjectAssignment from '../models/projectAssignmentModel.js';

dotenv.config();

async function migrateProjectAccess() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    // Get all organizations
    const organizations = await Organization.find({ isActive: true }).lean();
    console.log(`📋 Found ${organizations.length} active organization(s)\n`);

    let totalCreated = 0;
    let totalSkipped = 0;

    for (const org of organizations) {
      console.log(`\n🏢 Processing: ${org.name} (${org._id})`);

      // Get all active users in this org
      const users = await User.find({
        organization: org._id,
        isActive: true,
      }).select('_id firstName lastName').lean();

      // Get all projects in this org
      const projects = await Project.find({
        organization: org._id,
      }).select('_id name').lean();

      console.log(`   👥 ${users.length} active users, 📁 ${projects.length} projects`);

      if (users.length === 0 || projects.length === 0) {
        console.log('   ⏭️  Skipping — no users or projects');
        continue;
      }

      // Build assignment docs for all user×project combinations
      const assignmentDocs = [];
      for (const project of projects) {
        for (const user of users) {
          assignmentDocs.push({
            organization: org._id,
            user: user._id,
            project: project._id,
            assignedBy: users[0]._id, // First user as assigner
            assignedAt: new Date(),
            notes: 'Auto-assigned by migration script',
          });
        }
      }

      // Insert with ordered: false to skip duplicates (unique compound index)
      try {
        const result = await ProjectAssignment.insertMany(assignmentDocs, {
          ordered: false,
        });
        const created = result.length;
        totalCreated += created;
        console.log(`   ✅ Created ${created} project assignments`);
      } catch (error) {
        if (error.code === 11000 || error.writeErrors) {
          // Some duplicates — count what was inserted
          const inserted = error.insertedDocs?.length || 0;
          const duplicates = assignmentDocs.length - inserted;
          totalCreated += inserted;
          totalSkipped += duplicates;
          console.log(`   ✅ Created ${inserted} new assignments, ⏭️  skipped ${duplicates} duplicates`);
        } else {
          throw error;
        }
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log(`✅ Migration complete!`);
    console.log(`   📝 Total created: ${totalCreated}`);
    console.log(`   ⏭️  Total skipped (duplicates): ${totalSkipped}`);
    console.log('='.repeat(60));

    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error(error);
    process.exit(1);
  }
}

migrateProjectAccess();
