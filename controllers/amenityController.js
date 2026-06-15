// File: controllers/amenityController.js
// Org-scoped amenity catalog endpoints + the lead amenity-demand report.

import asyncHandler from 'express-async-handler';
import Amenity from '../models/amenityModel.js';
import Lead from '../models/leadModel.js';
import { normalizeAmenityName, amenityKey } from '../utils/amenity.js';

/**
 * @desc    List the org's amenity catalog (for the lead form autocomplete)
 * @route   GET /api/amenities
 * @access  Private (leads:view)
 */
const getAmenities = asyncHandler(async (req, res) => {
  const amenities = await Amenity.find({ organization: req.user.organization })
    .sort({ name: 1 })
    .select('name usageCount');
  res.json({ success: true, count: amenities.length, data: amenities });
});

/**
 * @desc    Add an amenity to the org catalog (idempotent on case-insensitive name)
 * @route   POST /api/amenities
 * @access  Private (leads:create)
 */
const createAmenity = asyncHandler(async (req, res) => {
  const name = normalizeAmenityName(req.body?.name);
  if (!name) {
    res.status(400);
    throw new Error('Amenity name is required.');
  }
  const nameLower = amenityKey(name);

  // Idempotent: repeated adds of the same (case-insensitive) name return the
  // existing catalog entry instead of erroring on the unique index.
  const amenity = await Amenity.findOneAndUpdate(
    { organization: req.user.organization, nameLower },
    {
      $setOnInsert: {
        organization: req.user.organization,
        name,
        nameLower,
        createdBy: req.user._id,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  res.status(201).json({ success: true, data: amenity });
});

/**
 * @desc    "Most-wanted amenities" — how many leads requested each amenity.
 * @route   GET /api/amenities/demand
 * @access  Private (leads:view)
 */
const getAmenityDemand = asyncHandler(async (req, res) => {
  const demand = await Lead.aggregate([
    { $match: { organization: req.user.organization } },
    { $unwind: '$requirements.amenities' },
    { $group: { _id: '$requirements.amenities', count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1 } },
    { $project: { _id: 0, name: '$_id', count: 1 } },
  ]);
  res.json({ success: true, count: demand.length, data: demand });
});

export { getAmenities, createAmenity, getAmenityDemand };
