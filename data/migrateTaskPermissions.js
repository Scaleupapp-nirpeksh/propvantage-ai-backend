// File: data/migrateTaskPermissions.js
// Description: One-time migration script to add task permissions to existing organization roles.
// Uses $addToSet to safely add permissions without duplicates.
// Usage: node data/migrateTaskPermissions.js

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import Role from '../models/roleModel.js';
import Organization from '../models/organizationModel.js';

dotenv.config();

// Task permissions mapping by role level
const TASK_PERMISSIONS_BY_LEVEL = {
  // Level 0 (Organization Owner) and Level 1 (Business Head) already get ALL_PERMISSIONS
  // so they automatically include all task permissions. We still add explicitly
  // in case the role was customized.
  0: [
    'tasks:view', 'tasks:view_team', 'tasks:view_all',
    'tasks:create', 'tasks:update', 'tasks:delete',
    'tasks:assign', 'tasks:manage_templates',
    'tasks:analytics', 'tasks:bulk_operations',
  ],
  1: [
    'tasks:view', 'tasks:view_team', 'tasks:view_all',
    'tasks:create', 'tasks:update', 'tasks:delete',
    'tasks:assign', 'tasks:manage_templates',
    'tasks:analytics', 'tasks:bulk_operations',
  ],
  2: [
    'tasks:view', 'tasks:view_team', 'tasks:view_all',
    'tasks:create', 'tasks:update',
    'tasks:assign', 'tasks:manage_templates',
    'tasks:analytics',
  ],
  3: [
    'tasks:view', 'tasks:view_team',
    'tasks:create', 'tasks:update',
    'tasks:assign', 'tasks:analytics',
  ],
  4: [
    'tasks:view', 'tasks:view_team',
    'tasks:create', 'tasks:update',
    'tasks:assign',
  ],
  5: [
    'tasks:view',
    'tasks:create', 'tasks:update',
  ],
  6: [
    'tasks:view',
    'tasks:create',
  ],
};

const migrateTaskPermissions = async () => {
  try {
    await connectDB();
    console.log('Connected to database');

    const organizations = await Organization.find({});
    console.log(`Found ${organizations.length} organization(s) to migrate\n`);

    let totalRolesUpdated = 0;

    for (const org of organizations) {
      console.log(`Migrating organization: ${org.name} (${org._id})`);

      const roles = await Role.find({ organization: org._id, isActive: true });
      console.log(`  Found ${roles.length} active role(s)`);

      for (const role of roles) {
        // Determine which task permissions to add based on role level
        // For levels not in our map (e.g., 7+), give basic view + create
        const level = role.level;
        let taskPerms;

        if (TASK_PERMISSIONS_BY_LEVEL[level]) {
          taskPerms = TASK_PERMISSIONS_BY_LEVEL[level];
        } else if (level <= 2) {
          taskPerms = TASK_PERMISSIONS_BY_LEVEL[2];
        } else if (level <= 4) {
          taskPerms = TASK_PERMISSIONS_BY_LEVEL[4];
        } else {
          taskPerms = TASK_PERMISSIONS_BY_LEVEL[6]; // Minimum: view + create
        }

        // Use $addToSet to avoid duplicates
        const result = await Role.updateOne(
          { _id: role._id },
          { $addToSet: { permissions: { $each: taskPerms } } }
        );

        if (result.modifiedCount > 0) {
          totalRolesUpdated++;
          console.log(`    - Updated "${role.name}" (level ${level}): added ${taskPerms.length} task permissions`);
        } else {
          console.log(`    - "${role.name}" (level ${level}): already has task permissions, skipped`);
        }
      }
    }

    console.log(`\nMigration completed! ${totalRolesUpdated} role(s) updated across ${organizations.length} organization(s).`);
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
};

migrateTaskPermissions();
