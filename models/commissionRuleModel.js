// File: models/commissionRuleModel.js
// Description: An org-configurable channel-partner commission policy — rate
//   and payout schedule. Consumed by the commission engine in Plan 2.

import mongoose from 'mongoose';

const trancheSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true },
    percentage: { type: Number, required: true, min: 0, max: 100 },
    trigger: {
      type: String,
      enum: ['on_booking', 'on_agreement', 'on_registration', 'on_possession'],
      required: true,
    },
  },
  { _id: false }
);

const commissionRuleSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Rule name is required'],
      trim: true,
    },
    description: { type: String, trim: true, default: '' },
    // null = applies to all projects; otherwise project-specific
    appliesToProject: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      default: null,
    },
    rate: {
      method: {
        type: String,
        enum: ['percentage', 'flat'],
        default: 'percentage',
      },
      percentage: { type: Number, default: 0, min: 0 },
      flatAmount: { type: Number, default: 0, min: 0 },
      basis: {
        type: String,
        enum: ['sale_price', 'base_price'],
        default: 'sale_price',
      },
    },
    payout: {
      schedule: {
        type: String,
        enum: ['lump_sum', 'tranches'],
        default: 'lump_sum',
      },
      tranches: [trancheSchema],
    },
    tdsPercent: { type: Number, default: 5, min: 0, max: 100 },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
      index: true,
    },
  },
  { timestamps: true }
);

// Tranche percentages must sum to 100 when the schedule uses tranches.
commissionRuleSchema.pre('validate', function (next) {
  if (this.payout?.schedule === 'tranches') {
    const tranches = this.payout.tranches || [];
    if (tranches.length === 0) {
      return next(new Error('Tranche schedule requires at least one tranche'));
    }
    const sum = tranches.reduce((a, t) => a + (t.percentage || 0), 0);
    if (Math.abs(sum - 100) > 0.01) {
      return next(new Error(`Tranche percentages must sum to 100 (got ${sum})`));
    }
  }
  next();
});

// Compound indexes for the controller's common query shapes.
commissionRuleSchema.index({ organization: 1, status: 1 });
commissionRuleSchema.index({ organization: 1, appliesToProject: 1 });

const CommissionRule = mongoose.model('CommissionRule', commissionRuleSchema);

export default CommissionRule;
