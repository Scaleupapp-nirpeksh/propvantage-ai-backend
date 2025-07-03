// File: models/interactionModel.js
// Description: Defines the Mongoose schema for logging interactions with a Lead.

import mongoose from 'mongoose';

const interactionSchema = new mongoose.Schema(
  {
    lead: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Lead',
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'User', // The user who performed the interaction
    },
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Organization',
    },
    type: {
      type: String,
      required: true,
      enum: ['Call', 'Email', 'SMS', 'Meeting', 'Site Visit', 'WhatsApp', 'Note'],
    },
    direction: {
      type: String,
      enum: ['Inbound', 'Outbound'],
      // Not required for all types, e.g., 'Note'
    },
    content: {
      type: String,
      required: true,
      trim: true,
      // The main notes or summary of the interaction
    },
    outcome: {
      type: String,
      trim: true,
      // e.g., 'Interested', 'Not available', 'Call back later'
    },
    nextAction: {
      type: String,
      trim: true,
      // Description of the next planned action
    },
    scheduledAt: {
      type: Date,
      // If a next action is scheduled for a specific time
    },
  },
  {
    timestamps: true, // records when the interaction was logged
  }
);

const Interaction = mongoose.model('Interaction', interactionSchema);

export default Interaction;
