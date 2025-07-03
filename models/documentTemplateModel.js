// File: models/documentTemplateModel.js
// Description: Defines the Mongoose schema for document templates

import mongoose from 'mongoose';

const documentTemplateSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Organization',
    },
    name: {
      type: String,
      required: [true, 'Template name is required'],
      trim: true,
      maxlength: [200, 'Template name cannot exceed 200 characters']
    },
    description: {
      type: String,
      trim: true,
      maxlength: [1000, 'Description cannot exceed 1000 characters']
    },
    // Template category
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DocumentCategory',
      required: true
    },
    // Template type
    type: {
      type: String,
      enum: [
        'Contract',
        'Agreement',
        'Invoice',
        'Receipt',
        'Proposal',
        'Report',
        'Letter',
        'Certificate',
        'Form',
        'Other'
      ],
      required: true
    },
    // Template file reference
    templateFile: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'File',
      required: true
    },
    // Template fields that can be populated
    fields: [{
      fieldName: {
        type: String,
        required: true,
        trim: true
      },
      fieldLabel: {
        type: String,
        required: true,
        trim: true
      },
      fieldType: {
        type: String,
        enum: ['text', 'number', 'date', 'email', 'phone', 'dropdown', 'checkbox', 'textarea', 'currency'],
        required: true
      },
      isRequired: {
        type: Boolean,
        default: false
      },
      defaultValue: {
        type: String,
        default: ''
      },
      placeholder: {
        type: String,
        default: ''
      },
      // For dropdown fields
      options: [{
        value: String,
        label: String
      }],
      // Validation rules
      validation: {
        minLength: Number,
        maxLength: Number,
        min: Number,
        max: Number,
        pattern: String, // Regex pattern
        customValidation: String // Custom validation function
      },
      // Field position in template
      position: {
        type: Number,
        default: 0
      },
      // Field grouping
      group: {
        type: String,
        default: 'General'
      }
    }],
    // Template sections for better organization
    sections: [{
      sectionName: {
        type: String,
        required: true
      },
      sectionLabel: {
        type: String,
        required: true
      },
      fields: [String], // Array of field names
      isRepeatable: {
        type: Boolean,
        default: false
      },
      maxRepetitions: {
        type: Number,
        default: 1
      }
    }],
    // Template usage settings
    usage: {
      // Who can use this template
      allowedRoles: [{
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
      }],
      // Resource types this template can be used for
      applicableResourceTypes: [{
        type: String,
        enum: ['Lead', 'Project', 'Sale', 'Unit', 'User', 'Organization', 'Commission', 'Payment']
      }],
      // Whether template requires approval after generation
      requiresApproval: {
        type: Boolean,
        default: false
      }
    },
    // Template configuration
    configuration: {
      // File format for generated documents
      outputFormat: {
        type: String,
        enum: ['pdf', 'docx', 'html'],
        default: 'pdf'
      },
      // Template engine settings
      engine: {
        type: String,
        enum: ['handlebars', 'mustache', 'ejs'],
        default: 'handlebars'
      },
      // Page settings for PDF generation
      pageSettings: {
        format: {
          type: String,
          enum: ['A4', 'A3', 'Letter', 'Legal'],
          default: 'A4'
        },
        orientation: {
          type: String,
          enum: ['portrait', 'landscape'],
          default: 'portrait'
        },
        margins: {
          top: { type: Number, default: 20 },
          right: { type: Number, default: 20 },
          bottom: { type: Number, default: 20 },
          left: { type: Number, default: 20 }
        }
      },
      // Header and footer settings
      headerFooter: {
        includeHeader: { type: Boolean, default: false },
        includeFooter: { type: Boolean, default: false },
        headerTemplate: String,
        footerTemplate: String
      }
    },
    // Template statistics
    statistics: {
      timesUsed: {
        type: Number,
        default: 0
      },
      lastUsed: Date,
      averageGenerationTime: {
        type: Number,
        default: 0
      }
    },
    // Template status
    isActive: {
      type: Boolean,
      default: true
    },
    version: {
      type: Number,
      default: 1
    },
    // Template tags for better organization
    tags: [{
      type: String,
      trim: true,
      lowercase: true
    }],
    // Created and modified by
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
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
documentTemplateSchema.index({ organization: 1, isActive: 1 });
documentTemplateSchema.index({ organization: 1, category: 1 });
documentTemplateSchema.index({ organization: 1, type: 1 });
documentTemplateSchema.index({ tags: 1 });
documentTemplateSchema.index({ 'usage.applicableResourceTypes': 1 });

// Text index for search functionality
documentTemplateSchema.index({ 
  name: 'text', 
  description: 'text',
  tags: 'text'
});

// Virtual for template complexity (based on number of fields)
documentTemplateSchema.virtual('complexity').get(function() {
  const fieldCount = this.fields.length;
  if (fieldCount <= 5) return 'Simple';
  if (fieldCount <= 15) return 'Medium';
  return 'Complex';
});

// Method to check if user can use this template
documentTemplateSchema.methods.canUserUse = function(user) {
  // Check if user's role is allowed
  if (this.usage.allowedRoles.length > 0) {
    if (!this.usage.allowedRoles.includes(user.role)) {
      return false;
    }
  }
  
  // Check if user is specifically allowed
  if (this.usage.allowedUsers.length > 0) {
    const isAllowed = this.usage.allowedUsers.some(allowedUser => 
      allowedUser.toString() === user._id.toString()
    );
    if (!isAllowed) return false;
  }
  
  return true;
};

// Method to validate template data
documentTemplateSchema.methods.validateTemplateData = function(data) {
  const errors = [];
  
  this.fields.forEach(field => {
    const value = data[field.fieldName];
    
    // Check required fields
    if (field.isRequired && (!value || value.toString().trim() === '')) {
      errors.push(`${field.fieldLabel} is required`);
      return;
    }
    
    // Skip validation if field is not provided and not required
    if (!value) return;
    
    // Type-specific validation
    switch (field.fieldType) {
      case 'email':
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(value)) {
          errors.push(`${field.fieldLabel} must be a valid email address`);
        }
        break;
      case 'phone':
        const phoneRegex = /^\+?[\d\s\-\(\)]{10,}$/;
        if (!phoneRegex.test(value)) {
          errors.push(`${field.fieldLabel} must be a valid phone number`);
        }
        break;
      case 'number':
      case 'currency':
        if (isNaN(value)) {
          errors.push(`${field.fieldLabel} must be a valid number`);
        } else {
          const numValue = parseFloat(value);
          if (field.validation.min !== undefined && numValue < field.validation.min) {
            errors.push(`${field.fieldLabel} must be at least ${field.validation.min}`);
          }
          if (field.validation.max !== undefined && numValue > field.validation.max) {
            errors.push(`${field.fieldLabel} must not exceed ${field.validation.max}`);
          }
        }
        break;
      case 'date':
        const dateValue = new Date(value);
        if (isNaN(dateValue.getTime())) {
          errors.push(`${field.fieldLabel} must be a valid date`);
        }
        break;
      case 'text':
      case 'textarea':
        const strValue = value.toString();
        if (field.validation.minLength && strValue.length < field.validation.minLength) {
          errors.push(`${field.fieldLabel} must be at least ${field.validation.minLength} characters`);
        }
        if (field.validation.maxLength && strValue.length > field.validation.maxLength) {
          errors.push(`${field.fieldLabel} must not exceed ${field.validation.maxLength} characters`);
        }
        if (field.validation.pattern) {
          const regex = new RegExp(field.validation.pattern);
          if (!regex.test(strValue)) {
            errors.push(`${field.fieldLabel} format is invalid`);
          }
        }
        break;
      case 'dropdown':
        const validOptions = field.options.map(opt => opt.value);
        if (!validOptions.includes(value)) {
          errors.push(`${field.fieldLabel} must be one of: ${validOptions.join(', ')}`);
        }
        break;
    }
  });
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

// Method to increment usage statistics
documentTemplateSchema.methods.incrementUsage = function(generationTime) {
  this.statistics.timesUsed += 1;
  this.statistics.lastUsed = new Date();
  
  // Update average generation time
  const currentAvg = this.statistics.averageGenerationTime || 0;
  const timesUsed = this.statistics.timesUsed;
  this.statistics.averageGenerationTime = ((currentAvg * (timesUsed - 1)) + generationTime) / timesUsed;
  
  return this.save();
};

// Static method to get templates by resource type
documentTemplateSchema.statics.getTemplatesByResourceType = function(organizationId, resourceType, user) {
  return this.find({
    organization: organizationId,
    isActive: true,
    'usage.applicableResourceTypes': resourceType
  })
  .populate('category', 'name type')
  .populate('createdBy', 'firstName lastName')
  .sort({ name: 1 })
  .then(templates => {
    // Filter templates user can use
    return templates.filter(template => template.canUserUse(user));
  });
};

// Pre-save middleware
documentTemplateSchema.pre('save', function(next) {
  if (this.isModified() && !this.isNew) {
    this.lastModifiedBy = this.createdBy; // This should be set by the controller
  }
  next();
});

const DocumentTemplate = mongoose.model('DocumentTemplate', documentTemplateSchema);

export default DocumentTemplate;