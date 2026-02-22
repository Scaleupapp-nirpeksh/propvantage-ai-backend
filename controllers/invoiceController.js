// File: controllers/invoiceController.js
// Description: Invoice controller for PropVantage AI - Production grade invoice management API
// Version: 1.0 - Complete invoice management with export functionality
// Location: controllers/invoiceController.js

import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import Invoice from '../models/invoiceModel.js';
import Sale from '../models/salesModel.js';
import Unit from '../models/unitModel.js';
import Lead from '../models/leadModel.js';
import Project from '../models/projectModel.js';
import Organization from '../models/organizationModel.js';
import { verifyProjectAccess, projectAccessFilter } from '../utils/projectAccessHelper.js';
import {
  checkApprovalRequired,
  createApprovalRequest,
} from '../services/approvalService.js';

/**
 * Helper function to convert number to words for Indian currency
 */
const convertNumberToWords = (num) => {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
  const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const numberGroups = ['', 'Thousand', 'Lakh', 'Crore'];

  if (num === 0) return 'Zero Rupees Only';

  const convertHundreds = (n) => {
    let result = '';
    if (n >= 100) {
      result += ones[Math.floor(n / 100)] + ' Hundred ';
      n %= 100;
    }
    if (n >= 20) {
      result += tens[Math.floor(n / 10)] + ' ';
      n %= 10;
    } else if (n >= 10) {
      result += teens[n - 10] + ' ';
      n = 0;
    }
    if (n > 0) {
      result += ones[n] + ' ';
    }
    return result;
  };

  const integerPart = Math.floor(num);
  const decimalPart = Math.round((num - integerPart) * 100);

  let result = '';
  let crores = Math.floor(integerPart / 10000000);
  let lakhs = Math.floor((integerPart % 10000000) / 100000);
  let thousandGroup = Math.floor((integerPart % 100000) / 1000);
  let hundreds = integerPart % 1000;

  if (crores > 0) {
    result += convertHundreds(crores) + 'Crore ';
  }
  if (lakhs > 0) {
    result += convertHundreds(lakhs) + 'Lakh ';
  }
  if (thousands > 0) {
    result += convertHundreds(thousands) + 'Thousand ';
  }
  if (hundreds > 0) {
    result += convertHundreds(hundreds);
  }

  result += 'Rupees';
  
  if (decimalPart > 0) {
    result += ' and ' + convertHundreds(decimalPart) + 'Paise';
  }
  
  return result.trim() + ' Only';
};

/**
 * @desc    Create invoice from sale
 * @route   POST /api/invoices/from-sale/:saleId
 * @access  Private (Sales and Finance roles)
 */
const createInvoiceFromSale = asyncHandler(async (req, res) => {
  const { saleId } = req.params;
  const { 
    type = 'booking_invoice',
    dueDate,
    customerNotes,
    paymentInstructions,
    template = { templateId: 'default', templateName: 'Standard Invoice' }
  } = req.body;

  console.log('📄 Creating invoice from sale:', saleId);

  try {
    // Validate sale exists and belongs to organization
    const sale = await Sale.findOne({
      _id: saleId,
      organization: req.user.organization
    })
    .populate('project', 'name location address gstNumber')
    .populate('unit', 'unitNumber floor area fullAddress')
    .populate('lead', 'firstName lastName email phone address')
    .populate('salesPerson', 'firstName lastName email');

    if (!sale) {
      res.status(404);
      throw new Error('Sale not found or not accessible');
    }

    // Verify project-level access
    verifyProjectAccess(req, res, sale.project?._id || sale.project);

    // Check if invoice already exists for this sale and type
    const existingInvoice = await Invoice.findOne({
      organization: req.user.organization,
      sale: saleId,
      type: type,
      status: { $ne: 'cancelled' }
    });

    if (existingInvoice) {
      res.status(400);
      throw new Error(`${type.replace('_', ' ')} invoice already exists for this sale`);
    }

    // Extract cost sheet data from sale
    const costSheetSnapshot = sale.costSheetSnapshot;
    if (!costSheetSnapshot) {
      res.status(400);
      throw new Error('Cost sheet not available for this sale');
    }

    // Transform cost sheet components to invoice line items
    const lineItems = [];
    let subtotal = 0;
    let totalGstAmount = 0;

    // Process cost sheet components
    if (costSheetSnapshot.components && Array.isArray(costSheetSnapshot.components)) {
      costSheetSnapshot.components.forEach(component => {
        const itemTotal = component.amount || 0;
        const gstRate = component.gstRate || 0;
        const gstAmount = (itemTotal * gstRate) / 100;

        lineItems.push({
          itemCode: component.code || '',
          description: component.name || component.description,
          category: component.category || 'other_charges',
          quantity: 1,
          unitPrice: itemTotal,
          totalPrice: itemTotal,
          taxable: component.taxable !== false,
          gstRate: gstRate,
          gstAmount: gstAmount
        });

        subtotal += itemTotal;
        totalGstAmount += gstAmount;
      });
    }

    // Add discount as separate line item if present
    if (sale.discountAmount && sale.discountAmount > 0) {
      lineItems.push({
        itemCode: 'DISC',
        description: 'Discount Applied',
        category: 'discounts',
        quantity: 1,
        unitPrice: -sale.discountAmount,
        totalPrice: -sale.discountAmount,
        taxable: false,
        gstRate: 0,
        gstAmount: 0
      });
      subtotal -= sale.discountAmount;
    }

    // Calculate financial summary
    const taxableAmount = lineItems
      .filter(item => item.taxable)
      .reduce((sum, item) => sum + item.totalPrice, 0);

    // For Indian GST - split between CGST/SGST or IGST
    // Assuming same state transaction for now (CGST + SGST)
    const cgstAmount = totalGstAmount / 2;
    const sgstAmount = totalGstAmount / 2;
    const igstAmount = 0; // For inter-state transactions

    const totalAmount = subtotal + totalGstAmount;
    const amountInWords = convertNumberToWords(totalAmount);

    // Create invoice data
    const invoiceData = {
      organization: req.user.organization,
      sale: saleId,
      project: sale.project._id,
      unit: sale.unit._id,
      customer: sale.lead._id,
      generatedBy: req.user._id,
      type: type,
      status: 'draft',
      invoiceDate: new Date(),
      dueDate: dueDate ? new Date(dueDate) : undefined,
      lineItems: lineItems,
      financialSummary: {
        subtotal: subtotal,
        discountAmount: sale.discountAmount || 0,
        taxableAmount: taxableAmount,
        cgstAmount: cgstAmount,
        sgstAmount: sgstAmount,
        igstAmount: igstAmount,
        totalGstAmount: totalGstAmount,
        totalAmount: totalAmount,
        amountInWords: amountInWords
      },
      paymentDetails: {
        totalPaid: 0,
        pendingAmount: totalAmount,
        lastPaymentDate: null
      },
      template: template,
      notes: {
        customerNotes: customerNotes || '',
        paymentInstructions: paymentInstructions || 'Please make payment within the due date.',
        internalNotes: `Generated from sale ${sale._id}`
      },
      metadata: {
        generationMethod: 'manual',
        source: 'web_app',
        ipAddress: req.ip
      }
    };

    // Create invoice
    const invoice = new Invoice(invoiceData);
    await invoice.save();

    // Populate the created invoice for response
    const populatedInvoice = await Invoice.findById(invoice._id)
      .populate('project', 'name location address gstNumber')
      .populate('unit', 'unitNumber floor area fullAddress')
      .populate('customer', 'firstName lastName email phone address')
      .populate('sale', 'salePrice bookingDate status')
      .populate('generatedBy', 'firstName lastName email');

    console.log('✅ Invoice created successfully:', invoice.invoiceNumber);

    res.status(201).json({
      success: true,
      data: populatedInvoice,
      message: `Invoice ${invoice.invoiceNumber} created successfully`
    });

  } catch (error) {
    console.error('❌ Error creating invoice:', error.message);
    res.status(400);
    throw new Error(`Failed to create invoice: ${error.message}`);
  }
});

/**
 * @desc    Get all invoices with filtering and pagination
 * @route   GET /api/invoices
 * @access  Private (Management and Finance roles)
 */
const getInvoices = asyncHandler(async (req, res) => {
  try {
    const {
      page = 1,
      limit = 25,
      search = '',
      status = '',
      type = '',
      project = '',
      customer = '',
      dateFrom = '',
      dateTo = '',
      overdue = '',
      sortBy = 'invoiceDate',
      sortOrder = 'desc'
    } = req.query;

    console.log('📋 Fetching invoices with filters:', req.query);

    // Build base query filters
    const baseFilters = {
      organization: req.user.organization,
      ...projectAccessFilter(req)
    };

    // Add status filter
    if (status && status !== 'all') {
      baseFilters.status = status;
    }

    // Add type filter
    if (type && type !== 'all') {
      baseFilters.type = type;
    }

    // Add project filter
    if (project && project !== 'all') {
      baseFilters.project = project;
    }

    // Add customer filter
    if (customer && customer !== 'all') {
      baseFilters.customer = customer;
    }

    // Add date range filter
    if (dateFrom || dateTo) {
      baseFilters.invoiceDate = {};
      if (dateFrom) {
        baseFilters.invoiceDate.$gte = new Date(dateFrom);
      }
      if (dateTo) {
        baseFilters.invoiceDate.$lte = new Date(dateTo);
      }
    }

    // Add overdue filter
    if (overdue === 'true') {
      baseFilters.dueDate = { $lt: new Date() };
      baseFilters.status = { $in: ['sent', 'overdue', 'partially_paid'] };
      baseFilters['paymentDetails.pendingAmount'] = { $gt: 0 };
    }

    // Calculate pagination
    const pageNumber = parseInt(page);
    const pageSize = parseInt(limit);
    const skip = (pageNumber - 1) * pageSize;

    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

    // Build aggregation pipeline for search
    let pipeline = [
      { $match: baseFilters }
    ];

    // Add search if provided
    if (search) {
      pipeline.push({
        $lookup: {
          from: 'leads',
          localField: 'customer',
          foreignField: '_id',
          as: 'customerData'
        }
      });

      pipeline.push({
        $lookup: {
          from: 'projects',
          localField: 'project',
          foreignField: '_id',
          as: 'projectData'
        }
      });

      pipeline.push({
        $match: {
          $or: [
            { invoiceNumber: { $regex: search, $options: 'i' } },
            { 'customerData.firstName': { $regex: search, $options: 'i' } },
            { 'customerData.lastName': { $regex: search, $options: 'i' } },
            { 'customerData.email': { $regex: search, $options: 'i' } },
            { 'projectData.name': { $regex: search, $options: 'i' } }
          ]
        }
      });
    }

    // Get total count
    const countPipeline = [...pipeline, { $count: 'total' }];
    const countResult = await Invoice.aggregate(countPipeline);
    const totalInvoices = countResult.length > 0 ? countResult[0].total : 0;

    // Add pagination and sorting to main pipeline
    pipeline.push(
      { $sort: sort },
      { $skip: skip },
      { $limit: pageSize }
    );

    // Execute aggregation to get invoice IDs
    const invoiceIds = await Invoice.aggregate([
      ...pipeline,
      { $project: { _id: 1 } }
    ]);

    // Fetch full invoice data with population
    const invoices = await Invoice.find({
      _id: { $in: invoiceIds.map(doc => doc._id) }
    })
    .populate('project', 'name location address')
    .populate('unit', 'unitNumber floor area')
    .populate('customer', 'firstName lastName email phone')
    .populate('sale', 'salePrice bookingDate')
    .populate('generatedBy', 'firstName lastName')
    .sort(sort);

    // Calculate pagination info
    const totalPages = Math.ceil(totalInvoices / pageSize);
    const hasNextPage = pageNumber < totalPages;
    const hasPrevPage = pageNumber > 1;

    // Get summary statistics
    const summaryStats = await Invoice.aggregate([
      { $match: baseFilters },
      {
        $group: {
          _id: null,
          totalAmount: { $sum: '$financialSummary.totalAmount' },
          totalPaid: { $sum: '$paymentDetails.totalPaid' },
          totalPending: { $sum: '$paymentDetails.pendingAmount' }
        }
      }
    ]);

    const summary = summaryStats[0] || {
      totalAmount: 0,
      totalPaid: 0,
      totalPending: 0
    };

    console.log('✅ Invoices fetched successfully:', {
      count: invoices.length,
      totalInvoices,
      currentPage: pageNumber
    });

    res.json({
      success: true,
      data: {
        invoices: invoices,
        pagination: {
          currentPage: pageNumber,
          totalPages: totalPages,
          totalInvoices: totalInvoices,
          hasNextPage: hasNextPage,
          hasPrevPage: hasPrevPage,
          limit: pageSize
        },
        summary: summary
      }
    });

  } catch (error) {
    console.error('❌ Error fetching invoices:', error.message);
    res.status(500);
    throw new Error(`Failed to fetch invoices: ${error.message}`);
  }
});

/**
 * @desc    Get single invoice by ID
 * @route   GET /api/invoices/:id
 * @access  Private (Management and Finance roles)
 */
const getInvoice = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;

    const invoice = await Invoice.findOne({
      _id: id,
      organization: req.user.organization
    })
    .populate('project', 'name location address gstNumber registrationDetails')
    .populate('unit', 'unitNumber floor area fullAddress specifications')
    .populate('customer', 'firstName lastName email phone address')
    .populate('sale', 'salePrice bookingDate status discountAmount')
    .populate('generatedBy', 'firstName lastName email role')
    .populate('approvalWorkflow.approvedBy', 'firstName lastName')
    .populate('cancellationDetails.cancelledBy', 'firstName lastName');

    if (!invoice) {
      res.status(404);
      throw new Error('Invoice not found');
    }

    // Verify project-level access
    verifyProjectAccess(req, res, invoice.project?._id || invoice.project);

    console.log('✅ Invoice fetched successfully:', invoice.invoiceNumber);

    res.json({
      success: true,
      data: invoice
    });

  } catch (error) {
    console.error('❌ Error fetching invoice:', error.message);
    res.status(500);
    throw new Error(`Failed to fetch invoice: ${error.message}`);
  }
});

/**
 * @desc    Update invoice
 * @route   PUT /api/invoices/:id
 * @access  Private (Finance roles)
 */
const updateInvoice = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // Find invoice
    const invoice = await Invoice.findOne({
      _id: id,
      organization: req.user.organization
    });

    if (!invoice) {
      res.status(404);
      throw new Error('Invoice not found');
    }

    // Verify project-level access
    verifyProjectAccess(req, res, invoice.project?._id || invoice.project);

    // Check if invoice can be updated
    if (invoice.status === 'paid') {
      res.status(400);
      throw new Error('Cannot update a paid invoice');
    }

    if (invoice.status === 'cancelled') {
      res.status(400);
      throw new Error('Cannot update a cancelled invoice');
    }

    // Check if invoice approval is needed when transitioning to 'sent'
    if (updateData.status === 'sent' && ['draft', 'generated'].includes(invoice.status)) {
      const invoiceApprovalCheck = await checkApprovalRequired(
        req.user.organization,
        'INVOICE_APPROVAL',
        { requestedBy: req.user._id },
        invoice.project?._id || invoice.project
      );

      if (invoiceApprovalCheck.required) {
        invoice.approvalWorkflow = {
          requiresApproval: true,
          approvalStatus: 'pending',
        };
        await invoice.save();

        await createApprovalRequest({
          organizationId: req.user.organization,
          projectId: invoice.project?._id || invoice.project,
          approvalType: 'INVOICE_APPROVAL',
          entityType: 'Invoice',
          entityId: invoice._id,
          requestedBy: req.user._id,
          requestData: {
            invoiceAmount: invoice.financialSummary?.totalAmount,
            invoiceType: invoice.type,
          },
          priority: 'Medium',
          title: `Invoice ${invoice.invoiceNumber} approval`,
          description: `Approval required before sending invoice ${invoice.invoiceNumber} (₹${invoice.financialSummary?.totalAmount?.toLocaleString('en-IN')}) to customer.`,
        });

        return res.json({
          success: true,
          pendingApproval: true,
          data: invoice,
          message: 'Invoice submitted for approval before sending',
        });
      }
    }

    // Update allowed fields
    const allowedUpdates = [
      'status',
      'dueDate',
      'notes.customerNotes',
      'notes.paymentInstructions',
      'notes.internalNotes',
      'template',
      'lineItems'
    ];

    // Apply updates
    allowedUpdates.forEach(field => {
      if (updateData[field] !== undefined) {
        if (field.includes('.')) {
          const [parent, child] = field.split('.');
          if (!invoice[parent]) invoice[parent] = {};
          invoice[parent][child] = updateData[field];
        } else {
          invoice[field] = updateData[field];
        }
      }
    });

    // Recalculate financial summary if line items changed
    if (updateData.lineItems) {
      const subtotal = updateData.lineItems.reduce((sum, item) => sum + item.totalPrice, 0);
      const totalGstAmount = updateData.lineItems.reduce((sum, item) => sum + item.gstAmount, 0);
      const totalAmount = subtotal + totalGstAmount;

      invoice.financialSummary.subtotal = subtotal;
      invoice.financialSummary.totalGstAmount = totalGstAmount;
      invoice.financialSummary.cgstAmount = totalGstAmount / 2;
      invoice.financialSummary.sgstAmount = totalGstAmount / 2;
      invoice.financialSummary.totalAmount = totalAmount;
      invoice.financialSummary.amountInWords = convertNumberToWords(totalAmount);
      
      // Update pending amount
      invoice.paymentDetails.pendingAmount = totalAmount - invoice.paymentDetails.totalPaid;
    }

    // Increment revision number
    invoice.revision += 1;

    await invoice.save();

    // Populate updated invoice
    const updatedInvoice = await Invoice.findById(id)
      .populate('project', 'name location address')
      .populate('unit', 'unitNumber floor area')
      .populate('customer', 'firstName lastName email phone')
      .populate('sale', 'salePrice bookingDate');

    console.log('✅ Invoice updated successfully:', invoice.invoiceNumber);

    res.json({
      success: true,
      data: updatedInvoice,
      message: 'Invoice updated successfully'
    });

  } catch (error) {
    console.error('❌ Error updating invoice:', error.message);
    res.status(400);
    throw new Error(`Failed to update invoice: ${error.message}`);
  }
});

/**
 * @desc    Record payment for invoice
 * @route   POST /api/invoices/:id/payment
 * @access  Private (Finance roles)
 */
const recordInvoicePayment = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, paymentMethod, paymentReference, paymentDate } = req.body;

    // Validate required fields
    if (!amount || !paymentMethod) {
      res.status(400);
      throw new Error('Payment amount and method are required');
    }

    if (amount <= 0) {
      res.status(400);
      throw new Error('Payment amount must be greater than 0');
    }

    // Find invoice
    const invoice = await Invoice.findOne({
      _id: id,
      organization: req.user.organization
    });

    if (!invoice) {
      res.status(404);
      throw new Error('Invoice not found');
    }

    // Verify project-level access
    verifyProjectAccess(req, res, invoice.project?._id || invoice.project);

    if (invoice.status === 'cancelled') {
      res.status(400);
      throw new Error('Cannot record payment for cancelled invoice');
    }

    // Record payment
    await invoice.recordPayment({
      amount: parseFloat(amount),
      paymentMethod,
      paymentReference,
      paymentDate: paymentDate ? new Date(paymentDate) : new Date()
    });

    // Populate updated invoice
    const updatedInvoice = await Invoice.findById(id)
      .populate('project', 'name location')
      .populate('customer', 'firstName lastName email phone');

    console.log('✅ Payment recorded successfully for invoice:', invoice.invoiceNumber);

    res.json({
      success: true,
      data: updatedInvoice,
      message: `Payment of ${amount} recorded successfully`
    });

  } catch (error) {
    console.error('❌ Error recording payment:', error.message);
    res.status(400);
    throw new Error(`Failed to record payment: ${error.message}`);
  }
});

/**
 * @desc    Cancel invoice
 * @route   PUT /api/invoices/:id/cancel
 * @access  Private (Finance Head and Business Head roles)
 */
const cancelInvoice = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason) {
      res.status(400);
      throw new Error('Cancellation reason is required');
    }

    // Find invoice
    const invoice = await Invoice.findOne({
      _id: id,
      organization: req.user.organization
    });

    if (!invoice) {
      res.status(404);
      throw new Error('Invoice not found');
    }

    // Verify project-level access
    verifyProjectAccess(req, res, invoice.project?._id || invoice.project);

    // Cancel invoice
    await invoice.cancelInvoice({ reason }, req.user._id);

    // Populate cancelled invoice
    const cancelledInvoice = await Invoice.findById(id)
      .populate('cancellationDetails.cancelledBy', 'firstName lastName');

    console.log('✅ Invoice cancelled successfully:', invoice.invoiceNumber);

    res.json({
      success: true,
      data: cancelledInvoice,
      message: 'Invoice cancelled successfully'
    });

  } catch (error) {
    console.error('❌ Error cancelling invoice:', error.message);
    res.status(400);
    throw new Error(`Failed to cancel invoice: ${error.message}`);
  }
});

/**
 * @desc    Get invoice statistics
 * @route   GET /api/invoices/statistics
 * @access  Private (Management roles)
 */
const getInvoiceStatistics = asyncHandler(async (req, res) => {
  try {
    const { period = '30', type = '' } = req.query;
    
    // Build filters
    const filters = {
      organization: req.user.organization,
      ...projectAccessFilter(req)
    };

    if (type && type !== 'all') {
      filters.type = type;
    }

    if (period !== 'all') {
      const days = parseInt(period);
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      filters.invoiceDate = { $gte: startDate };
    }

    // Get statistics
    const stats = await Invoice.getInvoiceStatistics(req.user.organization, filters);

    // Get recent invoices
    const recentInvoices = await Invoice.find({
      organization: req.user.organization,
      ...filters
    })
    .populate('customer', 'firstName lastName email')
    .populate('project', 'name')
    .sort({ invoiceDate: -1 })
    .limit(10);

    // Get overdue invoices
    let overdueInvoices = await Invoice.getOverdueInvoices(req.user.organization);

    // Filter by accessible projects
    if (req.accessibleProjectIds) {
      const accessibleIds = req.accessibleProjectIds.map(id => id.toString());
      overdueInvoices = overdueInvoices.filter(inv => {
        const pid = (inv.project?._id || inv.project)?.toString();
        return pid && accessibleIds.includes(pid);
      });
    }

    console.log('✅ Invoice statistics fetched successfully');

    res.json({
      success: true,
      data: {
        statistics: stats,
        recentInvoices,
        overdueInvoices: overdueInvoices.slice(0, 5), // Top 5 overdue
        period: period
      }
    });

  } catch (error) {
    console.error('❌ Error fetching statistics:', error.message);
    res.status(500);
    throw new Error(`Failed to fetch invoice statistics: ${error.message}`);
  }
});

/**
 * @desc    Get overdue invoices
 * @route   GET /api/invoices/overdue
 * @access  Private (Management and Finance roles)
 */
const getOverdueInvoices = asyncHandler(async (req, res) => {
  try {
    let overdueInvoices = await Invoice.getOverdueInvoices(req.user.organization);

    // Filter by accessible projects
    if (req.accessibleProjectIds) {
      const accessibleIds = req.accessibleProjectIds.map(id => id.toString());
      overdueInvoices = overdueInvoices.filter(inv => {
        const pid = (inv.project?._id || inv.project)?.toString();
        return pid && accessibleIds.includes(pid);
      });
    }

    console.log('✅ Overdue invoices fetched successfully:', overdueInvoices.length);

    res.json({
      success: true,
      data: overdueInvoices
    });

  } catch (error) {
    console.error('❌ Error fetching overdue invoices:', error.message);
    res.status(500);
    throw new Error(`Failed to fetch overdue invoices: ${error.message}`);
  }
});

/**
 * @desc    Export invoices to CSV
 * @route   GET /api/invoices/export
 * @access  Private (Management and Finance roles)
 */
const exportInvoices = asyncHandler(async (req, res) => {
  try {
    const {
      status = '',
      type = '',
      project = '',
      dateFrom = '',
      dateTo = '',
      format = 'csv'
    } = req.query;

    console.log('📊 Exporting invoices with filters:', req.query);

    // Build filters
    const filters = { organization: req.user.organization, ...projectAccessFilter(req) };

    if (status && status !== 'all') filters.status = status;
    if (type && type !== 'all') filters.type = type;
    if (project && project !== 'all') filters.project = project;
    
    if (dateFrom || dateTo) {
      filters.invoiceDate = {};
      if (dateFrom) filters.invoiceDate.$gte = new Date(dateFrom);
      if (dateTo) filters.invoiceDate.$lte = new Date(dateTo);
    }

    // Fetch invoices for export
    const invoices = await Invoice.find(filters)
      .populate('project', 'name location')
      .populate('unit', 'unitNumber floor area')
      .populate('customer', 'firstName lastName email phone')
      .populate('sale', 'salePrice bookingDate')
      .populate('generatedBy', 'firstName lastName')
      .sort({ invoiceDate: -1 });

    // Transform data for export
    const exportData = invoices.map(invoice => ({
      'Invoice Number': invoice.invoiceNumber,
      'Invoice Date': invoice.invoiceDate.toLocaleDateString(),
      'Due Date': invoice.dueDate.toLocaleDateString(),
      'Customer Name': `${invoice.customer.firstName} ${invoice.customer.lastName}`,
      'Customer Email': invoice.customer.email,
      'Customer Phone': invoice.customer.phone,
      'Project Name': invoice.project.name,
      'Unit Number': invoice.unit.unitNumber,
      'Invoice Type': invoice.type.replace('_', ' ').toUpperCase(),
      'Status': invoice.status.toUpperCase(),
      'Subtotal': invoice.financialSummary.subtotal,
      'GST Amount': invoice.financialSummary.totalGstAmount,
      'Total Amount': invoice.financialSummary.totalAmount,
      'Paid Amount': invoice.paymentDetails.totalPaid,
      'Pending Amount': invoice.paymentDetails.pendingAmount,
      'Payment Status': invoice.paymentDetails.pendingAmount > 0 ? 'PENDING' : 'PAID',
      'Generated By': `${invoice.generatedBy.firstName} ${invoice.generatedBy.lastName}`,
      'Generated Date': invoice.createdAt.toLocaleDateString()
    }));

    // Set response headers for download
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `invoices_export_${timestamp}.csv`;
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Generate CSV content
    if (exportData.length === 0) {
      res.send('No invoices found for the selected criteria.');
      return;
    }

    const headers = Object.keys(exportData[0]);
    let csvContent = headers.join(',') + '\n';
    
    exportData.forEach(row => {
      const values = headers.map(header => {
        const value = row[header] || '';
        // Escape commas and quotes in CSV
        return typeof value === 'string' && value.includes(',') ? `"${value}"` : value;
      });
      csvContent += values.join(',') + '\n';
    });

    console.log('✅ Invoices exported successfully:', exportData.length);
    
    res.send(csvContent);

  } catch (error) {
    console.error('❌ Error exporting invoices:', error.message);
    res.status(500);
    throw new Error(`Failed to export invoices: ${error.message}`);
  }
});

export {
  createInvoiceFromSale,
  getInvoices,
  getInvoice,
  updateInvoice,
  recordInvoicePayment,
  cancelInvoice,
  getInvoiceStatistics,
  getOverdueInvoices,
  exportInvoices
};