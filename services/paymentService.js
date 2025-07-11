// File: services/paymentService.js
// Updated createPaymentPlan function for frontend compatibility

import PaymentPlan from '../models/paymentPlanModel.js';
import Installment from '../models/installmentModel.js';
import PaymentTransaction from '../models/paymentTransactionModel.js';
import Project from '../models/projectModel.js';
import Sale from '../models/salesModel.js';
import mongoose from 'mongoose';

/**
 * Creates a new payment plan based on project template and sale details
 * UPDATED: Now handles frontend template names and provides fallbacks
 * @param {Object} saleData - Sale information
 * @param {string} templateName - Payment plan template name from frontend
 * @param {string} userId - User creating the plan
 * @returns {Object} Created payment plan with installments
 */
const createPaymentPlan = async (saleData, templateName, userId) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    console.log('🔄 Creating payment plan for sale:', saleData._id, 'with template:', templateName);
    
    // Get project with payment configuration
    const project = await Project.findById(saleData.project)
      .select('+paymentConfiguration')
      .session(session);
      
    if (!project) {
      throw new Error('Project not found');
    }

    console.log('📋 Project loaded:', project.name);
    console.log('💳 Available templates:', project.paymentConfiguration?.paymentPlanTemplates?.length || 0);

    // Find the payment plan template - with fallbacks for robustness
    let template = null;
    
    if (project.paymentConfiguration && project.paymentConfiguration.paymentPlanTemplates) {
      // First, try to find exact match
      template = project.paymentConfiguration.paymentPlanTemplates.find(
        t => t.name === templateName && t.isActive !== false
      );
      
      // If not found, try case-insensitive search
      if (!template) {
        template = project.paymentConfiguration.paymentPlanTemplates.find(
          t => t.name.toLowerCase() === templateName.toLowerCase() && t.isActive !== false
        );
      }
      
      // If still not found, get the first active template
      if (!template) {
        template = project.paymentConfiguration.paymentPlanTemplates.find(
          t => t.isActive !== false
        );
        console.log('⚠️ Template not found, using first available:', template?.name);
      }
    }
    
    // If no template found, create a default one
    if (!template) {
      console.log('⚠️ No payment templates found, creating default template');
      template = createDefaultPaymentTemplate();
    }

    console.log('✅ Using payment template:', template.name);

    // Calculate total amount with project charges
    const totalAmount = saleData.salePrice; // Use the sale price directly
    
    // Create payment plan
    const paymentPlan = new PaymentPlan({
      organization: project.organization,
      project: project._id,
      sale: saleData._id,
      customer: saleData.lead,
      templateUsed: template.name,
      planType: template.planType,
      totalAmount: totalAmount,
      baseAmount: totalAmount,
      amountBreakdown: {
        basePrice: totalAmount,
        taxes: { gst: 0, stampDuty: 0, registrationFees: 0, otherTaxes: 0 },
        additionalCharges: { parkingCharges: 0, clubMembership: 0, maintenanceDeposit: 0, legalCharges: 0, otherCharges: 0 },
        discounts: { earlyBirdDiscount: 0, loyaltyDiscount: 0, negotiatedDiscount: saleData.discountAmount || 0, otherDiscounts: 0 }
      },
      paymentTerms: {
        gracePeriodDays: template.gracePeriodDays || 7,
        lateFeeRate: template.lateFeeRate || 0,
        interestRate: 0,
        compoundInterest: false
      },
      createdBy: userId
    });
    
    await paymentPlan.save({ session });
    console.log('✅ Payment plan created:', paymentPlan._id);

    // Create installments based on template
    const installments = [];
    let cumulativeDays = 0;
    
    for (const installmentConfig of template.installments) {
      const installmentAmount = Math.round((totalAmount * installmentConfig.percentage) / 100);
      
      // Calculate due date
      let dueDate = new Date(saleData.bookingDate);
      if (installmentConfig.milestoneType === 'time_based') {
        cumulativeDays += installmentConfig.dueAfterDays || 0;
        dueDate.setDate(dueDate.getDate() + cumulativeDays);
      } else {
        dueDate.setDate(dueDate.getDate() + (installmentConfig.dueAfterDays || 0));
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
        isOptional: installmentConfig.isOptional || false,
        canBeWaived: installmentConfig.isOptional || false,
        createdBy: userId
      });
      
      await installment.save({ session });
      installments.push(installment);
    }
    
    console.log('✅ Created', installments.length, 'installments');

    // Update payment plan financial summary
    await paymentPlan.calculateFinancialSummary();
    await paymentPlan.save({ session });
    
    await session.commitTransaction();
    session.endSession();
    
    console.log('✅ Payment plan transaction completed successfully');
    
    return {
      paymentPlan,
      installments,
      totalAmount: totalAmount,
      breakdown: {
        basePrice: totalAmount,
        finalAmount: totalAmount,
        discountAmount: saleData.discountAmount || 0
      }
    };
    
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error('❌ Payment plan creation failed:', error.message);
    throw new Error(`Failed to create payment plan: ${error.message}`);
  }
};

/**
 * Creates a default payment template when none are available
 * @returns {Object} Default payment template
 */
const createDefaultPaymentTemplate = () => {
  return {
    name: 'Standard Payment Plan',
    description: 'Default payment schedule',
    planType: 'time_based',
    gracePeriodDays: 7,
    lateFeeRate: 2, // 2% per month
    installments: [
      {
        installmentNumber: 1,
        description: 'Booking Amount',
        percentage: 20,
        dueAfterDays: 0,
        milestoneType: 'booking',
        milestoneDescription: 'On booking confirmation',
        isOptional: false
      },
      {
        installmentNumber: 2,
        description: 'First Installment',
        percentage: 30,
        dueAfterDays: 30,
        milestoneType: 'time_based',
        milestoneDescription: '30 days after booking',
        isOptional: false
      },
      {
        installmentNumber: 3,
        description: 'Second Installment',
        percentage: 25,
        dueAfterDays: 60,
        milestoneType: 'time_based',
        milestoneDescription: '60 days after booking',
        isOptional: false
      },
      {
        installmentNumber: 4,
        description: 'Final Payment',
        percentage: 25,
        dueAfterDays: 90,
        milestoneType: 'time_based',
        milestoneDescription: '90 days after booking',
        isOptional: false
      }
    ]
  };
};

// Keep all other existing functions unchanged...
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
      transactionNumber: paymentData.transactionNumber,
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

// ✅ Fixed version with proper null checks
const getPaymentSummary = async (paymentPlanId) => {
  try {
    const paymentPlan = await PaymentPlan.findById(paymentPlanId);
    
    if (!paymentPlan) {
      throw new Error('Payment plan not found');
    }
    
    // ✅ Get installments with fallback to empty array
    const installments = await Installment.find({ paymentPlan: paymentPlanId }) || [];
    
    // ✅ Get transactions with fallback to empty array
    const transactions = await PaymentTransaction.find({ paymentPlan: paymentPlanId }) || [];
    
    // ✅ Safe reduce operations with fallbacks
    const totalPaid = Array.isArray(transactions) 
      ? transactions.reduce((sum, t) => sum + (t.amount || 0), 0) 
      : 0;
      
    const totalOutstanding = Array.isArray(installments) 
      ? installments.reduce((sum, i) => sum + (i.pendingAmount || 0), 0) 
      : 0;
    
    // ✅ Calculate other financial metrics safely
    const totalAmount = Array.isArray(installments) 
      ? installments.reduce((sum, i) => sum + (i.currentAmount || 0), 0) 
      : 0;
    
    return {
      paymentPlan,
      installments: installments || [],
      transactions: transactions || [],
      financialSummary: {
        totalPaid,
        totalOutstanding,
        totalAmount,
        nextDueDate: null, // Calculate next due date
        nextDueAmount: 0   // Calculate next due amount
      }
    };
  } catch (error) {
    console.error('Error in getPaymentSummary:', error);
    throw new Error(`Failed to get payment summary: ${error.message}`);
  }
};

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