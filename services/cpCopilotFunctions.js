// File: services/cpCopilotFunctions.js
// Description: SP5 — 7-tool catalog for the CP-side Copilot. Mirrors
//   services/copilotFunctions.js architecture but for CP analytics.
//
//   SECURITY: NO tool accepts an organizationId / cpOrgId / orgId argument.
//   Scoping comes from user.organization at execution time. The 45-sp5-
//   cross-tenant-safety regression suite (T9.3) asserts this by inspecting
//   the catalog statically and failing if any property includes those keys.

import mongoose from 'mongoose';
import * as cpAnalytics from './analytics/cpAnalyticsService.js';
import * as reconciliation from './analytics/commissionReconciliationService.js';
import Prospect from '../models/prospectModel.js';
import { isCpAgent } from './analytics/_shared.js';

// ─── OpenAI tool definitions (no organizationId fields anywhere) ───────────

export const cpCopilotTools = [
  {
    type: 'function',
    function: {
      name: 'get_pipeline_health',
      description: 'Get the CP\'s pipeline metrics (total / active prospects, follow-ups, aging) for a date range.',
      parameters: {
        type: 'object',
        properties: {
          range: { type: 'string', enum: ['7d', '30d', '90d', '6m', '12m', 'ytd', 'all'], description: 'Date range; default 30d.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_commission_overview',
      description: 'Get the CP\'s commission summary (expected / received / outstanding / realisation rate, per-currency, by-developer, by-agent).',
      parameters: {
        type: 'object',
        properties: {
          range: { type: 'string', enum: ['7d', '30d', '90d', '6m', '12m', 'ytd', 'all'] },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_agent_performance',
      description: 'Get per-agent performance breakdown. CP Owner / Manager only — CP Agent gets a not-allowed response.',
      parameters: {
        type: 'object',
        properties: {
          range: { type: 'string', enum: ['7d', '30d', '90d', '6m', '12m', 'ytd', 'all'] },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_developer_performance',
      description: 'Get per-developer performance (conversion, deltaVsOverall, commissionRealised, leadAcceptanceRate) for the CP.',
      parameters: {
        type: 'object',
        properties: {
          range: { type: 'string', enum: ['7d', '30d', '90d', '6m', '12m', 'ytd', 'all'] },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_reconciliation_status',
      description: 'Get commission reconciliation overview, or the detail for a single prospect when prospectId is given.',
      parameters: {
        type: 'object',
        properties: {
          range: { type: 'string', enum: ['7d', '30d', '90d', '6m', '12m', 'ytd', 'all'] },
          prospectId: { type: 'string', description: 'Optional — get drill-through detail for one prospect.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_prospects',
      description: 'Search the CP\'s prospects by name / phone / email / status / assignedAgent. Returns up to 10 with citations.',
      parameters: {
        type: 'object',
        properties: {
          query:  { type: 'string', description: 'Free-text query matched against name/phone/email.' },
          status: { type: 'string', description: 'Optional Prospect.status filter.' },
          assignedAgent: { type: 'string', description: 'Optional User._id filter (must be in the same CP org).' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_prospect_detail',
      description: 'Get the full record for a single prospect (must belong to the caller\'s CP org).',
      parameters: {
        type: 'object',
        properties: {
          prospectId: { type: 'string', description: 'Prospect _id.' },
        },
        required: ['prospectId'],
      },
    },
  },
];

// ─── Dispatcher ────────────────────────────────────────────────────────────

const FUNCTION_HANDLERS = {
  get_pipeline_health: (args, user) =>
    cpAnalytics.getPipelineHealth(user.organization, args || {}, user),

  get_commission_overview: (args, user) =>
    cpAnalytics.getCommissionOverview(user.organization, args || {}, user),

  get_agent_performance: (args, user) => {
    if (isCpAgent(user)) {
      return {
        error: 'forbidden',
        message: 'Agent-performance breakdown is restricted to CP Owner / Manager.',
      };
    }
    return cpAnalytics.getAgentPerformance(user.organization, args || {}, user);
  },

  get_developer_performance: (args, user) =>
    cpAnalytics.getDeveloperPerformance(user.organization, args || {}, user),

  get_reconciliation_status: async (args, user) => {
    if (args?.prospectId) {
      return reconciliation.getReconciliationDetail(user.organization, args.prospectId, user);
    }
    return reconciliation.getReconciliationOverview(user.organization, args || {}, user);
  },

  find_prospects: async (args, user) => {
    const orgFilter = { organization: user.organization };
    if (isCpAgent(user)) orgFilter.assignedAgent = user._id;
    if (args?.status) orgFilter.status = args.status;
    if (args?.assignedAgent && mongoose.isValidObjectId(args.assignedAgent)) {
      // Even Owner / Manager respects the requested agent narrowing,
      // but the resulting prospects MUST still be in their org (orgFilter).
      orgFilter.assignedAgent = args.assignedAgent;
    }
    const q = String(args?.query || '').trim();
    if (q) {
      const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(esc, 'i');
      orgFilter.$or = [{ firstName: re }, { lastName: re }, { phone: re }, { email: re }];
    }
    const rows = await Prospect.find(orgFilter)
      .select('_id firstName lastName phone email status priority assignedAgent updatedAt')
      .sort({ updatedAt: -1 })
      .limit(10)
      .lean();
    return {
      count: rows.length,
      prospects: rows.map((p) => ({
        ...p,
        name: `${p.firstName} ${p.lastName || ''}`.trim(),
        citation: `/partner/prospects/${p._id}`,
      })),
    };
  },

  get_prospect_detail: async (args, user) => {
    if (!args?.prospectId || !mongoose.isValidObjectId(args.prospectId)) {
      return { error: 'bad_request', message: 'prospectId is required.' };
    }
    const orgFilter = { _id: args.prospectId, organization: user.organization };
    if (isCpAgent(user)) orgFilter.assignedAgent = user._id;
    const prospect = await Prospect.findOne(orgFilter).lean();
    if (!prospect) return { error: 'not_found', message: 'Prospect not found in your organisation.' };
    return {
      ...prospect,
      name: `${prospect.firstName} ${prospect.lastName || ''}`.trim(),
      citation: `/partner/prospects/${prospect._id}`,
    };
  },
};

/**
 * Execute a tool call. Always uses user.organization (from middleware) for
 * scoping — never an args field. Returns the raw service-shape result so
 * the LLM can cite specific fields.
 */
export async function executeCpCopilotFunction(name, args, user) {
  const handler = FUNCTION_HANDLERS[name];
  if (!handler) return { error: 'unknown_function', message: `Unknown CP Copilot tool: ${name}` };
  try {
    return await handler(args || {}, user);
  } catch (err) {
    return { error: 'execution_error', message: err.message };
  }
}

export default { cpCopilotTools, executeCpCopilotFunction };
