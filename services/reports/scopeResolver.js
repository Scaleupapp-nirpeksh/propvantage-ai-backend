// File: services/reports/scopeResolver.js
// Resolve a report template's scope + the caller's project access into the effective
// project-id list to pass to getLeadershipOverview (null = "all projects"). Pure: no I/O.
// SECURITY: a user can never widen beyond their access; an empty restricted set throws
// (never returns [], which buildProjectFilter would treat as "all projects").

const norm = (id) => String(id);

/**
 * @param {object} scope - template.scope ({ mode?, projects?, period? })
 * @param {string[]|null} accessibleProjectIds - null = owner (all projects); array = the
 *        user's accessible project ids (possibly empty).
 * @returns {{ mode: string, projectIds: (string[]|null) }}
 * @throws {Error} when a restricted selection resolves to zero accessible projects.
 */
export const resolveReportScope = (scope = {}, accessibleProjectIds = null) => {
  const selected = Array.isArray(scope.projects) ? scope.projects.map(norm) : [];
  const mode = scope.mode || (selected.length ? 'project' : 'portfolio');
  const isOwner = accessibleProjectIds === null; // null sentinel = full access

  if (mode === 'portfolio') {
    if (isOwner) return { mode, projectIds: null }; // all projects
    if (!accessibleProjectIds.length) throw new Error('No accessible projects for this report.');
    return { mode, projectIds: accessibleProjectIds.map(norm) };
  }

  // 'project' or 'compare' — an explicit selection is required.
  if (!selected.length) throw new Error(`scope.mode "${mode}" requires scope.projects.`);
  const access = isOwner ? null : accessibleProjectIds.map(norm);
  const allowed = isOwner ? selected : selected.filter((id) => access.includes(id));
  if (!allowed.length) throw new Error('None of the selected projects are accessible.');
  return { mode, projectIds: allowed };
};

export default { resolveReportScope };
