// File: data/migrateRoles.js
// Description: One-time migration script to seed default roles for existing organizations
// and assign roleRef to existing users based on their role string field.
// Usage: node data/migrateRoles.js

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import User from '../models/userModel.js';
import Organization from '../models/organizationModel.js';
import Role from '../models/roleModel.js';
import { seedDefaultRoles } from './defaultRoles.js';

dotenv.config();

const migrateRoles = async () => {
  try {
    await connectDB();
    console.log('Connected to database');

    // Step 1: Get all organizations
    const organizations = await Organization.find({});
    console.log(`Found ${organizations.length} organization(s) to migrate`);

    for (const org of organizations) {
      console.log(`\nMigrating organization: ${org.name} (${org._id})`);

      // Step 2: Check if roles already exist for this org
      const existingRoles = await Role.countDocuments({ organization: org._id });

      if (existingRoles > 0) {
        console.log(`  - ${existingRoles} roles already exist, skipping seed`);
      } else {
        // Step 3: Find a user to attribute role creation to
        const firstUser = await User.findOne({
          organization: org._id,
          role: 'Business Head',
        });

        const createdBy = firstUser?._id || null;
        const roles = await seedDefaultRoles(org._id, createdBy);
        console.log(`  - Seeded ${roles.length} default roles`);
      }

      // Step 4: Assign roleRef to users without one
      const usersWithoutRoleRef = await User.find({
        organization: org._id,
        roleRef: null,
      });

      console.log(`  - ${usersWithoutRoleRef.length} user(s) need roleRef assignment`);

      for (const user of usersWithoutRoleRef) {
        // Find the matching role by name
        const matchingRole = await Role.findOne({
          organization: org._id,
          name: user.role,
          isActive: true,
        });

        if (matchingRole) {
          user.roleRef = matchingRole._id;
          await user.save({ validateBeforeSave: false });
          console.log(`    - Assigned "${matchingRole.name}" role to ${user.email}`);
        } else {
          console.warn(`    - WARNING: No matching role found for "${user.role}" (user: ${user.email})`);
        }
      }

      // Step 5: Assign Owner role to the first Business Head if no owner exists
      const ownerRole = await Role.findOne({
        organization: org._id,
        isOwnerRole: true,
      });

      if (ownerRole) {
        const existingOwner = await User.findOne({
          organization: org._id,
          roleRef: ownerRole._id,
        });

        if (!existingOwner) {
          const businessHead = await User.findOne({
            organization: org._id,
            role: 'Business Head',
            isActive: true,
          }).sort({ createdAt: 1 });

          if (businessHead) {
            businessHead.roleRef = ownerRole._id;
            await businessHead.save({ validateBeforeSave: false });
            console.log(`  - Assigned Owner role to ${businessHead.email}`);
          }
        } else {
          console.log(`  - Owner already assigned: ${existingOwner.email}`);
        }
      }
    }

    console.log('\nMigration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
};

migrateRoles();
