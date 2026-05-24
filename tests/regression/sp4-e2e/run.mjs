// tests/regression/sp4-e2e/run.mjs
// SP4 end-to-end QA runner. Loads the seven scenarios, runs them sequentially
// against the live API base (default https://api.prop-vantage.com/api),
// collects per-scenario logs, and emits a single Markdown report under
// tests/regression/sp4-e2e/REPORT-<runId>.md.
//
// Usage:
//   node tests/regression/sp4-e2e/run.mjs               # run all
//   node tests/regression/sp4-e2e/run.mjs 1 2 4         # run a subset
//   SP4_API_BASE=http://localhost:3000/api node tests/regression/sp4-e2e/run.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bindRunLog, BASE } from './lib/api.mjs';
import { newRunLog, finalize, KIND } from './lib/log.mjs';
import { newManifest } from './lib/manifest.mjs';

import scenario01 from './scenarios/01-cp-requests-access-lead-flow.mjs';
import scenario02 from './scenarios/02-cp-alone-external-dev.mjs';
import scenario03 from './scenarios/03-cp-invites-dev-then-claim.mjs';
import scenario04 from './scenarios/04-dev-creates-lead-assigned-to-cp.mjs';
import scenario05 from './scenarios/05-dev-invites-offplatform-cp.mjs';
import scenario06 from './scenarios/06-both-on-platform-not-connected.mjs';
import scenario07 from './scenarios/07-foolproof-edge-cases.mjs';
import scenario08 from './scenarios/08-cp-deal-full-lifecycle.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SCENARIOS = [
  { id: 1, title: 'CP requests access → dev grants → lead lifecycle → commission', fn: scenario01 },
  { id: 2, title: 'CP works alone (external-only developer, manual commission)', fn: scenario02 },
  { id: 3, title: 'CP invites off-platform dev → dev claims → prospects retag visible',  fn: scenario03 },
  { id: 4, title: 'Dev creates lead assigned to CP → CP proposes status → dev decides',  fn: scenario04 },
  { id: 5, title: 'Dev invites off-platform CP → dev manages → CP claims → tagging',     fn: scenario05 },
  { id: 6, title: 'Both on platform, not connected (invite + request directions)',       fn: scenario06 },
  { id: 7, title: 'Foolproof: scope leaks, withdraw, re-push, duplicate match, gates',   fn: scenario07 },
  { id: 8, title: 'Lifecycle-repair canary: prospect → Sale → 20% → invoice → paid → reconciled', fn: scenario08 },
];

const cliIds = process.argv.slice(2).map((s) => parseInt(s, 10)).filter((n) => !Number.isNaN(n));
const selected = cliIds.length ? SCENARIOS.filter((s) => cliIds.includes(s.id)) : SCENARIOS;

const runId = new Date().toISOString().replace(/[:.]/g, '-');
const manifest = newManifest(runId);
const logs = [];

console.log(`SP4 E2E runner — base=${BASE} runId=${runId}`);
console.log(`scenarios: ${selected.map((s) => s.id).join(', ')}`);

const ctx = {
  runId,
  manifest,
  creds: {
    cp:    { email: process.env.SP4_CP_EMAIL    || 'nirpeksh+offcp@scaleupapp.club',     password: process.env.SP4_CP_PASSWORD    || 'Demo@1234' },
    dev:   { email: process.env.SP4_DEV_EMAIL   || 'rohan.marwah@propvantage-demo.com',  password: process.env.SP4_DEV_PASSWORD   || 'Demo@1234' },
    // Optional second-developer (Vikram for sales-head role checks)
    devSalesHead: { email: 'vikram.khanna@propvantage-demo.com', password: 'Demo@1234' },
    devSalesExec: { email: 'priya.mehta@propvantage-demo.com',   password: 'Demo@1234' },
  },
};

for (const s of selected) {
  const log = newRunLog(`S${s.id}`, s.title);
  bindRunLog(log);
  console.log(`\n══════════════════════════════════════════════════════════════════════════`);
  console.log(` SCENARIO ${s.id} — ${s.title}`);
  console.log(`══════════════════════════════════════════════════════════════════════════`);
  try {
    await s.fn(ctx, log);
  } catch (e) {
    log.steps.push({ kind: 'FAIL', label: 'UNCAUGHT EXCEPTION', detail: e.stack || e.message, at: new Date().toISOString() });
    log.counts.fail++;
    console.log(`\n!! UNCAUGHT in scenario ${s.id}:\n${e.stack || e.message}`);
  }
  finalize(log);
  logs.push(log);
  console.log(`\n[S${s.id} summary] pass=${log.counts.pass} fail=${log.counts.fail} warn=${log.counts.warn} skip=${log.counts.skip}`);
}

// Write the report
const reportPath = path.join(__dirname, `REPORT-${runId}.md`);
fs.writeFileSync(reportPath, renderReport({ runId, base: BASE, logs, manifest }));
console.log(`\n📝 Report written: ${reportPath}`);

const totalFail = logs.reduce((n, l) => n + l.counts.fail, 0);
process.exit(totalFail > 0 ? 1 : 0);

// ──────────────────────────────────────────────────────────────────────────────
function renderReport({ runId, base, logs, manifest }) {
  const totals = logs.reduce(
    (a, l) => ({
      pass: a.pass + l.counts.pass,
      fail: a.fail + l.counts.fail,
      warn: a.warn + l.counts.warn,
      skip: a.skip + l.counts.skip,
    }),
    { pass: 0, fail: 0, warn: 0, skip: 0 }
  );
  const lines = [];
  lines.push(`# SP4 End-to-End QA Report — ${runId}`);
  lines.push('');
  lines.push(`**Base:** \`${base}\``);
  lines.push(`**Run ID:** \`${runId}\``);
  lines.push(`**Totals:** ✅ ${totals.pass} passed · ❌ ${totals.fail} failed · ⚠️ ${totals.warn} warnings · ↷ ${totals.skip} skipped`);
  lines.push('');
  lines.push('## Scenario summary');
  lines.push('');
  lines.push('| # | Title | Result | Pass | Fail | Warn | Skip |');
  lines.push('|---|-------|--------|------|------|------|------|');
  for (const l of logs) {
    const status = l.counts.fail > 0 ? '❌ FAIL' : (l.counts.warn > 0 ? '⚠️ PASS' : '✅ PASS');
    lines.push(`| ${l.scenarioId} | ${l.scenarioTitle} | ${status} | ${l.counts.pass} | ${l.counts.fail} | ${l.counts.warn} | ${l.counts.skip} |`);
  }
  lines.push('');
  for (const l of logs) {
    lines.push(`---`);
    lines.push(`## ${l.scenarioId} — ${l.scenarioTitle}`);
    lines.push(`*started ${l.startedAt} · finished ${l.finishedAt}*`);
    lines.push('');
    lines.push('### Step log');
    lines.push('');
    for (const s of l.steps) {
      const ic = s.kind === 'STEP' ? '→' : s.kind === 'PASS' ? '✅' : s.kind === 'FAIL' ? '❌' : s.kind === 'WARN' ? '⚠️' : s.kind === 'SKIP' ? '↷' : '·';
      const det = s.detail == null ? '' : (typeof s.detail === 'string' ? ` — ${s.detail}` : ` — \`${JSON.stringify(s.detail).slice(0, 280)}\``);
      lines.push(`- ${ic} **${s.kind}** ${s.label}${det}`);
    }
    if (Object.keys(l.artifacts).length) {
      lines.push('');
      lines.push('### Artifacts');
      lines.push('```json');
      lines.push(JSON.stringify(l.artifacts, null, 2));
      lines.push('```');
    }
    lines.push('');
    lines.push(`<details><summary>Request log (${l.requests.length} HTTP calls)</summary>`);
    lines.push('');
    lines.push('| # | Method | Path | Status | ms | Note |');
    lines.push('|---|--------|------|--------|----|------|');
    l.requests.forEach((r, i) => {
      lines.push(`| ${i + 1} | ${r.method} | \`${r.path}\` | ${r.status} | ${r.ms ?? '?'} | ${(r.note || '').replace(/\|/g, '\\|')} |`);
    });
    lines.push('');
    lines.push('</details>');
    lines.push('');
  }
  lines.push('---');
  lines.push('## Manifest — entities created during this run');
  lines.push('');
  for (const k of Object.keys(manifest)) {
    if (k === 'runId') continue;
    const arr = manifest[k];
    if (!Array.isArray(arr) || arr.length === 0) continue;
    lines.push(`### ${k}`);
    lines.push('```json');
    lines.push(JSON.stringify(arr, null, 2));
    lines.push('```');
    lines.push('');
  }
  return lines.join('\n');
}
