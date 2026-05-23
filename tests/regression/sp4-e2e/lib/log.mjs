// tests/regression/sp4-e2e/lib/log.mjs
// Per-scenario step recorder. Each scenario builds a stream of (kind, label,
// detail) records; the runner aggregates them into the final report.
export const KIND = {
  STEP: 'STEP',
  PASS: 'PASS',
  FAIL: 'FAIL',
  WARN: 'WARN',
  NOTE: 'NOTE',
  SKIP: 'SKIP',
};

export function newRunLog(scenarioId, scenarioTitle) {
  return {
    scenarioId,
    scenarioTitle,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    status: 'running',          // 'pass' | 'fail' | 'partial'
    steps: [],
    requests: [],
    artifacts: {},              // freeform per-scenario: created ids etc.
    counts: { pass: 0, fail: 0, warn: 0, skip: 0 },
  };
}

export function step(log, label, detail = null) {
  log.steps.push({ kind: KIND.STEP, label, detail, at: ts() });
  console.log(`\n→ ${log.scenarioId} · ${label}`);
}

export function pass(log, label, detail = null) {
  log.steps.push({ kind: KIND.PASS, label, detail, at: ts() });
  log.counts.pass++;
  console.log(`  ✓ ${label}`);
}

export function fail(log, label, detail = null) {
  log.steps.push({ kind: KIND.FAIL, label, detail, at: ts() });
  log.counts.fail++;
  console.log(`  ✗ ${label}${detail ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 200)) : ''}`);
}

export function warn(log, label, detail = null) {
  log.steps.push({ kind: KIND.WARN, label, detail, at: ts() });
  log.counts.warn++;
  console.log(`  ! ${label}${detail ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 200)) : ''}`);
}

export function note(log, label, detail = null) {
  log.steps.push({ kind: KIND.NOTE, label, detail, at: ts() });
}

export function skip(log, label, detail = null) {
  log.steps.push({ kind: KIND.SKIP, label, detail, at: ts() });
  log.counts.skip++;
  console.log(`  ↷ ${label}${detail ? ' — ' + detail : ''}`);
}

export function assert(log, label, cond, detail = null) {
  if (cond) pass(log, label, detail);
  else fail(log, label, detail);
  return cond;
}

export function finalize(log) {
  log.finishedAt = new Date().toISOString();
  log.status = log.counts.fail > 0 ? 'fail' : 'pass';
  return log;
}

const ts = () => new Date().toISOString().replace('T', ' ').slice(11, 23);
