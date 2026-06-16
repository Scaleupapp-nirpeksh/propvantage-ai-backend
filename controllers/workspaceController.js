// File: controllers/workspaceController.js
// Description: Personalized Workspace — catalog, live preview, and card CRUD.
//   Cards are saved, validated Query Plans over one module; every run is
//   re-scoped to the requesting viewer (never the author). Spec §3, §5, §7.

import asyncHandler from 'express-async-handler';
import WorkspaceCard, { WORKSPACE_MODULES, RENDER_MODES } from '../models/workspaceCardModel.js';
import WorkspaceLayout, { CARD_SIZES } from '../models/workspaceLayoutModel.js';
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
  // Fix 2: getCatalog THROWS on unknown module — wrap so unknown → 400, not 500.
  let catalog;
  try {
    catalog = getModuleCatalog(req.params.module);
  } catch (e) {
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
  // Fix 1: validateQueryPlan returns Joi { value, error } — not { valid, errors }.
  const { value: validatedPlan, error } = validateQueryPlan(queryPlan);
  if (error) {
    res.status(400);
    throw new Error(`Invalid query plan: ${error.message}`);
  }
  // Use the coerced plan (Joi defaults applied) — not raw body queryPlan.
  const result = await runQueryPlan(validatedPlan, viewerFromReq(req));
  res.json({ success: true, data: result });
});

/**
 * @desc    Create a card
 * @route   POST /api/workspace/cards
 * @access  Private (protect)
 */
export const createCard = asyncHandler(async (req, res) => {
  const { title, queryPlan, renderMode = 'list', metricConfig, visibility, sharedWithUsers, sharedWithRoles } = req.body;

  if (!RENDER_MODES.includes(renderMode)) {
    res.status(400);
    throw new Error(`Unknown render mode: '${renderMode}'`);
  }
  // Fix 1: validateQueryPlan returns Joi { value, error } — not { valid, errors }.
  const { value: validatedPlan, error } = validateQueryPlan(queryPlan);
  if (error) {
    res.status(400);
    throw new Error(`Invalid query plan: ${error.message}`);
  }

  // Fix 3: derive module from the validated plan so body.module can never
  // desync from the plan's module. No separate WORKSPACE_MODULES guard needed
  // because validateQueryPlan already enforces the allowed modules.
  const card = await WorkspaceCard.create({
    organization: req.user.organization,
    ownerId: req.user._id,
    title,
    module: validatedPlan.module,
    queryPlan: validatedPlan,
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

  // Fix 1 + Fix 3: if a new queryPlan is provided, validate it with the correct
  // Joi contract and update module from the coerced plan (never from body.module).
  if (req.body.queryPlan !== undefined) {
    const { value: validatedPlan, error } = validateQueryPlan(req.body.queryPlan);
    if (error) {
      res.status(400);
      throw new Error(`Invalid query plan: ${error.message}`);
    }
    card.queryPlan = validatedPlan;
    card.module = validatedPlan.module;
  }

  // Immutable fields — also treat 'module' as immutable from body (it's derived
  // from queryPlan above), so strip it too.
  const immutable = new Set(['organization', 'ownerId', '_id', 'createdAt', 'updatedAt', 'module', 'queryPlan']);
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

/**
 * @desc    List the user's own cards + cards shared with them (by user or role)
 * @route   GET /api/workspace/cards
 * @access  Private (protect)
 */
export const listCards = asyncHandler(async (req, res) => {
  const roleName = req.user.roleRef?.name;
  const orClauses = [
    { ownerId: req.user._id },
    { visibility: 'shared', sharedWithUsers: req.user._id },
  ];
  if (roleName) {
    orClauses.push({ visibility: 'shared', sharedWithRoles: roleName });
  }
  const cards = await WorkspaceCard.find({
    organization: req.user.organization,
    $or: orClauses,
  }).sort({ updatedAt: -1 });
  res.json({ success: true, data: cards });
});

// Is this requester allowed to read this card's data?
//  - owner: always
//  - shared card: recipient by explicit user id OR by current role name
const canReadCard = (card, req) => {
  if (String(card.ownerId) === String(req.user._id)) return true;
  if (card.visibility !== 'shared') return false;
  const byUser = (card.sharedWithUsers || []).some((u) => String(u) === String(req.user._id));
  const roleName = req.user.roleRef?.name;
  const byRole = Boolean(roleName) && (card.sharedWithRoles || []).includes(roleName);
  return byUser || byRole;
};

/**
 * @desc    Run a saved card under the REQUESTING viewer's scope (never the owner's)
 * @route   POST /api/workspace/cards/:id/data
 * @access  Private (protect) — owner or valid share recipient only
 */
export const getCardData = asyncHandler(async (req, res) => {
  const card = await WorkspaceCard.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  });
  if (!card) {
    res.status(404);
    throw new Error('Card not found');
  }
  if (!canReadCard(card, req)) {
    res.status(403);
    throw new Error('You do not have access to this card');
  }
  // Re-execute under the requester's ViewerContext — sharing can never widen
  // a recipient beyond data they could already see (spec §3.4).
  const result = await runQueryPlan(card.queryPlan, viewerFromReq(req));
  res.json({ success: true, data: result });
});
/**
 * @desc    Get the requesting user's personal board layout
 * @route   GET /api/workspace/layout
 * @access  Private (protect)
 */
export const getLayout = asyncHandler(async (req, res) => {
  const layout = await WorkspaceLayout.findOne({
    organization: req.user.organization,
    userId: req.user._id,
  });
  res.json({ success: true, data: layout || { items: [] } });
});

/**
 * @desc    Save card order/sizes for the requesting user (upsert; own layout only)
 * @route   PUT /api/workspace/layout
 * @access  Private (protect)
 */
export const saveLayout = asyncHandler(async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items)) {
    res.status(400);
    throw new Error('items must be an array');
  }
  for (const item of items) {
    if (!item || !item.cardId) {
      res.status(400);
      throw new Error('Each layout item requires a cardId');
    }
    if (item.size !== undefined && !CARD_SIZES.includes(item.size)) {
      res.status(400);
      throw new Error(`Invalid card size: '${item.size}'`);
    }
  }
  const layout = await WorkspaceLayout.findOneAndUpdate(
    { userId: req.user._id },
    { $set: { organization: req.user.organization, userId: req.user._id, items } },
    { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
  );
  res.json({ success: true, data: layout, message: 'Layout saved' });
});
