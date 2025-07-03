// File: controllers/salesController.js
// Description: Handles the business logic for creating and managing sales records.

import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import Sale from '../models/salesModel.js';
import Unit from '../models/unitModel.js';
import Lead from '../models/leadModel.js';
import { generateCostSheetForUnit } from '../services/pricingService.js';

/**
 * @desc    Create a new sale (book a unit)
 * @route   POST /api/sales
 * @access  Private
 */
const createSale = asyncHandler(async (req, res) => {
  const { unitId, leadId, discountPercentage = 0 } = req.body;

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
    }).session(session);

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
    const costSheet = await generateCostSheetForUnit(unitId, { discountPercentage });

    // 5. Create the sale record
    const sale = new Sale({
      project: unit.project,
      unit: unitId,
      lead: leadId,
      organization: req.user.organization,
      salesPerson: req.user._id, // The user creating the sale
      salePrice: costSheet.finalPayableAmount,
      costSheetSnapshot: costSheet, // Store the auditable snapshot
    });
    
    const createdSale = await sale.save({ session });

    // 6. Update the unit and lead status
    unit.status = 'sold';
    await unit.save({ session });

    lead.status = 'Booked';
    await lead.save({ session });
    
    // 7. If all operations are successful, commit the transaction
    await session.commitTransaction();
    session.endSession();

    res.status(201).json(createdSale);
  } catch (error) {
    // 8. If any operation fails, abort the transaction
    await session.abortTransaction();
    session.endSession();
    res.status(400); // Bad request, as the input might have been invalid (e.g., sold unit)
    throw new Error(`Failed to create sale: ${error.message}`);
  }
});

/**
 * @desc    Get all sales for the organization
 * @route   GET /api/sales
 * @access  Private
 */
const getSales = asyncHandler(async (req, res) => {
    const sales = await Sale.find({ organization: req.user.organization })
        .populate('project', 'name')
        .populate('unit', 'unitNumber')
        .populate('salesPerson', 'firstName lastName')
        .sort({ bookingDate: -1 });

    res.json(sales);
});

export { createSale, getSales };
