// File: models/towerModel.js
// Description: Tower model for project hierarchy management (FIXED EXPORT)
// ===================================================================

import mongoose from 'mongoose';

const towerSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Organization',
      index: true
    },
    project: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Project',
      index: true
    },
    towerName: {
      type: String,
      required: [true, 'Tower name is required'],
      trim: true,
      maxlength: [100, 'Tower name cannot exceed 100 characters']
    },
    towerCode: {
      type: String,
      required: [true, 'Tower code is required'],
      trim: true,
      uppercase: true,
      maxlength: [10, 'Tower code cannot exceed 10 characters']
    },
    totalFloors: {
      type: Number,
      required: [true, 'Total floors is required'],
      min: [1, 'Tower must have at least 1 floor'],
      max: [200, 'Tower cannot exceed 200 floors']
    },
    unitsPerFloor: {
      type: Number,
      required: [true, 'Units per floor is required'],
      min: [1, 'Floor must have at least 1 unit'],
      max: [50, 'Floor cannot exceed 50 units']
    },
    totalUnits: {
      type: Number,
      required: true,
      default: function() {
        return this.totalFloors * this.unitsPerFloor;
      }
    },
    towerType: {
      type: String,
      enum: ['residential', 'commercial', 'mixed_use', 'parking'],
      default: 'residential'
    },
    status: {
      type: String,
      enum: ['planning', 'under_construction', 'completed', 'on_hold', 'cancelled'],
      default: 'planning'
    },
    // Tower-specific configuration
    configuration: {
      elevators: {
        count: { type: Number, default: 2 },
        type: { type: String, default: 'passenger' }
      },
      staircases: {
        count: { type: Number, default: 2 },
        type: { type: String, default: 'fire_exit' }
      },
      powerBackup: {
        type: String,
        enum: ['none', 'partial', 'full'],
        default: 'partial'
      },
      waterSupply: {
        type: String,
        enum: ['municipal', 'borewell', 'mixed'],
        default: 'municipal'
      },
      parking: {
        levels: { type: Number, default: 1 },
        capacity: { type: Number, default: 0 }
      }
    },
    // Tower-specific amenities
    amenities: {
      lobby: { type: Boolean, default: true },
      security: { type: Boolean, default: true },
      cctv: { type: Boolean, default: true },
      intercom: { type: Boolean, default: false },
      mailbox: { type: Boolean, default: true },
      generator: { type: Boolean, default: true },
      waterTank: { type: Boolean, default: true },
      sewageTreatment: { type: Boolean, default: false },
      rainwaterHarvesting: { type: Boolean, default: false },
      solarPanels: { type: Boolean, default: false }
    },
    // Pricing configuration
    pricingConfiguration: {
      basePriceModifier: {
        type: Number,
        default: 1.0,
        min: 0.5,
        max: 3.0
      },
      floorPremium: {
        startFloor: { type: Number, default: 5 },
        premiumPerFloor: { type: Number, default: 25000 }
      },
      penthousePremium: {
        enabled: { type: Boolean, default: false },
        topFloors: { type: Number, default: 1 },
        premiumPercentage: { type: Number, default: 15 }
      },
      cornerUnitPremium: {
        percentage: { type: Number, default: 5 }
      }
    },
    // Construction details
    construction: {
      plannedStartDate: Date,
      plannedCompletionDate: Date,
      actualStartDate: Date,
      actualCompletionDate: Date,
      contractor: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Contractor'
      },
      progressPercentage: {
        type: Number,
        default: 0,
        min: 0,
        max: 100
      }
    },
    // Financial tracking
    financials: {
      constructionCost: {
        budgeted: { type: Number, default: 0 },
        actual: { type: Number, default: 0 }
      },
      revenueTarget: { type: Number, default: 0 },
      revenueAchieved: { type: Number, default: 0 }
    },
    // Approval and compliance
    approvals: {
      buildingPlan: {
        status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
        approvalDate: Date,
        validUntil: Date
      },
      fireNOC: {
        status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
        approvalDate: Date,
        validUntil: Date
      },
      elevatorCertificate: {
        status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
        approvalDate: Date,
        validUntil: Date
      }
    },
    // Additional metadata
    metadata: {
      architect: String,
      consultant: String,
      structuralEngineer: String,
      facingDirection: {
        type: String,
        enum: ['North', 'South', 'East', 'West', 'North-East', 'North-West', 'South-East', 'South-West']
      },
      cornerTower: { type: Boolean, default: false },
      premiumLocation: { type: Boolean, default: false }
    },
    // Active status
    isActive: {
      type: Boolean,
      default: true
    },
    // Audit fields
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Indexes for performance
towerSchema.index({ organization: 1, project: 1 });
towerSchema.index({ towerCode: 1, project: 1 }, { unique: true });
towerSchema.index({ status: 1 });
towerSchema.index({ isActive: 1 });

// Compound index for unique tower names within a project
towerSchema.index({ project: 1, towerName: 1 }, { unique: true });

// Virtual for units count
towerSchema.virtual('unitsCount', {
  ref: 'Unit',
  localField: '_id',
  foreignField: 'tower',
  count: true
});

// Virtual for available units count
towerSchema.virtual('availableUnitsCount', {
  ref: 'Unit',
  localField: '_id',
  foreignField: 'tower',
  match: { status: 'available' },
  count: true
});

// Virtual for sold units count
towerSchema.virtual('soldUnitsCount', {
  ref: 'Unit',
  localField: '_id',
  foreignField: 'tower',
  match: { status: 'sold' },
  count: true
});

// Virtual for completion percentage
towerSchema.virtual('completionPercentage').get(function() {
  if (this.totalUnits === 0) return 0;
  const soldCount = this.soldUnitsCount || 0;
  return Math.round((soldCount / this.totalUnits) * 100);
});

// Virtual for revenue achievement percentage
towerSchema.virtual('revenueAchievementPercentage').get(function() {
  if (!this.financials.revenueTarget || this.financials.revenueTarget === 0) return 0;
  return Math.round((this.financials.revenueAchieved / this.financials.revenueTarget) * 100);
});

// Pre-save middleware to calculate total units
towerSchema.pre('save', function(next) {
  if (this.isModified('totalFloors') || this.isModified('unitsPerFloor')) {
    this.totalUnits = this.totalFloors * this.unitsPerFloor;
  }
  next();
});

// Pre-save middleware to set updatedBy
towerSchema.pre('save', function(next) {
  if (!this.isNew && this.isModified()) {
    this.updatedBy = this._user || this.updatedBy;
  }
  next();
});

// Instance method to calculate pricing for a unit in this tower
towerSchema.methods.calculateUnitPrice = function(floor, isCornerUnit = false, basePrice = 0) {
  let finalPrice = basePrice || 1000000; // Default base price
  
  // Apply tower base price modifier
  finalPrice *= this.pricingConfiguration.basePriceModifier;
  
  // Apply floor premium
  if (floor >= this.pricingConfiguration.floorPremium.startFloor) {
    const premiumFloors = floor - this.pricingConfiguration.floorPremium.startFloor + 1;
    finalPrice += premiumFloors * this.pricingConfiguration.floorPremium.premiumPerFloor;
  }
  
  // Apply penthouse premium
  if (this.pricingConfiguration.penthousePremium.enabled) {
    const penthouseFloor = this.totalFloors - this.pricingConfiguration.penthousePremium.topFloors + 1;
    if (floor >= penthouseFloor) {
      finalPrice *= (1 + this.pricingConfiguration.penthousePremium.premiumPercentage / 100);
    }
  }
  
  // Apply corner unit premium
  if (isCornerUnit && this.pricingConfiguration.cornerUnitPremium.percentage > 0) {
    finalPrice *= (1 + this.pricingConfiguration.cornerUnitPremium.percentage / 100);
  }
  
  return Math.round(finalPrice);
};

// Instance method to check if tower is ready for sales
towerSchema.methods.isReadyForSales = function() {
  const requiredApprovals = ['buildingPlan'];
  return requiredApprovals.every(approval => 
    this.approvals[approval] && this.approvals[approval].status === 'approved'
  );
};

// Static method to get towers by project
towerSchema.statics.getByProject = function(projectId) {
  return this.find({ project: projectId, isActive: true })
    .populate('createdBy', 'firstName lastName')
    .populate('construction.contractor', 'name contactPerson')
    .sort({ towerCode: 1 });
};

// Static method to get tower analytics
towerSchema.statics.getTowerAnalytics = async function(towerId) {
  const Unit = mongoose.model('Unit');
  const Sale = mongoose.model('Sale');
  
  const tower = await this.findById(towerId);
  if (!tower) throw new Error('Tower not found');
  
  const analytics = await Unit.aggregate([
    { $match: { tower: tower._id } },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalValue: { $sum: '$currentPrice' }
      }
    }
  ]);
  
  const salesData = await Sale.aggregate([
    {
      $lookup: {
        from: 'units',
        localField: 'unit',
        foreignField: '_id',
        as: 'unitInfo'
      }
    },
    { $unwind: '$unitInfo' },
    { $match: { 'unitInfo.tower': tower._id } },
    {
      $group: {
        _id: null,
        totalSales: { $sum: 1 },
        totalRevenue: { $sum: '$salePrice' },
        averagePrice: { $avg: '$salePrice' }
      }
    }
  ]);
  
  return {
    tower,
    unitAnalytics: analytics,
    salesAnalytics: salesData[0] || { totalSales: 0, totalRevenue: 0, averagePrice: 0 }
  };
};

const Tower = mongoose.model('Tower', towerSchema);

export default Tower;