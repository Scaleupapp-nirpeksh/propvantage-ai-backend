// File: services/pricingService.js
// Description: Contains the core business logic for pricing calculations, cost sheets, and dynamic price optimization.

import Project from '../models/projectModel.js';
import Unit from '../models/unitModel.js';
import Sale from '../models/salesModel.js';
import mongoose from 'mongoose';

/**
 * Generates a detailed, line-itemized cost sheet for a specific unit.
 * This is the core function for providing a price breakdown to a customer.
 * @param {string} unitId - The ID of the unit to generate the cost sheet for.
 * @param {object} [options] - Optional parameters like discounts.
 * @param {number} [options.discountPercentage=0] - A percentage discount to apply.
 * @returns {Promise<object>} A structured JSON object representing the cost sheet.
 */
const generateCostSheetForUnit = async (unitId, options = {}) => {
  const { discountPercentage = 0 } = options;

  const unit = await Unit.findById(unitId);
  if (!unit) throw new Error('Unit not found');

  const project = await Project.findById(unit.project);
  if (!project) throw new Error('Project associated with the unit not found');

  // --- Start Calculation ---
  const breakdown = [];
  let totalCost = 0;

  // 1. Base Price
  const basePrice = unit.currentPrice;
  breakdown.push({ item: 'Base Price', amount: basePrice });
  totalCost += basePrice;

  // 2. Floor Rise Charges (FIXED: Added optional chaining)
  const floorRiseCharge = (unit.floor > 0 ? unit.floor : 0) * (project.pricingRules?.floorRiseCharge || 0);
  if (floorRiseCharge > 0) {
    breakdown.push({ item: 'Floor Rise Charges', amount: floorRiseCharge });
    totalCost += floorRiseCharge;
  }

  // 3. Preferential Location Charges (PLC) (FIXED: Added optional chaining)
  if (unit.features.isParkFacing && project.pricingRules?.plcCharges?.parkFacing > 0) {
    const plc = project.pricingRules.plcCharges.parkFacing;
    breakdown.push({ item: 'PLC (Park Facing)', amount: plc });
    totalCost += plc;
  }
  if (unit.features.isCornerUnit && project.pricingRules?.plcCharges?.cornerUnit > 0) {
    const plc = project.pricingRules.plcCharges.cornerUnit;
    breakdown.push({ item: 'PLC (Corner Unit)', amount: plc });
    totalCost += plc;
  }

  // 4. Additional Charges from Project
  if (project.additionalCharges && project.additionalCharges.length > 0) {
    project.additionalCharges.forEach(charge => {
        breakdown.push({ item: charge.name, amount: charge.amount });
        totalCost += charge.amount;
    });
  }

  const subTotal = totalCost;
  breakdown.push({ item: 'Sub-Total', amount: subTotal, isBold: true });

  // 5. Apply Discounts
  let discountAmount = 0;
  if (discountPercentage > 0) {
    discountAmount = (subTotal * discountPercentage) / 100;
    breakdown.push({ item: `Discount (${discountPercentage}%)`, amount: -discountAmount });
    totalCost -= discountAmount;
  }
  
  // 6. Calculate GST (FIXED: Added optional chaining)
  const gstRate = project.pricingRules?.gstRate || 0;
  const gstAmount = gstRate > 0 ? (totalCost * gstRate) / 100 : 0;
  if (gstAmount > 0) {
    breakdown.push({ item: `GST (${gstRate}%)`, amount: gstAmount });
    totalCost += gstAmount;
  }

  // --- Final Cost Sheet Object ---
  return {
    unitDetails: {
      unitNumber: unit.unitNumber,
      areaSqft: unit.areaSqft,
      floor: unit.floor,
    },
    projectDetails: {
      name: project.name,
      location: project.location?.city,
    },
    costBreakdown: breakdown,
    finalPayableAmount: totalCost,
  };
};

/**
 * Recalculates and suggests new pricing for all available units in a project.
 * This is the core dynamic pricing engine.
 * @param {string} projectId - The ID of the project to re-price.
 * @returns {Promise<object>} An object containing the summary and suggested new prices.
 */
const calculateDynamicPricingForProject = async (projectId) => {
  const project = await Project.findById(projectId);
  if (!project) throw new Error('Project not found');

  const sales = await Sale.find({ project: projectId, status: { $ne: 'Cancelled' } });
  const availableUnits = await Unit.find({ project: projectId, status: 'available' });

  // 1. Calculate revenue achieved so far
  const totalSoldRevenue = sales.reduce((acc, sale) => acc + sale.salePrice, 0);

  // 2. Calculate remaining revenue needed
  const remainingRevenueNeeded = project.targetRevenue - totalSoldRevenue;

  if (availableUnits.length === 0) {
    return { summary: 'No available units to price.', suggestions: [] };
  }

  if (remainingRevenueNeeded <= 0) {
    return { summary: 'Revenue target met or exceeded.', suggestions: [] };
  }

  // 3. Calculate new average base price for remaining units
  const newAverageBasePrice = remainingRevenueNeeded / availableUnits.length;

  // 4. Generate suggestions for each available unit
  const suggestions = availableUnits.map(unit => {
    // Simple modifier: higher floors are slightly more expensive
    const floorModifier = 1 + (unit.floor / 100) * 0.5; // 0.5% price increase per floor
    const suggestedPrice = Math.round((newAverageBasePrice * floorModifier) / 1000) * 1000; // Round to nearest 1000

    return {
      unitId: unit._id,
      unitNumber: unit.unitNumber,
      currentPrice: unit.currentPrice,
      suggestedNewPrice: suggestedPrice,
      difference: suggestedPrice - unit.currentPrice,
    };
  });

  return {
    summary: {
      targetRevenue: project.targetRevenue,
      achievedRevenue: totalSoldRevenue,
      remainingRevenue: remainingRevenueNeeded,
      unitsRemaining: availableUnits.length,
      newAveragePrice: newAverageBasePrice,
    },
    suggestions,
  };
};

export { generateCostSheetForUnit, calculateDynamicPricingForProject };
