// File: services/dataProviderService.js
// Description: Provider abstraction layer for competitive data ingestion.
// All providers write to CompetitorProject collection with dataSource tracking origin.
// Queries always hit CompetitorProject directly — providers are the ingest mechanism.

import DataProviderConfig from '../models/dataProviderConfigModel.js';
import { executeResearch } from './aiResearchService.js';
import { importCSV } from './csvImportService.js';

// ─── Base Provider ───────────────────────────────────────────

class BaseDataProvider {
  constructor(name) {
    this.name = name;
  }

  /**
   * Fetch data from this provider and upsert into CompetitorProject.
   * @param {Object} params
   * @param {ObjectId} params.organizationId
   * @param {Object} params.config - DataProviderConfig document
   * @param {ObjectId} params.userId
   * @returns {Object} Sync results
   */
  async fetchAndSync(/* params */) {
    throw new Error(`fetchAndSync() not implemented for provider "${this.name}"`);
  }

  /**
   * Test connection / credentials for this provider.
   */
  async testConnection(/* config */) {
    return { success: true, message: `${this.name} does not require connection testing` };
  }
}

// ─── Manual Provider ─────────────────────────────────────────

class ManualProvider extends BaseDataProvider {
  constructor() {
    super('manual');
  }

  async fetchAndSync() {
    return {
      provider: 'manual',
      message: 'Manual data entry is done via the CRUD API. No sync needed.',
      recordsProcessed: 0,
    };
  }
}

// ─── CSV Provider ────────────────────────────────────────────

class CSVProvider extends BaseDataProvider {
  constructor() {
    super('csv_import');
  }

  async fetchAndSync() {
    return {
      provider: 'csv_import',
      message: 'CSV import is done via the /import-csv endpoint. No sync needed.',
      recordsProcessed: 0,
    };
  }

  async importFile({ csvData, organizationId, userId, city, area, customColumnMap }) {
    return importCSV({ csvData, organizationId, userId, city, area, customColumnMap });
  }
}

// ─── AI Research Provider ────────────────────────────────────

class AIResearchProvider extends BaseDataProvider {
  constructor() {
    super('ai_research');
  }

  async fetchAndSync({ organizationId, userId, city, area, projectType, additionalContext }) {
    if (!city || !area) {
      throw new Error('AI Research requires city and area parameters');
    }

    const result = await executeResearch({
      organizationId,
      city,
      area,
      projectType,
      additionalContext,
      userId,
    });

    return {
      provider: 'ai_research',
      ...result,
    };
  }
}

// ─── Propstack Provider (Future) ─────────────────────────────

class PropstackProvider extends BaseDataProvider {
  constructor() {
    super('propstack');
  }

  async fetchAndSync() {
    return {
      provider: 'propstack',
      message: 'Propstack API integration is not yet implemented. Contact support for enterprise API access.',
      recordsProcessed: 0,
    };
  }

  async testConnection(config) {
    if (!config?.credentials?.apiKey) {
      return { success: false, message: 'API key not configured' };
    }
    return { success: false, message: 'Propstack API integration pending. API key stored.' };
  }
}

// ─── Square Yards Provider (Future) ──────────────────────────

class SquareYardsProvider extends BaseDataProvider {
  constructor() {
    super('squareyards');
  }

  async fetchAndSync() {
    return {
      provider: 'squareyards',
      message: 'Square Yards Data Intelligence API integration is not yet implemented.',
      recordsProcessed: 0,
    };
  }
}

// ─── ZapKey Provider (Future) ────────────────────────────────

class ZapKeyProvider extends BaseDataProvider {
  constructor() {
    super('zapkey');
  }

  async fetchAndSync() {
    return {
      provider: 'zapkey',
      message: 'ZapKey API integration is not yet implemented.',
      recordsProcessed: 0,
    };
  }
}

// ─── Provider Registry ───────────────────────────────────────

const providers = {
  manual: new ManualProvider(),
  csv_import: new CSVProvider(),
  ai_research: new AIResearchProvider(),
  propstack: new PropstackProvider(),
  squareyards: new SquareYardsProvider(),
  zapkey: new ZapKeyProvider(),
};

/**
 * Get a provider instance by name.
 */
const getProvider = (name) => {
  const provider = providers[name];
  if (!provider) {
    throw new Error(`Unknown data provider: "${name}". Available: ${Object.keys(providers).join(', ')}`);
  }
  return provider;
};

/**
 * List all available providers with their status.
 */
const listProviders = async (organizationId) => {
  const configs = await DataProviderConfig.find({ organization: organizationId }).lean();
  const configMap = {};
  for (const c of configs) {
    configMap[c.providerName] = c;
  }

  return Object.entries(providers).map(([name, provider]) => ({
    name,
    displayName: name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    isConfigured: !!configMap[name],
    isEnabled: configMap[name]?.isEnabled || false,
    lastSyncAt: configMap[name]?.syncConfig?.lastSyncAt || null,
    lastSyncStatus: configMap[name]?.syncConfig?.lastSyncStatus || null,
    capabilities: {
      autoSync: name === 'propstack' || name === 'squareyards' || name === 'zapkey',
      manualTrigger: name === 'ai_research',
      fileUpload: name === 'csv_import',
      manualEntry: name === 'manual',
    },
    status: ['propstack', 'squareyards', 'zapkey'].includes(name) ? 'coming_soon' : 'available',
  }));
};

/**
 * Trigger sync for a specific provider.
 */
const triggerSync = async ({ organizationId, providerName, userId, params = {} }) => {
  const provider = getProvider(providerName);
  const config = await DataProviderConfig.findOne({
    organization: organizationId,
    providerName,
  }).lean();

  const result = await provider.fetchAndSync({
    organizationId,
    userId,
    config,
    ...params,
  });

  // Update sync status
  if (config) {
    await DataProviderConfig.findByIdAndUpdate(config._id, {
      $set: {
        'syncConfig.lastSyncAt': new Date(),
        'syncConfig.lastSyncStatus': result.recordsProcessed > 0 ? 'success' : 'no_data',
        'syncConfig.lastSyncRecordCount': result.recordsProcessed || result.projectsCreated || 0,
      },
    });
  }

  return result;
};

export {
  BaseDataProvider,
  getProvider,
  listProviders,
  triggerSync,
  providers,
};
