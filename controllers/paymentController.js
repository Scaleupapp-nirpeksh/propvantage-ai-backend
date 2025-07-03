// File: controllers/paymentController.js
// Description: Handles payment plan creation, installment management, and payment processing

import asyncHandler from 'express-async-handler';
import PaymentPlan from '../models/paymentPlanModel.js';
import Installment from '../models/installmentModel.js';
import PaymentTransaction from '../models/paymentTransactionModel.js';
import Project from '../models/projectModel.js';
import Sale from '../models/salesModel.js';
import {
  createPaymentPlan,
  updatePaymentTransaction,
  recalculatePaymentPlan,
  processPayment,
  getPaymentSummary,
  getOverduePaymentsReport
} from '../services/paymentService.js';

/**
 * @desc    Create a new payment plan for a sale
 * @route   POST /api/payments/plans
 * @access  Private (Management/Sales roles)
 */
const createNewPaymentPlan = asyncHandler(async (req, res) => {
  const { saleId, templateName, customizations } = req.body;

  // Validate input
  if (!saleId || !templateName) {
    res.status(400);
    throw new Error('Sale ID and template name are required.');
  }

  // Check if sale exists and belongs to organization
  const sale = await Sale.findOne({
    _id: saleId,
    organization: req.user.organization
  }).populate('project').populate('lead');

  if (!sale) {
    res.status(404);
    throw new Error('Sale not found or access denied.');
  }

  // Check if payment plan already exists
  const existingPlan = await PaymentPlan.findOne({ sale: saleId });
  if (existingPlan) {
    res.status(400);
    throw new Error('Payment plan already exists for this sale.');
  }

  try {
    const result = await createPaymentPlan(sale, templateName, req.user._id);
    
    // Add customizations if provided
    if (customizations) {
      const paymentPlan = result.paymentPlan;
      
      // Apply custom payment terms
      if (customizations.paymentTerms) {
        Object.assign(paymentPlan.paymentTerms, customizations.paymentTerms);
      }
      
      // Apply custom amounts breakdown
      if (customizations.amountBreakdown) {
        Object.assign(paymentPlan.amountBreakdown, customizations.amountBreakdown);
      }
      
      // Add modification history
      paymentPlan.addModificationHistory(
        req.user._id,
        'Payment plan customized during creation',
        'Custom payment terms applied'
      );
      
      await paymentPlan.save();
    }

    res.status(201).json({
      success: true,
      data: result,
      message: 'Payment plan created successfully'
    });
  } catch (error) {
    res.status(400);
    throw new Error(error.message);
  }
});

/**
 * @desc    Get payment plan details with installments and transactions
 * @route   GET /api/payments/plans/:saleId
 * @access  Private
 */
const getPaymentPlanDetails = asyncHandler(async (req, res) => {
  const { saleId } = req.params;

  // Find payment plan by sale ID
  const paymentPlan = await PaymentPlan.findOne({
    sale: saleId,
    organization: req.user.organization
  });

  if (!paymentPlan) {
    res.status(404);
    throw new Error('Payment plan not found.');
  }

  try {
    const summary = await getPaymentSummary(paymentPlan._id);

    res.json({
      success: true,
      data: summary
    });
  } catch (error) {
    res.status(500);
    throw new Error(error.message);
  }
});

/**
 * @desc    Update payment plan details
 * @route   PUT /api/payments/plans/:planId
 * @access  Private (Management roles)
 */
const updatePaymentPlan = asyncHandler(async (req, res) => {
  const { planId } = req.params;
  const { paymentTerms, notes, reason } = req.body;

  const paymentPlan = await PaymentPlan.findOne({
    _id: planId,
    organization: req.user.organization
  });

  if (!paymentPlan) {
    res.status(404);
    throw new Error('Payment plan not found.');
  }

  // Update payment terms if provided
  if (paymentTerms) {
    Object.assign(paymentPlan.paymentTerms, paymentTerms);
  }

  // Update notes if provided
  if (notes) {
    paymentPlan.notes = notes;
  }

  // Add modification history
  paymentPlan.addModificationHistory(
    req.user._id,
    `Payment plan updated: ${JSON.stringify(req.body)}`,
    reason || 'Payment plan modifications'
  );

  await paymentPlan.save();

  // Recalculate if payment terms changed
  if (paymentTerms) {
    await recalculatePaymentPlan(paymentPlan._id);
  }

  res.json({
    success: true,
    data: paymentPlan,
    message: 'Payment plan updated successfully'
  });
});

/**
 * @desc    Get all installments for a payment plan
 * @route   GET /api/payments/installments/:planId
 * @access  Private
 */
const getInstallments = asyncHandler(async (req, res) => {
  const { planId } = req.params;
  const { status, overdue } = req.query;

  // Verify payment plan belongs to organization
  const paymentPlan = await PaymentPlan.findOne({
    _id: planId,
    organization: req.user.organization
  });

  if (!paymentPlan) {
    res.status(404);
    throw new Error('Payment plan not found.');
  }

  // Build query filters
  const filters = { paymentPlan: planId };
  
  if (status) {
    filters.status = status;
  }
  
  if (overdue === 'true') {
    filters.status = 'overdue';
  }

  const installments = await Installment.getInstallmentsWithDetails(filters);

  res.json({
    success: true,
    data: installments,
    count: installments.length
  });
});

/**
 * @desc    Update installment amount or due date
 * @route   PUT /api/payments/installments/:installmentId
 * @access  Private (Management roles)
 */
const updateInstallment = asyncHandler(async (req, res) => {
  const { installmentId } = req.params;
  const { amount, dueDate, reason } = req.body;

  const installment = await Installment.findOne({
    _id: installmentId,
    organization: req.user.organization
  });

  if (!installment) {
    res.status(404);
    throw new Error('Installment not found.');
  }

  try {
    let result = { installment };

    // Update amount if provided
    if (amount && amount !== installment.currentAmount) {
      await installment.updateAmount(amount, req.user._id, reason);
      result.amountUpdated = true;
      result.previousAmount = installment.currentAmount;
      result.newAmount = amount;
    }

    // Update due date if provided
    if (dueDate && new Date(dueDate).getTime() !== installment.currentDueDate.getTime()) {
      await installment.updateDueDate(new Date(dueDate), req.user._id, reason);
      result.dueDateUpdated = true;
      result.previousDueDate = installment.currentDueDate;
      result.newDueDate = dueDate;
    }

    // Recalculate payment plan
    await recalculatePaymentPlan(installment.paymentPlan);

    res.json({
      success: true,
      data: result,
      message: 'Installment updated successfully'
    });
  } catch (error) {
    res.status(400);
    throw new Error(error.message);
  }
});

/**
 * @desc    Waive an installment
 * @route   POST /api/payments/installments/:installmentId/waive
 * @access  Private (Senior Management roles)
 */
const waiveInstallment = asyncHandler(async (req, res) => {
  const { installmentId } = req.params;
  const { reason } = req.body;

  if (!reason) {
    res.status(400);
    throw new Error('Reason for waiver is required.');
  }

  const installment = await Installment.findOne({
    _id: installmentId,
    organization: req.user.organization
  });

  if (!installment) {
    res.status(404);
    throw new Error('Installment not found.');
  }

  try {
    await installment.waiveInstallment(req.user._id, reason);
    
    // Recalculate payment plan
    await recalculatePaymentPlan(installment.paymentPlan);

    res.json({
      success: true,
      data: installment,
      message: 'Installment waived successfully'
    });
  } catch (error) {
    res.status(400);
    throw new Error(error.message);
  }
});

/**
 * @desc    Record a new payment transaction
 * @route   POST /api/payments/transactions
 * @access  Private (Sales/Finance roles)
 */
const recordPayment = asyncHandler(async (req, res) => {
  const {
    paymentPlanId,
    amount,
    paymentDate,
    paymentMethod,
    paymentMethodDetails,
    allocations,
    notes
  } = req.body;

  // Validate required fields
  if (!paymentPlanId || !amount || !paymentDate || !paymentMethod) {
    res.status(400);
    throw new Error('Payment plan ID, amount, payment date, and payment method are required.');
  }

  // Verify payment plan exists and belongs to organization
  const paymentPlan = await PaymentPlan.findOne({
    _id: paymentPlanId,
    organization: req.user.organization
  });

  if (!paymentPlan) {
    res.status(404);
    throw new Error('Payment plan not found.');
  }

  const paymentData = {
    organization: req.user.organization,
    project: paymentPlan.project,
    paymentPlan: paymentPlanId,
    customer: paymentPlan.customer,
    amount,
    paymentDate: new Date(paymentDate),
    paymentMethod,
    paymentMethodDetails,
    notes,
    status: 'completed' // Default to completed, can be changed to pending if approval needed
  };

  try {
    const result = await processPayment(paymentData, allocations, req.user._id);

    res.status(201).json({
      success: true,
      data: result,
      message: 'Payment recorded successfully'
    });
  } catch (error) {
    res.status(400);
    throw new Error(error.message);
  }
});

/**
 * @desc    Update payment transaction amount
 * @route   PUT /api/payments/transactions/:transactionId
 * @access  Private (Finance/Management roles)
 */
const updatePaymentTransactionAmount = asyncHandler(async (req, res) => {
  const { transactionId } = req.params;
  const { amount, reason } = req.body;

  if (!amount || !reason) {
    res.status(400);
    throw new Error('New amount and reason are required.');
  }

  // Verify transaction exists and belongs to organization
  const transaction = await PaymentTransaction.findOne({
    _id: transactionId,
    organization: req.user.organization
  });

  if (!transaction) {
    res.status(404);
    throw new Error('Payment transaction not found.');
  }

  try {
    const result = await updatePaymentTransaction(transactionId, amount, req.user._id, reason);

    res.json({
      success: true,
      data: result,
      message: 'Payment transaction updated successfully'
    });
  } catch (error) {
    res.status(400);
    throw new Error(error.message);
  }
});

/**
 * @desc    Get payment transactions for a payment plan
 * @route   GET /api/payments/transactions/:planId
 * @access  Private
 */
const getPaymentTransactions = asyncHandler(async (req, res) => {
  const { planId } = req.params;
  const { status, method, startDate, endDate } = req.query;

  // Verify payment plan belongs to organization
  const paymentPlan = await PaymentPlan.findOne({
    _id: planId,
    organization: req.user.organization
  });

  if (!paymentPlan) {
    res.status(404);
    throw new Error('Payment plan not found.');
  }

  // Build query filters
  const filters = { paymentPlan: planId };
  
  if (status) {
    filters.status = status;
  }
  
  if (method) {
    filters.paymentMethod = method;
  }
  
  if (startDate && endDate) {
    filters.paymentDate = {
      $gte: new Date(startDate),
      $lte: new Date(endDate)
    };
  }

  const transactions = await PaymentTransaction.getTransactionsWithDetails(filters);

  res.json({
    success: true,
    data: transactions,
    count: transactions.length
  });
});

/**
 * @desc    Verify a payment transaction
 * @route   POST /api/payments/transactions/:transactionId/verify
 * @access  Private (Finance roles)
 */
const verifyPaymentTransaction = asyncHandler(async (req, res) => {
  const { transactionId } = req.params;
  const { verificationStatus, verificationNotes, bankStatementMatched } = req.body;

  if (!verificationStatus) {
    res.status(400);
    throw new Error('Verification status is required.');
  }

  const transaction = await PaymentTransaction.findOne({
    _id: transactionId,
    organization: req.user.organization
  });

  if (!transaction) {
    res.status(404);
    throw new Error('Payment transaction not found.');
  }

  const verificationData = {
    verificationStatus,
    verificationNotes,
    bankStatementMatched: bankStatementMatched || false
  };

  try {
    await transaction.verifyPayment(req.user._id, verificationData);

    res.json({
      success: true,
      data: transaction,
      message: 'Payment verification completed'
    });
  } catch (error) {
    res.status(400);
    throw new Error(error.message);
  }
});

/**
 * @desc    Get overdue payments report
 * @route   GET /api/payments/reports/overdue
 * @access  Private (Management/Finance roles)
 */
const getOverduePayments = asyncHandler(async (req, res) => {
  try {
    const report = await getOverduePaymentsReport(req.user.organization);

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
 * @desc    Get payments due today
 * @route   GET /api/payments/reports/due-today
 * @access  Private
 */
const getPaymentsDueToday = asyncHandler(async (req, res) => {
  try {
    const dueToday = await Installment.getDueInstallments(req.user.organization);

    res.json({
      success: true,
      data: dueToday,
      count: dueToday.length
    });
  } catch (error) {
    res.status(500);
    throw new Error(error.message);
  }
});

/**
 * @desc    Get payment statistics for organization
 * @route   GET /api/payments/reports/statistics
 * @access  Private (Management roles)
 */
const getPaymentStatistics = asyncHandler(async (req, res) => {
  const { period = '30' } = req.query;
  const orgId = req.user.organization;
  
  // Calculate date range
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - parseInt(period));

  try {
    // Get payment statistics
    const stats = await PaymentTransaction.aggregate([
      { 
        $match: { 
          organization: orgId,
          status: { $in: ['completed', 'cleared'] },
          paymentDate: { $gte: startDate }
        } 
      },
      {
        $group: {
          _id: null,
          totalPayments: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
          averagePayment: { $avg: '$amount' }
        }
      }
    ]);

    // Get overdue statistics
    const overdueStats = await Installment.aggregate([
      { 
        $match: { 
          organization: orgId,
          status: 'overdue'
        } 
      },
      {
        $group: {
          _id: null,
          overdueInstallments: { $sum: 1 },
          overdueAmount: { $sum: '$pendingAmount' }
        }
      }
    ]);

    // Get payment method breakdown
    const methodBreakdown = await PaymentTransaction.aggregate([
      { 
        $match: { 
          organization: orgId,
          status: { $in: ['completed', 'cleared'] },
          paymentDate: { $gte: startDate }
        } 
      },
      {
        $group: {
          _id: '$paymentMethod',
          count: { $sum: 1 },
          amount: { $sum: '$amount' }
        }
      }
    ]);

    const statistics = {
      period: `${period} days`,
      payments: stats[0] || { totalPayments: 0, totalAmount: 0, averagePayment: 0 },
      overdue: overdueStats[0] || { overdueInstallments: 0, overdueAmount: 0 },
      methodBreakdown,
      generatedAt: new Date()
    };

    res.json({
      success: true,
      data: statistics
    });
  } catch (error) {
    res.status(500);
    throw new Error(`Failed to generate payment statistics: ${error.message}`);
  }
});

export {
  createNewPaymentPlan,
  getPaymentPlanDetails,
  updatePaymentPlan,
  getInstallments,
  updateInstallment,
  waiveInstallment,
  recordPayment,
  updatePaymentTransactionAmount,
  getPaymentTransactions,
  verifyPaymentTransaction,
  getOverduePayments,
  getPaymentsDueToday,
  getPaymentStatistics
};