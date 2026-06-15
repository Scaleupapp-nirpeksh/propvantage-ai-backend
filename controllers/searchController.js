// File: controllers/searchController.js
// Fast, org-scoped, role-aware global search across leads, projects, units, people.
// Returns uniform result objects: { type, id, label, sublabel, url }.

import asyncHandler from 'express-async-handler';
import Lead from '../models/leadModel.js';
import Project from '../models/projectModel.js';
import Unit from '../models/unitModel.js';
import User from '../models/userModel.js';
import { escapeRegex, matchEnum } from '../utils/searchHelpers.js';

const LEAD_STATUSES = ['New', 'Qualified', 'Site Visit Completed', 'Negotiating', 'Booked', 'Lost', 'Revived'];
const LEAD_SOURCES = ['Channel Partner', 'Management', 'Direct', 'Referral', 'Marketing', 'Cold Calling'];
const LEAD_PRIORITIES = ['High', 'Medium', 'Low', 'Very Low'];

/**
 * @desc    Global search across the org's leads / projects / units / people.
 * @route   GET /api/search?q=&limit=
 * @access  Private (any authenticated org member; results are org-scoped)
 */
const globalSearch = asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const limit = Math.min(parseInt(req.query.limit, 10) || 5, 20);
  const emptyResults = { leads: [], projects: [], units: [], people: [] };

  if (q.length < 2) {
    return res.json({ success: true, query: q, results: emptyResults, total: 0 });
  }

  const org = req.user.organization;
  const rx = new RegExp(escapeRegex(q), 'i');

  // Leads: name/email/phone regex, plus a status/source/priority keyword match.
  // Sales Executives only see their own assigned leads.
  const leadFilter = { organization: org };
  if (req.user.role === 'Sales Executive') leadFilter.assignedTo = req.user._id;
  const leadOr = [{ firstName: rx }, { lastName: rx }, { email: rx }, { phone: rx }];
  const matchedStatus = matchEnum(q, LEAD_STATUSES);
  if (matchedStatus) leadOr.push({ status: matchedStatus });
  const matchedSource = matchEnum(q, LEAD_SOURCES);
  if (matchedSource) leadOr.push({ source: matchedSource });
  const matchedPriority = matchEnum(q, LEAD_PRIORITIES);
  if (matchedPriority) leadOr.push({ priority: matchedPriority });
  // UI label alias: "booking" → internal status 'Booked'.
  if (/^book/i.test(q) && !matchedStatus) leadOr.push({ status: 'Booked' });
  leadFilter.$or = leadOr;

  const [leads, projects, units, people] = await Promise.all([
    Lead.find(leadFilter).sort({ score: -1 }).limit(limit)
      .select('firstName lastName phone email status priority project')
      .populate('project', 'name').lean(),
    Project.find({ organization: org, name: rx }).limit(limit)
      .select('name location status').lean(),
    Unit.find({ organization: org, unitNumber: rx }).limit(limit)
      .select('unitNumber type status project').populate('project', 'name').lean(),
    User.find({ organization: org, $or: [{ firstName: rx }, { lastName: rx }, { email: rx }] })
      .limit(limit).select('firstName lastName email role').lean(),
  ]);

  const results = {
    leads: leads.map((l) => ({
      type: 'lead',
      id: l._id,
      label: `${l.firstName} ${l.lastName || ''}`.trim(),
      sublabel: [l.status, l.priority, l.project?.name].filter(Boolean).join(' · '),
      url: `/leads/${l._id}`,
    })),
    projects: projects.map((p) => ({
      type: 'project',
      id: p._id,
      label: p.name,
      sublabel: [p.location?.city, p.status].filter(Boolean).join(' · '),
      url: `/projects/${p._id}`,
    })),
    units: units.map((u) => ({
      type: 'unit',
      id: u._id,
      label: u.unitNumber,
      sublabel: [u.type, u.status, u.project?.name].filter(Boolean).join(' · '),
      url: u.project?._id ? `/projects/${u.project._id}` : '',
    })),
    people: people.map((u) => ({
      type: 'person',
      id: u._id,
      label: `${u.firstName} ${u.lastName || ''}`.trim(),
      sublabel: [u.email, u.role].filter(Boolean).join(' · '),
      url: '',
    })),
  };

  const total = results.leads.length + results.projects.length + results.units.length + results.people.length;
  res.json({ success: true, query: q, results, total });
});

export { globalSearch };
