// File: services/reports/accessScope.js
// Description: Server-side equivalent of authMiddleware's project-access derivation,
// for contexts that have no request (e.g. the scheduled-report cron job). Mirrors the
// middleware exactly: org owners get null ("all projects"); everyone else is bounded to
// their ProjectAssignment list. Fails CLOSED (empty list) for a missing user, so a
// scheduled run can never resolve unbounded data on behalf of a deleted/invalid owner.

import User from '../../models/userModel.js';
import ProjectAssignment from '../../models/projectAssignmentModel.js';

/**
 * Resolve the project-access scope for a user id, off the request path.
 * @param {string|object} userId
 * @returns {Promise<null|string[]>} null = all projects (org owner); array = bounded set
 *   (possibly empty, which downstream scope resolution treats as "no access").
 */
export async function getAccessibleProjectIdsForUser(userId) {
  if (!userId) return [];
  const user = await User.findById(userId)
    .select('organization')
    .populate('roleRef', 'isOwnerRole');
  if (!user) return []; // fail closed — never widen to "all projects" for an unknown user
  if (user.roleRef?.isOwnerRole) return null; // null signals "all projects"
  const assignments = await ProjectAssignment.find({
    organization: user.organization,
    user: user._id,
  })
    .select('project')
    .lean();
  return assignments.map((a) => a.project.toString());
}

export default { getAccessibleProjectIdsForUser };
