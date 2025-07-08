// ===================================================================
// File: controllers/towerController.js
// Description: Tower management controller with full CRUD operations
// ===================================================================

import asyncHandler from 'express-async-handler';
import Tower from '../models/towerModel.js';
import Unit from '../models/unitModel.js';
import Project from '../models/projectModel.js';
import mongoose from 'mongoose';

/**
 * @desc    Create a new tower
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
    res.status(400);
    throw new Error(`Failed to create tower: ${error.message}`);
  }
});

/**
 * @desc    Get all towers for a project
 * @route   GET /api/towers
 * @access  Private
 */
const getTowers = asyncHandler(async (req, res) => {
  const { projectId, status, includeInactive } = req.query;

  let query = { organization: req.user.organization };

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
    const towers = await Tower.find(query)
      .populate('project', 'name type location')
      .populate('createdBy', 'firstName lastName')
      .populate('construction.contractor', 'name contactPerson phone')
      .populate('unitsCount')
      .populate('availableUnitsCount')
      .populate('soldUnitsCount')
      .sort({ towerCode: 1 });

    // Add calculated fields
    const enhancedTowers = towers.map(tower => {
      const towerObj = tower.toObject();
      towerObj.salesProgress = {
        totalUnits: tower.totalUnits,
        unitsCount: tower.unitsCount || 0,
        availableUnits: tower.availableUnitsCount || 0,
        soldUnits: tower.soldUnitsCount || 0,
        bookedUnits: Math.max(0, (tower.unitsCount || 0) - (tower.availableUnitsCount || 0) - (tower.soldUnitsCount || 0)),
        occupancyPercentage: tower.totalUnits > 0 ? Math.round(((tower.soldUnitsCount || 0) / tower.totalUnits) * 100) : 0
      };
      return towerObj;
    });

    res.json({
      success: true,
      count: enhancedTowers.length,
      data: enhancedTowers
    });
  } catch (error) {
    res.status(500);
    throw new Error(`Failed to fetch towers: ${error.message}`);
  }
});

/**
 * @desc    Get single tower by ID
 * @route   GET /api/towers/:id
 * @access  Private
 */
const getTowerById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { includeUnits, includeAnalytics } = req.query;

  const tower = await Tower.findOne({
    _id: id,
    organization: req.user.organization
  })
    .populate('project', 'name type location')
    .populate('createdBy', 'firstName lastName')
    .populate('updatedBy', 'firstName lastName')
    .populate('construction.contractor', 'name contactPerson phone');

  if (!tower) {
    res.status(404);
    throw new Error('Tower not found');
  }

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
    
    result.unitsByFloor = unitsByFloor;
    result.totalUnitsCreated = units.length;
  }

  // Include analytics if requested
  if (includeAnalytics === 'true') {
    try {
      const analytics = await Tower.getTowerAnalytics(tower._id);
      result.analytics = analytics.unitAnalytics;
      result.salesAnalytics = analytics.salesAnalytics;
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
 * @desc    Update tower
 * @route   PUT /api/towers/:id
 * @access  Private (Management roles)
 */
const updateTower = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updateData = { ...req.body };

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
    res.status(400);
    throw new Error(`Failed to update tower: ${error.message}`);
  }
});

/**
 * @desc    Delete tower (soft delete)
 * @route   DELETE /api/towers/:id
 * @access  Private (Management roles)
 */
const deleteTower = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const tower = await Tower.findOne({
    _id: id,
    organization: req.user.organization
  });

  if (!tower) {
    res.status(404);
    throw new Error('Tower not found');
  }

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

/**
 * @desc    Get tower analytics and insights
 * @route   GET /api/towers/:id/analytics
 * @access  Private (Management roles)
 */
const getTowerAnalytics = asyncHandler(async (req, res) => {
  const { id } = req.params;

  try {
    const analytics = await Tower.getTowerAnalytics(id);
    
    if (!analytics.tower) {
      res.status(404);
      throw new Error('Tower not found');
    }

    // Check organization access
    if (analytics.tower.organization.toString() !== req.user.organization.toString()) {
      res.status(403);
      throw new Error('Access denied');
    }

    res.json({
      success: true,
      data: analytics
    });
  } catch (error) {
    res.status(500);
    throw new Error(`Failed to fetch tower analytics: ${error.message}`);
  }
});

/**
 * @desc    Bulk create units for a tower
 * @route   POST /api/towers/:id/units/bulk-create
 * @access  Private (Management roles)
 */
const bulkCreateUnits = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { unitTypeMapping, startFromFloor = 1, endAtFloor = null } = req.body;

  const tower = await Tower.findOne({
    _id: id,
    organization: req.user.organization
  });

  if (!tower) {
    res.status(404);
    throw new Error('Tower not found');
  }

  const project = await Project.findById(tower.project);
  if (!project) {
    res.status(404);
    throw new Error('Project not found');
  }

  try {
    const unitsToCreate = [];
    const endFloor = endAtFloor || tower.totalFloors;

    for (let floor = startFromFloor; floor <= endFloor; floor++) {
      for (let unitPos = 1; unitPos <= tower.unitsPerFloor; unitPos++) {
        const unitNumber = `${tower.towerCode}-${floor}${String(unitPos).padStart(2, '0')}`;
        
        // Check if unit already exists
        const existingUnit = await Unit.findOne({
          project: tower.project,
          unitNumber
        });

        if (existingUnit) {
          console.log(`Unit ${unitNumber} already exists, skipping...`);
          continue;
        }

        // Determine unit type based on mapping or position
        let unitType = '2BHK'; // default
        if (unitTypeMapping && unitTypeMapping[unitPos]) {
          unitType = unitTypeMapping[unitPos];
        } else if (unitPos <= 3) {
          unitType = '2BHK';
        } else if (unitPos <= 7) {
          unitType = '3BHK';
        } else {
          unitType = '3BHK+Study';
        }

        // Calculate base price using tower pricing configuration
        const isCornerUnit = unitPos === 1 || unitPos === tower.unitsPerFloor;
        const basePrice = tower.calculateUnitPrice(floor, isCornerUnit, 5000000); // 50L base

        // Determine facing
        const facings = ['North', 'South', 'East', 'West', 'North-East', 'South-West'];
        const facing = facings[unitPos % facings.length];

        const unitData = {
          project: tower.project,
          tower: tower._id,
          organization: tower.organization,
          unitNumber,
          type: unitType,
          floor,
          areaSqft: this.getAreaByType(unitType),
          basePrice,
          currentPrice: basePrice,
          facing,
          features: {
            isParkFacing: unitPos % 4 === 0,
            isCornerUnit,
            hasBalcony: unitType !== '1BHK',
            hasServantRoom: unitType.includes('3BHK'),
            hasStudyRoom: unitType.includes('Study')
          },
          specifications: this.getSpecificationsByType(unitType),
          status: 'available'
        };

        unitsToCreate.push(unitData);
      }
    }

    if (unitsToCreate.length === 0) {
      res.status(400);
      throw new Error('No new units to create');
    }

    const createdUnits = await Unit.insertMany(unitsToCreate);

    res.status(201).json({
      success: true,
      data: {
        towerId: tower._id,
        towerName: tower.towerName,
        unitsCreated: createdUnits.length,
        totalUnitsInTower: await Unit.countDocuments({ tower: tower._id })
      },
      message: `Successfully created ${createdUnits.length} units for tower ${tower.towerName}`
    });
  } catch (error) {
    res.status(400);
    throw new Error(`Failed to bulk create units: ${error.message}`);
  }
});

// Helper function to get area by unit type
const getAreaByType = (unitType) => {
  const areaMapping = {
    '1BHK': 550,
    '2BHK': 850,
    '3BHK': 1200,
    '3BHK+Study': 1400,
    '4BHK': 1800,
    'Penthouse': 2500
  };
  return areaMapping[unitType] || 1000;
};

// Helper function to get specifications by unit type
const getSpecificationsByType = (unitType) => {
  const specMapping = {
    '1BHK': { bedrooms: 1, bathrooms: 1, livingRooms: 1, kitchen: 1, balconies: 1 },
    '2BHK': { bedrooms: 2, bathrooms: 2, livingRooms: 1, kitchen: 1, balconies: 1 },
    '3BHK': { bedrooms: 3, bathrooms: 2, livingRooms: 1, kitchen: 1, balconies: 2 },
    '3BHK+Study': { bedrooms: 3, bathrooms: 3, livingRooms: 1, kitchen: 1, balconies: 2 },
    '4BHK': { bedrooms: 4, bathrooms: 3, livingRooms: 1, kitchen: 1, balconies: 2 },
    'Penthouse': { bedrooms: 4, bathrooms: 4, livingRooms: 2, kitchen: 1, balconies: 3 }
  };
  return specMapping[unitType] || { bedrooms: 2, bathrooms: 2, livingRooms: 1, kitchen: 1, balconies: 1 };
};

export {
  createTower,
  getTowers,
  getTowerById,
  updateTower,
  deleteTower,
  getTowerAnalytics,
  bulkCreateUnits
};