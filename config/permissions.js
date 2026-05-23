// File: config/permissions.js
// Description: Central permission catalog for the permission-based RBAC system.
// Permissions follow module:action format. This is the single source of truth.

export const PERMISSIONS = {
  // ─── PROJECTS ──────────────────────────────────────────
  PROJECTS: {
    VIEW: 'projects:view',
    CREATE: 'projects:create',
    UPDATE: 'projects:update',
    DELETE: 'projects:delete',
  },

  // ─── PROJECT ACCESS ─────────────────────────────────────
  PROJECT_ACCESS: {
    VIEW: 'project_access:view',
    MANAGE: 'project_access:manage',
  },

  // ─── TOWERS ────────────────────────────────────────────
  TOWERS: {
    VIEW: 'towers:view',
    CREATE: 'towers:create',
    UPDATE: 'towers:update',
    DELETE: 'towers:delete',
    ANALYTICS: 'towers:analytics',
    BULK_CREATE_UNITS: 'towers:bulk_create_units',
  },

  // ─── UNITS ─────────────────────────────────────────────
  UNITS: {
    VIEW: 'units:view',
    CREATE: 'units:create',
    UPDATE: 'units:update',
    DELETE: 'units:delete',
    STATISTICS: 'units:statistics',
  },

  // ─── LEADS ─────────────────────────────────────────────
  LEADS: {
    VIEW: 'leads:view',
    CREATE: 'leads:create',
    UPDATE: 'leads:update',
    DELETE: 'leads:delete',
    ASSIGN: 'leads:assign',
    SCORING_VIEW: 'leads:scoring_view',
    SCORING_CONFIG: 'leads:scoring_config',
    BULK_OPERATIONS: 'leads:bulk_operations',
  },

  // ─── SALES ─────────────────────────────────────────────
  SALES: {
    VIEW: 'sales:view',
    CREATE: 'sales:create',
    UPDATE: 'sales:update',
    CANCEL: 'sales:cancel',
    ANALYTICS: 'sales:analytics',
    PIPELINE: 'sales:pipeline',
    DOCUMENTS: 'sales:documents',
  },

  // ─── PAYMENTS ──────────────────────────────────────────
  PAYMENTS: {
    VIEW: 'payments:view',
    CREATE_PLAN: 'payments:create_plan',
    UPDATE_PLAN: 'payments:update_plan',
    RECORD: 'payments:record',
    UPDATE_TRANSACTION: 'payments:update_transaction',
    VERIFY: 'payments:verify',
    WAIVE: 'payments:waive',
    REPORTS: 'payments:reports',
  },

  // ─── PROJECT PAYMENTS ─────────────────────────────────
  PROJECT_PAYMENTS: {
    VIEW_CONFIG: 'project_payments:view_config',
    UPDATE_CONFIG: 'project_payments:update_config',
    VIEW_TEMPLATES: 'project_payments:view_templates',
    MANAGE_TEMPLATES: 'project_payments:manage_templates',
    MANAGE_BANK: 'project_payments:manage_bank',
    CALCULATE: 'project_payments:calculate',
  },

  // ─── INVOICES ──────────────────────────────────────────
  INVOICES: {
    VIEW: 'invoices:view',
    CREATE: 'invoices:create',
    UPDATE: 'invoices:update',
    CANCEL: 'invoices:cancel',
    RECORD_PAYMENT: 'invoices:record_payment',
    STATISTICS: 'invoices:statistics',
    EXPORT: 'invoices:export',
  },

  // ─── COMMISSIONS ───────────────────────────────────────
  COMMISSIONS: {
    VIEW: 'commissions:view',
    CREATE: 'commissions:create',
    MANAGE_STRUCTURES: 'commissions:manage_structures',
    APPROVE: 'commissions:approve',
    REJECT: 'commissions:reject',
    HOLD: 'commissions:hold',
    RECORD_PAYMENT: 'commissions:record_payment',
    REPORTS: 'commissions:reports',
    RECALCULATE: 'commissions:recalculate',
  },

  // ─── DOCUMENTS ─────────────────────────────────────────
  DOCUMENTS: {
    VIEW: 'documents:view',
    UPLOAD: 'documents:upload',
    UPDATE: 'documents:update',
    DELETE: 'documents:delete',
    MANAGE_CATEGORIES: 'documents:manage_categories',
    APPROVE: 'documents:approve',
    VERSION_CONTROL: 'documents:version_control',
    SHARE: 'documents:share',
    ANALYTICS: 'documents:analytics',
  },

  // ─── CONSTRUCTION ──────────────────────────────────────
  CONSTRUCTION: {
    VIEW: 'construction:view',
    CREATE: 'construction:create',
    UPDATE: 'construction:update',
    PROGRESS: 'construction:progress',
    QUALITY_CONTROL: 'construction:quality_control',
    ISSUES: 'construction:issues',
    UPLOAD_PHOTOS: 'construction:upload_photos',
    TIMELINE: 'construction:timeline',
    ANALYTICS: 'construction:analytics',
  },

  // ─── CONTRACTORS ───────────────────────────────────────
  CONTRACTORS: {
    VIEW: 'contractors:view',
    CREATE: 'contractors:create',
    UPDATE: 'contractors:update',
    MANAGE: 'contractors:manage',
    DOCUMENTS: 'contractors:documents',
    REVIEWS: 'contractors:reviews',
    ANALYTICS: 'contractors:analytics',
  },

  // ─── PRICING ───────────────────────────────────────────
  PRICING: {
    COST_SHEET: 'pricing:cost_sheet',
    DYNAMIC_PRICING: 'pricing:dynamic_pricing',
  },

  // ─── BUDGETS ───────────────────────────────────────────
  BUDGETS: {
    VIEW: 'budgets:view',
    UPDATE_TARGET: 'budgets:update_target',
    VARIANCE_VIEW: 'budgets:variance_view',
    DASHBOARD: 'budgets:dashboard',
  },

  // ─── ANALYTICS ─────────────────────────────────────────
  ANALYTICS: {
    BASIC: 'analytics:basic',
    ADVANCED: 'analytics:advanced',
    REPORTS: 'analytics:reports',
    PREDICTIVE: 'analytics:predictive',
    BUDGET_VS_ACTUAL: 'analytics:budget_vs_actual',
    MARKETING_ROI: 'analytics:marketing_roi',
  },

  // ─── DASHBOARD ────────────────────────────────────────
  DASHBOARD: {
    LEADERSHIP: 'dashboard:leadership',
  },

  // ─── USERS ─────────────────────────────────────────────
  USERS: {
    VIEW: 'users:view',
    UPDATE: 'users:update',
    DELETE: 'users:delete',
    INVITE: 'users:invite',
  },

  // ─── ROLES ─────────────────────────────────────────────
  ROLES: {
    VIEW: 'roles:view',
    CREATE: 'roles:create',
    UPDATE: 'roles:update',
    DELETE: 'roles:delete',
    ASSIGN: 'roles:assign',
  },

  // ─── FILES ─────────────────────────────────────────────
  FILES: {
    UPLOAD: 'files:upload',
    VIEW: 'files:view',
  },

  // ─── AI FEATURES ───────────────────────────────────────
  AI: {
    INSIGHTS: 'ai:insights',
    CONVERSATION: 'ai:conversation',
    COPILOT: 'ai:copilot',
  },

  // ─── CHAT ─────────────────────────────────────────────
  CHAT: {
    VIEW: 'chat:view',
    SEND: 'chat:send',
    CREATE_GROUP: 'chat:create_group',
    DELETE_ANY: 'chat:delete_any',
    MANAGE_GROUPS: 'chat:manage_groups',
  },

  // ─── APPROVALS ────────────────────────────────────────
  APPROVALS: {
    VIEW: 'approvals:view',
    VIEW_ALL: 'approvals:view_all',
    APPROVE: 'approvals:approve',
    REJECT: 'approvals:reject',
    MANAGE_POLICIES: 'approvals:manage_policies',
  },

  // ─── COMPETITIVE ANALYSIS ────────────────────────────
  COMPETITIVE_ANALYSIS: {
    VIEW: 'competitive_analysis:view',
    MANAGE_DATA: 'competitive_analysis:manage_data',
    AI_RESEARCH: 'competitive_analysis:ai_research',
    AI_RECOMMENDATIONS: 'competitive_analysis:ai_recommendations',
    MANAGE_PROVIDERS: 'competitive_analysis:manage_providers',
  },

  // ─── TASKS ────────────────────────────────────────────
  TASKS: {
    VIEW: 'tasks:view',
    VIEW_TEAM: 'tasks:view_team',
    VIEW_ALL: 'tasks:view_all',
    CREATE: 'tasks:create',
    UPDATE: 'tasks:update',
    DELETE: 'tasks:delete',
    ASSIGN: 'tasks:assign',
    MANAGE_TEMPLATES: 'tasks:manage_templates',
    ANALYTICS: 'tasks:analytics',
    BULK_OPERATIONS: 'tasks:bulk_operations',
  },

  // ─── CHANNEL PARTNERS ───────────────────────────────────
  CHANNEL_PARTNERS: {
    VIEW: 'channel_partners:view',
    CREATE: 'channel_partners:create',
    UPDATE: 'channel_partners:update',
    MANAGE_COMMISSION_RULES: 'channel_partners:manage_commission_rules',
    ATTRIBUTE: 'channel_partners:attribute',
    EDIT_BOOKING_ATTRIBUTION: 'channel_partners:edit_booking_attribution',
    MANAGE_COMMISSIONS: 'channel_partners:manage_commissions',
  },

  // ─── DEVELOPER PORTFOLIO ─────────────────────────────────
  PORTFOLIO: {
    MANAGE: 'portfolio:manage',
  },
};

// Flat array of all permission strings for validation
export const ALL_PERMISSIONS = Object.values(PERMISSIONS).flatMap((group) =>
  Object.values(group)
);

// ─── CHANNEL PARTNER PORTAL PERMISSIONS ──────────────────────────────
// A separate namespace for channel-partner organizations. Deliberately NOT
// part of PERMISSIONS / ALL_PERMISSIONS so it never leaks onto developer roles.
export const CP_PERMISSIONS = {
  TEAM: {
    VIEW: 'cp_team:view',
    MANAGE: 'cp_team:manage',
  },
  ORG: {
    VIEW: 'cp_org:view',
    MANAGE: 'cp_org:manage',
  },
  DASHBOARD: {
    VIEW: 'cp_dashboard:view',
  },
  PARTNERSHIPS: {
    VIEW: 'cp_partnerships:view',
    MANAGE: 'cp_partnerships:manage',
  },
  // SP4 — cross-org lead lifecycle & standalone CP workspace
  PROSPECTS: {
    VIEW: 'cp_prospects:view',
    MANAGE: 'cp_prospects:manage',
  },
  EXTERNAL_DEVELOPERS: {
    MANAGE: 'cp_external_developers:manage',
  },
  // SP5 — analytics, insights, and Copilot.
  //   VIEW       — every CP role; CP Agent is automatically scoped to their
  //                own data in the analytics services (via partnerAccessHelper).
  //   VIEW_TEAM  — CP Owner + CP Manager only; gates the agent-breakdown
  //                analytics endpoint (Area 3) so Agents cannot see peers.
  ANALYTICS: {
    VIEW:      'cp_analytics:view',
    VIEW_TEAM: 'cp_analytics:view_team',
  },
};

// Flat list of every CP permission — used to seed the CP Owner role.
export const ALL_CP_PERMISSIONS = Object.values(CP_PERMISSIONS).flatMap((group) =>
  Object.values(group)
);

// Valid category values for channel-partner organizations.
// Single source of truth — consumed by authController and cpPortalController.
export const CP_CATEGORIES = ['individual_agent', 'broker_firm', 'corporate', 'digital_aggregator'];

// Grouped for UI display — frontend uses this to render permission checkboxes
export const PERMISSION_GROUPS = Object.entries(PERMISSIONS).map(
  ([key, perms]) => ({
    module: key.toLowerCase(),
    label: key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    permissions: Object.entries(perms).map(([action, value]) => ({
      key: value,
      action: action.toLowerCase().replace(/_/g, ' '),
      label: `${action.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}`,
    })),
  })
);
