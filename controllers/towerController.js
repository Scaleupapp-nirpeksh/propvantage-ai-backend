// File: controllers/towerController.js - FIXED VERSION
// Description: Fixed tower management controller addressing test failures
// ===================================================================

import asyncHandler from 'express-async-handler';
import Tower from '../models/towerModel.js';
import Unit from '../models/unitModel.js';
import Project from '../models/projectModel.js';
import mongoose from 'mongoose';
import {
  verifyProjectAccess,
  projectAccessFilter,
} from '../utils/projectAccessHelper.js';

/**
 * @desc    Get all towers for a project - FIXED VERSION
 * @route   GET /api/towers
 * @access  Private
 */
const getTowers = asyncHandler(async (req, res) => {
  const { projectId, status, includeInactive } = req.query;

  let query = { organization: req.user.organization, ...projectAccessFilter(req) };

  if (projectId) {
    query.project = projectId;
  }

  if (status) {
    query.status = status;
  }

  if (includeInactive !== 'true') {
    query.isActive = true;
  }

  try {
    // FIXED: Simplified population to avoid undefined reference errors
    const towers = await Tower.find(query)
      .populate('project', 'name type location')
      .populate('createdBy', 'firstName lastName')
      .sort({ towerCode: 1 });

    // FIXED: Calculate unit counts manually to avoid virtual population issues
    const enhancedTowers = await Promise.all(towers.map(async (tower) => {
      const towerObj = tower.toObject();
      
      // Calculate unit counts
      const totalUnitsFromDB = await Unit.countDocuments({ tower: tower._id });
      const availableUnits = await Unit.countDocuments({ tower: tower._id, status: 'available' });
      const soldUnits = await Unit.countDocuments({ tower: tower._id, status: 'sold' });
      const bookedUnits = await Unit.countDocuments({ tower: tower._id, status: 'booked' });

      towerObj.salesProgress = {
        totalUnits: tower.totalUnits,
        unitsFromDB: totalUnitsFromDB,
        availableUnits,
        soldUnits,
        bookedUnits,
        occupancyPercentage: tower.totalUnits > 0 ? 
          Math.round(((soldUnits + bookedUnits) / tower.totalUnits) * 100) : 0
      };
      
      return towerObj;
    }));

    res.json({
      success: true,
      count: enhancedTowers.length,
      data: enhancedTowers,
      towerSupport: true // Add indicator for backward compatibility
    });
  } catch (error) {
    console.error('Tower fetch error:', error);
    res.status(500);
    throw new Error(`Failed to fetch towers: ${error.message}`);
  }
});

/**
 * @desc    Get single tower by ID - FIXED VERSION
 * @route   GET /api/towers/:id
 * @access  Private
 */
const getTowerById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { includeUnits, includeAnalytics } = req.query;

  // FIXED: Validate ObjectId format
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400);
    throw new Error('Invalid tower ID format');
  }

  const tower = await Tower.findOne({
    _id: id,
    organization: req.user.organization
  })
    .populate('project', 'name type location')
    .populate('createdBy', 'firstName lastName')
    .populate('updatedBy', 'firstName lastName');

  if (!tower) {
    res.status(404);
    throw new Error('Tower not found');
  }

  verifyProjectAccess(req, res, tower.project?._id || tower.project);

  const result = { tower };

  // Include units if requested
  if (includeUnits === 'true') {
    const units = await Unit.find({ tower: tower._id })
      .sort({ floor: 1, unitNumber: 1 });
    
    // Group units by floor
    const unitsByFloor = units.reduce((acc, unit) => {
      const floor = unit.floor;
      if (!acc[floor]) acc[floor] = [];
      acc[floor].push(unit);
      return acc;
    }, {});
    
    result.units = units;
    result.unitsByFloor = unitsByFloor;
    result.totalUnitsCreated = units.length;
  }

  // Include analytics if requested
  if (includeAnalytics === 'true') {
    try {
      // FIXED: Manual analytics calculation instead of relying on model method
      const units = await Unit.find({ tower: tower._id });
      const analytics = {
        unitAnalytics: units.map(unit => ({
          unitId: unit._id,
          unitNumber: unit.unitNumber,
          type: unit.type,
          floor: unit.floor,
          status: unit.status,
          price: unit.currentPrice
        })),
        salesAnalytics: {
          totalUnits: units.length,
          availableUnits: units.filter(u => u.status === 'available').length,
          soldUnits: units.filter(u => u.status === 'sold').length,
          bookedUnits: units.filter(u => u.status === 'booked').length,
          totalRevenue: units
            .filter(u => u.status === 'sold' || u.status === 'booked')
            .reduce((sum, u) => sum + u.currentPrice, 0),
          averagePrice: units.length > 0 ? 
            units.reduce((sum, u) => sum + u.currentPrice, 0) / units.length : 0
        }
      };
      result.analytics = analytics;
    } catch (error) {
      console.warn('Failed to fetch tower analytics:', error);
    }
  }

  res.json({
    success: true,
    data: result
  });
});

/**
 * @desc    Create a new tower - ENHANCED VERSION
 * @route   POST /api/towers
 * @access  Private (Management roles)
 */
const createTower = asyncHandler(async (req, res) => {
  const {
    project,
    towerName,
    towerCode,
    totalFloors,
    unitsPerFloor,
    towerType,
    configuration,
    amenities,
    pricingConfiguration,
    construction,
    metadata
  } = req.body;

  // Validate required fields
  if (!project || !towerName || !towerCode || !totalFloors || !unitsPerFloor) {
    res.status(400);
    throw new Error('Project, tower name, tower code, total floors, and units per floor are required');
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

  // Check if tower code already exists in the project
  const existingTower = await Tower.findOne({
    project,
    towerCode: towerCode.toUpperCase(),
    isActive: true
  });

  if (existingTower) {
    res.status(400);
    throw new Error('Tower code already exists in this project');
  }

  try {
    const tower = await Tower.create({
      organization: req.user.organization,
      project,
      towerName,
      towerCode: towerCode.toUpperCase(),
      totalFloors,
      unitsPerFloor,
      towerType: towerType || 'residential',
      configuration: configuration || {},
      amenities: amenities || {},
      pricingConfiguration: pricingConfiguration || {},
      construction: construction || {},
      metadata: metadata || {},
      createdBy: req.user._id
    });

    const populatedTower = await Tower.findById(tower._id)
      .populate('project', 'name type')
      .populate('createdBy', 'firstName lastName');

    res.status(201).json({
      success: true,
      data: populatedTower,
      message: 'Tower created successfully'
    });
  } catch (error) {
    console.error('Tower creation error:', error);
    res.status(400);
    throw new Error(`Failed to create tower: ${error.message}`);
  }
});

/**
 * @desc    Update tower - FIXED VERSION
 * @route   PUT /api/towers/:id
 * @access  Private (Management roles)
 */
const updateTower = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updateData = { ...req.body };

  // Validate ObjectId format
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400);
    throw new Error('Invalid tower ID format');
  }

  // Remove fields that shouldn't be updated directly
  delete updateData.organization;
  delete updateData.project;
  delete updateData.createdBy;
  delete updateData.totalUnits; // This is calculated automatically

  const tower = await Tower.findOne({
    _id: id,
    organization: req.user.organization
  });

  if (!tower) {
    res.status(404);
    throw new Error('Tower not found');
  }

  verifyProjectAccess(req, res, tower.project);

  // Set updatedBy
  updateData.updatedBy = req.user._id;

  try {
    // If floors or units per floor changed, check if it affects existing units
    if (updateData.totalFloors || updateData.unitsPerFloor) {
      const existingUnits = await Unit.countDocuments({ tower: tower._id });
      const newTotalUnits = (updateData.totalFloors || tower.totalFloors) * 
                           (updateData.unitsPerFloor || tower.unitsPerFloor);
      
      if (existingUnits > newTotalUnits) {
        res.status(400);
        throw new Error(`Cannot reduce capacity below existing units count (${existingUnits})`);
      }
    }

    Object.assign(tower, updateData);
    await tower.save();

    const updatedTower = await Tower.findById(tower._id)
      .populate('project', 'name type')
      .populate('updatedBy', 'firstName lastName');

    res.json({
      success: true,
      data: updatedTower,
      message: 'Tower updated successfully'
    });
  } catch (error) {
    console.error('Tower update error:', error);
    res.status(400);
    throw new Error(`Failed to update tower: ${error.message}`);
  }
});

/**
 * @desc    Get tower analytics - FIXED VERSION
 * @route   GET /api/towers/:id/analytics
 * @access  Private (Management roles)
 */
const getTowerAnalytics = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Validate ObjectId format
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400);
    throw new Error('Invalid tower ID format');
  }

  const tower = await Tower.findOne({
    _id: id,
    organization: req.user.organization
  }).populate('project', 'name type');

  if (!tower) {
    res.status(404);
    throw new Error('Tower not found');
  }

  verifyProjectAccess(req, res, tower.project?._id || tower.project);

  try {
    // Manual analytics calculation
    const units = await Unit.find({ tower: tower._id });
    
    const analytics = {
      tower: {
        _id: tower._id,
        towerName: tower.towerName,
        towerCode: tower.towerCode,
        totalFloors: tower.totalFloors,
        unitsPerFloor: tower.unitsPerFloor,
        totalUnits: tower.totalUnits
      },
      unitAnalytics: units.map(unit => ({
        unitId: unit._id,
        unitNumber: unit.unitNumber,
        type: unit.type,
        floor: unit.floor,
        status: unit.status,
        price: unit.currentPrice,
        areaSqft: unit.areaSqft
      })),
      salesAnalytics: {
        totalUnits: units.length,
        totalSales: units.filter(u => u.status === 'sold' || u.status === 'booked').length,
        availableUnits: units.filter(u => u.status === 'available').length,
        soldUnits: units.filter(u => u.status === 'sold').length,
        bookedUnits: units.filter(u => u.status === 'booked').length,
        totalRevenue: units
          .filter(u => u.status === 'sold' || u.status === 'booked')
          .reduce((sum, u) => sum + u.currentPrice, 0),
        averagePrice: units.length > 0 ? 
          units.reduce((sum, u) => sum + u.currentPrice, 0) / units.length : 0
      },
      floorDistribution: units.reduce((acc, unit) => {
        const floor = unit.floor;
        if (!acc[floor]) {
          acc[floor] = { total: 0, available: 0, sold: 0, booked: 0 };
        }
        acc[floor].total++;
        acc[floor][unit.status]++;
        return acc;
      }, {})
    };

    res.json({
      success: true,
      data: analytics
    });
  } catch (error) {
    console.error('Tower analytics error:', error);
    res.status(500);
    throw new Error(`Failed to fetch tower analytics: ${error.message}`);
  }
});

/**
 * @desc    Bulk create units for a tower - ENHANCED VERSION
 * @route   POST /api/towers/:id/units/bulk-create
 * @access  Private (Management roles)
 */
const bulkCreateUnits = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { unitTypeMapping, startFromFloor = 1, endAtFloor = null } = req.body;

  // Validate ObjectId format
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400);
    throw new Error('Invalid tower ID format');
  }

  const tower = await Tower.findOne({
    _id: id,
    organization: req.user.organization
  });

  if (!tower) {
    res.status(404);
    throw new Error('Tower not found');
  }

  verifyProjectAccess(req, res, tower.project);

  const project = await Project.findById(tower.project);
  if (!project) {
    res.status(404);
    throw new Error('Project not found');
  }

  try {
    const unitsToCreate = [];
    const endFloor = endAtFloor || tower.totalFloors;

    // Default unit type mapping if not provided
    const defaultMapping = unitTypeMapping || {
      1: '2BHK',
      2: '2BHK',
      3: '3BHK',
      4: '3BHK',
      5: '3BHK',
      6: '3BHK',
      7: '3BHK+Study',
      8: '3BHK+Study'
    };

    for (let floor = startFromFloor; floor <= endFloor; floor++) {
      for (let unitPos = 1; unitPos <= tower.unitsPerFloor; unitPos++) {
        const unitNumber = `${tower.towerCode}-${floor}${String(unitPos).padStart(2, '0')}`;
        const unitType = defaultMapping[unitPos] || '3BHK';
        
        // Skip if unit already exists
        const existingUnit = await Unit.findOne({
          project: tower.project,
          unitNumber,
          organization: req.user.organization
        });

        if (existingUnit) {
          continue; // Skip existing units
        }

        // Calculate base price and area based on unit type
        const unitConfig = {
          '1BHK': { area: 550, basePrice: 3500000 },
          '2BHK': { area: 750, basePrice: 4500000 },
          '3BHK': { area: 1200, basePrice: 6000000 },
          '3BHK+Study': { area: 1400, basePrice: 7000000 },
          '4BHK': { area: 1800, basePrice: 9000000 }
        };

        const config = unitConfig[unitType] || unitConfig['3BHK'];
        
        unitsToCreate.push({
          organization: req.user.organization,
          project: tower.project,
          tower: tower._id,
          unitNumber,
          type: unitType,
          floor,
          areaSqft: config.area,
          basePrice: config.basePrice,
          currentPrice: config.basePrice,
          facing: ['North', 'South', 'East', 'West'][unitPos % 4],
          features: {
            isCornerUnit: unitPos === 1 || unitPos === tower.unitsPerFloor,
            hasBalcony: true,
            isParkFacing: Math.random() > 0.7
          },
          specifications: {
            bedrooms: unitType.includes('4BHK') ? 4 : unitType.includes('3BHK') ? 3 : unitType.includes('2BHK') ? 2 : 1,
            bathrooms: unitType.includes('4BHK') ? 3 : unitType.includes('3BHK') ? 2 : 2,
            livingRooms: 1,
            kitchen: 1,
            balconies: unitType.includes('1BHK') ? 1 : 2
          },
          status: 'available'
        });
      }
    }

    let createdUnits = [];
    if (unitsToCreate.length > 0) {
      createdUnits = await Unit.insertMany(unitsToCreate);
    }

    res.json({
      success: true,
      data: {
        towerId: tower._id,
        towerName: tower.towerName,
        towerCode: tower.towerCode,
        unitsCreated: createdUnits.length,
        totalUnitsInTower: await Unit.countDocuments({ tower: tower._id }),
        floorsProcessed: `${startFromFloor} to ${endFloor}`,
        skippedExisting: unitsToCreate.length < ((endFloor - startFromFloor + 1) * tower.unitsPerFloor)
      },
      message: `Successfully created ${createdUnits.length} units for ${tower.towerName}`
    });
  } catch (error) {
    console.error('Bulk unit creation error:', error);
    res.status(400);
    throw new Error(`Failed to create units: ${error.message}`);
  }
});

/**
 * @desc    Delete tower (soft delete) - ENHANCED VERSION
 * @route   DELETE /api/towers/:id
 * @access  Private (Management roles)
 */
const deleteTower = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Validate ObjectId format
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400);
    throw new Error('Invalid tower ID format');
  }

  const tower = await Tower.findOne({
    _id: id,
    organization: req.user.organization
  });

  if (!tower) {
    res.status(404);
    throw new Error('Tower not found');
  }

  verifyProjectAccess(req, res, tower.project);

  // Check if tower has any units
  const unitCount = await Unit.countDocuments({ tower: tower._id });
  if (unitCount > 0) {
    res.status(400);
    throw new Error(`Cannot delete tower with existing units. Please delete or reassign ${unitCount} units first.`);
  }

  // Soft delete
  tower.isActive = false;
  tower.updatedBy = req.user._id;
  await tower.save();

  res.json({
    success: true,
    message: 'Tower deleted successfully'
  });
});

export {
  createTower,
  getTowers,
  getTowerById,
  updateTower,
  deleteTower,
  getTowerAnalytics,
  bulkCreateUnits
};