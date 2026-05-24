// File: controllers/devCommissionInvoiceController.js
// Description: SP5+ — HTTP handlers for /api/commission-invoices/* (dev side).

import asyncHandler from 'express-async-handler';
import * as svc from '../services/commissionInvoiceService.js';

const callSvc = async (fn, res) => {
  try {
    return await fn();
  } catch (err) {
    if (err?.statusCode) res.status(err.statusCode);
    throw err;
  }
};

export const list = asyncHandler(async (req, res) => {
  const data = await callSvc(() => svc.list(req.query, req.user), res);
  res.json({ success: true, data });
});

export const get = asyncHandler(async (req, res) => {
  const data = await callSvc(() => svc.get(req.params.id, req.user), res);
  res.json({ success: true, data });
});

export const approve = asyncHandler(async (req, res) => {
  const note = req.body?.note || '';
  const data = await callSvc(() => svc.decide(req.params.id, 'approve', note, req.user), res);
  res.json({ success: true, data });
});

export const reject = asyncHandler(async (req, res) => {
  const note = req.body?.note || '';
  const data = await callSvc(() => svc.decide(req.params.id, 'reject', note, req.user), res);
  res.json({ success: true, data });
});

export const recordPayment = asyncHandler(async (req, res) => {
  const data = await callSvc(() => svc.recordPayment(req.params.id, req.body || {}, req.user), res);
  res.json({ success: true, data });
});
