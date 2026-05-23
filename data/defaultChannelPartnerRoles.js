// File: data/defaultChannelPartnerRoles.js
// Description: Default roles seeded into a channel-partner organization at
//   registration. Parallel to data/defaultRoles.js (which seeds builder orgs).
import Role from '../models/roleModel.js';
import { ALL_CP_PERMISSIONS, CP_PERMISSIONS } from '../config/permissions.js';

const CP_DEFAULT_ROLES = [
  {
    name: 'CP Owner',
    slug: 'cp-owner',
    description: 'Channel partner organization owner — full control.',
    level: 0,
    isOwnerRole: true,
    permissions: ALL_CP_PERMISSIONS,
  },
  {
    name: 'CP Manager',
    slug: 'cp-manager',
    description: 'Runs the team day-to-day: members, org profile, dashboard.',
    level: 1,
    isOwnerRole: false,
    permissions: [
      CP_PERMISSIONS.TEAM.VIEW,
      CP_PERMISSIONS.TEAM.MANAGE,
      CP_PERMISSIONS.ORG.VIEW,
      CP_PERMISSIONS.ORG.MANAGE,
      CP_PERMISSIONS.DASHBOARD.VIEW,
      CP_PERMISSIONS.PARTNERSHIPS.VIEW,
      CP_PERMISSIONS.PARTNERSHIPS.MANAGE,
      // SP4
      CP_PERMISSIONS.PROSPECTS.VIEW,
      CP_PERMISSIONS.PROSPECTS.MANAGE,
      CP_PERMISSIONS.EXTERNAL_DEVELOPERS.MANAGE,
      // SP5 — analytics view + team-wide agent breakdown
      CP_PERMISSIONS.ANALYTICS.VIEW,
      CP_PERMISSIONS.ANALYTICS.VIEW_TEAM,
    ],
  },
  {
    name: 'CP Agent',
    slug: 'cp-agent',
    description: 'Works their own leads; views the org profile and dashboard.',
    level: 2,
    isOwnerRole: false,
    permissions: [
      CP_PERMISSIONS.ORG.VIEW,
      CP_PERMISSIONS.DASHBOARD.VIEW,
      CP_PERMISSIONS.PARTNERSHIPS.VIEW,
      // SP4 — Agent works prospects (their own); no external developers mgmt
      CP_PERMISSIONS.PROSPECTS.VIEW,
      CP_PERMISSIONS.PROSPECTS.MANAGE,
      // SP5 — analytics view only (auto-scoped to own data); no view_team
      CP_PERMISSIONS.ANALYTICS.VIEW,
    ],
  },
];

/**
 * Seed the three CP roles into a newly-created channel-partner organization.
 * Returns the created Role documents.
 */
export const seedChannelPartnerRoles = async (organizationId, createdByUserId) => {
  const roleDocs = CP_DEFAULT_ROLES.map((role) => ({
    ...role,
    organization: organizationId,
    isDefault: true,
    isActive: true,
    createdBy: createdByUserId,
  }));
  return await Role.insertMany(roleDocs);
};
