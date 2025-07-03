// File: services/commissionService.js
// Description: Service for commission calculations, processing, and management

import CommissionStructure from '../models/commissionStructureModel.js';
import PartnerCommission from '../models/partnerCommissionModel.js';
import Sale from '../models/salesModel.js';
import User from '../models/userModel.js';
import Project from '../models/projectModel.js';
import mongoose from 'mongoose';

/**
 * Creates a commission record for a sale
 * @param {Object} saleData - Sale information
 * @param {string} partnerId - Partner user ID
 * @param {string} commissionStructureId - Commission structure to use
 * @param {string} userId - User creating the commission
 * @returns {Object} Created commission record
 */
const createCommissionForSale = async (saleData, partnerId, commissionStructureId, userId) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    // Validate inputs
    const [sale, partner, commissionStructure] = await Promise.all([
      Sale.findById(saleData.saleId).session(session),
      User.findById(partnerId).session(session),
      CommissionStructure.findById(commissionStructureId).session(session)
    ]);
    
    if (!sale) throw new Error('Sale not found');
    if (!partner) throw new Error('Partner not found');
    if (!commissionStructure) throw new Error('Commission structure not found');
    
    // Check if commission already exists for this sale
    const existingCommission = await PartnerCommission.findOne({
      sale: saleData.saleId,
      partner: partnerId
    }).session(session);
    
    if (existingCommission) {
      throw new Error('Commission already exists for this sale and partner');
    }
    
    // Get partner performance data
    const partnerPerformance = await getPartnerPerformanceData(partnerId, sale.organization);
    
    // Prepare sale details for commission calculation
    const saleDetails = {
      salePrice: sale.salePrice,
      basePrice: sale.basePrice || sale.salePrice,
      unitType: saleData.unitType,
      saleDate: sale.bookingDate,
      partnerSalesVolume: partnerPerformance.totalSalesVolume
    };
    
    // Calculate commission using the structure
    const commissionCalculation = commissionStructure.calculateCommission(saleDetails, partnerPerformance);
    
    // Determine payment schedule
    const paymentSchedule = calculatePaymentSchedule(
      commissionCalculation.netCommission,
      commissionStructure.paymentTerms,
      sale.bookingDate
    );
    
    // Create commission record
    const commission = new PartnerCommission({
      organization: sale.organization,
      project: sale.project,
      sale: sale._id,
      partner: partnerId,
      commissionStructure: commissionStructureId,
      saleDetails: {
        salePrice: sale.salePrice,
        basePrice: sale.basePrice || sale.salePrice,
        unitType: saleData.unitType,
        saleDate: sale.bookingDate,
        bookingDate: sale.bookingDate,
        customer: sale.lead
      },
      partnerPerformance: partnerPerformance,
      commissionCalculation: {
        calculationMethod: commissionStructure.calculationMethod,
        breakdown: commissionCalculation.calculationDetails,
        grossCommission: commissionCalculation.grossCommission,
        bonuses: commissionCalculation.bonusBreakdown || [],
        totalBonuses: commissionCalculation.bonusAmount,
        deductions: commissionCalculation.deductions?.breakdown || [],
        totalDeductions: commissionCalculation.deductions?.totalDeductions || 0,
        netCommission: commissionCalculation.netCommission,
        calculationDate: new Date()
      },
      paymentSchedule: paymentSchedule,
      paymentDetails: {
        totalPaid: 0,
        totalPending: commissionCalculation.netCommission
      },
      taxDetails: {
        tdsDeducted: commissionCalculation.deductions?.tds || 0,
        tdsRate: commissionStructure.taxSettings.tdsRate,
        gstAmount: commissionCalculation.deductions?.gst || 0,
        gstRate: commissionStructure.taxSettings.gstRate,
        financialYear: getCurrentFinancialYear()
      },
      clawbackDetails: {
        isClawbackEligible: true,
        clawbackPeriod: commissionStructure.specialConditions.clawbackPeriod
      },
      createdBy: userId
    });
    
    // Set approval workflow if required
    if (commissionStructure.approvalWorkflow.requiresApproval) {
      commission.approvalWorkflow = {
        requiresApproval: true,
        approvalStatus: 'pending',
        approvers: commissionStructure.approvalWorkflow.approvers
      };
      commission.status = 'pending_approval';
    } else {
      commission.status = 'approved';
    }
    
    await commission.save({ session });
    
    // Update commission structure usage stats
    await updateCommissionStructureUsage(commissionStructureId, commissionCalculation.netCommission, session);
    
    await session.commitTransaction();
    session.endSession();
    
    return commission;
    
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw new Error(`Failed to create commission: ${error.message}`);
  }
};

/**
 * Processes commission payments for approved commissions
 * @param {Array} commissionIds - Array of commission IDs to process
 * @param {Object} paymentData - Payment details
 * @param {string} userId - User processing the payment
 * @returns {Object} Payment processing results
 */
const processCommissionPayments = async (commissionIds, paymentData, userId) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const results = {
      successful: [],
      failed: [],
      totalAmount: 0
    };
    
    for (const commissionId of commissionIds) {
      try {
        const commission = await PartnerCommission.findById(commissionId).session(session);
        
        if (!commission) {
          results.failed.push({
            commissionId,
            error: 'Commission not found'
          });
          continue;
        }
        
        if (commission.status !== 'approved') {
          results.failed.push({
            commissionId,
            error: 'Commission not approved for payment'
          });
          continue;
        }
        
        const paymentAmount = paymentData.amounts?.[commissionId] || commission.pendingAmount;
        
        await commission.recordPayment({
          amount: paymentAmount,
          paymentMethod: paymentData.paymentMethod,
          paymentReference: paymentData.paymentReference,
          paymentDate: paymentData.paymentDate || new Date()
        }, userId);
        
        results.successful.push({
          commissionId,
          amount: paymentAmount,
          partnerId: commission.partner,
          status: commission.status
        });
        
        results.totalAmount += paymentAmount;
        
      } catch (error) {
        results.failed.push({
          commissionId,
          error: error.message
        });
      }
    }
    
    await session.commitTransaction();
    session.endSession();
    
    return results;
    
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw new Error(`Failed to process commission payments: ${error.message}`);
  }
};

/**
 * Calculates commission adjustments for sale modifications
 * @param {string} saleId - Sale ID
 * @param {Object} saleChanges - Changes to the sale
 * @param {string} userId - User making the adjustment
 * @returns {Object} Adjustment results
 */
const adjustCommissionForSaleChange = async (saleId, saleChanges, userId) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    // Get all commissions for this sale
    const commissions = await PartnerCommission.find({ sale: saleId }).session(session);
    
    if (commissions.length === 0) {
      throw new Error('No commissions found for this sale');
    }
    
    const adjustmentResults = [];
    
    for (const commission of commissions) {
      const commissionStructure = await CommissionStructure.findById(commission.commissionStructure).session(session);
      
      if (!commissionStructure) {
        continue;
      }
      
      // Recalculate commission with new sale data
      const newSaleDetails = {
        salePrice: saleChanges.salePrice || commission.saleDetails.salePrice,
        basePrice: saleChanges.basePrice || commission.saleDetails.basePrice,
        unitType: saleChanges.unitType || commission.saleDetails.unitType,
        saleDate: commission.saleDetails.saleDate,
        partnerSalesVolume: commission.partnerPerformance.totalSalesVolume
      };
      
      const newCommissionCalculation = commissionStructure.calculateCommission(newSaleDetails, commission.partnerPerformance);
      
      const oldAmount = commission.commissionCalculation.netCommission;
      const newAmount = newCommissionCalculation.netCommission;
      
      if (Math.abs(oldAmount - newAmount) > 0.01) {
        // Adjust commission amount
        await commission.adjustCommissionAmount(
          newAmount,
          `Sale modification: ${JSON.stringify(saleChanges)}`,
          userId
        );
        
        adjustmentResults.push({
          commissionId: commission._id,
          partnerId: commission.partner,
          oldAmount,
          newAmount,
          adjustment: newAmount - oldAmount
        });
      }
    }
    
    await session.commitTransaction();
    session.endSession();
    
    return adjustmentResults;
    
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw new Error(`Failed to adjust commission: ${error.message}`);
  }
};

/**
 * Generates commission report for a period
 * @param {string} organizationId - Organization ID
 * @param {Object} filters - Report filters
 * @returns {Object} Commission report
 */
const generateCommissionReport = async (organizationId, filters = {}) => {
  try {
    const { startDate, endDate, partnerId, projectId, status } = filters;
    
    // Build query
    const query = { organization: organizationId };
    
    if (startDate && endDate) {
      query['saleDetails.saleDate'] = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }
    
    if (partnerId) {
      query.partner = partnerId;
    }
    
    if (projectId) {
      query.project = projectId;
    }
    
    if (status) {
      query.status = status;
    }
    
    // Get commission data
    const commissions = await PartnerCommission.find(query)
      .populate('partner', 'firstName lastName email')
      .populate('project', 'name')
      .populate('sale', 'salePrice bookingDate')
      .sort({ 'saleDetails.saleDate': -1 });
    
    // Calculate summary statistics
    const summary = await PartnerCommission.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalCommissions: { $sum: '$commissionCalculation.netCommission' },
          totalPaid: { $sum: '$paymentDetails.totalPaid' },
          totalPending: { $sum: '$paymentDetails.totalPending' },
          totalSales: { $sum: '$saleDetails.salePrice' },
          commissionsCount: { $sum: 1 },
          averageCommission: { $avg: '$commissionCalculation.netCommission' },
          averageCommissionRate: { $avg: '$commissionCalculation.breakdown.commissionRate' }
        }
      }
    ]);
    
    // Partner-wise breakdown
    const partnerBreakdown = await PartnerCommission.aggregate([
      { $match: query },
      {
        $group: {
          _id: '$partner',
          totalCommissions: { $sum: '$commissionCalculation.netCommission' },
          totalPaid: { $sum: '$paymentDetails.totalPaid' },
          totalPending: { $sum: '$paymentDetails.totalPending' },
          commissionsCount: { $sum: 1 },
          averageCommission: { $avg: '$commissionCalculation.netCommission' }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'partnerInfo'
        }
      },
      { $unwind: '$partnerInfo' },
      {
        $project: {
          partnerId: '$_id',
          partnerName: { $concat: ['$partnerInfo.firstName', ' ', '$partnerInfo.lastName'] },
          totalCommissions: 1,
          totalPaid: 1,
          totalPending: 1,
          commissionsCount: 1,
          averageCommission: 1
        }
      },
      { $sort: { totalCommissions: -1 } }
    ]);
    
    // Status-wise breakdown
    const statusBreakdown = await PartnerCommission.aggregate([
      { $match: query },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$commissionCalculation.netCommission' }
        }
      },
      { $sort: { totalAmount: -1 } }
    ]);
    
    return {
      summary: summary[0] || {
        totalCommissions: 0,
        totalPaid: 0,
        totalPending: 0,
        totalSales: 0,
        commissionsCount: 0,
        averageCommission: 0,
        averageCommissionRate: 0
      },
      partnerBreakdown,
      statusBreakdown,
      commissions,
      filters,
      generatedAt: new Date()
    };
    
  } catch (error) {
    throw new Error(`Failed to generate commission report: ${error.message}`);
  }
};

/**
 * Gets partner performance data for commission calculation
 * @param {string} partnerId - Partner ID
 * @param {string} organizationId - Organization ID
 * @returns {Object} Partner performance data
 */
const getPartnerPerformanceData = async (partnerId, organizationId) => {
  try {
    // Get partner's sales history
    const salesHistory = await Sale.find({
      salesPerson: partnerId,
      organization: organizationId
    }).sort({ bookingDate: -1 });
    
    // Get partner's commission history
    const commissionHistory = await PartnerCommission.find({
      partner: partnerId,
      organization: organizationId
    }).sort({ createdAt: -1 });
    
    // Calculate performance metrics
    const totalSalesVolume = salesHistory.reduce((sum, sale) => sum + sale.salePrice, 0);
    const totalUnitsSold = salesHistory.length;
    const lastSaleDate = salesHistory[0]?.bookingDate;
    
    // Get partner info
    const partner = await User.findById(partnerId);
    const monthsWithCompany = partner?.createdAt ? 
      Math.floor((new Date() - partner.createdAt) / (1000 * 60 * 60 * 24 * 30)) : 0;
    
    // Calculate average rating (placeholder - would come from reviews system)
    const averageRating = 4.0; // Default rating
    
    return {
      totalSalesVolume,
      totalUnitsSold,
      averageRating,
      monthsWithCompany,
      lastSaleDate,
      totalCommissions: commissionHistory.length,
      totalCommissionEarned: commissionHistory.reduce((sum, comm) => sum + comm.commissionCalculation.netCommission, 0)
    };
    
  } catch (error) {
    throw new Error(`Failed to get partner performance data: ${error.message}`);
  }
};

/**
 * Calculates payment schedule for commission
 * @param {number} commissionAmount - Total commission amount
 * @param {Object} paymentTerms - Payment terms from commission structure
 * @param {Date} saleDate - Sale date
 * @returns {Object} Payment schedule
 */
const calculatePaymentSchedule = (commissionAmount, paymentTerms, saleDate) => {
  const schedule = {
    paymentMethod: paymentTerms.paymentSchedule,
    scheduledDate: new Date(saleDate),
    holdPeriod: paymentTerms.holdPeriod,
    installments: [],
    totalInstallments: 1
  };
  
  // Add payment delay
  schedule.scheduledDate.setDate(schedule.scheduledDate.getDate() + paymentTerms.paymentDelay);
  
  // Add hold period
  if (paymentTerms.holdPeriod > 0) {
    schedule.holdUntil = new Date(schedule.scheduledDate);
    schedule.holdUntil.setDate(schedule.holdUntil.getDate() + paymentTerms.holdPeriod);
  }
  
  // Create installments based on payment schedule
  switch (paymentTerms.paymentSchedule) {
    case 'immediate':
      schedule.installments.push({
        installmentNumber: 1,
        amount: commissionAmount,
        dueDate: schedule.scheduledDate,
        status: 'pending'
      });
      break;
      
    case 'monthly':
      // Split into monthly installments if amount is large
      if (commissionAmount > paymentTerms.minimumPayoutAmount * 3) {
        schedule.totalInstallments = 3;
        const monthlyAmount = commissionAmount / 3;
        
        for (let i = 0; i < 3; i++) {
          const installmentDate = new Date(schedule.scheduledDate);
          installmentDate.setMonth(installmentDate.getMonth() + i);
          
          schedule.installments.push({
            installmentNumber: i + 1,
            amount: monthlyAmount,
            dueDate: installmentDate,
            status: 'pending'
          });
        }
      } else {
        schedule.installments.push({
          installmentNumber: 1,
          amount: commissionAmount,
          dueDate: schedule.scheduledDate,
          status: 'pending'
        });
      }
      break;
      
    default:
      schedule.installments.push({
        installmentNumber: 1,
        amount: commissionAmount,
        dueDate: schedule.scheduledDate,
        status: 'pending'
      });
  }
  
  return schedule;
};

/**
 * Updates commission structure usage statistics
 * @param {string} structureId - Commission structure ID
 * @param {number} commissionAmount - Commission amount
 * @param {Object} session - Database session
 */
const updateCommissionStructureUsage = async (structureId, commissionAmount, session) => {
  try {
    await CommissionStructure.findByIdAndUpdate(
      structureId,
      {
        $inc: {
          'usageStats.totalPartnersUsing': 1,
          'usageStats.totalCommissionPaid': commissionAmount
        },
        $set: {
          'usageStats.lastUsedDate': new Date()
        }
      },
      { session }
    );
  } catch (error) {
    console.error('Failed to update commission structure usage:', error);
  }
};

/**
 * Gets current financial year
 * @returns {string} Financial year (e.g., "2024-25")
 */
const getCurrentFinancialYear = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  
  // Financial year starts from April
  if (month >= 4) {
    return `${year}-${(year + 1).toString().slice(-2)}`;
  } else {
    return `${year - 1}-${year.toString().slice(-2)}`;
  }
};

/**
 * Bulk approve commissions
 * @param {Array} commissionIds - Array of commission IDs to approve
 * @param {string} userId - User approving the commissions
 * @param {string} notes - Approval notes
 * @returns {Object} Approval results
 */
const bulkApproveCommissions = async (commissionIds, userId, notes) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const results = {
      approved: [],
      failed: [],
      totalAmount: 0
    };
    
    for (const commissionId of commissionIds) {
      try {
        const commission = await PartnerCommission.findById(commissionId).session(session);
        
        if (!commission) {
          results.failed.push({
            commissionId,
            error: 'Commission not found'
          });
          continue;
        }
        
        if (commission.status !== 'pending_approval') {
          results.failed.push({
            commissionId,
            error: 'Commission not pending approval'
          });
          continue;
        }
        
        await commission.approveCommission(userId, notes);
        
        results.approved.push({
          commissionId,
          amount: commission.commissionCalculation.netCommission,
          partnerId: commission.partner
        });
        
        results.totalAmount += commission.commissionCalculation.netCommission;
        
      } catch (error) {
        results.failed.push({
          commissionId,
          error: error.message
        });
      }
    }
    
    await session.commitTransaction();
    session.endSession();
    
    return results;
    
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw new Error(`Failed to bulk approve commissions: ${error.message}`);
  }
};

/**
 * Recalculates commission for existing record
 * @param {string} commissionId - Commission ID
 * @param {string} userId - User triggering recalculation
 * @returns {Object} Recalculation results
 */
const recalculateCommission = async (commissionId, userId) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const commission = await PartnerCommission.findById(commissionId).session(session);
    
    if (!commission) {
      throw new Error('Commission not found');
    }
    
    const commissionStructure = await CommissionStructure.findById(commission.commissionStructure).session(session);
    
    if (!commissionStructure) {
      throw new Error('Commission structure not found');
    }
    
    // Get updated partner performance data
    const partnerPerformance = await getPartnerPerformanceData(commission.partner, commission.organization);
    
    // Recalculate commission
    const saleDetails = {
      salePrice: commission.saleDetails.salePrice,
      basePrice: commission.saleDetails.basePrice,
      unitType: commission.saleDetails.unitType,
      saleDate: commission.saleDetails.saleDate,
      partnerSalesVolume: partnerPerformance.totalSalesVolume
    };
    
    const newCommissionCalculation = commissionStructure.calculateCommission(saleDetails, partnerPerformance);
    
    const oldAmount = commission.commissionCalculation.netCommission;
    const newAmount = newCommissionCalculation.netCommission;
    
    if (Math.abs(oldAmount - newAmount) > 0.01) {
      // Update commission calculation
      commission.commissionCalculation = {
        calculationMethod: commissionStructure.calculationMethod,
        breakdown: newCommissionCalculation.calculationDetails,
        grossCommission: newCommissionCalculation.grossCommission,
        bonuses: newCommissionCalculation.bonusBreakdown || [],
        totalBonuses: newCommissionCalculation.bonusAmount,
        deductions: newCommissionCalculation.deductions?.breakdown || [],
        totalDeductions: newCommissionCalculation.deductions?.totalDeductions || 0,
        netCommission: newCommissionCalculation.netCommission,
        calculationDate: new Date()
      };
      
      // Update payment details
      commission.paymentDetails.totalPending = newCommissionCalculation.netCommission - commission.paymentDetails.totalPaid;
      
      // Update partner performance
      commission.partnerPerformance = partnerPerformance;
      
      // Add adjustment record
      commission.adjustments.push({
        adjustmentType: newAmount > oldAmount ? 'amount_increase' : 'amount_decrease',
        adjustmentAmount: Math.abs(newAmount - oldAmount),
        previousAmount: oldAmount,
        newAmount: newAmount,
        reason: 'Commission recalculated based on updated partner performance',
        adjustedBy: userId
      });
      
      commission.lastModifiedBy = userId;
      
      await commission.save({ session });
    }
    
    await session.commitTransaction();
    session.endSession();
    
    return {
      commissionId,
      oldAmount,
      newAmount,
      adjustment: newAmount - oldAmount,
      recalculated: Math.abs(oldAmount - newAmount) > 0.01
    };
    
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw new Error(`Failed to recalculate commission: ${error.message}`);
  }
};

/**
 * Gets commission analytics for dashboard
 * @param {string} organizationId - Organization ID
 * @param {Object} filters - Analytics filters
 * @returns {Object} Commission analytics
 */
const getCommissionAnalytics = async (organizationId, filters = {}) => {
  try {
    const { period = 30, partnerId, projectId } = filters;
    
    // Calculate date range
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(period));
    
    const matchConditions = {
      organization: organizationId,
      createdAt: { $gte: startDate }
    };
    
    if (partnerId) {
      matchConditions.partner = partnerId;
    }
    
    if (projectId) {
      matchConditions.project = projectId;
    }
    
    // Overall commission metrics
    const overallMetrics = await PartnerCommission.aggregate([
      { $match: matchConditions },
      {
        $group: {
          _id: null,
          totalCommissions: { $sum: '$commissionCalculation.netCommission' },
          totalPaid: { $sum: '$paymentDetails.totalPaid' },
          totalPending: { $sum: '$paymentDetails.totalPending' },
          totalSales: { $sum: '$saleDetails.salePrice' },
          commissionsCount: { $sum: 1 },
          averageCommission: { $avg: '$commissionCalculation.netCommission' },
          averageCommissionRate: { $avg: '$commissionCalculation.breakdown.commissionRate' }
        }
      }
    ]);
    
    // Commission status breakdown
    const statusBreakdown = await PartnerCommission.aggregate([
      { $match: matchConditions },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$commissionCalculation.netCommission' }
        }
      }
    ]);
    
    // Monthly commission trends
    const monthlyTrends = await PartnerCommission.aggregate([
      { $match: matchConditions },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' }
          },
          totalCommissions: { $sum: '$commissionCalculation.netCommission' },
          totalPaid: { $sum: '$paymentDetails.totalPaid' },
          commissionsCount: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);
    
    // Top performing partners
    const topPartners = await PartnerCommission.aggregate([
      { $match: matchConditions },
      {
        $group: {
          _id: '$partner',
          totalCommissions: { $sum: '$commissionCalculation.netCommission' },
          totalPaid: { $sum: '$paymentDetails.totalPaid' },
          commissionsCount: { $sum: 1 },
          averageCommission: { $avg: '$commissionCalculation.netCommission' }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'partnerInfo'
        }
      },
      { $unwind: '$partnerInfo' },
      {
        $project: {
          partnerId: '$_id',
          partnerName: { $concat: ['$partnerInfo.firstName', ' ', '$partnerInfo.lastName'] },
          totalCommissions: 1,
          totalPaid: 1,
          commissionsCount: 1,
          averageCommission: 1
        }
      },
      { $sort: { totalCommissions: -1 } },
      { $limit: 10 }
    ]);
    
    // Commission method breakdown
    const methodBreakdown = await PartnerCommission.aggregate([
      { $match: matchConditions },
      {
        $group: {
          _id: '$commissionCalculation.calculationMethod',
          count: { $sum: 1 },
          totalAmount: { $sum: '$commissionCalculation.netCommission' },
          averageAmount: { $avg: '$commissionCalculation.netCommission' }
        }
      }
    ]);
    
    return {
      period: `${period} days`,
      overallMetrics: overallMetrics[0] || {
        totalCommissions: 0,
        totalPaid: 0,
        totalPending: 0,
        totalSales: 0,
        commissionsCount: 0,
        averageCommission: 0,
        averageCommissionRate: 0
      },
      statusBreakdown,
      monthlyTrends,
      topPartners,
      methodBreakdown,
      generatedAt: new Date()
    };
    
  } catch (error) {
    throw new Error(`Failed to get commission analytics: ${error.message}`);
  }
};

/**
 * Validates commission structure configuration
 * @param {Object} structureData - Commission structure data
 * @returns {Object} Validation results
 */
const validateCommissionStructure = (structureData) => {
  const errors = [];
  const warnings = [];
  
  // Validate basic fields
  if (!structureData.structureName || structureData.structureName.trim() === '') {
    errors.push('Structure name is required');
  }
  
  if (!structureData.calculationMethod) {
    errors.push('Calculation method is required');
  }
  
  if (!structureData.validityPeriod?.startDate || !structureData.validityPeriod?.endDate) {
    errors.push('Validity period start and end dates are required');
  }
  
  if (structureData.validityPeriod?.startDate && structureData.validityPeriod?.endDate) {
    if (new Date(structureData.validityPeriod.startDate) >= new Date(structureData.validityPeriod.endDate)) {
      errors.push('Start date must be before end date');
    }
  }
  
  // Validate tiered structure
  if (structureData.calculationMethod === 'tiered' && structureData.commissionTiers) {
    if (structureData.commissionTiers.length === 0) {
      errors.push('At least one commission tier is required for tiered calculation');
    }
    
    // Check for overlapping tiers
    for (let i = 0; i < structureData.commissionTiers.length; i++) {
      const tier = structureData.commissionTiers[i];
      if (tier.minSales >= tier.maxSales && tier.maxSales !== null) {
        errors.push(`Tier ${i + 1}: Maximum sales must be greater than minimum sales`);
      }
    }
  }
  
  // Validate percentage rates
  if (structureData.baseCommissionRate && (structureData.baseCommissionRate < 0 || structureData.baseCommissionRate > 100)) {
    errors.push('Base commission rate must be between 0 and 100');
  }
  
  // Validate unit type rates
  if (structureData.unitTypeRates) {
    structureData.unitTypeRates.forEach((rate, index) => {
      if (rate.commissionRate < 0 || rate.commissionRate > 100) {
        errors.push(`Unit type rate ${index + 1}: Commission rate must be between 0 and 100`);
      }
    });
  }
  
  // Validate TDS rate
  if (structureData.taxSettings?.tdsRate && (structureData.taxSettings.tdsRate < 0 || structureData.taxSettings.tdsRate > 30)) {
    warnings.push('TDS rate seems unusually high or low');
  }
  
  // Validate performance bonuses
  if (structureData.performanceBonuses) {
    structureData.performanceBonuses.forEach((bonus, index) => {
      if (!bonus.bonusName || bonus.bonusName.trim() === '') {
        errors.push(`Performance bonus ${index + 1}: Bonus name is required`);
      }
      
      if (!bonus.validFrom || !bonus.validUntil) {
        errors.push(`Performance bonus ${index + 1}: Valid from and until dates are required`);
      }
      
      if (bonus.validFrom && bonus.validUntil && new Date(bonus.validFrom) >= new Date(bonus.validUntil)) {
        errors.push(`Performance bonus ${index + 1}: Valid from date must be before valid until date`);
      }
    });
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
};

export {
  createCommissionForSale,
  processCommissionPayments,
  adjustCommissionForSaleChange,
  generateCommissionReport,
  getPartnerPerformanceData,
  bulkApproveCommissions,
  recalculateCommission,
  getCommissionAnalytics,
  validateCommissionStructure
};