// File: models/documentCategoryModel.js
// Description: Defines the Mongoose schema for document categories and organization

import mongoose from 'mongoose';

const documentCategorySchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Organization',
    },
    name: {
      type: String,
      required: [true, 'Category name is required'],
      trim: true,
      maxlength: [100, 'Category name cannot exceed 100 characters']
    },
    description: {
      type: String,
      trim: true,
      maxlength: [500, 'Description cannot exceed 500 characters']
    },
    // Category type for different document contexts
    type: {
      type: String,
      enum: [
        'Legal',
        'Financial',
        'Project',
        'Marketing',
        'Customer',
        'Compliance',
        'HR',
        'Operations',
        'Other'
      ],
      required: true
    },
    // Parent category for hierarchical structure
    parentCategory: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DocumentCategory',
      default: null
    },
    // Category color for UI display
    color: {
      type: String,
      default: '#3B82F6', // Blue
      match: [/^#[0-9A-F]{6}$/i, 'Color must be a valid hex color']
    },
    // Category icon for UI display
    icon: {
      type: String,
      default: 'folder',
      trim: true
    },
    // Allowed file types for this category
    allowedFileTypes: [{
      type: String,
      enum: [
        'pdf',
        'doc',
        'docx',
        'xls',
        'xlsx',
        'ppt',
        'pptx',
        'txt',
        'jpg',
        'jpeg',
        'png',
        'gif',
        'mp4',
        'mov',
        'avi',
        'zip',
        'rar',
        'csv'
      ]
    }],
    // Maximum file size in bytes (default 10MB)
    maxFileSize: {
      type: Number,
      default: 10 * 1024 * 1024, // 10MB
      min: [1024, 'Minimum file size is 1KB'],
      max: [100 * 1024 * 1024, 'Maximum file size is 100MB']
    },
    // Whether this category requires approval workflow
    requiresApproval: {
      type: Boolean,
      default: false
    },
    // Approval workflow configuration
    approvalWorkflow: {
      approvers: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      }],
      requiredApprovals: {
        type: Number,
        default: 1,
        min: 1
      },
      autoApprovalRoles: [{
        type: String,
        enum: [
          'Business Head',
          'Project Director',
          'Sales Head',
          'Finance Head',
          'Marketing Head'
        ]
      }]
    },
    // Retention policy for documents in this category
    retentionPolicy: {
      enabled: {
        type: Boolean,
        default: false
      },
      retentionPeriod: {
        type: Number, // in days
        default: 2555, // 7 years
        min: 30 // minimum 30 days
      },
      autoDelete: {
        type: Boolean,
        default: false
      },
      archiveBeforeDelete: {
        type: Boolean,
        default: true
      }
    },
    // Access control for the category
    accessControl: {
      publicAccess: {
        type: Boolean,
        default: false
      },
      restrictedRoles: [{
        type: String,
        enum: [
          'Business Head',
          'Project Director',
          'Sales Head',
          'Finance Head',
          'Marketing Head',
          'Sales Manager',
          'Finance Manager',
          'Channel Partner Manager',
          'Sales Executive',
          'Channel Partner Admin',
          'Channel Partner Agent'
        ]
      }],
      allowedUsers: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      }]
    },
    // Template settings for documents in this category
    templateSettings: {
      hasTemplate: {
        type: Boolean,
        default: false
      },
      templateFile: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'File'
      },
      mandatoryFields: [{
        fieldName: String,
        fieldType: {
          type: String,
          enum: ['text', 'number', 'date', 'email', 'phone', 'dropdown', 'checkbox']
        },
        required: Boolean,
        defaultValue: String,
        options: [String] // For dropdown fields
      }]
    },
    // Category statistics
    statistics: {
      totalDocuments: {
        type: Number,
        default: 0
      },
      totalSize: {
        type: Number,
        default: 0
      },
      lastUpdated: {
        type: Date,
        default: Date.now
      }
    },
    // Category status
    isActive: {
      type: Boolean,
      default: true
    },
    // Category order for display
    displayOrder: {
      type: Number,
      default: 0
    },
    // Created by user
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    // Last modified by user
    lastModifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  {
    timestamps: true,
  }
);

// Indexes for better performance
documentCategorySchema.index({ organization: 1, type: 1 });
documentCategorySchema.index({ organization: 1, parentCategory: 1 });
documentCategorySchema.index({ organization: 1, isActive: 1 });
documentCategorySchema.index({ organization: 1, name: 1 });
documentCategorySchema.index({ displayOrder: 1 });

// Compound index for hierarchical queries
documentCategorySchema.index({ organization: 1, parentCategory: 1, displayOrder: 1 });

// Virtual for full category path
documentCategorySchema.virtual('fullPath').get(function() {
  // This would need to be populated with parent categories
  return this.name;
});

// Virtual for subcategories count
documentCategorySchema.virtual('subcategoriesCount', {
  ref: 'DocumentCategory',
  localField: '_id',
  foreignField: 'parentCategory',
  count: true
});

// Method to check if user has access to this category
documentCategorySchema.methods.hasUserAccess = function(user) {
  // Public access
  if (this.accessControl.publicAccess) {
    return true;
  }
  
  // Check if user's role is in restricted roles
  if (this.accessControl.restrictedRoles.length > 0) {
    return this.accessControl.restrictedRoles.includes(user.role);
  }
  
  // Check if user is in allowed users
  if (this.accessControl.allowedUsers.length > 0) {
    return this.accessControl.allowedUsers.some(allowedUser => 
      allowedUser.toString() === user._id.toString()
    );
  }
  
  // Default: allow access if no restrictions
  return true;
};

// Method to check if file type is allowed
documentCategorySchema.methods.isFileTypeAllowed = function(fileType) {
  if (!this.allowedFileTypes || this.allowedFileTypes.length === 0) {
    return true; // No restrictions
  }
  
  return this.allowedFileTypes.includes(fileType.toLowerCase());
};

// Method to check if file size is within limits
documentCategorySchema.methods.isFileSizeAllowed = function(fileSize) {
  return fileSize <= this.maxFileSize;
};

// Method to get approval workflow for a user
documentCategorySchema.methods.getApprovalWorkflow = function(user) {
  if (!this.requiresApproval) {
    return { requiresApproval: false };
  }
  
  // Check if user has auto-approval rights
  const hasAutoApproval = this.approvalWorkflow.autoApprovalRoles.includes(user.role);
  
  return {
    requiresApproval: true,
    hasAutoApproval,
    approvers: this.approvalWorkflow.approvers,
    requiredApprovals: this.approvalWorkflow.requiredApprovals
  };
};

// Static method to get category tree
documentCategorySchema.statics.getCategoryTree = async function(organizationId, parentId = null) {
  const categories = await this.find({
    organization: organizationId,
    parentCategory: parentId,
    isActive: true
  }).sort({ displayOrder: 1, name: 1 });
  
  const categoryTree = [];
  
  for (const category of categories) {
    const categoryObj = category.toObject();
    categoryObj.subcategories = await this.getCategoryTree(organizationId, category._id);
    categoryTree.push(categoryObj);
  }
  
  return categoryTree;
};

// Static method to get user-accessible categories
documentCategorySchema.statics.getUserAccessibleCategories = async function(organizationId, user) {
  const categories = await this.find({
    organization: organizationId,
    isActive: true
  }).sort({ displayOrder: 1, name: 1 });
  
  return categories.filter(category => category.hasUserAccess(user));
};

// Pre-save middleware to update statistics
documentCategorySchema.pre('save', function(next) {
  if (this.isModified() && !this.isNew) {
    this.lastModifiedBy = this.createdBy; // This should be set by the controller
    this.statistics.lastUpdated = new Date();
  }
  next();
});

// Pre-remove middleware to handle subcategories
documentCategorySchema.pre('deleteOne', { document: true, query: false }, async function(next) {
  try {
    // Check if there are subcategories
    const subcategoriesCount = await this.constructor.countDocuments({
      parentCategory: this._id
    });
    
    if (subcategoriesCount > 0) {
      throw new Error('Cannot delete category with subcategories. Please delete subcategories first.');
    }
    
    // Check if there are documents in this category
    const Document = mongoose.model('File');
    const documentsCount = await Document.countDocuments({
      category: this._id
    });
    
    if (documentsCount > 0) {
      throw new Error('Cannot delete category with documents. Please move or delete documents first.');
    }
    
    next();
  } catch (error) {
    next(error);
  }
});

const DocumentCategory = mongoose.model('DocumentCategory', documentCategorySchema);

export default DocumentCategory;