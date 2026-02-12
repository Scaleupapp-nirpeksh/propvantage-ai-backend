// File: models/fileModel.js
// Description: Enhanced file model with document management capabilities

import mongoose from 'mongoose';

const fileSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Organization',
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'User',
    },
    // Enhanced categorization
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DocumentCategory',
      required: true
    },
    // Associated resource (Lead, Project, Sale, etc.)
    associatedResource: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    resourceType: {
      type: String,
      required: true,
      enum: ['Lead', 'Project', 'Sale', 'Unit', 'User', 'Organization', 'Commission', 'Payment', 'Message'],
    },
    // File metadata
    originalName: {
      type: String,
      required: true,
      trim: true,
    },
    fileName: {
      type: String,
      required: true,
      trim: true,
    },
    mimeType: {
      type: String,
      required: true,
    },
    fileExtension: {
      type: String,
      required: true,
      lowercase: true
    },
    size: {
      type: Number,
      required: true,
      min: 0
    },
    // Storage information
    url: {
      type: String,
      required: true,
    },
    s3Key: {
      type: String,
      required: true,
    },
    s3Bucket: {
      type: String,
      required: false, // Can be derived from config
    },
    // Document management fields
    title: {
      type: String,
      trim: true,
      maxlength: [200, 'Title cannot exceed 200 characters']
    },
    description: {
      type: String,
      trim: true,
      maxlength: [1000, 'Description cannot exceed 1000 characters']
    },
    tags: [{
      type: String,
      trim: true,
      lowercase: true
    }],
    // Version control
    version: {
      type: Number,
      default: 1,
      min: 1
    },
    isLatestVersion: {
      type: Boolean,
      default: true
    },
    parentFile: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'File',
      default: null
    },
    versionHistory: [{
      version: Number,
      fileId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'File'
      },
      uploadedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      uploadedAt: Date,
      changeLog: String,
      size: Number
    }],
    // Approval workflow
    approvalStatus: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'not_required'],
      default: 'not_required'
    },
    approvalWorkflow: {
      requiredApprovals: {
        type: Number,
        default: 1
      },
      approvals: [{
        approver: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User'
        },
        status: {
          type: String,
          enum: ['approved', 'rejected', 'pending'],
          default: 'pending'
        },
        comment: String,
        timestamp: {
          type: Date,
          default: Date.now
        }
      }],
      finalApprovalDate: Date,
      finalApprovalBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      }
    },
    // Access control
    accessLevel: {
      type: String,
      enum: ['public', 'organization', 'restricted', 'private'],
      default: 'organization'
    },
    allowedUsers: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }],
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
    // Document expiry
    expiryDate: {
      type: Date,
      default: null
    },
    isExpired: {
      type: Boolean,
      default: false
    },
    expiryNotificationSent: {
      type: Boolean,
      default: false
    },
    // Document status
    status: {
      type: String,
      enum: ['active', 'archived', 'deleted', 'expired'],
      default: 'active'
    },
    // Custom metadata fields
    customFields: {
      type: Map,
      of: mongoose.Schema.Types.Mixed,
      default: new Map()
    },
    // Document processing
    isProcessed: {
      type: Boolean,
      default: false
    },
    processingStatus: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed'],
      default: 'pending'
    },
    extractedText: {
      type: String,
      default: ''
    },
    extractedMetadata: {
      type: Map,
      of: mongoose.Schema.Types.Mixed,
      default: new Map()
    },
    // Audit trail
    accessLog: [{
      user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      action: {
        type: String,
        enum: ['view', 'download', 'share', 'edit', 'delete']
      },
      timestamp: {
        type: Date,
        default: Date.now
      },
      ipAddress: String,
      userAgent: String
    }],
    // Sharing and collaboration
    shares: [{
      sharedWith: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      sharedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      permissions: [{
        type: String,
        enum: ['view', 'download', 'comment', 'edit']
      }],
      expiresAt: Date,
      sharedAt: {
        type: Date,
        default: Date.now
      },
      isActive: {
        type: Boolean,
        default: true
      }
    }],
    // Comments and annotations
    comments: [{
      user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      comment: {
        type: String,
        required: true,
        maxlength: [1000, 'Comment cannot exceed 1000 characters']
      },
      timestamp: {
        type: Date,
        default: Date.now
      },
      isResolved: {
        type: Boolean,
        default: false
      },
      resolvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      resolvedAt: Date
    }],
    // File integrity
    checksum: {
      type: String,
      required: false
    },
    // Thumbnail for images/videos
    thumbnail: {
      url: String,
      s3Key: String,
      size: Number
    }
  },
  {
    timestamps: true,
  }
);

// Indexes for better performance
fileSchema.index({ organization: 1, category: 1 });
fileSchema.index({ organization: 1, associatedResource: 1, resourceType: 1 });
fileSchema.index({ organization: 1, uploadedBy: 1 });
fileSchema.index({ organization: 1, status: 1 });
fileSchema.index({ organization: 1, approvalStatus: 1 });
fileSchema.index({ organization: 1, isLatestVersion: 1 });
fileSchema.index({ parentFile: 1, version: 1 });
fileSchema.index({ tags: 1 });
fileSchema.index({ expiryDate: 1, isExpired: 1 });
fileSchema.index({ createdAt: -1 });

// Text index for search functionality
fileSchema.index({ 
  title: 'text', 
  description: 'text', 
  originalName: 'text', 
  extractedText: 'text' 
});

// Virtual for file size in human readable format
fileSchema.virtual('humanReadableSize').get(function() {
  const bytes = this.size;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  if (bytes === 0) return '0 Bytes';
  const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
  return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
});

// Virtual for file age
fileSchema.virtual('ageInDays').get(function() {
  const now = new Date();
  const diffTime = Math.abs(now - this.createdAt);
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
});

// Virtual for approval progress
fileSchema.virtual('approvalProgress').get(function() {
  if (this.approvalStatus === 'not_required') {
    return { percentage: 100, status: 'Not Required' };
  }
  
  const approvedCount = this.approvalWorkflow.approvals.filter(a => a.status === 'approved').length;
  const totalRequired = this.approvalWorkflow.requiredApprovals;
  const percentage = Math.round((approvedCount / totalRequired) * 100);
  
  return {
    percentage,
    approved: approvedCount,
    required: totalRequired,
    status: this.approvalStatus
  };
});

// Method to check if user has access to this file
fileSchema.methods.hasUserAccess = function(user, action = 'view') {
  // File owner always has access
  if (this.uploadedBy.toString() === user._id.toString()) {
    return true;
  }
  
  // Check access level
  switch (this.accessLevel) {
    case 'public':
      return true;
    case 'organization':
      return this.organization.toString() === user.organization.toString();
    case 'restricted':
      return this.allowedRoles.includes(user.role) || 
             this.allowedUsers.some(u => u.toString() === user._id.toString());
    case 'private':
      return this.allowedUsers.some(u => u.toString() === user._id.toString());
    default:
      return false;
  }
};

// Method to add access log entry
fileSchema.methods.logAccess = function(user, action, ipAddress, userAgent) {
  this.accessLog.push({
    user: user._id,
    action,
    ipAddress,
    userAgent,
    timestamp: new Date()
  });
  
  // Keep only last 100 access logs
  if (this.accessLog.length > 100) {
    this.accessLog = this.accessLog.slice(-100);
  }
};

// Method to create new version
fileSchema.methods.createNewVersion = function(newFileData, user, changeLog) {
  // Add current version to history
  this.versionHistory.push({
    version: this.version,
    fileId: this._id,
    uploadedBy: this.uploadedBy,
    uploadedAt: this.createdAt,
    changeLog: changeLog || 'Version updated',
    size: this.size
  });
  
  // Update current version
  this.version += 1;
  this.originalName = newFileData.originalName;
  this.fileName = newFileData.fileName;
  this.mimeType = newFileData.mimeType;
  this.size = newFileData.size;
  this.url = newFileData.url;
  this.s3Key = newFileData.s3Key;
  this.uploadedBy = user._id;
  this.isLatestVersion = true;
  
  return this;
};

// Method to check if file is expired
fileSchema.methods.checkExpiry = function() {
  if (this.expiryDate && new Date() > this.expiryDate) {
    this.isExpired = true;
    this.status = 'expired';
    return true;
  }
  return false;
};

// Method to add comment
fileSchema.methods.addComment = function(user, comment) {
  this.comments.push({
    user: user._id,
    comment,
    timestamp: new Date()
  });
  return this.comments[this.comments.length - 1];
};

// Method to share file
fileSchema.methods.shareWith = function(user, sharedBy, permissions, expiresAt) {
  // Remove existing share if any
  this.shares = this.shares.filter(s => s.sharedWith.toString() !== user._id.toString());
  
  // Add new share
  this.shares.push({
    sharedWith: user._id,
    sharedBy: sharedBy._id,
    permissions,
    expiresAt,
    sharedAt: new Date(),
    isActive: true
  });
  
  return this.shares[this.shares.length - 1];
};

// Static method to get files by category
fileSchema.statics.getFilesByCategory = function(organizationId, categoryId, options = {}) {
  const query = {
    organization: organizationId,
    category: categoryId,
    status: 'active'
  };
  
  if (options.latestVersionOnly) {
    query.isLatestVersion = true;
  }
  
  return this.find(query)
    .populate('uploadedBy', 'firstName lastName')
    .populate('category', 'name type')
    .sort({ createdAt: -1 });
};

// Static method to search files
fileSchema.statics.searchFiles = function(organizationId, searchTerm, options = {}) {
  const query = {
    organization: organizationId,
    status: 'active',
    $text: { $search: searchTerm }
  };
  
  if (options.category) {
    query.category = options.category;
  }
  
  if (options.resourceType) {
    query.resourceType = options.resourceType;
  }
  
  return this.find(query, { score: { $meta: 'textScore' } })
    .populate('uploadedBy', 'firstName lastName')
    .populate('category', 'name type')
    .sort({ score: { $meta: 'textScore' } });
};

// Pre-save middleware to update file extension
fileSchema.pre('save', function(next) {
  if (this.isModified('originalName') || this.isNew) {
    const lastDotIndex = this.originalName.lastIndexOf('.');
    this.fileExtension = lastDotIndex > -1 ? 
      this.originalName.substring(lastDotIndex + 1).toLowerCase() : '';
  }
  
  // Check expiry
  this.checkExpiry();
  
  next();
});

// Pre-save middleware to set file name if not provided
fileSchema.pre('save', function(next) {
  if (!this.fileName && this.originalName) {
    this.fileName = this.originalName;
  }
  next();
});

const File = mongoose.model('File', fileSchema);

export default File;