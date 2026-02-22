// File: models/contractorModel.js
// Description: Defines the Mongoose schema for contractors and vendors

import mongoose from 'mongoose';
import encryptionPlugin from '../utils/encryptionPlugin.js';

const contractorSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Organization',
    },
    // Basic contractor information
    name: {
      type: String,
      required: [true, 'Contractor name is required'],
      trim: true,
      maxlength: [200, 'Name cannot exceed 200 characters']
    },
    companyName: {
      type: String,
      trim: true,
      maxlength: [200, 'Company name cannot exceed 200 characters']
    },
    // Contractor type and specialization
    type: {
      type: String,
      enum: [
        'General Contractor',
        'Subcontractor',
        'Specialist',
        'Supplier',
        'Consultant',
        'Service Provider'
      ],
      required: true
    },
    specialization: [{
      type: String,
      enum: [
        'Civil Work',
        'Electrical Work',
        'Plumbing Work',
        'HVAC',
        'Flooring',
        'Painting',
        'Roofing',
        'Landscaping',
        'Interior Design',
        'Architecture',
        'Engineering',
        'Material Supply',
        'Equipment Rental',
        'Security',
        'Cleaning',
        'Other'
      ]
    }],
    // Contact information
    contactInfo: {
      primaryContact: {
        name: {
          type: String,
          required: true,
          trim: true
        },
        designation: {
          type: String,
          trim: true
        },
        phone: {
          type: String,
          required: true,
          trim: true
        },
        email: {
          type: String,
          trim: true,
          lowercase: true
        },
        whatsapp: {
          type: String,
          trim: true
        }
      },
      alternateContact: {
        name: String,
        designation: String,
        phone: String,
        email: String
      },
      officePhone: String,
      fax: String,
      website: String
    },
    // Address information
    address: {
      street: {
        type: String,
        required: true,
        trim: true
      },
      area: {
        type: String,
        trim: true
      },
      city: {
        type: String,
        required: true,
        trim: true
      },
      state: {
        type: String,
        required: true,
        trim: true
      },
      pincode: {
        type: String,
        required: true,
        trim: true
      },
      country: {
        type: String,
        default: 'India',
        trim: true
      },
      coordinates: {
        latitude: Number,
        longitude: Number
      }
    },
    // Business details
    businessInfo: {
      registrationNumber: {
        type: String,
        trim: true
      },
      panNumber: {
        type: String,
        trim: true,
        uppercase: true
      },
      gstNumber: {
        type: String,
        trim: true,
        uppercase: true
      },
      licenseNumber: {
        type: String,
        trim: true
      },
      licenseType: {
        type: String,
        enum: ['PWD', 'CPWD', 'Municipal', 'Private', 'Other'],
        trim: true
      },
      licenseExpiryDate: Date,
      establishedYear: {
        type: Number,
        min: 1900,
        max: new Date().getFullYear()
      },
      companySize: {
        type: String,
        enum: ['Small (1-10)', 'Medium (11-50)', 'Large (51-200)', 'Enterprise (200+)']
      }
    },
    // Financial information
    financialInfo: {
      bankDetails: {
        accountNumber: {
          type: String,
          trim: true
        },
        accountHolderName: {
          type: String,
          trim: true
        },
        bankName: {
          type: String,
          trim: true
        },
        ifscCode: {
          type: String,
          trim: true,
          uppercase: true
        },
        branchName: {
          type: String,
          trim: true
        }
      },
      paymentTerms: {
        type: String,
        enum: ['Advance', 'On Delivery', 'Net 15', 'Net 30', 'Net 45', 'Net 60', 'Custom'],
        default: 'Net 30'
      },
      customPaymentTerms: {
        type: String,
        trim: true
      },
      creditLimit: {
        type: Number,
        default: 0,
        min: 0
      },
      outstandingAmount: {
        type: Number,
        default: 0
      }
    },
    // Rating and performance
    rating: {
      overall: {
        type: Number,
        default: 0,
        min: 0,
        max: 5
      },
      quality: {
        type: Number,
        default: 0,
        min: 0,
        max: 5
      },
      timeliness: {
        type: Number,
        default: 0,
        min: 0,
        max: 5
      },
      communication: {
        type: Number,
        default: 0,
        min: 0,
        max: 5
      },
      costEffectiveness: {
        type: Number,
        default: 0,
        min: 0,
        max: 5
      },
      totalReviews: {
        type: Number,
        default: 0
      }
    },
    // Work history and statistics
    workHistory: {
      totalProjects: {
        type: Number,
        default: 0
      },
      completedProjects: {
        type: Number,
        default: 0
      },
      ongoingProjects: {
        type: Number,
        default: 0
      },
      cancelledProjects: {
        type: Number,
        default: 0
      },
      totalContractValue: {
        type: Number,
        default: 0
      },
      averageProjectDuration: {
        type: Number,
        default: 0 // in days
      },
      onTimeCompletionRate: {
        type: Number,
        default: 0 // percentage
      }
    },
    // Capacity and availability
    capacity: {
      maxSimultaneousProjects: {
        type: Number,
        default: 1,
        min: 1
      },
      currentWorkload: {
        type: Number,
        default: 0,
        min: 0,
        max: 100 // percentage
      },
      availableFrom: {
        type: Date,
        default: Date.now
      },
      workingAreas: [{
        city: String,
        state: String,
        radiusKm: Number
      }],
      teamSize: {
        type: Number,
        default: 1,
        min: 1
      },
      equipmentOwned: [{
        type: String,
        description: String,
        quantity: Number
      }]
    },
    // Certifications and qualifications
    certifications: [{
      name: {
        type: String,
        required: true
      },
      issuedBy: {
        type: String,
        required: true
      },
      issueDate: {
        type: Date,
        required: true
      },
      expiryDate: Date,
      certificateNumber: String,
      document: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'File'
      }
    }],
    // Insurance and legal
    insurance: {
      hasLiabilityInsurance: {
        type: Boolean,
        default: false
      },
      liabilityAmount: {
        type: Number,
        default: 0
      },
      insuranceProvider: String,
      policyNumber: String,
      expiryDate: Date,
      document: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'File'
      }
    },
    // Documents
    documents: [{
      type: {
        type: String,
        enum: [
          'Registration Certificate',
          'PAN Card',
          'GST Certificate',
          'License',
          'Insurance Policy',
          'Bank Details',
          'Previous Work Photos',
          'References',
          'Other'
        ],
        required: true
      },
      name: {
        type: String,
        required: true
      },
      file: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'File',
        required: true
      },
      uploadedAt: {
        type: Date,
        default: Date.now
      },
      expiryDate: Date,
      verified: {
        type: Boolean,
        default: false
      },
      verifiedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      verifiedAt: Date
    }],
    // Reviews and feedback
    reviews: [{
      project: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Project'
      },
      reviewedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
      },
      rating: {
        overall: {
          type: Number,
          required: true,
          min: 1,
          max: 5
        },
        quality: {
          type: Number,
          required: true,
          min: 1,
          max: 5
        },
        timeliness: {
          type: Number,
          required: true,
          min: 1,
          max: 5
        },
        communication: {
          type: Number,
          required: true,
          min: 1,
          max: 5
        },
        costEffectiveness: {
          type: Number,
          required: true,
          min: 1,
          max: 5
        }
      },
      comment: {
        type: String,
        required: true,
        maxlength: [1000, 'Review comment cannot exceed 1000 characters']
      },
      wouldRecommend: {
        type: Boolean,
        required: true
      },
      reviewDate: {
        type: Date,
        default: Date.now
      },
      projectDuration: Number, // in days
      contractValue: Number
    }],
    // Status and preferences
    status: {
      type: String,
      enum: ['Active', 'Inactive', 'Blacklisted', 'Under Review'],
      default: 'Active'
    },
    isPreferred: {
      type: Boolean,
      default: false
    },
    blacklistReason: {
      type: String,
      trim: true
    },
    blacklistedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    blacklistedAt: Date,
    // Internal notes
    internalNotes: [{
      note: {
        type: String,
        required: true,
        maxlength: [1000, 'Note cannot exceed 1000 characters']
      },
      addedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
      },
      addedAt: {
        type: Date,
        default: Date.now
      },
      isPrivate: {
        type: Boolean,
        default: false
      }
    }],
    // Created and modified tracking
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
contractorSchema.index({ organization: 1, status: 1 });
contractorSchema.index({ organization: 1, type: 1 });
contractorSchema.index({ specialization: 1 });
contractorSchema.index({ 'rating.overall': -1 });
contractorSchema.index({ 'contactInfo.primaryContact.phone': 1 });
contractorSchema.index({ 'businessInfo.gstNumber': 1 });
// PAN index removed — encrypted values are not searchable via index
contractorSchema.index({ isPreferred: 1, status: 1 });

// Text index for search functionality
contractorSchema.index({
  name: 'text',
  companyName: 'text',
  'contactInfo.primaryContact.name': 'text',
  specialization: 'text'
});

// Virtual for full address
contractorSchema.virtual('fullAddress').get(function() {
  const addr = this.address;
  return [addr.street, addr.area, addr.city, addr.state, addr.pincode].filter(Boolean).join(', ');
});

// Virtual for completion rate
contractorSchema.virtual('completionRate').get(function() {
  const total = this.workHistory.totalProjects;
  if (total === 0) return 0;
  return ((this.workHistory.completedProjects / total) * 100).toFixed(2);
});

// Virtual for current availability status
contractorSchema.virtual('availabilityStatus').get(function() {
  const now = new Date();
  if (this.status !== 'Active') return 'Unavailable';
  if (this.capacity.currentWorkload >= 100) return 'Fully Booked';
  if (this.capacity.availableFrom > now) return 'Available Soon';
  return 'Available';
});

// Method to update rating
contractorSchema.methods.updateRating = function() {
  if (this.reviews.length === 0) return;
  
  const totalReviews = this.reviews.length;
  const ratings = this.reviews.reduce((acc, review) => {
    acc.overall += review.rating.overall;
    acc.quality += review.rating.quality;
    acc.timeliness += review.rating.timeliness;
    acc.communication += review.rating.communication;
    acc.costEffectiveness += review.rating.costEffectiveness;
    return acc;
  }, { overall: 0, quality: 0, timeliness: 0, communication: 0, costEffectiveness: 0 });
  
  this.rating.overall = (ratings.overall / totalReviews).toFixed(2);
  this.rating.quality = (ratings.quality / totalReviews).toFixed(2);
  this.rating.timeliness = (ratings.timeliness / totalReviews).toFixed(2);
  this.rating.communication = (ratings.communication / totalReviews).toFixed(2);
  this.rating.costEffectiveness = (ratings.costEffectiveness / totalReviews).toFixed(2);
  this.rating.totalReviews = totalReviews;
  
  return this;
};

// Method to add review
contractorSchema.methods.addReview = function(reviewData) {
  this.reviews.push(reviewData);
  this.updateRating();
  return this.reviews[this.reviews.length - 1];
};

// Method to check availability for date range
contractorSchema.methods.isAvailableForPeriod = function(startDate, endDate) {
  const now = new Date();
  
  // Check basic availability conditions
  if (this.status !== 'Active') return false;
  if (this.capacity.currentWorkload >= 100) return false;
  if (this.capacity.availableFrom > startDate) return false;
  
  // Additional checks can be added here for overlapping projects
  return true;
};

// Method to update work history
contractorSchema.methods.updateWorkHistory = function(projectData) {
  this.workHistory.totalProjects += 1;
  
  if (projectData.status === 'Completed') {
    this.workHistory.completedProjects += 1;
    this.workHistory.totalContractValue += projectData.contractValue || 0;
    
    // Update average project duration
    if (projectData.duration) {
      const totalDuration = this.workHistory.averageProjectDuration * (this.workHistory.completedProjects - 1);
      this.workHistory.averageProjectDuration = (totalDuration + projectData.duration) / this.workHistory.completedProjects;
    }
    
    // Update on-time completion rate
    if (projectData.completedOnTime !== undefined) {
      const totalOnTime = this.workHistory.onTimeCompletionRate * (this.workHistory.completedProjects - 1) / 100;
      const newOnTime = totalOnTime + (projectData.completedOnTime ? 1 : 0);
      this.workHistory.onTimeCompletionRate = (newOnTime / this.workHistory.completedProjects) * 100;
    }
  } else if (projectData.status === 'Cancelled') {
    this.workHistory.cancelledProjects += 1;
  }
  
  return this;
};

// Static method to find contractors by specialization
contractorSchema.statics.findBySpecialization = function(organizationId, specialization, options = {}) {
  const query = {
    organization: organizationId,
    specialization: specialization,
    status: 'Active'
  };
  
  if (options.preferredOnly) {
    query.isPreferred = true;
  }
  
  if (options.minRating) {
    query['rating.overall'] = { $gte: options.minRating };
  }
  
  return this.find(query)
    .sort({ 'rating.overall': -1, isPreferred: -1 });
};

// Static method to get available contractors
contractorSchema.statics.getAvailableContractors = function(organizationId, startDate, endDate, specialization) {
  const query = {
    organization: organizationId,
    status: 'Active',
    'capacity.currentWorkload': { $lt: 100 },
    'capacity.availableFrom': { $lte: startDate }
  };
  
  if (specialization) {
    query.specialization = specialization;
  }
  
  return this.find(query)
    .sort({ 'rating.overall': -1, isPreferred: -1 });
};

// Pre-save middleware
contractorSchema.pre('save', function(next) {
  // Update rating if reviews were modified
  if (this.isModified('reviews')) {
    this.updateRating();
  }
  
  // Set last modified by
  if (this.isModified() && !this.isNew) {
    this.lastModifiedBy = this.createdBy; // This should be set by the controller
  }
  
  next();
});

// Field-level encryption for PII data
contractorSchema.plugin(encryptionPlugin, {
  fields: [
    'businessInfo.panNumber',
    'financialInfo.bankDetails.accountNumber',
  ],
});

const Contractor = mongoose.model('Contractor', contractorSchema);

export default Contractor;