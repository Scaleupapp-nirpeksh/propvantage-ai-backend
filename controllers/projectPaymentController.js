// File: controllers/projectPaymentController.js
// Description: Handles project-level payment configuration and templates

import asyncHandler from 'express-async-handler';
import Project from '../models/projectModel.js';
import mongoose from 'mongoose';

/**
 * @desc    Get payment configuration for a project
 * @route   GET /api/projects/:projectId/payment-config
 * @access  Private (Management roles)
 */
const getProjectPaymentConfig = asyncHandler(async (req, res) => {
  const { projectId } = req.params;

  const project = await Project.findOne({
    _id: projectId,
    organization: req.user.organization
  }).select('name paymentConfiguration');

  if (!project) {
    res.status(404);
    throw new Error('Project not found.');
  }

  res.json({
    success: true,
    data: {
      projectId: project._id,
      projectName: project.name,
      paymentConfiguration: project.paymentConfiguration
    }
  });
});

/**
 * @desc    Update payment configuration for a project
 * @route   PUT /api/projects/:projectId/payment-config
 * @access  Private (Management roles)
 */
const updateProjectPaymentConfig = asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  const { 
    defaultPaymentTerms, 
    defaultCharges, 
    taxConfiguration, 
    discountConfiguration,
    acceptedPaymentMethods,
    bankAccountDetails
  } = req.body;

  const project = await Project.findOne({
    _id: projectId,
    organization: req.user.organization
  });

  if (!project) {
    res.status(404);
    throw new Error('Project not found.');
  }

  // Update configuration sections
  if (defaultPaymentTerms) {
    Object.assign(project.paymentConfiguration.defaultPaymentTerms, defaultPaymentTerms);
  }

  if (defaultCharges) {
    Object.assign(project.paymentConfiguration.defaultCharges, defaultCharges);
  }

  if (taxConfiguration) {
    Object.assign(project.paymentConfiguration.taxConfiguration, taxConfiguration);
  }

  if (discountConfiguration) {
    Object.assign(project.paymentConfiguration.discountConfiguration, discountConfiguration);
  }

  if (acceptedPaymentMethods) {
    project.paymentConfiguration.acceptedPaymentMethods = acceptedPaymentMethods;
  }

  if (bankAccountDetails) {
    project.paymentConfiguration.bankAccountDetails = bankAccountDetails;
  }

  await project.save();

  res.json({
    success: true,
    data: project.paymentConfiguration,
    message: 'Payment configuration updated successfully'
  });
});

/**
 * @desc    Get payment plan templates for a project
 * @route   GET /api/projects/:projectId/payment-templates
 * @access  Private (Sales/Management roles)
 */
const getPaymentPlanTemplates = asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  const { active } = req.query;

  const project = await Project.findOne({
    _id: projectId,
    organization: req.user.organization
  }).select('name paymentConfiguration.paymentPlanTemplates');

  if (!project) {
    res.status(404);
    throw new Error('Project not found.');
  }

  let templates = project.paymentConfiguration.paymentPlanTemplates;

  // Filter by active status if specified
  if (active === 'true') {
    templates = templates.filter(template => template.isActive);
  }

  res.json({
    success: true,
    data: templates,
    count: templates.length
  });
});

/**
 * @desc    Create a new payment plan template for a project
 * @route   POST /api/projects/:projectId/payment-templates
 * @access  Private (Management roles)
 */
const createPaymentPlanTemplate = asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  const { 
    name, 
    description, 
    planType, 
    installments,
    gracePeriodDays,
    lateFeeRate
  } = req.body;

  // Validate required fields
  if (!name || !planType || !installments || !Array.isArray(installments)) {
    res.status(400);
    throw new Error('Name, plan type, and installments array are required.');
  }

  // Validate installments total percentage
  const totalPercentage = installments.reduce((sum, inst) => sum + inst.percentage, 0);
  if (Math.abs(totalPercentage - 100) > 0.01) {
    res.status(400);
    throw new Error('Total installment percentages must equal 100%.');
  }

  const project = await Project.findOne({
    _id: projectId,
    organization: req.user.organization
  });

  if (!project) {
    res.status(404);
    throw new Error('Project not found.');
  }

  // Check if template name already exists
  const existingTemplate = project.paymentConfiguration.paymentPlanTemplates.find(
    template => template.name.toLowerCase() === name.toLowerCase()
  );

  if (existingTemplate) {
    res.status(400);
    throw new Error('Payment plan template with this name already exists.');
  }

  // Create new template
  const newTemplate = {
    name,
    description,
    planType,
    installments,
    totalPercentage: 100,
    gracePeriodDays: gracePeriodDays || 7,
    lateFeeRate: lateFeeRate || 0,
    isActive: true
  };

  project.paymentConfiguration.paymentPlanTemplates.push(newTemplate);
  await project.save();

  // Get the created template (with generated ID)
  const createdTemplate = project.paymentConfiguration.paymentPlanTemplates[
    project.paymentConfiguration.paymentPlanTemplates.length - 1
  ];

  res.status(201).json({
    success: true,
    data: createdTemplate,
    message: 'Payment plan template created successfully'
  });
});

/**
 * @desc    Update a payment plan template
 * @route   PUT /api/projects/:projectId/payment-templates/:templateId
 * @access  Private (Management roles)
 */
const updatePaymentPlanTemplate = asyncHandler(async (req, res) => {
  const { projectId, templateId } = req.params;
  const updateData = req.body;

  const project = await Project.findOne({
    _id: projectId,
    organization: req.user.organization
  });

  if (!project) {
    res.status(404);
    throw new Error('Project not found.');
  }

  // Find the template
  const template = project.paymentConfiguration.paymentPlanTemplates.id(templateId);
  if (!template) {
    res.status(404);
    throw new Error('Payment plan template not found.');
  }

  // Validate installments if provided
  if (updateData.installments) {
    const totalPercentage = updateData.installments.reduce((sum, inst) => sum + inst.percentage, 0);
    if (Math.abs(totalPercentage - 100) > 0.01) {
      res.status(400);
      throw new Error('Total installment percentages must equal 100%.');
    }
  }

  // Update template
  Object.assign(template, updateData);
  await project.save();

  res.json({
    success: true,
    data: template,
    message: 'Payment plan template updated successfully'
  });
});

/**
 * @desc    Deactivate a payment plan template
 * @route   DELETE /api/projects/:projectId/payment-templates/:templateId
 * @access  Private (Management roles)
 */
const deactivatePaymentPlanTemplate = asyncHandler(async (req, res) => {
  const { projectId, templateId } = req.params;

  const project = await Project.findOne({
    _id: projectId,
    organization: req.user.organization
  });

  if (!project) {
    res.status(404);
    throw new Error('Project not found.');
  }

  // Find and deactivate template
  const template = project.paymentConfiguration.paymentPlanTemplates.id(templateId);
  if (!template) {
    res.status(404);
    throw new Error('Payment plan template not found.');
  }

  template.isActive = false;
  await project.save();

  res.json({
    success: true,
    message: 'Payment plan template deactivated successfully'
  });
});

/**
 * @desc    Get available payment methods for a project
 * @route   GET /api/projects/:projectId/payment-methods
 * @access  Private (Sales/Finance roles)
 */
const getAvailablePaymentMethods = asyncHandler(async (req, res) => {
  const { projectId } = req.params;

  const project = await Project.findOne({
    _id: projectId,
    organization: req.user.organization
  }).select('name paymentConfiguration.acceptedPaymentMethods');

  if (!project) {
    res.status(404);
    throw new Error('Project not found.');
  }

  const availableMethods = project.getAvailablePaymentMethods();

  res.json({
    success: true,
    data: availableMethods,
    count: availableMethods.length
  });
});

/**
 * @desc    Calculate project charges for a unit price
 * @route   POST /api/projects/:projectId/calculate-charges
 * @access  Private (Sales/Finance roles)
 */
const calculateProjectCharges = asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  const { 
    unitPrice, 
    includeStampDuty, 
    includeRegistrationFee, 
    discounts 
  } = req.body;

  if (!unitPrice || unitPrice <= 0) {
    res.status(400);
    throw new Error('Valid unit price is required.');
  }

  const project = await Project.findOne({
    _id: projectId,
    organization: req.user.organization
  });

  if (!project) {
    res.status(404);
    throw new Error('Project not found.');
  }

  const options = {
    includeStampDuty: includeStampDuty || false,
    includeRegistrationFee: includeRegistrationFee || false,
    discounts: discounts || {}
  };

  const breakdown = project.calculateProjectCharges(unitPrice, options);

  res.json({
    success: true,
    data: breakdown
  });
});

/**
 * @desc    Get bank account details for a project
 * @route   GET /api/projects/:projectId/bank-accounts
 * @access  Private (Sales/Finance roles)
 */
const getProjectBankAccounts = asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  const { active } = req.query;

  const project = await Project.findOne({
    _id: projectId,
    organization: req.user.organization
  }).select('name paymentConfiguration.bankAccountDetails');

  if (!project) {
    res.status(404);
    throw new Error('Project not found.');
  }

  let bankAccounts = project.paymentConfiguration.bankAccountDetails;

  // Filter by active status if specified
  if (active === 'true') {
    bankAccounts = bankAccounts.filter(account => account.isActive);
  }

  res.json({
    success: true,
    data: bankAccounts,
    primary: project.primaryBankAccount,
    count: bankAccounts.length
  });
});

/**
 * @desc    Add bank account to project
 * @route   POST /api/projects/:projectId/bank-accounts
 * @access  Private (Finance/Management roles)
 */
const addProjectBankAccount = asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  const {
    bankName,
    accountNumber,
    accountHolderName,
    ifscCode,
    branchName,
    accountType,
    isPrimary
  } = req.body;

  // Validate required fields
  if (!bankName || !accountNumber || !accountHolderName || !ifscCode) {
    res.status(400);
    throw new Error('Bank name, account number, account holder name, and IFSC code are required.');
  }

  const project = await Project.findOne({
    _id: projectId,
    organization: req.user.organization
  });

  if (!project) {
    res.status(404);
    throw new Error('Project not found.');
  }

  // If setting as primary, make others non-primary
  if (isPrimary) {
    project.paymentConfiguration.bankAccountDetails.forEach(account => {
      account.isPrimary = false;
    });
  }

  // Add new bank account
  const newAccount = {
    bankName,
    accountNumber,
    accountHolderName,
    ifscCode,
    branchName,
    accountType: accountType || 'current',
    isActive: true,
    isPrimary: isPrimary || false
  };

  project.paymentConfiguration.bankAccountDetails.push(newAccount);
  await project.save();

  res.status(201).json({
    success: true,
    data: newAccount,
    message: 'Bank account added successfully'
  });
});

export {
  getProjectPaymentConfig,
  updateProjectPaymentConfig,
  getPaymentPlanTemplates,
  createPaymentPlanTemplate,
  updatePaymentPlanTemplate,
  deactivatePaymentPlanTemplate,
  getAvailablePaymentMethods,
  calculateProjectCharges,
  getProjectBankAccounts,
  addProjectBankAccount
};