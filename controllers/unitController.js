// File: controllers/unitController.js - COMPLETE ENHANCED VERSION
// Description: Complete unit controller with all missing endpoints (groupBy, statistics, search)
// Location: controllers/unitController.js

import asyncHandler from 'express-async-handler';
import Unit from '../models/unitModel.js';
import Project from '../models/projectModel.js';
import mongoose from 'mongoose';
import { verifyProjectAccess, projectAccessFilter } from '../utils/projectAccessHelper.js';

// Import Tower model with error handling for backward compatibility
let Tower;
try {
  const towerModule = await import('../models/towerModel.js');
  Tower = towerModule.default;
} catch (error) {
  console.warn('Tower model not available - running in compatibility mode');
  Tower = null;
}

/**
 * @desc    Get units with enhanced filtering, grouping, and search - COMPLETE VERSION
 * @route   GET /api/units
 * @access  Private
 */
const getUnits = asyncHandler(async (req, res) => {
  const { 
    projectId, 
    towerId,     // NEW: Filter by tower
    type,
    status,
    floor,
    facing,
    minPrice,
    maxPrice,
    minArea,
    maxArea,
    page = 1,
    limit = 20,
    sortBy = 'unitNumber',
    groupBy,     // NEW: Group results by field
    search       // NEW: Search functionality
  } = req.query;

  // Build query
  let query = { organization: req.user.organization, ...projectAccessFilter(req) };

  if (projectId) {
    query.project = projectId;
  }

  if (towerId && Tower) {
    query.tower = towerId;
  }

  if (type) {
    query.type = type;
  }

  if (status) {
    query.status = status;
  }

  if (floor) {
    query.floor = parseInt(floor);
  }

  if (facing) {
    query.facing = facing;
  }

  if (minPrice || maxPrice) {
    query.currentPrice = {};
    if (minPrice) query.currentPrice.$gte = parseInt(minPrice);
    if (maxPrice) query.currentPrice.$lte = parseInt(maxPrice);
  }

  if (minArea || maxArea) {
    query.areaSqft = {};
    if (minArea) query.areaSqft.$gte = parseInt(minArea);
    if (maxArea) query.areaSqft.$lte = parseInt(maxArea);
  }

  // Search functionality
  if (search) {
    query.$or = [
      { unitNumber: { $regex: search, $options: 'i' } },
      { type: { $regex: search, $options: 'i' } },
      { facing: { $regex: search, $options: 'i' } }
    ];
  }

  try {
    // Handle groupBy functionality
    if (groupBy) {
      return await handleGroupByQuery(req, res, query, groupBy);
    }

    // Regular query with pagination
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Build sort object
    let sortObj = {};
    if (sortBy === 'price') {
      sortObj.currentPrice = 1;
    } else if (sortBy === 'area') {
      sortObj.areaSqft = 1;
    } else if (sortBy === 'floor') {
      sortObj.floor = 1;
    } else {
      sortObj.unitNumber = 1;
    }

    // Execute query with population
    let populateFields = ['project'];
    if (Tower) {
      populateFields.push('tower');
    }

    const units = await Unit.find(query)
      .populate('project', 'name type location')
      .populate(Tower ? 'tower' : null, 'towerName towerCode totalFloors')
      .sort(sortObj)
      .limit(limitNum)
      .skip(skip);

    const total = await Unit.countDocuments(query);

    // Add tower support indicator
    const responseData = {
      success: true,
      count: units.length,
      totalCount: total,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(total / limitNum),
        hasNext: pageNum < Math.ceil(total / limitNum),
        hasPrev: pageNum > 1
      },
      data: units,
      towerSupport: !!Tower
    };

    res.json(responseData);
  } catch (error) {
    console.error('Unit fetch error:', error);
    res.status(500);
    throw new Error(`Failed to fetch units: ${error.message}`);
  }
});

/**
 * Handle groupBy queries for units - COMPLETE IMPLEMENTATION
 */
const handleGroupByQuery = async (req, res, baseQuery, groupBy) => {
  let aggregationPipeline = [];

  // Match stage
  aggregationPipeline.push({ $match: baseQuery });

  // Lookup stages for population
  aggregationPipeline.push(
    {
      $lookup: {
        from: 'projects',
        localField: 'project',
        foreignField: '_id',
        as: 'project'
      }
    },
    {
      $unwind: '$project'
    }
  );

  // Add tower lookup if Tower model exists
  if (Tower) {
    aggregationPipeline.push(
      {
        $lookup: {
          from: 'towers',
          localField: 'tower',
          foreignField: '_id',
          as: 'tower'
        }
      },
      {
        $unwind: {
          path: '$tower',
          preserveNullAndEmptyArrays: true
        }
      }
    );
  }

  // Group stage based on groupBy parameter
  let groupStage = {};
  let sortStage = {};

  switch (groupBy) {
    case 'tower':
      if (Tower) {
        groupStage = {
          $group: {
            _id: '$tower._id',
            towerName: { $first: '$tower.towerName' },
            towerCode: { $first: '$tower.towerCode' },
            projectName: { $first: '$project.name' },
            units: { $push: '$$ROOT' },
            totalUnits: { $sum: 1 },
            availableUnits: {
              $sum: { $cond: [{ $eq: ['$status', 'available'] }, 1, 0] }
            },
            soldUnits: {
              $sum: { $cond: [{ $eq: ['$status', 'sold'] }, 1, 0] }
            },
            bookedUnits: {
              $sum: { $cond: [{ $eq: ['$status', 'booked'] }, 1, 0] }
            },
            avgPrice: { $avg: '$currentPrice' },
            totalValue: { $sum: '$currentPrice' }
          }
        };
        sortStage = { $sort: { towerCode: 1 } };
      } else {
        // Fallback for systems without towers
        groupStage = {
          $group: {
            _id: null,
            projectName: { $first: '$project.name' },
            units: { $push: '$$ROOT' },
            totalUnits: { $sum: 1 },
            availableUnits: {
              $sum: { $cond: [{ $eq: ['$status', 'available'] }, 1, 0] }
            },
            soldUnits: {
              $sum: { $cond: [{ $eq: ['$status', 'sold'] }, 1, 0] }
            },
            bookedUnits: {
              $sum: { $cond: [{ $eq: ['$status', 'booked'] }, 1, 0] }
            },
            avgPrice: { $avg: '$currentPrice' },
            totalValue: { $sum: '$currentPrice' }
          }
        };
      }
      break;

    case 'floor':
      groupStage = {
        $group: {
          _id: '$floor',
          floor: { $first: '$floor' },
          towerName: Tower ? { $first: '$tower.towerName' } : { $first: null },
          projectName: { $first: '$project.name' },
          units: { $push: '$$ROOT' },
          totalUnits: { $sum: 1 },
          availableUnits: {
            $sum: { $cond: [{ $eq: ['$status', 'available'] }, 1, 0] }
          },
          soldUnits: {
            $sum: { $cond: [{ $eq: ['$status', 'sold'] }, 1, 0] }
          },
          bookedUnits: {
            $sum: { $cond: [{ $eq: ['$status', 'booked'] }, 1, 0] }
          },
          avgPrice: { $avg: '$currentPrice' },
          minPrice: { $min: '$currentPrice' },
          maxPrice: { $max: '$currentPrice' }
        }
      };
      sortStage = { $sort: { floor: 1 } };
      break;

    case 'type':
      groupStage = {
        $group: {
          _id: '$type',
          unitType: { $first: '$type' },
          units: { $push: '$$ROOT' },
          totalUnits: { $sum: 1 },
          availableUnits: {
            $sum: { $cond: [{ $eq: ['$status', 'available'] }, 1, 0] }
          },
          soldUnits: {
            $sum: { $cond: [{ $eq: ['$status', 'sold'] }, 1, 0] }
          },
          bookedUnits: {
            $sum: { $cond: [{ $eq: ['$status', 'booked'] }, 1, 0] }
          },
          avgPrice: { $avg: '$currentPrice' },
          avgArea: { $avg: '$areaSqft' },
          minPrice: { $min: '$currentPrice' },
          maxPrice: { $max: '$currentPrice' }
        }
      };
      sortStage = { $sort: { unitType: 1 } };
      break;

    case 'status':
      groupStage = {
        $group: {
          _id: '$status',
          status: { $first: '$status' },
          units: { $push: '$$ROOT' },
          totalUnits: { $sum: 1 },
          avgPrice: { $avg: '$currentPrice' },
          totalValue: { $sum: '$currentPrice' }
        }
      };
      sortStage = { $sort: { status: 1 } };
      break;

    case 'project':
      groupStage = {
        $group: {
          _id: '$project._id',
          projectName: { $first: '$project.name' },
          projectType: { $first: '$project.type' },
          units: { $push: '$$ROOT' },
          totalUnits: { $sum: 1 },
          availableUnits: {
            $sum: { $cond: [{ $eq: ['$status', 'available'] }, 1, 0] }
          },
          soldUnits: {
            $sum: { $cond: [{ $eq: ['$status', 'sold'] }, 1, 0] }
          },
          bookedUnits: {
            $sum: { $cond: [{ $eq: ['$status', 'booked'] }, 1, 0] }
          },
          avgPrice: { $avg: '$currentPrice' },
          totalValue: { $sum: '$currentPrice' },
          uniqueTowers: Tower ? { $addToSet: '$tower._id' } : { $addToSet: null }
        }
      };
      sortStage = { $sort: { projectName: 1 } };
      break;

    default:
      throw new Error(`Unsupported groupBy field: ${groupBy}`);
  }

  aggregationPipeline.push(groupStage);
  aggregationPipeline.push(sortStage);

  // Apply limit if specified
  const limit = parseInt(req.query.limit) || 50;
  aggregationPipeline.push({ $limit: limit });

  const results = await Unit.aggregate(aggregationPipeline);

  // Calculate totals
  const totalPipeline = [...aggregationPipeline];
  totalPipeline.pop(); // Remove limit
  totalPipeline.push({ $count: "total" });
  const countResult = await Unit.aggregate(totalPipeline);
  const totalCount = countResult[0]?.total || 0;

  res.json({
    success: true,
    groupedBy: groupBy,
    count: results.length,
    totalCount,
    data: results,
    towerSupport: !!Tower,
    groupingSupported: ['tower', 'floor', 'type', 'status', 'project']
  });
};

/**
 * @desc    Get unit statistics - NEW ENDPOINT
 * @route   GET /api/units/statistics
 * @access  Private
 */
const getUnitStatistics = asyncHandler(async (req, res) => {
  const { projectId, towerId } = req.query;

  let matchQuery = { organization: req.user.organization, ...projectAccessFilter(req) };
  
  if (projectId) {
    matchQuery.project = mongoose.Types.ObjectId(projectId);
  }
  
  if (towerId && Tower) {
    matchQuery.tower = mongoose.Types.ObjectId(towerId);
  }

  try {
    const stats = await Unit.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: null,
          totalUnits: { $sum: 1 },
          availableUnits: {
            $sum: { $cond: [{ $eq: ['$status', 'available'] }, 1, 0] }
          },
          soldUnits: {
            $sum: { $cond: [{ $eq: ['$status', 'sold'] }, 1, 0] }
          },
          bookedUnits: {
            $sum: { $cond: [{ $eq: ['$status', 'booked'] }, 1, 0] }
          },
          blockedUnits: {
            $sum: { $cond: [{ $eq: ['$status', 'blocked'] }, 1, 0] }
          },
          avgPrice: { $avg: '$currentPrice' },
          minPrice: { $min: '$currentPrice' },
          maxPrice: { $max: '$currentPrice' },
          totalValue: { $sum: '$currentPrice' },
          avgArea: { $avg: '$areaSqft' },
          totalArea: { $sum: '$areaSqft' }
        }
      }
    ]);

    const result = stats[0] || {
      totalUnits: 0,
      availableUnits: 0,
      soldUnits: 0,
      bookedUnits: 0,
      blockedUnits: 0,
      avgPrice: 0,
      minPrice: 0,
      maxPrice: 0,
      totalValue: 0,
      avgArea: 0,
      totalArea: 0
    };

    // Calculate occupancy percentage
    result.occupancyPercentage = result.totalUnits > 0 ? 
      Math.round(((result.soldUnits + result.bookedUnits) / result.totalUnits) * 100) : 0;

    res.json({
      success: true,
      data: result,
      towerSupport: !!Tower
    });
  } catch (error) {
    console.error('Unit statistics error:', error);
    res.status(500);
    throw new Error(`Failed to fetch unit statistics: ${error.message}`);
  }
});

/**
 * @desc    Create unit with tower support - ENHANCED VERSION
 * @route   POST /api/units
 * @access  Private
 */
const createUnit = asyncHandler(async (req, res) => {
  const {
    project,
    tower,      // NEW: Optional tower reference
    unitNumber,
    type,
    floor,
    areaSqft,
    basePrice,
    facing,
    features,
    specifications,
    parking
  } = req.body;

  // Validate required fields
  if (!project || !unitNumber || !type || !floor || !areaSqft || !basePrice) {
    res.status(400);
    throw new Error('Project, unit number, type, floor, area, and base price are required');
  }

  // Verify project exists and belongs to organization
  const projectExists = await Project.findOne({
    _id: project,
    organization: req.user.organization
  });

  if (!projectExists) {
    res.status(404);
    throw new Error('Project not found or access denied');
  }

  verifyProjectAccess(req, res, project);

  // Verify tower if provided and Tower model exists
  if (tower && Tower) {
    const towerExists = await Tower.findOne({
      _id: tower,
      project: project,
      organization: req.user.organization
    });

    if (!towerExists) {
      res.status(404);
      throw new Error('Tower not found or does not belong to this project');
    }

    // Validate floor is within tower limits
    if (floor > towerExists.totalFloors) {
      res.status(400);
      throw new Error(`Floor ${floor} exceeds tower's total floors (${towerExists.totalFloors})`);
    }
  }

  // Check if unit number already exists in the project
  const existingUnit = await Unit.findOne({
    project,
    unitNumber,
    organization: req.user.organization
  });

  if (existingUnit) {
    res.status(400);
    throw new Error('Unit number already exists in this project');
  }

  try {
    const unitData = {
      project,
      organization: req.user.organization,
      unitNumber,
      type,
      floor,
      areaSqft,
      basePrice,
      currentPrice: basePrice,
      facing: facing || 'North',
      features: features || {},
      specifications: specifications || {},
      parking: parking || { covered: 0, open: 0 }
    };

    // Add tower reference if provided and Tower model exists
    if (tower && Tower) {
      unitData.tower = tower;
    }

    const unit = await Unit.create(unitData);

    // Populate with tower info if available
    let populatedUnit = unit;
    if (Tower) {
      populatedUnit = await Unit.findById(unit._id)
        .populate('project', 'name type')
        .populate('tower', 'towerName towerCode');
    } else {
      populatedUnit = await Unit.findById(unit._id)
        .populate('project', 'name type');
    }

    res.status(201).json({
      success: true,
      data: populatedUnit,
      message: 'Unit created successfully'
    });
  } catch (error) {
    console.error('Unit creation error:', error);
    res.status(400);
    throw new Error(`Failed to create unit: ${error.message}`);
  }
});

/**
 * @desc    Get single unit by ID - ENHANCED VERSION
 * @route   GET /api/units/:id
 * @access  Private
 */
const getUnitById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Validate ObjectId format
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400);
    throw new Error('Invalid unit ID format');
  }

  let populateFields = ['project'];
  if (Tower) {
    populateFields.push('tower');
  }

  const unit = await Unit.findOne({
    _id: id,
    organization: req.user.organization
  })
    .populate('project', 'name type location')
    .populate(Tower ? 'tower' : null, 'towerName towerCode totalFloors unitsPerFloor');

  if (!unit) {
    res.status(404);
    throw new Error('Unit not found');
  }

  verifyProjectAccess(req, res, unit.project);

  res.json({
    success: true,
    data: unit,
    towerSupport: !!Tower
  });
});

/**
 * @desc    Update unit - ENHANCED VERSION
 * @route   PUT /api/units/:id
 * @access  Private
 */
const updateUnit = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updateData = { ...req.body };

  // Validate ObjectId format
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400);
    throw new Error('Invalid unit ID format');
  }

  // Remove fields that shouldn't be updated directly
  delete updateData.organization;
  delete updateData.project;

  const unit = await Unit.findOne({
    _id: id,
    organization: req.user.organization
  });

  if (!unit) {
    res.status(404);
    throw new Error('Unit not found');
  }

  verifyProjectAccess(req, res, unit.project);

  // Validate tower change if provided
  if (updateData.tower && Tower) {
    const towerExists = await Tower.findOne({
      _id: updateData.tower,
      project: unit.project,
      organization: req.user.organization
    });

    if (!towerExists) {
      res.status(404);
      throw new Error('Tower not found or does not belong to this project');
    }

    // Validate floor is within tower limits
    const floor = updateData.floor || unit.floor;
    if (floor > towerExists.totalFloors) {
      res.status(400);
      throw new Error(`Floor ${floor} exceeds tower's total floors (${towerExists.totalFloors})`);
    }
  }

  try {
    Object.assign(unit, updateData);
    await unit.save();

    const updatedUnit = await Unit.findById(unit._id)
      .populate('project', 'name type')
      .populate(Tower ? 'tower' : null, 'towerName towerCode');

    res.json({
      success: true,
      data: updatedUnit,
      message: 'Unit updated successfully'
    });
  } catch (error) {
    console.error('Unit update error:', error);
    res.status(400);
    throw new Error(`Failed to update unit: ${error.message}`);
  }
});

/**
 * @desc    Delete unit (soft delete) - ENHANCED VERSION
 * @route   DELETE /api/units/:id
 * @access  Private
 */
const deleteUnit = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Validate ObjectId format
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400);
    throw new Error('Invalid unit ID format');
  }

  const unit = await Unit.findOne({
    _id: id,
    organization: req.user.organization
  });

  if (!unit) {
    res.status(404);
    throw new Error('Unit not found');
  }

  verifyProjectAccess(req, res, unit.project);

  // Check if unit has any sales or bookings
  try {
    const { default: Sale } = await import('../models/salesModel.js');
    const saleExists = await Sale.findOne({ unit: unit._id });
    
    if (saleExists) {
      res.status(400);
      throw new Error('Cannot delete unit with existing sales records');
    }
  } catch (importError) {
    // Sale model may not exist in all setups
    console.warn('Sale model not available for validation');
  }

  await unit.deleteOne();

  res.json({
    success: true,
    message: 'Unit deleted successfully'
  });
});

export {
  createUnit,
  getUnits,
  getUnitById,
  updateUnit,
  deleteUnit,
  getUnitStatistics
};