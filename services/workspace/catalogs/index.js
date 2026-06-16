// File: services/workspace/catalogs/index.js
// Description: Catalog registry. Maps a module key -> its CatalogModule. Leads
// is wired in this region; sales/payments/tasks/channelPartners are added by
// their owning regions (import their catalog and add a line below).
//
// Shared type shapes (JSDoc, for editor help only — this is plain ESM):
//
// @typedef {Object} FieldDescriptor
// @property {string} key
// @property {string} label
// @property {'string'|'number'|'date'|'enum'|'ref'|'boolean'} type
// @property {string[]} operators
// @property {string[]} [enumValues]
// @property {boolean} displayable
// @property {boolean} [defaultColumn]
// @property {boolean} [derived]
// @property {() => object[]} [addFields]   aggregation stages for a derived field
// @property {(op: string, value: *, viewerCtx: object) => object} toMatch
//
// @typedef {Object} CatalogModule
// @property {string} module
// @property {string} label
// @property {string} baseModel
// @property {FieldDescriptor[]} fields
// @property {(viewerCtx: object) => object} scope

import { leadsCatalog } from './leadsCatalog.js';

const REGISTRY = {
  leads: leadsCatalog,
  // sales: salesCatalog,                 // added by the Sales region
  // payments: paymentsCatalog,           // added by the Payments region
  // tasks: tasksCatalog,                 // added by the Tasks region
  // channelPartners: channelPartnersCatalog, // added by the CP region
};

/** @returns {string[]} the module keys currently wired into the registry. */
export const listCatalogModules = () => Object.keys(REGISTRY);

/**
 * Resolve a module's catalog.
 * @param {string} module One of the registered module keys.
 * @returns {CatalogModule}
 * @throws if module is missing or not registered.
 */
export const getCatalog = (module) => {
  if (!module) throw new Error('module is required');
  const catalog = REGISTRY[module];
  if (!catalog) throw new Error(`Unknown or unregistered module: ${module}`);
  return catalog;
};

export default getCatalog;
