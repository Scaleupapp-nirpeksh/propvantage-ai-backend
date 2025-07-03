// File: controllers/commissionController.js
// Description: Handles commission management API endpoints

import asyncHandler from 'express-async-handler';
import CommissionStructure from '../models/commissionStructureModel.js';
import PartnerCommission from '../models/partnerCommissionModel.js';
import {
  createCommissionForSale,
  processCommissionPayments,
  adjustCommissionForSaleChange,
  generateCommissionReport,
  getPartnerPerformanceData,
  bulkApproveCommissions,
  recalculateCommission,
  getCommissionAnalytics,
  validateCommissionStructure
} from '../services/commissionService.js';

// =============================================================================
// COMMISSION STRUCTURE MANAGEMENT
// =============================================================================

/**
 * @desc    Create a new commission structure
 * @route   POST /api/commissions/structures
 * @access  Private (Management roles)
 */
const createCommissionStructure = asyncHandler(async (req, res) => {
  const structureData = {
    ...req.body,
    organization: req.user.organization,
    createdBy: req.user._id
  };

  // Validate structure data
  const validation = validateCommissionStructure(structureData);
  if (!validation.isValid) {
    res.status(400);
    throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
  }

  try {
    const commissionStructure = await CommissionStructure.create(structureData);

    res.status(201).json({
      success: true,
      data: commissionStructure,
      warnings: validation.warnings,
      message: 'Commission structure created successfully'
    });
  } catch (error) {
    res.status(400);
    throw new Error(`Failed to create commission structure: ${error.message}`);
  }
});

/**
 * @desc    Get all commission structures
 * @route   GET /api/commissions/structures
 * @access  Private (Management roles)
 */
const getCommissionStructures = asyncHandler(async (req, res) => {
  const { active, projectId } = req.query;

  try {
    let structures;
    
    if (active === 'true') {
      structures = await CommissionStructure.getActiveStructures(
        req.user.organization,
        projectId
      );
    } else {
      const query = { organization: req.user.organization };
      if (projectId) {
        query.$or = [
          { project: projectId },
          { project: null }
        ];
      }
      structures = await CommissionStructure.find(query)
        .populate('project', 'name')
        .populate('createdBy', 'firstName lastName')
        .sort({ createdAt: -1 });
    }

    res.json({
      success: true,
      data: structures,
      count: structures.length
    });
  } catch (error) {
    res.status(500);
    throw new Error(`Failed to get commission structures: ${error.message}`);
  }
});

/**
 * @desc    Get commission structure by ID
 * @route   GET /api/commissions/structures/:id
 * @access  Private (Management roles)
 */
const getCommissionStructureById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const structure = await CommissionStructure.findOne({
    _id: id,
    organization: req.user.organization
  })
    .populate('project', 'name')
    .populate('createdBy', 'firstName lastName')
    .populate('lastModifiedBy', 'firstName lastName');

  if (!structure) {
    res.status(404);
    throw new Error('Commission structure not found');
  }

  res.json({
    success: true,
    data: structure
  });
});

/**
 * @desc    Update commission structure
 * @route   PUT /api/commissions/structures/:id
 * @access  Private (Management roles)
 */
const updateCommissionStructure = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reason, ...updateData } = req.body;

  const structure = await CommissionStructure.findOne({
    _id: id,
    organization: req.user.organization
  });

  if (!structure) {
    res.status(404);
    throw new Error('Commission structure not found');
  }

  // Validate update data
  const validation = validateCommissionStructure({ ...structure.toObject(), ...updateData });
  if (!validation.isValid) {
    res.status(400);
    throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
  }

  try {
    // Update structure
    Object.assign(structure, updateData);
    structure.lastModifiedBy = req.user._id;

    // Add modification history
    structure.modificationHistory.push({
      modifiedBy: req.user._id,
      modificationDate: new Date(),
      changes: JSON.stringify(updateData),
      reason: reason || 'Commission structure updated'
    });

    await structure.save();

    res.json({
      success: true,
      data: structure,
      warnings: validation.warnings,
      message: 'Commission structure updated successfully'
    });
  } catch (error) {
    res.status(400);
    throw new Error(`Failed to update commission structure: ${error.message}`);
  }
});

/**
 * @desc    Deactivate commission structure
 * @route   DELETE /api/commissions/structures/:id
 * @access  Private (Management roles)
 */
const deactivateCommissionStructure = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;

  const structure = await CommissionStructure.findOne({
    _id: id,
    organization: req.user.organization
  });

  if (!structure) {
    res.status(404);
    throw new Error('Commission structure not found');
  }

  structure.validityPeriod.isActive = false;
  structure.lastModifiedBy = req.user._id;

  structure.modificationHistory.push({
    modifiedBy: req.user._id,
    modificationDate: new Date(),
    changes: 'Structure deactivated',
    reason: reason || 'Commission structure deactivated'
  });

  await structure.save();

  res.json({
    success: true,
    message: 'Commission structure deactivated successfully'
  });
});

// =============================================================================
// COMMISSION MANAGEMENT
// =============================================================================

/**
 * @desc    Create commission for a sale
 * @route   POST /api/commissions/create-for-sale
 * @access  Private (Sales/Management roles)
 */
const createCommissionForSaleEndpoint = asyncHandler(async (req, res) => {
  const { saleId, partnerId, commissionStructureId, unitType } = req.body;

  if (!saleId || !partnerId || !commissionStructureId || !unitType) {
    res.status(400);
    throw new Error('Sale ID, partner ID, commission structure ID, and unit type are required');
  }

  try {
    const commission = await createCommissionForSale(
      { saleId, unitType },
      partnerId,
      commissionStructureId,
      req.user._id
    );

    res.status(201).json({
      success: true,
      data: commission,
      message: 'Commission created successfully'
    });
  } catch (error) {
    res.status(400);
    throw new Error(error.message);
  }
});

/**
 * @desc    Get commissions with filters
 * @route   GET /api/commissions
 * @access  Private (Sales/Management roles)
 */
const getCommissions = asyncHandler(async (req, res) => {
  const { 
    status, 
    partnerId, 
    projectId, 
    startDate, 
    endDate,
    page = 1,
    limit = 20
  } = req.query;

  // Build filters
  const filters = { organization: req.user.organization };
  
  if (status) {
    filters.status = status;
  }
  
  if (partnerId) {
    filters.partner = partnerId;
  }
  
  if (projectId) {
    filters.project = projectId;
  }
  
  if (startDate && endDate) {
    filters['saleDetails.saleDate'] = {
      $gte: new Date(startDate),
      $lte: new Date(endDate)
    };
  }

  try {
    const commissions = await PartnerCommission.getPartnerCommissionsWithDetails(filters);
    
    // Apply pagination
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + parseInt(limit);
    const paginatedCommissions = commissions.slice(startIndex, endIndex);

    res.json({
      success: true,
      data: paginatedCommissions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: commissions.length,
        pages: Math.ceil(commissions.length / limit)
      }
    });
  } catch (error) {
    res.status(500);
    throw new Error(`Failed to get commissions: ${error.message}`);
  }
});

/**
 * @desc    Get commission by ID
 * @route   GET /api/commissions/:id
 * @access  Private (Sales/Management roles)
 */
const getCommissionById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const commission = await PartnerCommission.findOne({
    _id: id,
    organization: req.user.organization
  })
    .populate('partner', 'firstName lastName email phone')
    .populate('project', 'name')
    .populate('sale', 'salePrice bookingDate')
    .populate('commissionStructure', 'structureName calculationMethod')
    .populate('createdBy', 'firstName lastName')
    .populate('approvalWorkflow.approvedBy', 'firstName lastName');

  if (!commission) {
    res.status(404);
    throw new Error('Commission not found');
  }

  res.json({
    success: true,
    data: commission
  });
});

/**
 * @desc    Approve commission
 * @route   POST /api/commissions/:id/approve
 * @access  Private (Management roles)
 */
const approveCommission = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { notes } = req.body;

  const commission = await PartnerCommission.findOne({
    _id: id,
    organization: req.user.organization
  });

  if (!commission) {
    res.status(404);
    throw new Error('Commission not found');
  }

  try {
    await commission.approveCommission(req.user._id, notes);

    res.json({
      success: true,
      data: commission,
      message: 'Commission approved successfully'
    });
  } catch (error) {
    res.status(400);
    throw new Error(error.message);
  }
});

/**
 * @desc    Reject commission
 * @route   POST /api/commissions/:id/reject
 * @access  Private (Management roles)
 */
const rejectCommission = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;

  if (!reason) {
    res.status(400);
    throw new Error('Rejection reason is required');
  }

  const commission = await PartnerCommission.findOne({
    _id: id,
    organization: req.user.organization
  });

  if (!commission) {
    res.status(404);
    throw new Error('Commission not found');
  }

  try {
    await commission.rejectCommission(req.user._id, reason);

    res.json({
      success: true,
      data: commission,
      message: 'Commission rejected successfully'
    });
  } catch (error) {
    res.status(400);
    throw new Error(error.message);
  }
});

/**
 * @desc    Put commission on hold
 * @route   POST /api/commissions/:id/hold
 * @access  Private (Management roles)
 */
const putCommissionOnHold = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reason, holdDays } = req.body;

  if (!reason || !holdDays) {
    res.status(400);
    throw new Error('Reason and hold days are required');
  }

  const commission = await PartnerCommission.findOne({
    _id: id,
    organization: req.user.organization
  });

  if (!commission) {
    res.status(404);
    throw new Error('Commission not found');
  }

  try {
    await commission.putOnHold(req.user._id, reason, holdDays);

    res.json({
      success: true,
      data: commission,
      message: 'Commission put on hold successfully'
    });
  } catch (error) {
    res.status(400);
    throw new Error(error.message);
  }
});

/**
 * @desc    Release commission from hold
 * @route   POST /api/commissions/:id/release
 * @access  Private (Management roles)
 */
const releaseCommissionHold = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;

  if (!reason) {
    res.status(400);
    throw new Error('Release reason is required');
  }

  const commission = await PartnerCommission.findOne({
    _id: id,
    organization: req.user.organization
  });

  if (!commission) {
    res.status(404);
    throw new Error('Commission not found');
  }

  try {
    await commission.releaseHold(req.user._id, reason);

    res.json({
      success: true,
      data: commission,
      message: 'Commission hold released successfully'
    });
  } catch (error) {
    res.status(400);
    throw new Error(error.message);
  }
});

/**
 * @desc    Bulk approve commissions
 * @route   POST /api/commissions/bulk-approve
 * @access  Private (Management roles)
 */
const bulkApproveCommissionsEndpoint = asyncHandler(async (req, res) => {
  const { commissionIds, notes } = req.body;

  if (!commissionIds || !Array.isArray(commissionIds) || commissionIds.length === 0) {
    res.status(400);
    throw new Error('Commission IDs array is required');
  }

  try {
    const results = await bulkApproveCommissions(commissionIds, req.user._id, notes);

    res.json({
      success: true,
      data: results,
      message: `${results.approved.length} commissions approved successfully`
    });
  } catch (error) {
    res.status(400);
    throw new Error(error.message);
  }
});

// =============================================================================
// COMMISSION PAYMENTS
// =============================================================================

/**
 * @desc    Record commission payment
 * @route   POST /api/commissions/:id/payment
 * @access  Private (Finance roles)
 */
const recordCommissionPayment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { amount, paymentMethod, paymentReference, paymentDate } = req.body;

  if (!amount || !paymentMethod) {
    res.status(400);
    throw new Error('Amount and payment method are required');
  }

  const commission = await PartnerCommission.findOne({
    _id: id,
    organization: req.user.organization
  });

  if (!commission) {
    res.status(404);
    throw new Error('Commission not found');
  }

  try {
    await commission.recordPayment({
      amount,
      paymentMethod,
      paymentReference,
      paymentDate
    }, req.user._id);

    res.json({
      success: true,
      data: commission,
      message: 'Payment recorded successfully'
    });
  } catch (error) {
    res.status(400);
    throw new Error(error.message);
  }
});

/**
 * @desc    Process bulk commission payments
 * @route   POST /api/commissions/bulk-payment
 * @access  Private (Finance roles)
 */
const processBulkCommissionPayments = asyncHandler(async (req, res) => {
  const { commissionIds, paymentData } = req.body;

  if (!commissionIds || !Array.isArray(commissionIds) || commissionIds.length === 0) {
    res.status(400);
    throw new Error('Commission IDs array is required');
  }

  if (!paymentData || !paymentData.paymentMethod) {
    res.status(400);
    throw new Error('Payment data with payment method is required');
  }

  try {
    const results = await processCommissionPayments(commissionIds, paymentData, req.user._id);

    res.json({
      success: true,
      data: results,
      message: `${results.successful.length} payments processed successfully`
    });
  } catch (error) {
    res.status(400);
    throw new Error(error.message);
  }
});

// =============================================================================
// COMMISSION REPORTS & ANALYTICS
// =============================================================================

/**
 * @desc    Generate commission report
 * @route   GET /api/commissions/reports/detailed
 * @access  Private (Management roles)
 */
const getCommissionReport = asyncHandler(async (req, res) => {
  const { startDate, endDate, partnerId, projectId, status } = req.query;

  try {
    const report = await generateCommissionReport(req.user.organization, {
      startDate,
      endDate,
      partnerId,
      projectId,
      status
    });

    res.json({
      success: true,
      data: report
    });
  } catch (error) {
    res.status(500);
    throw new Error(error.message);
  }
});

/**
 * @desc    Get commission analytics
 * @route   GET /api/commissions/analytics
 * @access  Private (Management roles)
 */
const getCommissionAnalyticsEndpoint = asyncHandler(async (req, res) => {
  const { period, partnerId, projectId } = req.query;

  try {
    const analytics = await getCommissionAnalytics(req.user.organization, {
      period,
      partnerId,
      projectId
    });

    res.json({
      success: true,
      data: analytics
    });
  } catch (error) {
    res.status(500);
    throw new Error(error.message);
  }
});

/**
 * @desc    Get overdue commissions
 * @route   GET /api/commissions/reports/overdue
 * @access  Private (Management roles)
 */
const getOverdueCommissions = asyncHandler(async (req, res) => {
  try {
    const overdueCommissions = await PartnerCommission.getOverdueCommissions(req.user.organization);

    res.json({
      success: true,
      data: overdueCommissions,
      count: overdueCommissions.length
    });
  } catch (error) {
    res.status(500);
    throw new Error(`Failed to get overdue commissions: ${error.message}`);
  }
});

/**
 * @desc    Get partner performance data
 * @route   GET /api/commissions/partners/:partnerId/performance
 * @access  Private (Management roles)
 */
const getPartnerPerformanceEndpoint = asyncHandler(async (req, res) => {
  const { partnerId } = req.params;

  try {
    const performance = await getPartnerPerformanceData(partnerId, req.user.organization);

    res.json({
      success: true,
      data: performance
    });
  } catch (error) {
    res.status(500);
    throw new Error(error.message);
  }
});

/**
 * @desc    Recalculate commission
 * @route   POST /api/commissions/:id/recalculate
 * @access  Private (Management roles)
 */
const recalculateCommissionEndpoint = asyncHandler(async (req, res) => {
  const { id } = req.params;

  try {
    const result = await recalculateCommission(id, req.user._id);

    res.json({
      success: true,
      data: result,
      message: result.recalculated ? 'Commission recalculated successfully' : 'No changes in commission amount'
    });
  } catch (error) {
    res.status(400);
    throw new Error(error.message);
  }
});

export {
  // Commission Structure Management
  createCommissionStructure,
  getCommissionStructures,
  getCommissionStructureById,
  updateCommissionStructure,
  deactivateCommissionStructure,
  
  // Commission Management
  createCommissionForSaleEndpoint,
  getCommissions,
  getCommissionById,
  approveCommission,
  rejectCommission,
  putCommissionOnHold,
  releaseCommissionHold,
  bulkApproveCommissionsEndpoint,
  
  // Commission Payments
  recordCommissionPayment,
  processBulkCommissionPayments,
  
  // Reports & Analytics
  getCommissionReport,
  getCommissionAnalyticsEndpoint,
  getOverdueCommissions,
  getPartnerPerformanceEndpoint,
  recalculateCommissionEndpoint
};