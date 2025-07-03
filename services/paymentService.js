// File: services/paymentService.js
// Description: Service for handling payment plan creation, updates, and recalculations

import PaymentPlan from '../models/paymentPlanModel.js';
import Installment from '../models/installmentModel.js';
import PaymentTransaction from '../models/paymentTransactionModel.js';
import Project from '../models/projectModel.js';
import Sale from '../models/salesModel.js';
import mongoose from 'mongoose';

/**
 * Creates a new payment plan based on project template and sale details
 * @param {Object} saleData - Sale information
 * @param {string} templateName - Payment plan template name
 * @param {string} userId - User creating the plan
 * @returns {Object} Created payment plan with installments
 */
const createPaymentPlan = async (saleData, templateName, userId) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    // Get project with payment configuration
    const project = await Project.getProjectWithPaymentConfig(saleData.project);
    if (!project) {
      throw new Error('Project not found');
    }
    
    // Find the payment plan template
    const template = project.paymentConfiguration.paymentPlanTemplates.find(
      t => t.name === templateName && t.isActive
    );
    
    if (!template) {
      throw new Error('Payment plan template not found');
    }
    
    // Calculate total amount with project charges
    const chargeBreakdown = project.calculateProjectCharges(saleData.salePrice, {
      includeStampDuty: true,
      includeRegistrationFee: true,
      discounts: saleData.discounts || {}
    });
    
    // Create payment plan
    const paymentPlan = new PaymentPlan({
      organization: project.organization,
      project: project._id,
      sale: saleData._id,
      customer: saleData.lead,
      templateUsed: templateName,
      planType: template.planType,
      totalAmount: chargeBreakdown.finalAmount,
      baseAmount: chargeBreakdown.basePrice,
      amountBreakdown: {
        basePrice: chargeBreakdown.basePrice,
        taxes: chargeBreakdown.taxes,
        additionalCharges: chargeBreakdown.charges,
        discounts: chargeBreakdown.discounts
      },
      paymentTerms: {
        gracePeriodDays: project.paymentConfiguration.defaultPaymentTerms.gracePeriodDays,
        lateFeeRate: project.paymentConfiguration.defaultPaymentTerms.lateFeeRate,
        interestRate: project.paymentConfiguration.defaultPaymentTerms.interestRate,
        compoundInterest: project.paymentConfiguration.defaultPaymentTerms.compoundInterest
      },
      createdBy: userId
    });
    
    await paymentPlan.save({ session });
    
    // Create installments based on template
    const installments = [];
    let cumulativeDays = 0;
    
    for (const installmentConfig of template.installments) {
      const installmentAmount = (chargeBreakdown.finalAmount * installmentConfig.percentage) / 100;
      
      // Calculate due date
      let dueDate = new Date(saleData.bookingDate);
      if (installmentConfig.milestoneType === 'time_based') {
        cumulativeDays += installmentConfig.dueAfterDays;
        dueDate.setDate(dueDate.getDate() + cumulativeDays);
      } else {
        dueDate.setDate(dueDate.getDate() + installmentConfig.dueAfterDays);
      }
      
      // Calculate grace period end date
      const gracePeriodEndDate = new Date(dueDate);
      gracePeriodEndDate.setDate(gracePeriodEndDate.getDate() + paymentPlan.paymentTerms.gracePeriodDays);
      
      const installment = new Installment({
        organization: project.organization,
        project: project._id,
        paymentPlan: paymentPlan._id,
        sale: saleData._id,
        customer: saleData.lead,
        installmentNumber: installmentConfig.installmentNumber,
        description: installmentConfig.description,
        milestoneType: installmentConfig.milestoneType,
        milestoneDescription: installmentConfig.milestoneDescription,
        originalAmount: installmentAmount,
        currentAmount: installmentAmount,
        pendingAmount: installmentAmount,
        originalDueDate: dueDate,
        currentDueDate: dueDate,
        gracePeriodEndDate: gracePeriodEndDate,
        lateFeeApplicable: true,
        lateFeeRate: paymentPlan.paymentTerms.lateFeeRate,
        isOptional: installmentConfig.isOptional,
        canBeWaived: installmentConfig.isOptional,
        createdBy: userId
      });
      
      await installment.save({ session });
      installments.push(installment);
    }
    
    // Update payment plan financial summary
    await paymentPlan.calculateFinancialSummary();
    await paymentPlan.save({ session });
    
    await session.commitTransaction();
    session.endSession();
    
    return {
      paymentPlan,
      installments,
      totalAmount: chargeBreakdown.finalAmount,
      breakdown: chargeBreakdown
    };
    
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw new Error(`Failed to create payment plan: ${error.message}`);
  }
};

/**
 * Updates a payment transaction amount and triggers recalculation
 * @param {string} transactionId - Transaction ID to update
 * @param {number} newAmount - New payment amount
 * @param {string} userId - User making the update
 * @param {string} reason - Reason for update
 * @returns {Object} Updated transaction and recalculated data
 */
const updatePaymentTransaction = async (transactionId, newAmount, userId, reason) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    // Get the transaction
    const transaction = await PaymentTransaction.findById(transactionId).session(session);
    if (!transaction) {
      throw new Error('Payment transaction not found');
    }
    
    const oldAmount = transaction.amount;
    
    // Update transaction amount
    await transaction.updateAmount(newAmount, userId, reason);
    
    // Recalculate installment allocations proportionally
    const amountDifference = newAmount - oldAmount;
    const recalculatedAllocations = [];
    
    for (const allocation of transaction.paymentAllocations) {
      const installment = await Installment.findById(allocation.installment).session(session);
      if (installment) {
        // Calculate proportional change
        const proportionalChange = (allocation.allocatedAmount / oldAmount) * amountDifference;
        const newAllocationAmount = allocation.allocatedAmount + proportionalChange;
        
        // Update installment payment
        const previousPaidAmount = installment.paidAmount;
        installment.paidAmount = previousPaidAmount - allocation.allocatedAmount + newAllocationAmount;
        installment.pendingAmount = Math.max(0, installment.currentAmount - installment.paidAmount);
        
        // Update installment status
        installment.updateStatus();
        await installment.save({ session });
        
        // Update allocation
        allocation.allocatedAmount = newAllocationAmount;
        recalculatedAllocations.push({
          installmentId: installment._id,
          oldAllocation: allocation.allocatedAmount - proportionalChange,
          newAllocation: newAllocationAmount,
          difference: proportionalChange
        });
      }
    }
    
    // Save updated transaction
    await transaction.save({ session });
    
    // Recalculate payment plan summary
    const paymentPlan = await PaymentPlan.findById(transaction.paymentPlan).session(session);
    await paymentPlan.calculateFinancialSummary();
    await paymentPlan.save({ session });
    
    await session.commitTransaction();
    session.endSession();
    
    return {
      transaction,
      recalculatedAllocations,
      amountDifference,
      paymentPlanSummary: paymentPlan.financialSummary
    };
    
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw new Error(`Failed to update payment transaction: ${error.message}`);
  }
};

/**
 * Recalculates all financial summaries for a payment plan
 * @param {string} paymentPlanId - Payment plan ID
 * @returns {Object} Updated financial summary
 */
const recalculatePaymentPlan = async (paymentPlanId) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    // Get payment plan
    const paymentPlan = await PaymentPlan.findById(paymentPlanId).session(session);
    if (!paymentPlan) {
      throw new Error('Payment plan not found');
    }
    
    // Get all installments
    const installments = await Installment.find({ paymentPlan: paymentPlanId }).session(session);
    
    // Get all transactions
    const transactions = await PaymentTransaction.find({ 
      paymentPlan: paymentPlanId,
      status: { $in: ['completed', 'cleared'] }
    }).session(session);
    
    // Recalculate installment statuses and late fees
    for (const installment of installments) {
      // Calculate late fees
      installment.calculateLateFees();
      
      // Update status based on current amounts
      installment.updateStatus();
      
      await installment.save({ session });
    }
    
    // Recalculate payment plan financial summary
    await paymentPlan.calculateFinancialSummary();
    await paymentPlan.save({ session });
    
    await session.commitTransaction();
    session.endSession();
    
    return {
      paymentPlan,
      installments,
      transactions,
      summary: paymentPlan.financialSummary
    };
    
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw new Error(`Failed to recalculate payment plan: ${error.message}`);
  }
};

/**
 * Processes a new payment and allocates it to installments
 * @param {Object} paymentData - Payment information
 * @param {Array} allocations - How to allocate payment across installments
 * @param {string} userId - User recording the payment
 * @returns {Object} Created transaction and updated installments
 */
const processPayment = async (paymentData, allocations, userId) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    // Create payment transaction
    const transaction = new PaymentTransaction({
      organization: paymentData.organization,
      project: paymentData.project,
      paymentPlan: paymentData.paymentPlan,
      customer: paymentData.customer,
      amount: paymentData.amount,
      originalAmount: paymentData.amount,
      paymentDate: paymentData.paymentDate,
      paymentMethod: paymentData.paymentMethod,
      paymentMethodDetails: paymentData.paymentMethodDetails,
      status: paymentData.status || 'pending',
      processingFee: paymentData.processingFee || 0,
      bankCharges: paymentData.bankCharges || 0,
      notes: paymentData.notes,
      recordedBy: userId
    });
    
    await transaction.save({ session });
    
    // Allocate payment to installments
    if (allocations && allocations.length > 0) {
      await transaction.allocateToInstallments(allocations);
    } else {
      // Auto-allocate to oldest pending installments
      const pendingInstallments = await Installment.find({
        paymentPlan: paymentData.paymentPlan,
        status: { $in: ['pending', 'due', 'overdue', 'partially_paid'] }
      }).sort({ currentDueDate: 1 }).session(session);
      
      let remainingAmount = paymentData.amount;
      const autoAllocations = [];
      
      for (const installment of pendingInstallments) {
        if (remainingAmount <= 0) break;
        
        const allocationAmount = Math.min(remainingAmount, installment.pendingAmount);
        if (allocationAmount > 0) {
          autoAllocations.push({
            installment: installment._id,
            allocatedAmount: allocationAmount,
            allocationType: 'principal'
          });
          remainingAmount -= allocationAmount;
        }
      }
      
      if (autoAllocations.length > 0) {
        await transaction.allocateToInstallments(autoAllocations);
      }
    }
    
    // Recalculate payment plan
    await recalculatePaymentPlan(paymentData.paymentPlan);
    
    await session.commitTransaction();
    session.endSession();
    
    return {
      transaction,
      message: 'Payment processed successfully'
    };
    
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw new Error(`Failed to process payment: ${error.message}`);
  }
};

/**
 * Gets comprehensive payment summary for a customer/sale
 * @param {string} paymentPlanId - Payment plan ID
 * @returns {Object} Complete payment summary
 */
const getPaymentSummary = async (paymentPlanId) => {
  try {
    const paymentPlan = await PaymentPlan.getPaymentPlanWithDetails(paymentPlanId);
    if (!paymentPlan) {
      throw new Error('Payment plan not found');
    }
    
    const installments = await Installment.getInstallmentsWithDetails({ paymentPlan: paymentPlanId });
    const transactions = await PaymentTransaction.getTransactionsWithDetails({ paymentPlan: paymentPlanId });
    
    // Calculate additional metrics
    const totalInstallments = installments.length;
    const paidInstallments = installments.filter(i => i.status === 'paid').length;
    const overdueInstallments = installments.filter(i => i.status === 'overdue').length;
    const upcomingInstallments = installments.filter(i => i.status === 'pending').length;
    
    // Calculate total late fees
    const totalLateFees = installments.reduce((sum, i) => sum + (i.lateFeeAccrued || 0), 0);
    
    // Next payment due
    const nextDueInstallment = installments
      .filter(i => i.status === 'pending' || i.status === 'due')
      .sort((a, b) => new Date(a.currentDueDate) - new Date(b.currentDueDate))[0];
    
    return {
      paymentPlan,
      installments,
      transactions,
      summary: {
        totalInstallments,
        paidInstallments,
        overdueInstallments,
        upcomingInstallments,
        totalLateFees,
        nextDueInstallment,
        completionPercentage: paymentPlan.completionPercentage,
        remainingBalance: paymentPlan.remainingBalance
      }
    };
    
  } catch (error) {
    throw new Error(`Failed to get payment summary: ${error.message}`);
  }
};

/**
 * Gets overdue payments report for organization
 * @param {string} organizationId - Organization ID
 * @returns {Object} Overdue payments report
 */
const getOverduePaymentsReport = async (organizationId) => {
  try {
    const overdueInstallments = await Installment.getOverdueInstallments(organizationId);
    
    // Group by customer
    const customerGroups = {};
    let totalOverdueAmount = 0;
    
    for (const installment of overdueInstallments) {
      const customerId = installment.customer._id.toString();
      
      if (!customerGroups[customerId]) {
        customerGroups[customerId] = {
          customer: installment.customer,
          project: installment.project,
          installments: [],
          totalOverdue: 0,
          oldestOverdueDate: installment.currentDueDate
        };
      }
      
      customerGroups[customerId].installments.push(installment);
      customerGroups[customerId].totalOverdue += installment.pendingAmount;
      totalOverdueAmount += installment.pendingAmount;
      
      // Update oldest overdue date
      if (installment.currentDueDate < customerGroups[customerId].oldestOverdueDate) {
        customerGroups[customerId].oldestOverdueDate = installment.currentDueDate;
      }
    }
    
    return {
      totalOverdueAmount,
      totalOverdueCustomers: Object.keys(customerGroups).length,
      totalOverdueInstallments: overdueInstallments.length,
      customerGroups: Object.values(customerGroups),
      generatedAt: new Date()
    };
    
  } catch (error) {
    throw new Error(`Failed to generate overdue payments report: ${error.message}`);
  }
};

export {
  createPaymentPlan,
  updatePaymentTransaction,
  recalculatePaymentPlan,
  processPayment,
  getPaymentSummary,
  getOverduePaymentsReport
};