// File: models/roleModel.js
// Description: Role model for organization-scoped custom roles with granular permissions

import mongoose from 'mongoose';

const roleSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: [true, 'Organization is required'],
      index: true,
    },

    name: {
      type: String,
      required: [true, 'Role name is required'],
      trim: true,
      maxlength: [50, 'Role name cannot exceed 50 characters'],
    },

    slug: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },

    description: {
      type: String,
      maxlength: [200, 'Description cannot exceed 200 characters'],
      default: '',
    },

    level: {
      type: Number,
      required: [true, 'Hierarchy level is required'],
      min: [0, 'Level must be at least 0'],
      max: [100, 'Level cannot exceed 100'],
    },

    permissions: [
      {
        type: String,
        trim: true,
      },
    ],

    isDefault: {
      type: Boolean,
      default: false,
    },

    isOwnerRole: {
      type: Boolean,
      default: false,
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
  }
);

// Role name + org must be unique
roleSchema.index({ organization: 1, slug: 1 }, { unique: true });
// Performance index for active role lookups
roleSchema.index({ organization: 1, isActive: 1 });

// Auto-generate slug from name before validation
roleSchema.pre('validate', function (next) {
  if (this.isModified('name') && this.name) {
    this.slug = this.name
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
  }
  next();
});

const Role = mongoose.model('Role', roleSchema);

export default Role;
