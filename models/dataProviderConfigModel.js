// File: models/dataProviderConfigModel.js
// Description: Configuration for competitive data providers (manual, CSV, AI research, future APIs).

import mongoose from 'mongoose';

export const PROVIDER_NAMES = [
  'manual',
  'csv_import',
  'ai_research',
  'propstack',
  'squareyards',
  'zapkey',
];

const dataProviderConfigSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Organization',
      index: true,
    },

    providerName: {
      type: String,
      required: true,
      enum: PROVIDER_NAMES,
    },

    isEnabled: { type: Boolean, default: false },

    // API credentials (for future API providers)
    credentials: {
      apiKey: { type: String },
      apiSecret: { type: String },
      baseUrl: { type: String },
      webhookUrl: { type: String },
    },

    // Sync configuration
    syncConfig: {
      autoSyncEnabled: { type: Boolean, default: false },
      syncFrequency: {
        type: String,
        enum: ['daily', 'weekly', 'biweekly', 'monthly'],
        default: 'weekly',
      },
      lastSyncAt: { type: Date },
      lastSyncStatus: {
        type: String,
        enum: ['success', 'partial', 'failed', 'never'],
        default: 'never',
      },
      lastSyncRecordCount: { type: Number, default: 0 },
      lastSyncErrors: [{ type: String }],
    },

    // Locality filters for API sync
    syncFilters: {
      cities: [{ type: String }],
      areas: [{ type: String }],
      projectTypes: [{ type: String }],
    },

    // Column mapping for CSV provider
    csvColumnMapping: {
      type: Map,
      of: String,
    },

    configuredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// One config per provider per org
dataProviderConfigSchema.index(
  { organization: 1, providerName: 1 },
  { unique: true }
);

const DataProviderConfig = mongoose.model(
  'DataProviderConfig',
  dataProviderConfigSchema
);

export default DataProviderConfig;
