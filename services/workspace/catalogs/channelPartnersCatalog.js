// File: services/workspace/catalogs/channelPartnersCatalog.js
// Description: Field catalog for the Channel Partners module. The CP registry is
//   owned by the developer org (no per-project tenant split), so scope() is
//   org-only. Spec §3.1.

import mongoose from 'mongoose';

const CP_CATEGORIES = ['broker_firm', 'individual_agent', 'corporate', 'digital_aggregator'];
const CP_STATUSES = ['active', 'suspended', 'blacklisted'];

const oid = (v) => new mongoose.Types.ObjectId(String(v));
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const enumMatch = (path) => (op, value) => {
  if (op === 'is') return { [path]: value };
  if (op === 'in') return { [path]: { $in: value } };
  if (op === 'notIn') return { [path]: { $nin: value } };
  throw new Error(`Unsupported operator '${op}' for field '${path}'`);
};

const fields = [
  {
    key: 'status', label: 'Status', type: 'enum',
    operators: ['is', 'in', 'notIn'], enumValues: CP_STATUSES,
    displayable: true, defaultColumn: true, toMatch: enumMatch('status'),
  },
  {
    key: 'category', label: 'Category', type: 'enum',
    operators: ['is', 'in', 'notIn'], enumValues: CP_CATEGORIES,
    displayable: true, defaultColumn: true, toMatch: enumMatch('category'),
  },
  {
    key: 'firmName', label: 'Firm Name', type: 'string',
    operators: ['is', 'contains'], displayable: true, defaultColumn: true,
    toMatch(op, value) {
      if (op === 'is') return { firmName: value };
      if (op === 'contains') return { firmName: new RegExp(escapeRe(value), 'i') };
      throw new Error(`Unsupported operator '${op}' for field 'firmName'`);
    },
  },
  {
    key: 'approvedProjects', label: 'Approved Projects', type: 'ref',
    operators: ['is', 'in', 'isEmpty', 'isNotEmpty'], displayable: true,
    // Array membership: matching a single id matches docs whose array contains it.
    toMatch(op, value) {
      if (op === 'is') return { approvedProjects: oid(value) };
      if (op === 'in') return { approvedProjects: { $in: value.map(oid) } };
      if (op === 'isEmpty') return { approvedProjects: { $size: 0 } };
      if (op === 'isNotEmpty') return { approvedProjects: { $not: { $size: 0 } } };
      throw new Error(`Unsupported operator '${op}' for field 'approvedProjects'`);
    },
  },
];

const channelPartnersCatalog = {
  module: 'channelPartners',
  label: 'Channel Partners',
  baseModel: 'ChannelPartner',
  fields,
  scope(viewerCtx) {
    return { organization: viewerCtx.organization };
  },
};

export default channelPartnersCatalog;
