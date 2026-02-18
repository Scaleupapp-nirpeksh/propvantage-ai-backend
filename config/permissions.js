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
};

// Flat array of all permission strings for validation
export const ALL_PERMISSIONS = Object.values(PERMISSIONS).flatMap((group) =>
  Object.values(group)
);

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
