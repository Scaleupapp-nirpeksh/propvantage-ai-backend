// File: controllers/cpCommissionInvoiceController.js
// Description: SP5+ — HTTP handlers for /api/cp/commission-invoices/*.
//   Thin asyncHandler wrappers; all business logic lives in the service.

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

export const create = asyncHandler(async (req, res) => {
  const data = await callSvc(() => svc.createDraft(req.body, req.user), res);
  res.status(201).json({ success: true, data });
});

export const update = asyncHandler(async (req, res) => {
  const data = await callSvc(() => svc.update(req.params.id, req.body, req.user), res);
  res.json({ success: true, data });
});

export const submit = asyncHandler(async (req, res) => {
  const data = await callSvc(() => svc.submit(req.params.id, req.user), res);
  res.json({ success: true, data });
});

export const cancel = asyncHandler(async (req, res) => {
  const data = await callSvc(() => svc.cancel(req.params.id, req.user), res);
  res.json({ success: true, data });
});
