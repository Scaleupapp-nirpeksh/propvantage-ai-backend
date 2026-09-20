// File: services/import/importService.js
// Description: Orchestrates a data import: parse the uploaded workbooks, then either
//   validate (dry run — nothing written) or commit (insert-only, runs in the background
//   so large files never hit a proxy timeout). Every run is recorded as an ImportBatch.
//   Uploaded files are processed in memory and never stored.

import crypto from 'crypto';
import ImportBatch from '../../models/importBatchModel.js';
import { parseFiles } from './parse.js';
import { commitCanonical, cleanDomain } from './commit.js';

const MAX_STORED_ISSUES = 400;
const STALE_MS = 20 * 60 * 1000;

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** Options as stored on the batch — the starting password is never persisted. */
export function publicOptions(o = {}) {
  return {
    projectName: o.projectName || '', emailDomain: cleanDomain(o.emailDomain), createTeam: o.createTeam !== false,
    createPlaceholders: o.createPlaceholders !== false, applyNewBookings: !!o.applyNewBookings, passwordProvided: !!o.defaultPassword,
  };
}

function finishFields(canonical, result, startedAt) {
  const issues = canonical.issues || [];
  const totals = { errors: 0, warnings: 0, info: 0 };
  for (const i of issues) { if (i.severity === 'error') totals.errors += 1; else if (i.severity === 'warning') totals.warnings += 1; else totals.info += 1; }
  const order = { error: 0, warning: 1, info: 2 };
  return {
    counts: result.counts, accounts: result.accounts, summary: result.summary, project: result.projectId || undefined,
    issues: [...issues].sort((a, b) => order[a.severity] - order[b.severity]).slice(0, MAX_STORED_ISSUES), issueTotals: totals,
    unmappedColumns: (canonical.unmappedColumns || []).slice(0, 200), skippedSheets: (canonical.skippedSheets || []).slice(0, 200),
    finishedAt: new Date(), durationMs: Date.now() - startedAt,
  };
}

/**
 * @param {{ name, buffer, size }[]} files
 * @param {'dry_run'|'commit'} mode
 * @returns the ImportBatch (dry run: finished · commit: status "importing", finishes in the background)
 */
export async function runImport({ files, mode, options = {}, organizationId, actor, background = true }) {
  const startedAt = Date.now();
  const { canonical, files: info } = await parseFiles(files, {});
  const fileRows = files.map((f) => ({ name: f.name, sizeBytes: f.size ?? f.buffer.length, sha256: sha256(f.buffer), format: info.find((x) => x.name === f.name)?.format, sheets: info.find((x) => x.name === f.name)?.sheets }));
  const unrecognised = info.filter((x) => x.format === 'unrecognised').map((x) => x.name);
  if (unrecognised.length === files.length) {
    return ImportBatch.create({ organization: organizationId, uploadedBy: actor._id, mode, status: 'failed', files: fileRows, formats: [], options: publicOptions(options), error: 'None of the uploaded workbooks match a supported layout (developer MIS, stacking sheet, or the PropVantage intake template).', issues: canonical.issues?.slice(0, 50) || [], finishedAt: new Date(), durationMs: Date.now() - startedAt });
  }

  const batch = await ImportBatch.create({
    organization: organizationId, uploadedBy: actor._id, mode, status: mode === 'commit' ? 'importing' : 'validated', files: fileRows,
    formats: [...new Set(info.map((x) => x.format).filter((f) => f && f !== 'unrecognised'))], options: publicOptions(options), progress: { stage: 'Reading files', done: 0, total: 0 },
  });

  const work = async () => {
    let lastWrite = 0;
    const onProgress = (stage, done, total) => { if (mode !== 'commit') return; const t = Date.now(); if (t - lastWrite < 1500 && stage !== 'Done') return; lastWrite = t; ImportBatch.updateOne({ _id: batch._id }, { $set: { progress: { stage, done, total } } }).catch(() => {}); };
    try {
      const result = await commitCanonical({ canonical, organizationId, actor, batchId: batch._id, options, dryRun: mode !== 'commit', onProgress });
      const fields = finishFields(canonical, result, startedAt);
      const status = mode !== 'commit' ? 'validated' : (fields.issueTotals.errors || result.counts.some((x) => x.rejected) ? 'completed_with_issues' : 'completed');
      if (mode === 'commit' && result.counts.some((x) => x.created)) {
        // Make the platform's intelligence work on the new records straight away (scores etc.).
        const { finishedAt: _f, durationMs: _d, ...soFar } = fields;
        await ImportBatch.updateOne({ _id: batch._id }, { $set: soFar });
        try { const { runIntelligencePass } = await import('./intelligence.js'); await runIntelligencePass({ organizationId, batchId: batch._id, onProgress }); } catch (e) { console.warn('⚠️ [import] intelligence pass skipped:', e.message); }
      }
      await ImportBatch.updateOne({ _id: batch._id }, { $set: { ...fields, finishedAt: new Date(), durationMs: Date.now() - startedAt, status, progress: { stage: 'Done', done: 1, total: 1 } } });
    } catch (err) {
      console.error('❌ [import] failed:', err.message);
      await ImportBatch.updateOne({ _id: batch._id }, { $set: { status: 'failed', error: String(err.message || err).slice(0, 500), finishedAt: new Date(), durationMs: Date.now() - startedAt } }).catch(() => {});
    }
  };

  if (mode === 'commit' && background) { setImmediate(work); return ImportBatch.findById(batch._id).lean(); }
  await work();
  return ImportBatch.findById(batch._id).lean();
}

/** Imports that were cut short (e.g. a server restart) should not look as if they are still running. */
export async function expireStale(organizationId) {
  await ImportBatch.updateMany(
    { organization: organizationId, status: 'importing', updatedAt: { $lt: new Date(Date.now() - STALE_MS) } },
    { $set: { status: 'failed', error: 'The import was interrupted before it finished. Run it again — records already created are skipped, nothing is duplicated.', finishedAt: new Date() } }
  );
}
