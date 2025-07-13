// File: controllers/projectBudgetController.js
// Description: Real-time budget variance tracking controller
// Location: controllers/projectBudgetController.js

import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import Project from '../models/projectModel.js';
import Unit from '../models/unitModel.js';
import Sale from '../models/salesModel.js';

/**
 * @desc    Get real-time budget variance analysis for a project
 * @route   GET /api/projects/:id/budget-variance
 * @access  Private (Management/Sales roles)
 */
const getProjectBudgetVariance = asyncHandler(async (req, res) => {
  const projectId = req.params.id;
  const organizationId = req.user.organization;

  try {
    console.log(`🔍 Fetching budget variance for project: ${projectId}`);

    // Validate project exists and belongs to organization
    const project = await Project.findOne({
      _id: projectId,
      organization: organizationId
    });

    if (!project) {
      res.status(404);
      throw new Error('Project not found or you do not have permission to access it');
    }

    // Get all relevant data in parallel for better performance
    const [sales, totalUnits, soldUnits, availableUnits] = await Promise.all([
      // Get all completed sales for this project
      Sale.find({ 
        project: projectId, 
        status: { $in: ['Completed', 'Active', 'Booked'] }
      }).populate('unit', 'unitNumber unitType floor areaSqft'),
      
      // Get total units count
      Unit.countDocuments({ project: projectId }),
      
      // Get sold units count
      Unit.countDocuments({ 
        project: projectId, 
        status: { $in: ['sold', 'booked'] }
      }),
      
      // Get available units for pricing suggestions
      Unit.find({ 
        project: projectId, 
        status: 'available' 
      }).select('unitNumber unitType floor areaSqft currentPrice')
    ]);

    console.log(`📊 Data summary: ${sales.length} sales, ${totalUnits} total units, ${soldUnits} sold units`);

    // Calculate financial metrics
    const totalRevenue = sales.reduce((sum, sale) => sum + (sale.salePrice || 0), 0);
    const averageSalePrice = soldUnits > 0 ? totalRevenue / soldUnits : 0;
    
    // Determine budget target (use project target or calculate from pricing)
    const budgetTarget = project.targetRevenue || 
                        (project.basePrice ? project.basePrice * totalUnits : 0) ||
                        (averageSalePrice * totalUnits);

    if (budgetTarget === 0) {
      res.status(400);
      throw new Error('Project budget target not set. Please configure project pricing.');
    }

    // Calculate expected vs actual performance
    const expectedRevenueAtCurrentSales = (budgetTarget / totalUnits) * soldUnits;
    const shortfall = expectedRevenueAtCurrentSales - totalRevenue;
    const variancePercentage = expectedRevenueAtCurrentSales > 0 
      ? ((totalRevenue - expectedRevenueAtCurrentSales) / expectedRevenueAtCurrentSales) * 100 
      : 0;

    // Calculate requirements for remaining units
    const remainingUnits = totalUnits - soldUnits;
    const requiredRevenueFromRemainingUnits = budgetTarget - totalRevenue;
    const requiredAveragePricePerRemainingUnit = remainingUnits > 0 
      ? requiredRevenueFromRemainingUnits / remainingUnits 
      : 0;

    // Calculate price adjustment needed
    const originalTargetPrice = budgetTarget / totalUnits;
    const priceAdjustmentNeeded = originalTargetPrice > 0 && remainingUnits > 0
      ? ((requiredAveragePricePerRemainingUnit - originalTargetPrice) / originalTargetPrice) * 100 
      : 0;

    // Generate alerts based on variance
    const alerts = [];
    let alertSeverity = 'normal';

    if (Math.abs(variancePercentage) >= 20) {
      alertSeverity = 'critical';
      alerts.push({
        type: 'budget_variance_critical',
        severity: 'critical',
        title: '🚨 Critical Budget Variance',
        message: `Revenue is ${Math.abs(variancePercentage).toFixed(1)}% ${variancePercentage < 0 ? 'behind' : 'ahead of'} target`,
        actionRequired: true,
        recommendations: variancePercentage < 0 ? [
          `Increase remaining unit prices to ₹${Math.round(requiredAveragePricePerRemainingUnit / 1000)}K each`,
          'Consider premium positioning with added amenities',
          'Target high-net-worth customer segment',
          'Implement flexible payment plans'
        ] : [
          'Maintain current pricing strategy',
          'Consider early completion bonus for buyers',
          'Expand marketing to similar customer segments'
        ]
      });
    } else if (Math.abs(variancePercentage) >= 10) {
      alertSeverity = 'warning';
      alerts.push({
        type: 'budget_variance_warning',
        severity: 'warning',
        title: '⚠️ Budget Variance Detected',
        message: `Revenue is ${Math.abs(variancePercentage).toFixed(1)}% ${variancePercentage < 0 ? 'behind' : 'ahead of'} target`,
        actionRequired: variancePercentage < 0,
        recommendations: variancePercentage < 0 ? [
          'Monitor pricing strategy closely',
          'Consider modest price adjustments',
          'Review market positioning'
        ] : [
          'Excellent performance - maintain momentum',
          'Consider expanding similar projects'
        ]
      });
    }

    // Generate unit-wise pricing suggestions for remaining units
    const pricingSuggestions = availableUnits.map(unit => {
      // Base suggestion on required average, adjusted for unit characteristics
      let suggestedPrice = requiredAveragePricePerRemainingUnit;
      
      // Adjust based on unit type and floor
      if (unit.unitType === '3BHK') {
        suggestedPrice *= 1.2; // 20% premium for 3BHK
      } else if (unit.unitType === '1BHK') {
        suggestedPrice *= 0.8; // 20% discount for 1BHK
      }
      
      // Floor premium (higher floors = higher price)
      if (unit.floor && unit.floor > 0) {
        suggestedPrice *= (1 + (unit.floor * 0.02)); // 2% per floor
      }
      
      return {
        unitNumber: unit.unitNumber,
        unitType: unit.unitType,
        floor: unit.floor || 'Ground',
        currentPrice: unit.currentPrice || 0,
        suggestedPrice: Math.round(suggestedPrice),
        priceIncrease: unit.currentPrice ? 
          Math.round(((suggestedPrice - unit.currentPrice) / unit.currentPrice) * 100) : 0
      };
    });

    // Compile sold units data
    const soldUnitsData = sales.map(sale => ({
      unitNumber: sale.unit?.unitNumber || 'N/A',
      unitType: sale.unit?.unitType || 'N/A',
      floor: sale.unit?.floor || 'Ground',
      salePrice: sale.salePrice,
      bookingDate: sale.bookingDate,
      status: sale.status
    }));

    // Build comprehensive response
    const budgetVarianceData = {
      project: {
        id: project._id,
        name: project.name,
        budgetTarget: budgetTarget,
        totalUnits: totalUnits,
        targetPricePerUnit: originalTargetPrice
      },
      
      sales: {
        unitsSold: soldUnits,
        totalRevenue: totalRevenue,
        averageSalePrice: averageSalePrice,
        soldUnits: soldUnitsData
      },
      
      calculations: {
        expectedRevenueAtCurrentSales: expectedRevenueAtCurrentSales,
        actualRevenue: totalRevenue,
        shortfall: shortfall,
        remainingUnits: remainingUnits,
        requiredRevenueFromRemainingUnits: requiredRevenueFromRemainingUnits,
        requiredAveragePricePerRemainingUnit: requiredAveragePricePerRemainingUnit,
        variancePercentage: variancePercentage,
        priceAdjustmentNeeded: priceAdjustmentNeeded
      },
      
      pricingSuggestions: pricingSuggestions,
      
      alerts: {
        hasVariance: Math.abs(variancePercentage) >= 10,
        severity: alertSeverity,
        alerts: alerts
      },
      
      performance: {
        budgetProgress: (totalRevenue / budgetTarget) * 100,
        salesProgress: (soldUnits / totalUnits) * 100,
        efficiency: soldUnits > 0 ? (totalRevenue / soldUnits) / originalTargetPrice * 100 : 0
      },
      
      metadata: {
        calculatedAt: new Date(),
        dataPoints: {
          salesRecords: sales.length,
          totalUnits: totalUnits,
          soldUnits: soldUnits,
          availableUnits: availableUnits.length
        }
      }
    };

    console.log(`✅ Budget variance calculated: ${variancePercentage.toFixed(1)}% variance`);

    res.json({
      success: true,
      data: budgetVarianceData,
      message: 'Budget variance analysis completed successfully'
    });

  } catch (error) {
    console.error('❌ Budget variance calculation failed:', error);
    res.status(500);
    throw new Error(`Failed to calculate budget variance: ${error.message}`);
  }
});

/**
 * @desc    Get budget variance summary for multiple projects
 * @route   GET /api/projects/budget-variance-summary
 * @access  Private (Management roles)
 */
const getMultiProjectBudgetSummary = asyncHandler(async (req, res) => {
  const organizationId = req.user.organization;
  const { limit = 10 } = req.query;

  try {
    console.log(`🔍 Fetching budget variance summary for organization: ${organizationId}`);

    // Get all projects for the organization
    const projects = await Project.find({ 
      organization: organizationId,
      status: { $ne: 'Completed' } // Only active projects
    }).limit(parseInt(limit));

    const projectSummaries = await Promise.all(
      projects.map(async (project) => {
        try {
          // Get basic metrics for each project
          const [sales, totalUnits, soldUnits] = await Promise.all([
            Sale.find({ 
              project: project._id, 
              status: { $in: ['Completed', 'Active', 'Booked'] }
            }),
            Unit.countDocuments({ project: project._id }),
            Unit.countDocuments({ 
              project: project._id, 
              status: { $in: ['sold', 'booked'] }
            })
          ]);

          const totalRevenue = sales.reduce((sum, sale) => sum + (sale.salePrice || 0), 0);
          const budgetTarget = project.targetRevenue || (project.basePrice * totalUnits) || 0;
          
          const expectedRevenue = totalUnits > 0 ? (budgetTarget / totalUnits) * soldUnits : 0;
          const variancePercentage = expectedRevenue > 0 
            ? ((totalRevenue - expectedRevenue) / expectedRevenue) * 100 
            : 0;

          return {
            projectId: project._id,
            projectName: project.name,
            budgetTarget: budgetTarget,
            totalRevenue: totalRevenue,
            totalUnits: totalUnits,
            soldUnits: soldUnits,
            variancePercentage: variancePercentage,
            status: Math.abs(variancePercentage) >= 20 ? 'critical' :
                   Math.abs(variancePercentage) >= 10 ? 'warning' : 'normal',
            needsAttention: Math.abs(variancePercentage) >= 10
          };
        } catch (projectError) {
          console.error(`Error calculating variance for project ${project._id}:`, projectError);
          return null;
        }
      })
    );

    // Filter out failed calculations and sort by variance
    const validSummaries = projectSummaries
      .filter(summary => summary !== null)
      .sort((a, b) => Math.abs(b.variancePercentage) - Math.abs(a.variancePercentage));

    const overallStats = {
      totalProjects: validSummaries.length,
      projectsNeedingAttention: validSummaries.filter(p => p.needsAttention).length,
      criticalProjects: validSummaries.filter(p => p.status === 'critical').length,
      warningProjects: validSummaries.filter(p => p.status === 'warning').length,
      totalBudgetTarget: validSummaries.reduce((sum, p) => sum + p.budgetTarget, 0),
      totalRevenue: validSummaries.reduce((sum, p) => sum + p.totalRevenue, 0)
    };

    res.json({
      success: true,
      data: {
        projects: validSummaries,
        summary: overallStats
      },
      message: 'Multi-project budget variance summary generated successfully'
    });

  } catch (error) {
    console.error('❌ Multi-project budget variance failed:', error);
    res.status(500);
    throw new Error(`Failed to generate budget variance summary: ${error.message}`);
  }
});

/**
 * @desc    Update project budget target
 * @route   PUT /api/projects/:id/budget-target
 * @access  Private (Management roles)
 */
const updateProjectBudgetTarget = asyncHandler(async (req, res) => {
  const projectId = req.params.id;
  const { budgetTarget, targetPricePerUnit } = req.body;
  const organizationId = req.user.organization;

  try {
    const project = await Project.findOne({
      _id: projectId,
      organization: organizationId
    });

    if (!project) {
      res.status(404);
      throw new Error('Project not found');
    }

    // Update budget target
    const updatedProject = await Project.findByIdAndUpdate(
      projectId,
      {
        targetRevenue: budgetTarget,
        basePrice: targetPricePerUnit,
        updatedAt: new Date()
      },
      { new: true }
    );

    console.log(`✅ Budget target updated for project: ${project.name}`);

    res.json({
      success: true,
      data: {
        projectId: updatedProject._id,
        projectName: updatedProject.name,
        targetRevenue: updatedProject.targetRevenue,
        basePrice: updatedProject.basePrice
      },
      message: 'Project budget target updated successfully'
    });

  } catch (error) {
    console.error('❌ Budget target update failed:', error);
    res.status(500);
    throw new Error(`Failed to update budget target: ${error.message}`);
  }
});

export { 
  getProjectBudgetVariance, 
  getMultiProjectBudgetSummary,
  updateProjectBudgetTarget 
};