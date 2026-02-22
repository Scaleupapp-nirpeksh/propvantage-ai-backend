// File: data/defaultRoles.js
// Description: Seeds default roles with permission mappings for new organizations.
// Permission mappings are derived from the current route-level access patterns.

import Role from '../models/roleModel.js';
import { ALL_PERMISSIONS } from '../config/permissions.js';

const DEFAULT_ROLES = [
  {
    name: 'Organization Owner',
    slug: 'organization-owner',
    description: 'Full access owner role. Cannot be deleted or modified.',
    level: 0,
    isOwnerRole: true,
    permissions: ALL_PERMISSIONS,
  },
  {
    name: 'Business Head',
    slug: 'business-head',
    description: 'Top-level management with near-complete access.',
    level: 1,
    permissions: ALL_PERMISSIONS.filter((p) => p !== 'roles:delete'),
  },
  {
    name: 'Project Director',
    slug: 'project-director',
    description: 'Oversees projects, construction, and cross-functional operations.',
    level: 2,
    permissions: [
      // Projects — full
      'projects:view', 'projects:create', 'projects:update', 'projects:delete',
      // Towers — full
      'towers:view', 'towers:create', 'towers:update', 'towers:delete',
      'towers:analytics', 'towers:bulk_create_units',
      // Units — full
      'units:view', 'units:create', 'units:update', 'units:delete', 'units:statistics',
      // Leads — full
      'leads:view', 'leads:create', 'leads:update', 'leads:delete',
      'leads:assign', 'leads:scoring_view', 'leads:scoring_config', 'leads:bulk_operations',
      // Sales — full
      'sales:view', 'sales:create', 'sales:update', 'sales:cancel',
      'sales:analytics', 'sales:pipeline', 'sales:documents',
      // Payments — full
      'payments:view', 'payments:create_plan', 'payments:update_plan',
      'payments:record', 'payments:update_transaction', 'payments:verify',
      'payments:waive', 'payments:reports',
      // Project Payments — full
      'project_payments:view_config', 'project_payments:update_config',
      'project_payments:view_templates', 'project_payments:manage_templates',
      'project_payments:manage_bank', 'project_payments:calculate',
      // Invoices — full
      'invoices:view', 'invoices:create', 'invoices:update', 'invoices:cancel',
      'invoices:record_payment', 'invoices:statistics', 'invoices:export',
      // Commissions — full
      'commissions:view', 'commissions:create', 'commissions:manage_structures',
      'commissions:approve', 'commissions:reject', 'commissions:hold',
      'commissions:record_payment', 'commissions:reports', 'commissions:recalculate',
      // Documents — full
      'documents:view', 'documents:upload', 'documents:update', 'documents:delete',
      'documents:manage_categories', 'documents:approve',
      'documents:version_control', 'documents:share', 'documents:analytics',
      // Construction — full
      'construction:view', 'construction:create', 'construction:update',
      'construction:progress', 'construction:quality_control', 'construction:issues',
      'construction:upload_photos', 'construction:timeline', 'construction:analytics',
      // Contractors — full
      'contractors:view', 'contractors:create', 'contractors:update',
      'contractors:manage', 'contractors:documents', 'contractors:reviews',
      'contractors:analytics',
      // Pricing — full
      'pricing:cost_sheet', 'pricing:dynamic_pricing',
      // Budgets — full
      'budgets:view', 'budgets:update_target', 'budgets:variance_view', 'budgets:dashboard',
      // Analytics — full
      'analytics:basic', 'analytics:advanced', 'analytics:reports',
      'analytics:predictive', 'analytics:budget_vs_actual', 'analytics:marketing_roi',
      // Users — full
      'users:view', 'users:update', 'users:delete', 'users:invite',
      // Roles — manage (no delete)
      'roles:view', 'roles:create', 'roles:update', 'roles:assign',
      // Files
      'files:upload', 'files:view',
      // AI
      'ai:insights', 'ai:conversation', 'ai:copilot',
      // Tasks — full (except delete, bulk)
      'tasks:view', 'tasks:view_team', 'tasks:view_all', 'tasks:create',
      'tasks:update', 'tasks:assign', 'tasks:manage_templates', 'tasks:analytics',
      // Chat — full
      'chat:view', 'chat:send', 'chat:create_group', 'chat:delete_any', 'chat:manage_groups',
      // Dashboard
      'dashboard:leadership',
      // Project Access
      'project_access:view', 'project_access:manage',
      // Approvals — full (including policy management)
      'approvals:view', 'approvals:view_all', 'approvals:approve', 'approvals:reject', 'approvals:manage_policies',
      // Competitive Analysis — full
      'competitive_analysis:view', 'competitive_analysis:manage_data', 'competitive_analysis:ai_research',
      'competitive_analysis:ai_recommendations', 'competitive_analysis:manage_providers',
    ],
  },
  {
    name: 'Sales Head',
    slug: 'sales-head',
    description: 'Leads the sales department with full sales and team access.',
    level: 3,
    permissions: [
      'projects:view',
      'towers:view',
      'units:view', 'units:create', 'units:update', 'units:delete', 'units:statistics',
      'leads:view', 'leads:create', 'leads:update', 'leads:delete',
      'leads:assign', 'leads:scoring_view', 'leads:bulk_operations',
      'sales:view', 'sales:create', 'sales:update', 'sales:cancel',
      'sales:analytics', 'sales:pipeline', 'sales:documents',
      'payments:view', 'payments:create_plan', 'payments:update_plan',
      'payments:record', 'payments:reports',
      'project_payments:view_config', 'project_payments:view_templates',
      'project_payments:calculate',
      'invoices:view', 'invoices:create', 'invoices:statistics', 'invoices:export',
      'commissions:view', 'commissions:create', 'commissions:manage_structures',
      'commissions:approve', 'commissions:reject', 'commissions:hold',
      'commissions:reports', 'commissions:recalculate',
      'documents:view', 'documents:upload', 'documents:update', 'documents:delete',
      'documents:manage_categories', 'documents:approve',
      'documents:version_control', 'documents:share',
      'construction:view', 'construction:create', 'construction:update',
      'construction:progress', 'construction:quality_control',
      'construction:issues', 'construction:upload_photos',
      'construction:timeline', 'construction:analytics',
      'contractors:view', 'contractors:create', 'contractors:update',
      'contractors:manage', 'contractors:documents', 'contractors:reviews',
      'pricing:cost_sheet',
      'budgets:view', 'budgets:variance_view', 'budgets:dashboard',
      'analytics:basic', 'analytics:advanced', 'analytics:reports',
      'analytics:budget_vs_actual', 'analytics:marketing_roi',
      'users:view', 'users:update', 'users:invite',
      'roles:view',
      'files:upload', 'files:view',
      'ai:insights', 'ai:conversation', 'ai:copilot',
      // Tasks
      'tasks:view', 'tasks:view_team', 'tasks:create', 'tasks:update',
      'tasks:assign', 'tasks:analytics',
      // Chat
      'chat:view', 'chat:send', 'chat:create_group',
      // Dashboard
      'dashboard:leadership',
      // Project Access
      'project_access:view', 'project_access:manage',
      // Approvals — view, approve, reject (no policy management)
      'approvals:view', 'approvals:view_all', 'approvals:approve', 'approvals:reject',
      // Competitive Analysis — view, manage data, research, recommendations
      'competitive_analysis:view', 'competitive_analysis:manage_data',
      'competitive_analysis:ai_research', 'competitive_analysis:ai_recommendations',
    ],
  },
  {
    name: 'Marketing Head',
    slug: 'marketing-head',
    description: 'Leads marketing with access to leads, analytics, and campaigns.',
    level: 3,
    permissions: [
      'projects:view', 'projects:update',
      'towers:view',
      'units:view', 'units:create', 'units:update', 'units:delete', 'units:statistics',
      'leads:view', 'leads:create', 'leads:update',
      'leads:scoring_view',
      'sales:view', 'sales:analytics', 'sales:pipeline',
      'documents:view', 'documents:upload', 'documents:update', 'documents:delete',
      'documents:manage_categories', 'documents:approve',
      'documents:version_control', 'documents:share', 'documents:analytics',
      'construction:view', 'construction:timeline',
      'budgets:view', 'budgets:variance_view', 'budgets:dashboard',
      'analytics:basic', 'analytics:advanced', 'analytics:reports',
      'analytics:budget_vs_actual', 'analytics:marketing_roi',
      'users:view', 'users:update', 'users:invite',
      'roles:view',
      'files:upload', 'files:view',
      'ai:insights', 'ai:conversation', 'ai:copilot',
      // Tasks
      'tasks:view', 'tasks:view_team', 'tasks:create', 'tasks:update',
      'tasks:assign', 'tasks:analytics',
      // Chat
      'chat:view', 'chat:send', 'chat:create_group',
      // Dashboard
      'dashboard:leadership',
      // Project Access
      'project_access:view', 'project_access:manage',
      // Approvals — view, approve, reject
      'approvals:view', 'approvals:view_all', 'approvals:approve', 'approvals:reject',
      // Competitive Analysis — view, manage data, research, recommendations
      'competitive_analysis:view', 'competitive_analysis:manage_data',
      'competitive_analysis:ai_research', 'competitive_analysis:ai_recommendations',
    ],
  },
  {
    name: 'Finance Head',
    slug: 'finance-head',
    description: 'Leads finance with full access to payments, invoices, and commissions.',
    level: 3,
    permissions: [
      'projects:view',
      'towers:view',
      'units:view', 'units:create', 'units:update', 'units:delete', 'units:statistics',
      'leads:view',
      'sales:view', 'sales:analytics',
      'payments:view', 'payments:create_plan', 'payments:update_plan',
      'payments:record', 'payments:update_transaction', 'payments:verify',
      'payments:waive', 'payments:reports',
      'project_payments:view_config', 'project_payments:update_config',
      'project_payments:view_templates', 'project_payments:manage_templates',
      'project_payments:manage_bank', 'project_payments:calculate',
      'invoices:view', 'invoices:create', 'invoices:update', 'invoices:cancel',
      'invoices:record_payment', 'invoices:statistics', 'invoices:export',
      'commissions:view', 'commissions:manage_structures',
      'commissions:approve', 'commissions:reject', 'commissions:hold',
      'commissions:record_payment', 'commissions:reports', 'commissions:recalculate',
      'documents:view', 'documents:upload', 'documents:update', 'documents:delete',
      'documents:manage_categories', 'documents:approve',
      'documents:version_control', 'documents:share', 'documents:analytics',
      'pricing:dynamic_pricing',
      'budgets:view', 'budgets:update_target', 'budgets:variance_view', 'budgets:dashboard',
      'analytics:basic', 'analytics:advanced', 'analytics:reports',
      'analytics:budget_vs_actual',
      'users:view', 'users:update', 'users:invite',
      'roles:view',
      'files:upload', 'files:view',
      'ai:copilot',
      // Tasks
      'tasks:view', 'tasks:view_team', 'tasks:create', 'tasks:update',
      'tasks:assign', 'tasks:analytics',
      // Chat
      'chat:view', 'chat:send', 'chat:create_group',
      // Dashboard
      'dashboard:leadership',
      // Project Access
      'project_access:view', 'project_access:manage',
      // Approvals — view, approve, reject
      'approvals:view', 'approvals:view_all', 'approvals:approve', 'approvals:reject',
      // Competitive Analysis — view, research, recommendations (no manage_data)
      'competitive_analysis:view', 'competitive_analysis:ai_research',
      'competitive_analysis:ai_recommendations',
    ],
  },
  {
    name: 'Sales Manager',
    slug: 'sales-manager',
    description: 'Manages sales team, leads, and day-to-day sales operations.',
    level: 4,
    permissions: [
      'projects:view',
      'towers:view', 'towers:create', 'towers:update', 'towers:analytics',
      'units:view', 'units:create', 'units:update', 'units:statistics',
      'leads:view', 'leads:create', 'leads:update',
      'leads:assign', 'leads:scoring_view', 'leads:bulk_operations',
      'sales:view', 'sales:create', 'sales:update',
      'sales:analytics', 'sales:pipeline', 'sales:documents',
      'payments:view', 'payments:create_plan', 'payments:update_plan',
      'payments:record', 'payments:reports',
      'project_payments:view_config', 'project_payments:update_config',
      'project_payments:view_templates', 'project_payments:manage_templates',
      'project_payments:calculate',
      'invoices:view', 'invoices:create', 'invoices:statistics', 'invoices:export',
      'commissions:view', 'commissions:create', 'commissions:manage_structures',
      'commissions:approve', 'commissions:reject', 'commissions:hold',
      'commissions:reports', 'commissions:recalculate',
      'documents:view', 'documents:upload', 'documents:update',
      'documents:manage_categories', 'documents:approve',
      'documents:version_control', 'documents:share',
      'construction:view', 'construction:create', 'construction:update',
      'construction:progress', 'construction:quality_control',
      'construction:issues', 'construction:upload_photos',
      'construction:timeline', 'construction:analytics',
      'contractors:view', 'contractors:create', 'contractors:update',
      'contractors:manage', 'contractors:documents', 'contractors:reviews',
      'pricing:cost_sheet',
      'budgets:view', 'budgets:variance_view', 'budgets:dashboard',
      'analytics:basic', 'analytics:advanced',
      'analytics:budget_vs_actual',
      'users:view', 'users:update', 'users:invite',
      'roles:view',
      'files:upload', 'files:view',
      'ai:insights', 'ai:conversation', 'ai:copilot',
      // Tasks
      'tasks:view', 'tasks:view_team', 'tasks:create', 'tasks:update', 'tasks:assign',
      // Chat
      'chat:view', 'chat:send', 'chat:create_group',
      // Project Access
      'project_access:view', 'project_access:manage',
      // Approvals — view, approve, reject
      'approvals:view', 'approvals:approve', 'approvals:reject',
      // Competitive Analysis — view, manage data
      'competitive_analysis:view', 'competitive_analysis:manage_data',
    ],
  },
  {
    name: 'Finance Manager',
    slug: 'finance-manager',
    description: 'Manages financial operations, payments, and invoicing.',
    level: 4,
    permissions: [
      'projects:view',
      'towers:view', 'towers:create', 'towers:update',
      'units:view', 'units:create', 'units:update', 'units:statistics',
      'leads:view',
      'sales:view', 'sales:analytics',
      'payments:view', 'payments:create_plan', 'payments:update_plan',
      'payments:record', 'payments:update_transaction', 'payments:verify',
      'payments:reports',
      'project_payments:view_config', 'project_payments:update_config',
      'project_payments:view_templates', 'project_payments:manage_templates',
      'project_payments:manage_bank', 'project_payments:calculate',
      'invoices:view', 'invoices:create', 'invoices:update',
      'invoices:record_payment', 'invoices:statistics', 'invoices:export',
      'commissions:view', 'commissions:record_payment', 'commissions:reports',
      'documents:view', 'documents:upload', 'documents:update',
      'documents:manage_categories', 'documents:approve',
      'documents:version_control', 'documents:share',
      'pricing:dynamic_pricing',
      'budgets:view', 'budgets:variance_view', 'budgets:dashboard',
      'analytics:basic', 'analytics:advanced',
      'analytics:budget_vs_actual',
      'users:view', 'users:update', 'users:invite',
      'roles:view',
      'files:upload', 'files:view',
      'ai:copilot',
      // Tasks
      'tasks:view', 'tasks:view_team', 'tasks:create', 'tasks:update', 'tasks:assign',
      // Chat
      'chat:view', 'chat:send', 'chat:create_group',
      // Project Access
      'project_access:view',
      // Approvals — view, approve, reject
      'approvals:view', 'approvals:approve', 'approvals:reject',
      // Competitive Analysis — view only
      'competitive_analysis:view',
    ],
  },
  {
    name: 'Channel Partner Manager',
    slug: 'channel-partner-manager',
    description: 'Manages channel partner relationships and external sales.',
    level: 4,
    permissions: [
      'projects:view',
      'towers:view',
      'units:view', 'units:statistics',
      'leads:view', 'leads:create', 'leads:update',
      'leads:assign', 'leads:scoring_view',
      'sales:view', 'sales:create', 'sales:update',
      'sales:pipeline',
      'commissions:view', 'commissions:create', 'commissions:manage_structures',
      'commissions:approve', 'commissions:reject', 'commissions:hold',
      'commissions:reports',
      'documents:view', 'documents:upload', 'documents:update',
      'documents:manage_categories', 'documents:approve',
      'documents:version_control', 'documents:share',
      'construction:view', 'construction:timeline',
      'contractors:view', 'contractors:create', 'contractors:update',
      'contractors:manage', 'contractors:documents', 'contractors:reviews',
      'budgets:view', 'budgets:variance_view',
      'analytics:basic',
      'analytics:budget_vs_actual',
      'users:view', 'users:update', 'users:invite',
      'roles:view',
      'ai:insights', 'ai:conversation', 'ai:copilot',
      // Tasks
      'tasks:view', 'tasks:view_team', 'tasks:create', 'tasks:update', 'tasks:assign',
      // Chat
      'chat:view', 'chat:send', 'chat:create_group',
      // Project Access
      'project_access:view',
      // Approvals — view, approve, reject
      'approvals:view', 'approvals:approve', 'approvals:reject',
      // Competitive Analysis — view only
      'competitive_analysis:view',
    ],
  },
  {
    name: 'Sales Executive',
    slug: 'sales-executive',
    description: 'Frontline sales staff handling leads and sales transactions.',
    level: 5,
    permissions: [
      'projects:view',
      'towers:view',
      'units:view', 'units:statistics',
      'leads:view', 'leads:create', 'leads:update',
      'leads:scoring_view',
      'sales:view', 'sales:create', 'sales:update',
      'sales:documents',
      'payments:view', 'payments:create_plan', 'payments:record',
      'project_payments:view_templates', 'project_payments:calculate',
      'invoices:create',
      'commissions:view', 'commissions:create',
      'documents:view', 'documents:upload', 'documents:update',
      'documents:version_control', 'documents:share',
      'construction:view', 'construction:progress',
      'construction:issues', 'construction:upload_photos',
      'construction:timeline',
      'contractors:view', 'contractors:reviews',
      'pricing:cost_sheet',
      'budgets:view',
      'users:view',
      'files:upload', 'files:view',
      'ai:insights', 'ai:conversation', 'ai:copilot',
      // Tasks
      'tasks:view', 'tasks:create', 'tasks:update',
      // Chat
      'chat:view', 'chat:send',
      // Project Access
      'project_access:view',
      // Approvals — view only
      'approvals:view',
    ],
  },
  {
    name: 'Channel Partner Admin',
    slug: 'channel-partner-admin',
    description: 'Administrative access for channel partner organizations.',
    level: 5,
    permissions: [
      'projects:view',
      'towers:view',
      'units:view', 'units:statistics',
      'leads:view', 'leads:create', 'leads:update',
      'sales:view',
      'documents:view', 'documents:upload', 'documents:update',
      'documents:version_control', 'documents:share',
      'construction:view', 'construction:timeline',
      'pricing:cost_sheet',
      'budgets:view',
      'users:view',
      'ai:insights', 'ai:conversation', 'ai:copilot',
      // Tasks
      'tasks:view', 'tasks:create', 'tasks:update',
      // Chat
      'chat:view', 'chat:send',
      // Project Access
      'project_access:view',
      // Approvals — view only
      'approvals:view',
    ],
  },
  {
    name: 'Channel Partner Agent',
    slug: 'channel-partner-agent',
    description: 'External sales agents with limited access.',
    level: 6,
    permissions: [
      'projects:view',
      'towers:view',
      'units:view',
      'leads:view', 'leads:create',
      'documents:view', 'documents:upload',
      'documents:version_control', 'documents:share',
      'construction:view', 'construction:timeline',
      'pricing:cost_sheet',
      'ai:copilot',
      // Tasks
      'tasks:view', 'tasks:create',
      // Chat
      'chat:view', 'chat:send',
      // Project Access
      'project_access:view',
      // Approvals — view only
      'approvals:view',
    ],
  },
];

/**
 * Seed default roles for a new organization.
 * Called during org registration.
 * @param {ObjectId} organizationId
 * @param {ObjectId} createdByUserId
 * @returns {Array} Created role documents
 */
export const seedDefaultRoles = async (organizationId, createdByUserId) => {
  const roleDocs = DEFAULT_ROLES.map((role) => ({
    ...role,
    organization: organizationId,
    isDefault: true,
    isActive: true,
    createdBy: createdByUserId,
  }));

  return await Role.insertMany(roleDocs);
};

export { DEFAULT_ROLES };
