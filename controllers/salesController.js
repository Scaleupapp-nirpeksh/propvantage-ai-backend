// File: controllers/salesController.js
// Description: Complete sales controller with pagination, filtering, and proper data population
// Version: 3.0 - Production-ready with comprehensive pagination and search
// Location: controllers/salesController.js

import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import Sale from '../models/salesModel.js';
import Unit from '../models/unitModel.js';
import Lead from '../models/leadModel.js';
import Project from '../models/projectModel.js';
import User from '../models/userModel.js';
import { generateCostSheetForUnit } from '../services/pricingService.js';

/**
 * @desc    Create a new sale (book a unit)
 * @route   POST /api/sales
 * @access  Private (Sales roles)
 */
const createSale = asyncHandler(async (req, res) => {
  const { unitId, leadId, discountPercentage = 0, discountAmount = 0 } = req.body;

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
    }).populate('project', 'name').session(session);

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

    // 4. Generate the final, official cost sheet for the sale
    const costSheet = await generateCostSheetForUnit(unitId, { 
      discountPercentage,
      discountAmount 
    });

    // 5. Create the sale record
    const sale = new Sale({
      project: unit.project._id,
      unit: unitId,
      lead: leadId,
      organization: req.user.organization,
      salesPerson: req.user._id,
      salePrice: costSheet.finalPayableAmount || costSheet.negotiatedPrice,
      discountAmount: discountAmount || (costSheet.basePrice * discountPercentage / 100),
      costSheetSnapshot: costSheet,
      status: 'booked',
      paymentStatus: 'pending',
      bookingDate: new Date(),
    });
    
    const createdSale = await sale.save({ session });

    // 6. Update the unit and lead status
    unit.status = 'sold';
    await unit.save({ session });

    lead.status = 'Booked';
    lead.lastContactDate = new Date();
    await lead.save({ session });
    
    // 7. If all operations are successful, commit the transaction
    await session.commitTransaction();
    session.endSession();

    // 8. Return the created sale with populated data
    const populatedSale = await Sale.findById(createdSale._id)
      .populate('project', 'name location type status')
      .populate('unit', 'unitNumber fullAddress floor area')
      .populate('lead', 'firstName lastName email phone source priority')
      .populate('salesPerson', 'firstName lastName email role');

    res.status(201).json({
      success: true,
      data: populatedSale,
      message: 'Sale created successfully'
    });

  } catch (error) {
    // 8. If any operation fails, abort the transaction
    await session.abortTransaction();
    session.endSession();
    res.status(400);
    throw new Error(`Failed to create sale: ${error.message}`);
  }
});

/**
 * @desc    Get all sales with comprehensive pagination, filtering, and search
 * @route   GET /api/sales
 * @access  Private (Sales and Management roles)
 */
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

/**
 * @desc    Get a single sale by ID
 * @route   GET /api/sales/:id
 * @access  Private (Sales and Management roles)
 */
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
      .populate('salesPerson', 'firstName lastName email role');

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

/**
 * @desc    Update a sale
 * @route   PUT /api/sales/:id
 * @access  Private (Sales and Management roles)
 */
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

/**
 * @desc    Cancel a sale
 * @route   DELETE /api/sales/:id
 * @access  Private (Management roles)
 */
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

/**
 * @desc    Get sales analytics
 * @route   GET /api/sales/analytics
 * @access  Private (Management roles)
 */
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

/**
 * @desc    Get sales pipeline data
 * @route   GET /api/sales/pipeline
 * @access  Private (Sales and Management roles)
 */
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

/**
 * Helper function to calculate sales statistics
 */
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