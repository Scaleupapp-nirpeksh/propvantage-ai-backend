// tests/regression/sp4-e2e/lib/manifest.mjs
// Tracks every entity the run creates so the report has a cleanup checklist.
export function newManifest(runId) {
  return {
    runId,
    organizations: [],   // {id, name, type, scenarioId}
    users: [],           // {id, email, role, scenarioId}
    leads: [],
    prospects: [],
    externalDevelopers: [],
    partnerships: [],
    invites: [],
    other: [],
  };
}

export const track = (manifest, bucket, entity) => {
  if (!manifest[bucket]) manifest[bucket] = [];
  manifest[bucket].push(entity);
};
