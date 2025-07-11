// File: controllers/salesController.js
// Updated to work seamlessly with the frontend payload structure

import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import Sale from '../models/salesModel.js';
import Unit from '../models/unitModel.js';
import Lead from '../models/leadModel.js';
import Project from '../models/projectModel.js';
import User from '../models/userModel.js';
import { generateCostSheetForUnit } from '../services/pricingService.js';
import { createPaymentPlan } from '../services/paymentService.js';

/**
 * @desc    Create a new sale (book a unit) - UPDATED for frontend compatibility
 * @route   POST /api/sales
 * @access  Private (Sales roles)
 */
const createSale = asyncHandler(async (req, res) => {
  const { 
    unitId, 
    leadId, 
    discountPercentage = 0, 
    discountAmount = 0, 
    costSheetSnapshot, 
    paymentPlanSnapshot // Frontend sends this with templateId, templateName, schedule
  } = req.body;

  console.log('📝 Creating sale with frontend payload:', {
    unitId,
    leadId,
    discountPercentage,
    discountAmount,
    hasCostSheet: !!costSheetSnapshot,
    hasPaymentPlanSnapshot: !!paymentPlanSnapshot,
    paymentPlanDetails: paymentPlanSnapshot ? {
      templateId: paymentPlanSnapshot.templateId,
      templateName: paymentPlanSnapshot.templateName,
      hasSchedule: !!paymentPlanSnapshot.schedule
    } : null
  });

  // 1. Validate input
  if (!unitId || !leadId) {
    res.status(400);
    throw new Error('Unit ID and Lead ID are required to book a sale.');
  }

  // Use a transaction to ensure atomicity
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // 2. Check if the unit is available and belongs to the organization
    const unit = await Unit.findOne({
      _id: unitId,
      organization: req.user.organization,
    }).populate('project', 'name location type status').session(session);

    if (!unit) {
      throw new Error('Unit not found or not accessible.');
    }
    if (unit.status !== 'available') {
      throw new Error(`Unit is not available. Current status: ${unit.status}`);
    }

    // 3. Verify the lead exists
    const lead = await Lead.findOne({
      _id: leadId,
      organization: req.user.organization,
    }).session(session);

    if (!lead) {
      throw new Error('Lead not found or not accessible.');
    }

    // 4. Generate or use provided cost sheet
    let costSheet;
    if (costSheetSnapshot) {
      costSheet = costSheetSnapshot;
      console.log('✅ Using provided cost sheet snapshot');
    } else {
      // Fallback: Generate cost sheet if not provided
      costSheet = await generateCostSheetForUnit(unitId, { 
        discountPercentage,
        discountAmount 
      });
      console.log('✅ Generated new cost sheet');
    }

    // 5. Calculate final sale price
    const finalSalePrice = costSheet.totals?.finalAmount || 
                          costSheet.finalPayableAmount || 
                          costSheet.total || 
                          costSheet.negotiatedPrice ||
                          unit.currentPrice ||
                          unit.basePrice;

    console.log('💰 Final sale price calculated:', finalSalePrice);

    // 6. Create the sale record with proper discount amount
    const calculatedDiscountAmount = discountAmount || (finalSalePrice * discountPercentage / 100);

    const sale = new Sale({
      project: unit.project._id,
      unit: unitId,
      lead: leadId,
      organization: req.user.organization,
      salesPerson: req.user._id,
      salePrice: finalSalePrice,
      discountAmount: calculatedDiscountAmount,
      costSheetSnapshot: costSheet,
      status: 'Booked',
      bookingDate: new Date(),
      // Store the payment plan snapshot for reference
      paymentPlanSnapshot: paymentPlanSnapshot
    });
    
    const createdSale = await sale.save({ session });
    console.log('✅ Sale created successfully:', createdSale._id);

    // 7. Update the unit and lead status
    unit.status = 'sold';
    await unit.save({ session });
    console.log('✅ Unit status updated to sold');

    lead.status = 'Booked';
    lead.lastContactDate = new Date();
    await lead.save({ session });
    console.log('✅ Lead status updated to Booked');

    // 8. 🔥 CREATE PAYMENT PLAN AUTOMATICALLY
    console.log('💳 Creating payment plan...');
    
    let paymentPlanResult = null;
    
    try {
      // Extract template name from frontend payload
      const templateName = paymentPlanSnapshot?.templateName || 'standard';
      
      console.log('📋 Creating payment plan with template:', templateName);
      
      paymentPlanResult = await createPaymentPlan(
        createdSale, 
        templateName, 
        req.user._id
      );
      
      console.log('✅ Payment plan created:', paymentPlanResult.paymentPlan._id);
      console.log('✅ Installments created:', paymentPlanResult.installments.length);
      
      // Update sale with payment plan reference
      createdSale.paymentPlan = paymentPlanResult.paymentPlan._id;
      await createdSale.save({ session });
      console.log('✅ Sale updated with payment plan reference');
      
    } catch (paymentPlanError) {
      console.error('❌ Payment plan creation failed:', paymentPlanError.message);
      // Don't fail the entire transaction for payment plan issues
      // The sale is still valid even if payment plan creation fails
    }
    
    // 9. Commit the transaction
    await session.commitTransaction();
    session.endSession();
    console.log('✅ Transaction committed successfully');

    // 10. Return populated sale data as expected by frontend
    const populatedSale = await Sale.findById(createdSale._id)
      .populate('project', 'name location type status')
      .populate('unit', 'unitNumber fullAddress floor area')
      .populate('lead', 'firstName lastName email phone source priority')
      .populate('salesPerson', 'firstName lastName email role')
      .populate('paymentPlan');

    // 11. Get payment plan and installments for frontend response
    let paymentPlanData = null;
    let installmentsData = [];
    
    if (paymentPlanResult) {
      paymentPlanData = await mongoose.model('PaymentPlan').findById(paymentPlanResult.paymentPlan._id)
        .populate('project', 'name')
        .populate('customer', 'firstName lastName email');
        
      installmentsData = await mongoose.model('Installment').find({ 
        sale: createdSale._id 
      }).sort({ installmentNumber: 1 });
    }

    // 12. Frontend expects this response structure
    res.status(201).json({
      success: true,
      data: {
        ...populatedSale.toObject(),
        paymentPlan: paymentPlanData,
        installments: installmentsData,
        summary: paymentPlanData ? {
          totalInstallments: installmentsData.length,
          totalAmount: paymentPlanData.totalAmount || 0,
          nextDueDate: installmentsData.find(i => i.status === 'pending')?.currentDueDate
        } : null
      },
      message: 'Sale and payment plan created successfully'
    });

  } catch (error) {
    // If any operation fails, abort the transaction
    await session.abortTransaction();
    session.endSession();
    console.error('❌ Transaction aborted due to error:', error.message);
    res.status(400);
    throw new Error(`Failed to create sale: ${error.message}`);
  }
});

// Keep all other existing functions unchanged...
const getSales = asyncHandler(async (req, res) => {
  try {
    const {
      page = 1,
      limit = 25,
      search = '',
      status = '',
      paymentStatus = '',
      project = '',
      salesperson = '',
      dateFrom = '',
      dateTo = '',
      sortBy = 'bookingDate',
      sortOrder = 'desc'
    } = req.query;

    console.log('📋 getSales query params:', req.query);

    // Build base query filters
    const baseFilters = {
      organization: req.user.organization
    };

    // Add status filter
    if (status && status !== 'all') {
      baseFilters.status = status;
    }

    // Add payment status filter
    if (paymentStatus && paymentStatus !== 'all') {
      baseFilters.paymentStatus = paymentStatus;
    }

    // Add project filter
    if (project && project !== 'all') {
      baseFilters.project = project;
    }

    // Add salesperson filter
    if (salesperson && salesperson !== 'all') {
      baseFilters.salesPerson = salesperson;
    }

    // Add date range filter
    if (dateFrom || dateTo) {
      baseFilters.bookingDate = {};
      if (dateFrom) {
        baseFilters.bookingDate.$gte = new Date(dateFrom);
      }
      if (dateTo) {
        baseFilters.bookingDate.$lte = new Date(dateTo);
      }
    }

    // Calculate pagination
    const pageNumber = parseInt(page);
    const pageSize = parseInt(limit);
    const skip = (pageNumber - 1) * pageSize;

    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

    console.log('🔍 Base filters:', baseFilters);
    console.log('📄 Pagination:', { page: pageNumber, limit: pageSize, skip });

    // Handle search with aggregation pipeline
    if (search && search.trim()) {
      const searchRegex = new RegExp(search.trim(), 'i');
      
      const searchPipeline = [
        {
          $match: baseFilters
        },
        {
          $lookup: {
            from: 'leads',
            localField: 'lead',
            foreignField: '_id',
            as: 'leadData'
          }
        },
        {
          $lookup: {
            from: 'units',
            localField: 'unit',
            foreignField: '_id',
            as: 'unitData'
          }
        },
        {
          $lookup: {
            from: 'projects',
            localField: 'project',
            foreignField: '_id',
            as: 'projectData'
          }
        },
        {
          $lookup: {
            from: 'users',
            localField: 'salesPerson',
            foreignField: '_id',
            as: 'salesPersonData'
          }
        },
        {
          $match: {
            $or: [
              { 'leadData.firstName': searchRegex },
              { 'leadData.lastName': searchRegex },
              { 'leadData.email': searchRegex },
              { 'leadData.phone': searchRegex },
              { 'unitData.unitNumber': searchRegex },
              { 'unitData.fullAddress': searchRegex },
              { 'projectData.name': searchRegex },
              { 'salesPersonData.firstName': searchRegex },
              { 'salesPersonData.lastName': searchRegex },
              { saleNumber: searchRegex }
            ]
          }
        },
        {
          $sort: sort
        }
      ];

      // Get total count for pagination
      const totalCountPipeline = [
        ...searchPipeline,
        { $count: 'total' }
      ];

      // Get paginated results
      const dataPipeline = [
        ...searchPipeline,
        { $skip: skip },
        { $limit: pageSize }
      ];

      const [totalCountResult, salesData] = await Promise.all([
        Sale.aggregate(totalCountPipeline),
        Sale.aggregate(dataPipeline)
      ]);

      const total = totalCountResult[0]?.total || 0;

      // Populate the aggregated results
      const populatedSales = await Sale.populate(salesData, [
        { path: 'project', select: 'name location type status' },
        { path: 'unit', select: 'unitNumber fullAddress floor area' },
        { path: 'lead', select: 'firstName lastName email phone source priority' },
        { path: 'salesPerson', select: 'firstName lastName email role' }
      ]);

      // Calculate stats
      const stats = await calculateSalesStats(req.user.organization, baseFilters);

      res.json({
        success: true,
        data: populatedSales,
        pagination: {
          page: pageNumber,
          limit: pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
          hasNext: pageNumber < Math.ceil(total / pageSize),
          hasPrev: pageNumber > 1
        },
        stats,
        count: populatedSales.length
      });

    } else {
      // Regular query without search
      const salesQuery = Sale.find(baseFilters)
        .populate('project', 'name location type status')
        .populate('unit', 'unitNumber fullAddress floor area')
        .populate('lead', 'firstName lastName email phone source priority')
        .populate('salesPerson', 'firstName lastName email role')
        .sort(sort)
        .skip(skip)
        .limit(pageSize);

      const [sales, total] = await Promise.all([
        salesQuery,
        Sale.countDocuments(baseFilters)
      ]);

      // Calculate stats
      const stats = await calculateSalesStats(req.user.organization, baseFilters);

      console.log('✅ Sales query results:', { count: sales.length, total });

      res.json({
        success: true,
        data: sales,
        pagination: {
          page: pageNumber,
          limit: pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
          hasNext: pageNumber < Math.ceil(total / pageSize),
          hasPrev: pageNumber > 1
        },
        stats,
        count: sales.length
      });
    }

  } catch (error) {
    console.error('❌ Error in getSales:', error);
    res.status(500);
    throw new Error('Failed to fetch sales data');
  }
});

const getSale = asyncHandler(async (req, res) => {
  const { id } = req.params;

  try {
    const sale = await Sale.findOne({
      _id: id,
      organization: req.user.organization
    })
      .populate('project', 'name location type status configuration')
      .populate('unit', 'unitNumber fullAddress floor area bedrooms bathrooms')
      .populate('lead', 'firstName lastName email phone source priority requirements')
      .populate('salesPerson', 'firstName lastName email role')
      .populate('paymentPlan');

    if (!sale) {
      res.status(404);
      throw new Error('Sale not found');
    }

    res.json({
      success: true,
      data: sale
    });

  } catch (error) {
    console.error('❌ Error in getSale:', error);
    if (error.message === 'Sale not found') {
      res.status(404);
      throw new Error('Sale not found');
    }
    res.status(500);
    throw new Error('Failed to fetch sale details');
  }
});

const updateSale = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updateData = req.body;

  try {
    const sale = await Sale.findOne({
      _id: id,
      organization: req.user.organization
    });

    if (!sale) {
      res.status(404);
      throw new Error('Sale not found');
    }

    // Update the sale
    Object.assign(sale, updateData);
    sale.updatedAt = new Date();

    const updatedSale = await sale.save();

    // Return with populated data
    const populatedSale = await Sale.findById(updatedSale._id)
      .populate('project', 'name location type status')
      .populate('unit', 'unitNumber fullAddress floor area')
      .populate('lead', 'firstName lastName email phone')
      .populate('salesPerson', 'firstName lastName email role');

    res.json({
      success: true,
      data: populatedSale,
      message: 'Sale updated successfully'
    });

  } catch (error) {
    console.error('❌ Error in updateSale:', error);
    res.status(400);
    throw new Error('Failed to update sale');
  }
});

const cancelSale = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reason, cancelledBy } = req.body;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const sale = await Sale.findOne({
      _id: id,
      organization: req.user.organization
    }).session(session);

    if (!sale) {
      throw new Error('Sale not found');
    }

    // Update sale status
    sale.status = 'cancelled';
    sale.cancellationReason = reason || 'No reason provided';
    sale.cancelledBy = cancelledBy || req.user._id;
    sale.cancelledAt = new Date();
    await sale.save({ session });

    // Update unit status back to available
    await Unit.findByIdAndUpdate(
      sale.unit,
      { status: 'available' },
      { session }
    );

    // Update lead status back to active
    await Lead.findByIdAndUpdate(
      sale.lead,
      { status: 'Active' },
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    res.json({
      success: true,
      message: 'Sale cancelled successfully'
    });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error('❌ Error in cancelSale:', error);
    res.status(400);
    throw new Error(`Failed to cancel sale: ${error.message}`);
  }
});

const getSalesAnalytics = asyncHandler(async (req, res) => {
  try {
    const { period = '30', projectId, salespersonId } = req.query;
    
    // Build filters
    const filters = { organization: req.user.organization };
    if (projectId) filters.project = projectId;
    if (salespersonId) filters.salesPerson = salespersonId;
    
    // Date range
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(period));
    
    const analytics = await Sale.aggregate([
      { $match: { ...filters, bookingDate: { $gte: startDate } } },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$bookingDate' }
          },
          totalSales: { $sum: 1 },
          totalRevenue: { $sum: '$salePrice' },
          averageValue: { $avg: '$salePrice' }
        }
      },
      { $sort: { '_id': 1 } }
    ]);

    res.json({
      success: true,
      data: analytics,
      period: `${period} days`
    });

  } catch (error) {
    console.error('❌ Error in getSalesAnalytics:', error);
    res.status(500);
    throw new Error('Failed to fetch sales analytics');
  }
});

const getSalesPipeline = asyncHandler(async (req, res) => {
  try {
    const pipeline = await Sale.aggregate([
      { $match: { organization: req.user.organization } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalValue: { $sum: '$salePrice' }
        }
      },
      {
        $project: {
          status: '$_id',
          count: 1,
          totalValue: 1,
          _id: 0
        }
      }
    ]);

    res.json({
      success: true,
      data: pipeline
    });

  } catch (error) {
    console.error('❌ Error in getSalesPipeline:', error);
    res.status(500);
    throw new Error('Failed to fetch sales pipeline');
  }
});

const calculateSalesStats = async (organizationId, filters = {}) => {
  try {
    const baseFilters = { organization: organizationId };
    const allFilters = { ...baseFilters, ...filters };

    // Total sales and revenue
    const totalStats = await Sale.aggregate([
      { $match: baseFilters },
      {
        $group: {
          _id: null,
          totalSales: { $sum: 1 },
          totalRevenue: { $sum: '$salePrice' },
          averageSaleValue: { $avg: '$salePrice' }
        }
      }
    ]);

    // Monthly stats (current month)
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const monthlyStats = await Sale.aggregate([
      {
        $match: {
          ...baseFilters,
          bookingDate: { $gte: startOfMonth }
        }
      },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          revenue: { $sum: '$salePrice' }
        }
      }
    ]);

    // Status breakdown
    const statusBreakdown = await Sale.aggregate([
      { $match: baseFilters },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          revenue: { $sum: '$salePrice' }
        }
      }
    ]);

    return {
      totalSales: totalStats[0]?.totalSales || 0,
      totalRevenue: totalStats[0]?.totalRevenue || 0,
      averageSaleValue: totalStats[0]?.averageSaleValue || 0,
      monthlyStats: monthlyStats[0] || { count: 0, revenue: 0 },
      statusBreakdown: statusBreakdown
    };

  } catch (error) {
    console.error('❌ Error calculating sales stats:', error);
    return {
      totalSales: 0,
      totalRevenue: 0,
      averageSaleValue: 0,
      monthlyStats: { count: 0, revenue: 0 },
      statusBreakdown: []
    };
  }
};

export { 
  createSale, 
  getSales, 
  getSale, 
  updateSale, 
  cancelSale,
  getSalesAnalytics,
  getSalesPipeline
};