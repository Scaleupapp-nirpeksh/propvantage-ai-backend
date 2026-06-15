// File: models/amenityModel.js
// Org-scoped amenity catalog (2026-06 Leads refactor). Users can add new
// preferred amenities on the fly; they become available to everyone in the org
// for future leads, and feed the "most-wanted amenities" demand report.
// Leads still store requirements.amenities as a string[]; this is the catalog.

import mongoose from 'mongoose';
import { amenityKey } from '../utils/amenity.js';

const amenitySchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    // Display form (case preserved).
    name: { type: String, required: true, trim: true },
    // Lowercased dedupe key — set by the pre-validate hook (and explicitly by
    // the controller's idempotent upsert). Backs the case-insensitive unique index.
    nameLower: { type: String, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    usageCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// One catalog entry per (org, case-insensitive name).
amenitySchema.index({ organization: 1, nameLower: 1 }, { unique: true });

// Keep nameLower in sync for document .save() paths (e.g. seeders). The
// controller's findOneAndUpdate sets nameLower directly, so it does not depend
// on this hook.
amenitySchema.pre('validate', function (next) {
  if (this.name) this.nameLower = amenityKey(this.name);
  next();
});

const Amenity = mongoose.model('Amenity', amenitySchema);
export default Amenity;
