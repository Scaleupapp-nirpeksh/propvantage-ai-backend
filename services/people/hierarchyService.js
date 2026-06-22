// File: services/people/hierarchyService.js
// Description: Role-tier hierarchy resolver. Foundation for People & Performance module.
// All functions are pure over user objects except getTeam/getManagerChain/getSubtree
// which query the DB (org-scoped).

import User from '../../models/userModel.js';

// =============================================================================
// DEPARTMENT MAP
// Maps each role to the head role that "owns" that department.
// Business Head / Owner-role users see ALL — they are the top of the tree.
// =============================================================================

/**
 * Maps a role string to the head role responsible for that department.
 * Head roles themselves map up to 'Business Head' (the owner tier).
 * @type {Record<string, string>}
 */
export const DEPARTMENT_BY_ROLE = {
  // Members → their Head
  'Sales Manager':            'Sales Head',
  'Sales Executive':          'Sales Head',
  'Channel Partner Manager':  'Sales Head',
  'Channel Partner Admin':    'Sales Head',
  'Channel Partner Agent':    'Sales Head',
  'Finance Manager':          'Finance Head',

  // Heads → owner tier (Business Head sees all Heads)
  'Sales Head':       'Business Head',
  'Finance Head':     'Business Head',
  'Legal Head':       'Business Head',
  'CRM Head':         'Business Head',
  'Marketing Head':   'Business Head',
  'Project Director': 'Business Head',
};

/**
 * The set of roles that are "Head" roles (i.e. they have a department of members beneath them).
 * Used to distinguish Head-level subtree (department) from member-level subtree (self).
 * @type {Set<string>}
 */
const HEAD_ROLES = new Set([
  'Sales Head',
  'Finance Head',
  'Legal Head',
  'CRM Head',
  'Marketing Head',
  'Project Director',
]);

/**
 * Maps each Head role to itself (the head is identified by their own role string).
 * Provided for symmetry with DEPARTMENT_BY_ROLE so callers can look up the head
 * role string for a given department key.
 * @type {Record<string, string>}
 */
export const HEAD_ROLE_BY_DEPARTMENT = {
  'Sales Head':       'Sales Head',
  'Finance Head':     'Finance Head',
  'Legal Head':       'Legal Head',
  'CRM Head':         'CRM Head',
  'Marketing Head':   'Marketing Head',
  'Project Director': 'Project Director',
  'Business Head':    'Business Head',
};

// =============================================================================
// PURE RESOLVER FUNCTIONS
// =============================================================================

/**
 * Determine whether this user is at the owner level (sees the entire org).
 * Conditions (either suffices):
 *   - user.role === 'Business Head'
 *   - user.roleRef?.isOwnerRole === true
 *
 * @param {object} user
 * @returns {boolean}
 */
export function isOwnerLevel(user) {
  if (user.role === 'Business Head') return true;
  if (user.roleRef?.isOwnerRole === true) return true;
  return false;
}

/**
 * Resolve the department "bucket" for a user. The bucket is the head-role string
 * that owns the user's department, or 'Business Head' for owner-level users,
 * or 'unassigned' for unmapped custom roles.
 *
 * Resolution order:
 *   1. If owner-level (role === 'Business Head' or roleRef.isOwnerRole) → 'Business Head'
 *   2. If user.role is in DEPARTMENT_BY_ROLE → that mapped head role
 *   3. If user.role === 'Business Head' already handled above
 *   4. Else if user.roleRef?.department is set → use that value
 *   5. Else → 'unassigned'
 *
 * @param {object} user
 * @returns {string}
 */
export function resolveDepartment(user) {
  // Owner-level always resolves to 'Business Head'
  if (isOwnerLevel(user)) return 'Business Head';

  // Legacy role string lookup
  if (user.role && DEPARTMENT_BY_ROLE[user.role] !== undefined) {
    return DEPARTMENT_BY_ROLE[user.role];
  }

  // Custom roleRef with explicit department tag
  if (user.roleRef?.department) {
    return user.roleRef.department;
  }

  return 'unassigned';
}

/**
 * Return the head role string that this user reports to, or null if they are
 * already at the top (owner-level). 'unassigned' roles roll up to 'Business Head'
 * so nobody is invisible.
 *
 * @param {object} user
 * @returns {string|null}
 */
export function getHeadRoleForUser(user) {
  if (isOwnerLevel(user)) return null;

  const dept = resolveDepartment(user);
  if (dept === 'Business Head') {
    // The user is a Head rolling up to the owner
    return 'Business Head';
  }
  if (dept === 'unassigned') {
    // Unmapped custom roles roll up to the owner so they are never invisible
    return 'Business Head';
  }
  // dept is the head role for the user's department
  return dept;
}

// =============================================================================
// ASYNC DB QUERIES (org-scoped)
// =============================================================================

/**
 * Return all org members that belong to the head's department, excluding the
 * head themselves. For owner-level users, returns ALL org members (excluding self).
 *
 * @param {object} headUser - The Head or Owner user document.
 * @returns {Promise<object[]>}
 */
export async function getTeam(headUser) {
  const baseQuery = {
    organization: headUser.organization,
    _id: { $ne: headUser._id },
  };

  if (isOwnerLevel(headUser)) {
    // Owner sees everyone
    return User.find(baseQuery).lean();
  }

  // Head sees members whose legacy role maps to this head's role.
  // Build the list of member roles that map to headUser.role.
  const headRole = headUser.role; // e.g. 'Sales Head'
  const memberRoles = Object.entries(DEPARTMENT_BY_ROLE)
    .filter(([, head]) => head === headRole)
    .map(([role]) => role);

  return User.find({ ...baseQuery, role: { $in: memberRoles } }).lean();
}

/**
 * Return the chain of managers above a user: [directHead, ..., Owner].
 * Owner-level users return an empty array (nobody above them).
 *
 * Each step looks up one user with the head role in the same org.
 * If multiple users share the same head role, the first is used
 * (PropVantage orgs have at most one person per Head role).
 *
 * @param {object} user
 * @returns {Promise<object[]>}
 */
export async function getManagerChain(user) {
  if (isOwnerLevel(user)) return [];

  const chain = [];
  let current = user;

  // Prevent infinite loops with a depth cap (org hierarchy is shallow by design)
  const MAX_DEPTH = 10;
  let depth = 0;

  while (!isOwnerLevel(current) && depth < MAX_DEPTH) {
    const headRole = getHeadRoleForUser(current);
    if (!headRole) break;

    // Find the user with that role in the same org
    const [headUser] = await User.find({
      organization: user.organization,
      role: headRole,
    }).lean();

    if (!headUser) break; // No user found for this head role — stop

    chain.push(headUser);
    current = headUser;
    depth++;
  }

  return chain;
}

/**
 * Determine the visibility scope for a user:
 * - Owner/Business Head → scope 'org', all org user ids
 * - Head role          → scope 'department', their team's ids
 * - Member / unassigned → scope 'self', [user._id]
 *
 * @param {object} user
 * @returns {Promise<{ scope: 'org'|'department'|'self', userIds: import('mongoose').Types.ObjectId[] }>}
 */
export async function getSubtree(user) {
  if (isOwnerLevel(user)) {
    const members = await User.find({
      organization: user.organization,
      _id: { $ne: user._id },
    }).lean();
    return {
      scope: 'org',
      userIds: members.map((m) => m._id),
    };
  }

  // Check if this user is a Head (has a department beneath them)
  const isHead = user.role && HEAD_ROLES.has(user.role);

  if (isHead) {
    const team = await getTeam(user);
    return {
      scope: 'department',
      userIds: team.map((m) => m._id),
    };
  }

  // Member or unassigned → self only
  return {
    scope: 'self',
    userIds: [user._id],
  };
}
