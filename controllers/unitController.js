// File: controllers/unitController.js (UPDATED)
// Description: Updated unit controller to handle tower relationships with proper error handling
// ===================================================================

import asyncHandler from 'express-async-handler';
import Unit from '../models/unitModel.js';
import Project from '../models/projectModel.js';
import mongoose from 'mongoose';

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
 * @desc    Create a new unit (updated to support towers)
 * @route   POST /api/units
 * @access  Private (Management roles)
 */
const createUnit = asyncHandler(async (req, res) => {
  const {
    project,
    tower,
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

  // If tower is specified and Tower model is available, verify it exists
  if (tower && Tower) {
    const towerExists = await Tower.findOne({
      _id: tower,
      project: project,
      organization: req.user.organization,
      isActive: true
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
    res.status(400);
    throw new Error(`Failed to create unit: ${error.message}`);
  }
});

/**
 * @desc    Get units (updated to support tower filtering)
 * @route   GET /api/units
 * @access  Private
 */
const getUnits = asyncHandler(async (req, res) => {
  const { 
    projectId, 
    towerId, 
    status, 
    floor, 
    type, 
    groupBy,
    page = 1, 
    limit = 50 
  } = req.query;

  let query = { organization: req.user.organization };

  if (projectId) query.project = projectId;
  if (towerId && Tower) query.tower = towerId;
  if (status) query.status = status;
  if (floor) query.floor = parseInt(floor);
  if (type) query.type = type;

  try {
    let units;
    let totalCount;

    if (groupBy === 'tower' && Tower) {
      // Group units by tower (only if Tower model exists)
      units = await Unit.aggregate([
        { $match: query },
        {
          $lookup: {
            from: 'towers',
            localField: 'tower',
            foreignField: '_id',
            as: 'towerInfo'
          }
        },
        {
          $lookup: {
            from: 'projects',
            localField: 'project',
            foreignField: '_id',
            as: 'projectInfo'
          }
        },
        {
          $group: {
            _id: '$tower',
            towerInfo: { $first: { $arrayElemAt: ['$towerInfo', 0] } },
            projectInfo: { $first: { $arrayElemAt: ['$projectInfo', 0] } },
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
            totalValue: { $sum: '$currentPrice' },
            averagePrice: { $avg: '$currentPrice' }
          }
        },
        {
          $sort: { 'towerInfo.towerCode': 1 }
        }
      ]);

      totalCount = units.length;
    } else if (groupBy === 'floor') {
      // Group units by floor
      const groupField = Tower ? { tower: '$tower', floor: '$floor' } : { project: '$project', floor: '$floor' };
      
      units = await Unit.aggregate([
        { $match: query },
        ...(Tower ? [{
          $lookup: {
            from: 'towers',
            localField: 'tower',
            foreignField: '_id',
            as: 'towerInfo'
          }
        }] : []),
        {
          $group: {
            _id: groupField,
            ...(Tower ? { towerInfo: { $first: { $arrayElemAt: ['$towerInfo', 0] } } } : {}),
            units: { $push: '$$ROOT' },
            totalUnits: { $sum: 1 },
            availableUnits: {
              $sum: { $cond: [{ $eq: ['$status', 'available'] }, 1, 0] }
            }
          }
        },
        {
          $sort: Tower ? { '_id.tower': 1, '_id.floor': 1 } : { '_id.project': 1, '_id.floor': 1 }
        }
      ]);

      totalCount = units.length;
    } else {
      // Regular listing with pagination
      const skip = (parseInt(page) - 1) * parseInt(limit);
      
      let populateFields = [
        { path: 'project', select: 'name type location' }
      ];

      // Add tower population only if Tower model exists
      if (Tower) {
        populateFields.push({ path: 'tower', select: 'towerName towerCode totalFloors' });
      }
      
      units = await Unit.find(query)
        .populate(populateFields)
        .sort(Tower ? { 'tower.towerCode': 1, floor: 1, unitNumber: 1 } : { project: 1, floor: 1, unitNumber: 1 })
        .limit(parseInt(limit))
        .skip(skip);

      totalCount = await Unit.countDocuments(query);
    }

    res.json({
      success: true,
      count: units.length,
      totalCount,
      currentPage: parseInt(page),
      totalPages: Math.ceil(totalCount / parseInt(limit)),
      data: units,
      towerSupport: !!Tower
    });
  } catch (error) {
    res.status(500);
    throw new Error(`Failed to fetch units: ${error.message}`);
  }
});

/**
 * @desc    Get single unit by ID
 * @route   GET /api/units/:id
 * @access  Private
 */
const getUnitById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  let populateFields = [
    { path: 'project', select: 'name type location' }
  ];

  // Add tower population only if Tower model exists
  if (Tower) {
    populateFields.push({ path: 'tower', select: 'towerName towerCode totalFloors amenities' });
  }

  const unit = await Unit.findOne({
    _id: id,
    organization: req.user.organization
  }).populate(populateFields);

  if (!unit) {
    res.status(404);
    throw new Error('Unit not found');
  }

  res.json({
    success: true,
    data: unit,
    towerSupport: !!Tower
  });
});

/**
 * @desc    Update unit (with tower support)
 * @route   PUT /api/units/:id
 * @access  Private (Management roles)
 */
const updateUnit = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updateData = { ...req.body };

  // Remove fields that shouldn't be updated directly
  delete updateData.organization;
  delete updateData.project;

  let populateFields = [{ path: 'project', select: 'name type' }];
  if (Tower) {
    populateFields.push({ path: 'tower', select: 'towerName towerCode totalFloors' });
  }

  const unit = await Unit.findOne({
    _id: id,
    organization: req.user.organization
  }).populate(populateFields);

  if (!unit) {
    res.status(404);
    throw new Error('Unit not found');
  }

  // If tower is being changed and Tower model exists, validate the new tower
  if (updateData.tower && Tower && updateData.tower !== unit.tower?._id?.toString()) {
    const newTower = await Tower.findOne({
      _id: updateData.tower,
      project: unit.project._id,
      organization: req.user.organization,
      isActive: true
    });

    if (!newTower) {
      res.status(404);
      throw new Error('New tower not found or does not belong to this project');
    }

    // Validate floor is within new tower limits
    const floorToCheck = updateData.floor || unit.floor;
    if (floorToCheck > newTower.totalFloors) {
      res.status(400);
      throw new Error(`Floor ${floorToCheck} exceeds tower's total floors (${newTower.totalFloors})`);
    }
  }

  // If floor is being changed and unit has a tower, validate floor limits
  if (updateData.floor && unit.tower && Tower && updateData.floor > unit.tower.totalFloors) {
    res.status(400);
    throw new Error(`Floor ${updateData.floor} exceeds tower's total floors (${unit.tower.totalFloors})`);
  }

  try {
    Object.assign(unit, updateData);
    await unit.save();

    const updatedUnit = await Unit.findById(unit._id).populate(populateFields);

    res.json({
      success: true,
      data: updatedUnit,
      message: 'Unit updated successfully'
    });
  } catch (error) {
    res.status(400);
    throw new Error(`Failed to update unit: ${error.message}`);
  }
});

/**
 * @desc    Delete unit
 * @route   DELETE /api/units/:id
 * @access  Private (Management roles)
 */
const deleteUnit = asyncHandler(async (req, res) => {
  const unit = await Unit.findOne({
    _id: req.params.id,
    organization: req.user.organization
  });

  if (!unit) {
    res.status(404);
    throw new Error('Unit not found');
  }

  // Check if unit is booked or sold
  if (unit.status === 'booked' || unit.status === 'sold') {
    res.status(400);
    throw new Error('Cannot delete a unit that is booked or sold');
  }

  await Unit.findByIdAndDelete(req.params.id);

  res.json({
    success: true,
    message: 'Unit deleted successfully'
  });
});

/**
 * @desc    Get units by project with optional tower filtering
 * @route   GET /api/units/project/:projectId
 * @access  Private
 */
const getUnitsByProject = asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  const { towerId, status, groupBy } = req.query;

  let query = { 
    project: projectId,
    organization: req.user.organization 
  };

  if (towerId && Tower) query.tower = towerId;
  if (status) query.status = status;

  try {
    let units;

    if (groupBy === 'tower' && Tower) {
      // Group by tower
      units = await Unit.aggregate([
        { $match: query },
        {
          $lookup: {
            from: 'towers',
            localField: 'tower',
            foreignField: '_id',
            as: 'towerInfo'
          }
        },
        {
          $group: {
            _id: '$tower',
            towerName: { $first: { $arrayElemAt: ['$towerInfo.towerName', 0] } },
            towerCode: { $first: { $arrayElemAt: ['$towerInfo.towerCode', 0] } },
            units: { $push: '$$ROOT' },
            totalUnits: { $sum: 1 },
            availableUnits: {
              $sum: { $cond: [{ $eq: ['$status', 'available'] }, 1, 0] }
            }
          }
        },
        { $sort: { towerCode: 1 } }
      ]);
    } else if (groupBy === 'floor') {
      // Group by floor
      units = await Unit.aggregate([
        { $match: query },
        {
          $group: {
            _id: '$floor',
            units: { $push: '$$ROOT' },
            totalUnits: { $sum: 1 }
          }
        },
        { $sort: { _id: 1 } }
      ]);
    } else {
      // Regular fetch
      let populateFields = [{ path: 'project', select: 'name type' }];
      if (Tower) {
        populateFields.push({ path: 'tower', select: 'towerName towerCode' });
      }

      units = await Unit.find(query)
        .populate(populateFields)
        .sort({ floor: 1, unitNumber: 1 });
    }

    res.json({
      success: true,
      count: units.length,
      data: units,
      towerSupport: !!Tower
    });
  } catch (error) {
    res.status(500);
    throw new Error(`Failed to fetch units: ${error.message}`);
  }
});

export {
  createUnit,
  getUnits,
  getUnitById,
  updateUnit,
  deleteUnit,
  getUnitsByProject
};