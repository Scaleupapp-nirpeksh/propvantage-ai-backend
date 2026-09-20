// File: controllers/importController.js
// Description: Admin "Import data" API — validate or import Excel workbooks, and the
//   history of every run. Imports are insert-only and organisation-scoped.

import asyncHandler from 'express-async-handler';
import ImportBatch from '../models/importBatchModel.js';
import { runImport, expireStale } from '../services/import/importService.js';
import { runIntelligencePass } from '../services/import/intelligence.js';

const LIST_FIELDS = 'mode status files.name files.format files.sizeBytes formats counts issueTotals options project progress error createdAt finishedAt durationMs uploadedBy';
const truthy = (v) => v === true || v === 'true' || v === '1' || v === 'on';

// POST /api/imports  (multipart: files[], mode, projectName, emailDomain, defaultPassword, createTeam, createPlaceholders, applyNewBookings)
export const createImport = asyncHandler(async (req, res) => {
  const files = (req.files || []).map((f) => ({ name: f.originalname, buffer: f.buffer, size: f.size }));
  if (!files.length) { res.status(400); throw new Error('Attach at least one Excel workbook (.xlsx)'); }
  const mode = req.body.mode === 'commit' ? 'commit' : 'dry_run';
  const b = req.body || {};
  const options = {
    projectName: typeof b.projectName === 'string' ? b.projectName.trim() : '', emailDomain: typeof b.emailDomain === 'string' ? b.emailDomain : '',
    defaultPassword: typeof b.defaultPassword === 'string' ? b.defaultPassword : '', createTeam: b.createTeam === undefined ? true : truthy(b.createTeam),
    createPlaceholders: b.createPlaceholders === undefined ? true : truthy(b.createPlaceholders), applyNewBookings: truthy(b.applyNewBookings),
  };
  if (mode === 'commit') {
    const running = await ImportBatch.exists({ organization: req.user.organization, status: 'importing', updatedAt: { $gt: new Date(Date.now() - 20 * 60 * 1000) } });
    if (running) { res.status(409); throw new Error('An import is already running for this organisation — wait for it to finish'); }
  }
  const batch = await runImport({ files, mode, options, organizationId: req.user.organization, actor: req.user });
  res.status(mode === 'commit' ? 202 : 200).json({ success: true, data: batch });
});

// GET /api/imports
export const listImports = asyncHandler(async (req, res) => {
  await expireStale(req.user.organization);
  const rows = await ImportBatch.find({ organization: req.user.organization }).select(LIST_FIELDS).sort({ createdAt: -1 }).limit(100).populate('uploadedBy', 'firstName lastName').populate('project', 'name').lean();
  res.json({ success: true, data: rows });
});

// GET /api/imports/:id
export const getImport = asyncHandler(async (req, res) => {
  await expireStale(req.user.organization);
  const row = await ImportBatch.findOne({ _id: req.params.id, organization: req.user.organization }).populate('uploadedBy', 'firstName lastName').populate('project', 'name').lean();
  if (!row) { res.status(404); throw new Error('Import not found'); }
  res.json({ success: true, data: row });
});

// POST /api/imports/:id/intelligence — (re)run the post-import intelligence pass for one import.
export const runImportIntelligence = asyncHandler(async (req, res) => {
  const row = await ImportBatch.findOne({ _id: req.params.id, organization: req.user.organization }).select('mode status').lean();
  if (!row) { res.status(404); throw new Error('Import not found'); }
  if (row.mode !== 'commit' || row.status === 'importing') { res.status(400); throw new Error('Only a finished import can be processed'); }
  setImmediate(() => runIntelligencePass({ organizationId: req.user.organization, batchId: row._id }).catch((e) => console.warn('⚠️ [import] intelligence pass failed:', e.message)));
  res.status(202).json({ success: true, message: 'Intelligence pass started' });
});
