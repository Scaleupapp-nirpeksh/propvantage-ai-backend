// File: controllers/workspaceController.js
// Description: Personalized Workspace — catalog, live preview, and card CRUD.
//   Cards are saved, validated Query Plans over one module; every run is
//   re-scoped to the requesting viewer (never the author). Spec §3, §5, §7.

import asyncHandler from 'express-async-handler';
import WorkspaceCard, { WORKSPACE_MODULES, RENDER_MODES } from '../models/workspaceCardModel.js';
import { getCatalog as getModuleCatalog } from '../services/workspace/catalogs/index.js';
import { validateQueryPlan } from '../services/workspace/queryPlanSchema.js';
import { runQueryPlan } from '../services/workspace/queryEngine.js';

// Canonical ViewerContext from the auth-middleware request enhancements.
// accessibleProjectIds === null means owner (all projects) — preserved as-is.
const viewerFromReq = (req) => ({
  organization: req.user.organization,
  userId: req.user._id,
  accessibleProjectIds: req.accessibleProjectIds,
  isOwner: req.isOwner || false,
  permissions: req.userPermissions || [],
});

// Strip function-valued descriptor props so the catalog is JSON-safe for the client.
const serializeCatalog = (catalog) => ({
  module: catalog.module,
  label: catalog.label,
  baseModel: catalog.baseModel,
  fields: catalog.fields.map((f) => ({
    key: f.key,
    label: f.label,
    type: f.type,
    operators: f.operators,
    enumValues: f.enumValues,
    displayable: f.displayable,
    defaultColumn: f.defaultColumn || false,
    derived: f.derived || false,
  })),
});

/**
 * @desc    Field catalog that drives the builder UI for one module
 * @route   GET /api/workspace/catalog/:module
 * @access  Private (protect)
 */
export const getCatalog = asyncHandler(async (req, res) => {
  const catalog = getModuleCatalog(req.params.module);
  if (!catalog) {
    res.status(400);
    throw new Error(`Unknown workspace module: '${req.params.module}'`);
  }
  res.json({ success: true, data: serializeCatalog(catalog) });
});

/**
 * @desc    Run a Query Plan without saving (builder live preview)
 * @route   POST /api/workspace/preview
 * @access  Private (protect)
 */
export const previewCard = asyncHandler(async (req, res) => {
  const { queryPlan } = req.body;
  const { valid, errors } = validateQueryPlan(queryPlan);
  if (!valid) {
    res.status(400);
    throw new Error(`Invalid query plan: ${errors.join('; ')}`);
  }
  const result = await runQueryPlan(queryPlan, viewerFromReq(req));
  res.json({ success: true, data: result });
});

/**
 * @desc    Create a card
 * @route   POST /api/workspace/cards
 * @access  Private (protect)
 */
export const createCard = asyncHandler(async (req, res) => {
  const { title, module, queryPlan, renderMode = 'list', metricConfig, visibility, sharedWithUsers, sharedWithRoles } = req.body;

  if (!WORKSPACE_MODULES.includes(module)) {
    res.status(400);
    throw new Error(`Unknown workspace module: '${module}'`);
  }
  if (!RENDER_MODES.includes(renderMode)) {
    res.status(400);
    throw new Error(`Unknown render mode: '${renderMode}'`);
  }
  const { valid, errors } = validateQueryPlan(queryPlan);
  if (!valid) {
    res.status(400);
    throw new Error(`Invalid query plan: ${errors.join('; ')}`);
  }

  const card = await WorkspaceCard.create({
    organization: req.user.organization,
    ownerId: req.user._id,
    title,
    module,
    queryPlan,
    renderMode,
    metricConfig,
    visibility,
    sharedWithUsers,
    sharedWithRoles,
  });
  res.status(201).json({ success: true, data: card, message: 'Card created' });
});

/**
 * @desc    Update a card (owner only)
 * @route   PUT /api/workspace/cards/:id
 * @access  Private (protect)
 */
export const updateCard = asyncHandler(async (req, res) => {
  // Owner-only: scope the lookup to org + ownerId, so a non-owner gets 404.
  const card = await WorkspaceCard.findOne({
    _id: req.params.id,
    organization: req.user.organization,
    ownerId: req.user._id,
  });
  if (!card) {
    res.status(404);
    throw new Error('Card not found');
  }

  if (req.body.queryPlan !== undefined) {
    const { valid, errors } = validateQueryPlan(req.body.queryPlan);
    if (!valid) {
      res.status(400);
      throw new Error(`Invalid query plan: ${errors.join('; ')}`);
    }
  }

  const immutable = new Set(['organization', 'ownerId', '_id', 'createdAt', 'updatedAt']);
  Object.keys(req.body).forEach((key) => {
    if (!immutable.has(key) && req.body[key] !== undefined) card[key] = req.body[key];
  });

  const updated = await card.save();
  res.json({ success: true, data: updated, message: 'Card updated' });
});

/**
 * @desc    Delete a card (owner only)
 * @route   DELETE /api/workspace/cards/:id
 * @access  Private (protect)
 */
export const deleteCard = asyncHandler(async (req, res) => {
  const card = await WorkspaceCard.findOne({
    _id: req.params.id,
    organization: req.user.organization,
    ownerId: req.user._id,
  });
  if (!card) {
    res.status(404);
    throw new Error('Card not found');
  }
  await WorkspaceCard.deleteOne({ _id: card._id });
  res.json({ success: true, message: `Card '${card.title}' deleted` });
});

// listCards, getCardData (Task 12) and getLayout/saveLayout (Task 13) are
// appended below in subsequent tasks.
export const listCards = asyncHandler(async (req, res) => { res.json({ success: true, data: [] }); });
export const getCardData = asyncHandler(async (req, res) => { res.status(501); throw new Error('Not implemented'); });
export const getLayout = asyncHandler(async (req, res) => { res.json({ success: true, data: { items: [] } }); });
export const saveLayout = asyncHandler(async (req, res) => { res.status(501); throw new Error('Not implemented'); });
