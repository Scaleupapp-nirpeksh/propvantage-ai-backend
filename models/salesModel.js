// File: models/salesModel.js
// Description: Defines the Mongoose schema for a Sale, capturing the final transaction details.

import mongoose from 'mongoose';

const saleSchema = new mongoose.Schema(
  {
    project: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Project',
    },
    unit: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Unit',
      unique: true, // A unit can only be sold once
    },
    lead: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Lead',
    },
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Organization',
    },
    salesPerson: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'User',
    },
    channelPartner: {
      // Optional, if the sale came through a partner
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
    },
    salePrice: {
      // The final agreed-upon price from the cost sheet
      type: Number,
      required: true,
    },
    // A complete JSON snapshot of the generated cost sheet at the time of booking.
    // This is crucial for auditing and record-keeping.
    costSheetSnapshot: {
      type: Object,
      required: true,
    },
    bookingDate: {
      type: Date,
      default: Date.now,
    },
    status: {
      type: String,
      enum: ['Booked', 'Agreement Signed', 'Registered', 'Completed', 'Cancelled'],
      default: 'Booked',
    },
    // Fields for commission calculation
    commission: {
      rate: { type: Number }, // e.g., 2 for 2%
      amount: { type: Number },
    },
  },
  {
    timestamps: true,
  }
);

const Sale = mongoose.model('Sale', saleSchema);

export default Sale;
