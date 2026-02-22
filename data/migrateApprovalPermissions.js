// File: data/migrateApprovalPermissions.js
// Description: Migration script to add approval permissions to existing roles
// and seed default approval policies for all existing organizations.
// Usage: node data/migrateApprovalPermissions.js
// Idempotent — safe to run multiple times.

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Role from '../models/roleModel.js';
import Organization from '../models/organizationModel.js';
import { seedDefaultApprovalPolicies } from './seedDefaultApprovalPolicies.js';
import User from '../models/userModel.js';

dotenv.config();

// ─── Permission Mapping by Role Level ─────────────────────────────────────

const APPROVAL_PERMISSIONS_BY_LEVEL = {
  // Levels 0-2: Full approval permissions including policy management
  0: ['approvals:view', 'approvals:view_all', 'approvals:approve', 'approvals:reject', 'approvals:manage_policies'],
  1: ['approvals:view', 'approvals:view_all', 'approvals:approve', 'approvals:reject', 'approvals:manage_policies'],
  2: ['approvals:view', 'approvals:view_all', 'approvals:approve', 'approvals:reject', 'approvals:manage_policies'],
  // Level 3: View all, approve, reject (no policy management)
  3: ['approvals:view', 'approvals:view_all', 'approvals:approve', 'approvals:reject'],
  // Level 4: View, approve, reject
  4: ['approvals:view', 'approvals:approve', 'approvals:reject'],
  // Levels 5-6: View only
  5: ['approvals:view'],
  6: ['approvals:view'],
};

async function migrate() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    // ─── Step 1: Update Roles ────────────────────────────────────
    console.log('1️⃣  Updating roles with approval permissions...');

    const allRoles = await Role.find({}).select('_id name level permissions organization');
    let updatedCount = 0;

    for (const role of allRoles) {
      const level = role.level ?? 6; // Default to most restrictive if no level
      const permissionsToAdd = APPROVAL_PERMISSIONS_BY_LEVEL[level] || APPROVAL_PERMISSIONS_BY_LEVEL[6];

      // Use $addToSet to avoid duplicates
      const result = await Role.updateOne(
        { _id: role._id },
        { $addToSet: { permissions: { $each: permissionsToAdd } } }
      );

      if (result.modifiedCount > 0) {
        updatedCount++;
      }
    }

    console.log(`   ✅ Updated ${updatedCount} of ${allRoles.length} roles\n`);

    // ─── Step 2: Seed Approval Policies for Each Org ─────────────
    console.log('2️⃣  Seeding default approval policies for all organizations...');

    const orgs = await Organization.find({}).select('_id name');
    let policiesCreated = 0;

    for (const org of orgs) {
      // Find org owner or highest-level user for createdBy
      const owner = await User.findOne({ organization: org._id, isActive: true })
        .populate('roleRef', 'level isOwnerRole')
        .sort({ 'roleRef.level': 1 });

      const createdBy = owner?._id || new mongoose.Types.ObjectId();

      const policies = await seedDefaultApprovalPolicies(org._id, createdBy);
      policiesCreated += policies.length;
      console.log(`   ✅ ${org.name}: ${policies.length} policies`);
    }

    console.log(`\n   ✅ Total: ${policiesCreated} policies across ${orgs.length} organizations\n`);

    // ─── Summary ─────────────────────────────────────────────────
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  MIGRATION COMPLETE');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`  Roles updated:    ${updatedCount}`);
    console.log(`  Policies created: ${policiesCreated}`);
    console.log('═══════════════════════════════════════════════════════════');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

migrate();
