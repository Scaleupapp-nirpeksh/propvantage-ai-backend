// File: services/import/commit.js
// Description: Writes a canonical data set into the organisation. INSERT-ONLY:
//   - a record that already exists (same import key, or same natural key such as
//     project + unit number, user email, firm name) is counted as a duplicate and
//     left exactly as it is — never updated, never overwritten;
//   - everything created is stamped with the import batch id.
//   With `dryRun: true` nothing is written; the same checks run and the counts say
//   what *would* be created, so the UI can show it before the user commits.

import Project from '../../models/projectModel.js';
import Tower from '../../models/towerModel.js';
import Unit from '../../models/unitModel.js';
import Lead from '../../models/leadModel.js';
import Interaction from '../../models/interactionModel.js';
import Sale, { ACTIVE_SALE_STATUSES } from '../../models/salesModel.js';
import Task from '../../models/taskModel.js';
import ChannelPartner from '../../models/channelPartnerModel.js';
import User from '../../models/userModel.js';
import Role from '../../models/roleModel.js';
import ProjectAssignment from '../../models/projectAssignmentModel.js';
import { issueCollector } from './canonical.js';

const CHUNK = 500;
const FACINGS = new Set(['North', 'South', 'East', 'West', 'North-East', 'North-West', 'South-East', 'South-West']);
const LEGACY_ROLES = new Set(['Business Head', 'Sales Head', 'Marketing Head', 'Finance Head', 'Legal Head', 'CRM Head', 'Project Director', 'Sales Manager', 'Finance Manager', 'Channel Partner Manager', 'Sales Executive']);
const PASSWORD_OK = (p) => typeof p === 'string' && p.length >= 8 && /[A-Z]/.test(p) && /[a-z]/.test(p) && /\d/.test(p) && /[!@#$%^&*(),.?":{}|<>]/.test(p);

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const chunk = (arr, n = CHUNK) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
const lettersOnly = (s) => String(s || '').replace(/[^a-zA-Z\s'-]/g, ' ').replace(/\s+/g, ' ').trim();
const clean = (o) => { for (const k of Object.keys(o)) { const v = o[k]; if (v === undefined || v === null || v === '' || (typeof v === 'number' && Number.isNaN(v))) delete o[k]; } return o; };
const hasValues = (o) => !!o && Object.values(o).some((v) => v !== null && v !== undefined && v !== '');

export const cleanDomain = (d) => String(d || '').trim().toLowerCase().replace(/^.*@/, '').replace(/[^a-z0-9.-]/g, '');

/** "Meera Shah" → meera.shah · "Kabir" → kabir */
export function usernameFor(name) {
  return lettersOnly(name).toLowerCase().split(' ').filter(Boolean).slice(0, 3).join('.').replace(/[^a-z.]/g, '');
}

/** Insert many documents; a duplicate-key race is a duplicate, anything else a rejection. */
async function insertChunked(Model, docs, tally, issue, label) {
  const inserted = [];
  for (const part of chunk(docs)) {
    try {
      const res = await Model.insertMany(part, { ordered: false });
      inserted.push(...res); tally.created += res.length;
    } catch (err) {
      const ok = err.insertedDocs || []; inserted.push(...ok); tally.created += ok.length;
      const writeErrors = err.writeErrors || (err.code === 11000 ? [err] : null);
      if (!writeErrors) throw err;
      for (const we of writeErrors) { if ((we.code || we.err?.code) === 11000) tally.duplicates += 1; else { tally.rejected += 1; issue('error', label, null, label, `${label} could not be saved: ${(we.errmsg || we.err?.errmsg || we.message || '').slice(0, 160)}`); } }
    }
  }
  return inserted;
}

/** Run `fn` over items with bounded concurrency (hooks / encryption need per-document saves). */
async function pooled(items, size, fn) {
  let i = 0;
  const worker = async () => { while (i < items.length) { const idx = i; i += 1; await fn(items[idx], idx); } };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
}

/**
 * @param {object} p
 * @param {object} p.canonical      output of parseFiles()
 * @param {ObjectId} p.organizationId
 * @param {object} p.actor          the signed-in user running the import
 * @param {ObjectId} [p.batchId]
 * @param {object} [p.options]      { projectName, emailDomain, defaultPassword, createTeam, createPlaceholders, applyNewBookings, teamRoles }
 * @param {boolean} [p.dryRun]
 * @param {function} [p.onProgress] (stage, done, total)
 */
export async function commitCanonical({ canonical: c, organizationId: org, actor, batchId, options = {}, dryRun = false, onProgress = () => {} }) {
  const issues = c.issues || (c.issues = []);
  const issue = issueCollector(issues);
  const counts = new Map();
  const tally = (entity, found = 0) => { if (!counts.has(entity)) counts.set(entity, { entity, found: 0, created: 0, duplicates: 0, rejected: 0 }); const t = counts.get(entity); t.found += found; return t; };
  const make = (t, n = 1) => { t.created += n; };
  const now = new Date();
  const accounts = [];

  // ── 0. Team accounts ─────────────────────────────────────────────────────────────────
  onProgress('Team', 0, 1);
  const roles = await Role.find({ organization: org }).select('name isOwnerRole level').lean();
  const roleByName = new Map(roles.map((r) => [r.name, r]));
  const domain = cleanDomain(options.emailDomain);
  const password = options.defaultPassword;
  const wantTeam = options.createTeam !== false;
  const canCreateUsers = !!domain && PASSWORD_OK(password);
  const userByTeamKey = new Map(); // alias (first-name key) → user id
  const orgUsers = await User.find({ organization: org }).select('email roleRef firstName lastName isActive').lean();
  const usersByEmail = new Map(orgUsers.map((u) => [u.email, u]));
  const filledRoles = new Set(orgUsers.filter((u) => u.roleRef).map((u) => String(u.roleRef)));
  const tUsers = tally('Team accounts', (c.team || []).length);
  const importUsers = [];

  const createUser = async ({ firstName, lastName, email, roleName, placeholder }) => {
    const role = roleByName.get(roleName);
    const doc = { organization: org, firstName, lastName, email, password, role: LEGACY_ROLES.has(roleName) ? roleName : 'Sales Executive', roleRef: role?._id, isActive: true, invitationStatus: 'accepted', importBatch: batchId };
    accounts.push({ name: `${firstName} ${lastName}`, email, role: roleName, placeholder: !!placeholder });
    if (dryRun) return null;
    const u = await User.create(clean(doc));
    importUsers.push(u._id);
    return u;
  };

  if ((c.team || []).length && wantTeam) {
    if (!canCreateUsers) {
      tUsers.rejected += c.team.length;
      issue('warning', 'Team', null, 'Accounts', 'Team accounts were not created — give an email domain and a starting password (8+ characters with upper and lower case, a number and a symbol)');
    } else {
      const taken = new Set();
      for (const t of c.team) {
        const parts = lettersOnly(t.name).split(' ').filter(Boolean);
        const firstName = (parts[0] || '').length >= 2 ? parts[0] : null;
        if (!firstName) { tUsers.rejected += 1; continue; }
        const realLast = parts.slice(1).join(' ');
        const closing = (t.functions || []).includes('closing');
        const lastName = realLast.length >= 2 ? realLast : (closing ? 'Sales' : 'Sourcing');
        let username = usernameFor(realLast ? `${firstName} ${realLast}` : firstName);
        while (taken.has(username)) username += 'x';
        taken.add(username);
        const email = `${username}@${domain}`;
        const roleName = options.teamRoles?.[t.key] || (closing ? 'Sales Manager' : 'Sales Executive');
        const mine = usersByEmail.get(email);
        let userId = mine?._id || null;
        if (mine) { tUsers.duplicates += 1; } else {
          const elsewhere = await User.findOne({ email }).select('_id').lean();
          if (elsewhere) { tUsers.rejected += 1; issue('warning', 'Team', null, 'Email', `${email} already belongs to another organisation — account not created; their records are kept under your name`); } else {
            const u = await createUser({ firstName, lastName, email, roleName });
            make(tUsers); userId = u?._id || null;
            if (roleByName.get(roleName)) filledRoles.add(String(roleByName.get(roleName)._id));
          }
        }
        if (mine?.roleRef) filledRoles.add(String(mine.roleRef));
        for (const a of new Set([t.key, ...(t.aliases || [])])) userByTeamKey.set(a, userId);
      }
      const single = c.team.filter((t) => lettersOnly(t.name).split(' ').length < 2).length;
      if (single) issue('info', 'Team', null, 'Name', `${single} team members appear in the files by first name only — their surname is shown as "Sales" / "Sourcing" until full names are supplied`);
    }
  }

  // Placeholder accounts, one per role nobody holds yet, so every role's view can be opened.
  const tPlace = tally('Placeholder accounts');
  if (options.createPlaceholders !== false && canCreateUsers) {
    for (const r of roles) {
      if (r.isOwnerRole || filledRoles.has(String(r._id))) continue;
      tPlace.found += 1;
      const firstName = lettersOnly(r.name).replace(/\s+/g, '');
      const email = `${firstName.toLowerCase()}.testrole@${domain}`;
      if (usersByEmail.has(email)) { tPlace.duplicates += 1; continue; }
      if (await User.findOne({ email }).select('_id').lean()) { tPlace.rejected += 1; continue; }
      await createUser({ firstName, lastName: 'TestRole', email, roleName: r.name, placeholder: true });
      make(tPlace);
    }
  }

  const userFor = (key) => (key && userByTeamKey.get(String(key).toLowerCase().split(' ')[0])) || null;
  const teamNames = new Map();
  for (const t of c.team || []) for (const a of new Set([t.key, ...(t.aliases || [])])) teamNames.set(a, t.name);
  const nameFor = (key) => { if (!key) return undefined; const k = String(key).toLowerCase().split(' ')[0]; return teamNames.get(k) || String(key).replace(/\b[a-z]/g, (ch) => ch.toUpperCase()); };

  // ── 1. Project ──────────────────────────────────────────────────────────────────────
  onProgress('Project', 0, 1);
  const tProject = tally('Projects', c.project || (c.units || []).length ? 1 : 0);
  let project = null;
  const projectName = String(options.projectName || c.project?.name || '').trim().slice(0, 100);
  if (tProject.found) {
    if (!projectName) { tProject.rejected += 1; issue('error', 'Project', null, 'Name', 'No project name found in the files — enter one in the import options'); } else {
      project = await Project.findOne({ organization: org, name: new RegExp(`^${escapeRe(projectName)}$`, 'i') });
      if (project) { tProject.duplicates += 1; } else {
        const p = c.project || {};
        const doc = new Project(clean({
          organization: org, name: projectName, description: p.description, type: p.type || 'apartment', status: p.status || 'launched',
          location: clean({ city: p.city || options.city || 'Not specified', area: p.area || p.city || options.city || 'Not specified', state: p.state, pincode: p.pincode, landmark: p.landmark }),
          totalUnits: Math.max(1, p.totalUnits || (c.units || []).length), totalArea: p.totalArea > 0 ? p.totalArea : undefined,
          priceRange: { min: p.priceMin || 0, max: p.priceMax || 0 }, targetRevenue: Math.max(1, p.targetRevenue || 1),
          launchDate: p.launchDate, expectedCompletionDate: p.expectedCompletionDate, fyTargets: p.fyTargets, importBatch: batchId,
        }));
        if (p.reraNumber) doc.approvals = { rera: { number: p.reraNumber } };
        const templates = (p.paymentPlanTemplates || []).filter((t) => Math.abs((t.installments || []).reduce((a, i) => a + (i.percentage || 0), 0) - 100) < 0.01);
        if (templates.length && doc.paymentConfiguration) doc.paymentConfiguration.paymentPlanTemplates = templates;
        tally('Payment plan templates', (p.paymentPlanTemplates || []).length).created += templates.length;
        counts.get('Payment plan templates').rejected += (p.paymentPlanTemplates || []).length - templates.length;
        if (!dryRun) { await doc.save(); project = doc; }
        make(tProject);
      }
      if (tProject.duplicates && (c.project?.paymentPlanTemplates || []).length) { const t = tally('Payment plan templates', c.project.paymentPlanTemplates.length); t.duplicates += c.project.paymentPlanTemplates.length; }
    }
  }
  const projectId = project?._id || null;
  const needProject = (t, n) => { t.rejected += n; };

  // ── 2. Towers ───────────────────────────────────────────────────────────────────────
  const tTower = tally('Towers', (c.towers || []).length);
  const towerIdByCode = new Map();
  if (projectId) for (const t of await Tower.find({ project: projectId }).select('towerCode').lean()) towerIdByCode.set(t.towerCode, t._id);
  for (const t of c.towers || []) {
    const code = String(t.code).toUpperCase().slice(0, 10);
    if (towerIdByCode.has(code)) { tTower.duplicates += 1; continue; }
    if (!projectId && !dryRun) { needProject(tTower, 1); continue; }
    if (!dryRun) {
      const doc = await Tower.create({ organization: org, project: projectId, towerName: t.name || code, towerCode: code, totalFloors: Math.min(200, Math.max(1, t.totalFloors || 1)), unitsPerFloor: Math.min(50, Math.max(1, t.unitsPerFloor || 1)), status: 'under_construction', createdBy: actor._id, importBatch: batchId });
      towerIdByCode.set(code, doc._id);
    }
    make(tTower);
  }

  // ── 3. Channel partners ─────────────────────────────────────────────────────────────
  onProgress('Channel partners', 0, (c.brokers || []).length);
  const tBroker = tally('Channel partners', (c.brokers || []).length);
  const brokerIdByKey = new Map();
  const existingFirms = await ChannelPartner.find({ organization: org }).select('firmName importKey').lean();
  const firmByImportKey = new Map(existingFirms.filter((f) => f.importKey).map((f) => [f.importKey, f._id]));
  const firmByName = new Map(existingFirms.map((f) => [f.firmName.toLowerCase().trim(), f._id]));
  for (const b of c.brokers || []) {
    const importKey = `cp:${b.key}`;
    const found = firmByImportKey.get(importKey) || firmByName.get(String(b.firmName).toLowerCase().trim());
    if (found) { brokerIdByKey.set(b.key, found); tBroker.duplicates += 1; continue; }
    if (!dryRun) {
      const doc = await ChannelPartner.create({
        organization: org, firmName: b.firmName, primaryContact: clean({ name: b.contactName || (b.contacts || [])[0], phone: b.phone, email: b.email }),
        approvedProjects: projectId ? [projectId] : [], onboardedBy: actor._id, importKey, importBatch: batchId,
        agreementNotes: [b.ratePct ? `Brokerage ${b.ratePct}% recorded in the sales register` : '', (b.contacts || []).length > 1 ? `Contacts: ${b.contacts.join(', ')}` : ''].filter(Boolean).join(' · '),
      });
      brokerIdByKey.set(b.key, doc._id);
    }
    make(tBroker);
  }

  // ── 4. Clients (leads) ──────────────────────────────────────────────────────────────
  const leads = c.leads || [];
  const tLead = tally('Clients', leads.length);
  const leadIdByKey = new Map();
  const newLeadKeys = new Set();
  const byLeadInteractions = new Map();
  for (const it of c.interactions || []) { const cur = byLeadInteractions.get(it.leadKey) || { n: 0, last: null, type: null }; cur.n += 1; if (it.occurredAt && (!cur.last || new Date(it.occurredAt) > cur.last)) { cur.last = new Date(it.occurredAt); cur.type = it.type; } byLeadInteractions.set(it.leadKey, cur); }
  for (const part of chunk(leads.map((l) => `lead:${l.key}`), 1000)) for (const e of await Lead.find({ organization: org, importKey: { $in: part } }).select('importKey').lean()) leadIdByKey.set(e.importKey.slice(5), e._id);
  const phones = leads.filter((l) => l.phone && !leadIdByKey.has(l.key)).map((l) => l.phone);
  const phoneOwner = new Map();
  for (const part of chunk(phones, 1000)) for (const e of await Lead.find({ organization: org, phone: { $in: part } }).select('phone').lean()) phoneOwner.set(e.phone, e._id);
  const toCreate = [];
  for (const l of leads) {
    if (leadIdByKey.has(l.key)) { tLead.duplicates += 1; continue; }
    if (l.phone && phoneOwner.has(l.phone)) { leadIdByKey.set(l.key, phoneOwner.get(l.phone)); tLead.duplicates += 1; continue; }
    if (!l.firstName) { tLead.rejected += 1; continue; }
    toCreate.push(l);
  }
  if (!projectId && !dryRun) { needProject(tLead, toCreate.length); toCreate.length = 0; }
  let done = 0;
  await pooled(toCreate, 12, async (l) => {
    newLeadKeys.add(l.key);
    if (!dryRun) {
      const stats = byLeadInteractions.get(l.key);
      const partner = l.brokerKey ? brokerIdByKey.get(l.brokerKey) : null;
      const created = l.createdAt ? new Date(l.createdAt) : now;
      const doc = clean({
        organization: org, project: projectId, assignedTo: userFor(l.assignedTo), firstName: l.firstName, lastName: l.lastName, email: l.email, phone: l.phone,
        alternatePhone: l.alternatePhone, address: l.address, lostReason: l.lostReason, source: l.source, status: l.status || 'New',
        statusChangedAt: l.lastContactAt ? new Date(l.lastContactAt) : created, notes: [l.nameNote, l.notes].filter(Boolean).join(' · '),
        importKey: `lead:${l.key}`, importBatch: batchId, createdAt: created,
      });
      if (hasValues(l.profile)) doc.profile = clean({ ...l.profile });
      if (hasValues(l.kyc)) doc.kyc = clean({ ...l.kyc });
      if ((l.coApplicants || []).length) doc.coApplicants = l.coApplicants.map((x) => clean({ ...x }));
      if (l.sourceDetail || l.mgmtContact) doc.sourceDetail = { text: l.sourceDetail || '', management: { contactName: l.mgmtContact || '' } };
      if (l.budgetMax > 0 || l.budgetMin > 0) doc.budget = clean({ min: l.budgetMin, max: l.budgetMax });
      if (l.unitTypeWanted) doc.requirements = { unitType: l.unitTypeWanted };
      if (stats) doc.engagementMetrics = clean({ totalInteractions: stats.n, lastInteractionDate: stats.last, lastInteractionType: stats.type });
      if (partner) doc.channelPartnerAttribution = { viaChannelPartner: true, partners: [{ channelPartner: partner, sharePct: 100 }], status: 'tagged', taggedBy: actor._id, taggedAt: created };
      try { const saved = await Lead.create(doc); leadIdByKey.set(l.key, saved._id); make(tLead); } catch (err) {
        if (err.code === 11000) { tLead.duplicates += 1; const e = await Lead.findOne({ organization: org, importKey: doc.importKey }).select('_id').lean(); if (e) leadIdByKey.set(l.key, e._id); } else { tLead.rejected += 1; issue('error', 'Clients', null, 'Client', `A client could not be saved: ${err.message.slice(0, 140)}`); }
      }
    } else make(tLead);
    done += 1; if (done % 100 === 0) onProgress('Clients', done, toCreate.length);
  });
  const leadKnown = (key) => leadIdByKey.has(key) || (dryRun && newLeadKeys.has(key));

  // ── 5. Units (with holds) ───────────────────────────────────────────────────────────
  onProgress('Units', 0, (c.units || []).length);
  const units = c.units || [];
  const tUnit = tally('Units', units.length);
  const tHold = tally('Holds (EOI / blocked)', (c.holds || []).length);
  const holdByUnit = new Map((c.holds || []).map((h) => [h.unitKey, h]));
  const unitIdByKey = new Map(); const existingUnit = new Map(); const newUnitKeys = new Set();
  if (projectId) for (const u of await Unit.find({ project: projectId }).select('unitNumber status').lean()) existingUnit.set(u.unitNumber, u);
  const unitDocs = [];
  for (const u of units) {
    const hold = holdByUnit.get(u.key);
    const prior = existingUnit.get(u.unitNumber);
    if (prior) { unitIdByKey.set(u.key, prior._id); tUnit.duplicates += 1; if (hold) tHold.duplicates += 1; continue; }
    if (!(u.areaSqft > 0) || !(u.currentPrice > 0) || u.floor === null || u.floor === undefined) { tUnit.rejected += 1; if (hold) tHold.rejected += 1; issue('error', 'Units', null, 'Unit', `${u.key} has no floor, area or price — not created`); continue; }
    newUnitKeys.add(u.key);
    const doc = clean({
      organization: org, project: projectId, tower: towerIdByCode.get(String(u.towerCode || '').toUpperCase()), unitNumber: u.unitNumber, type: u.type || 'Apartment', floor: u.floor,
      areaSqft: u.areaSqft, basePrice: u.basePrice || u.currentPrice, currentPrice: u.currentPrice, facing: FACINGS.has(u.facing) ? u.facing : undefined, status: u.status || 'available',
      habitableFloor: u.habitableFloor, typology: u.typology, isRefuge: !!u.isRefuge, heightMeters: u.heightMeters, remarks: u.remarks, importKey: `unit:${u.key}`, importBatch: batchId,
    });
    if (u.bedrooms) doc.specifications = { bedrooms: u.bedrooms };
    if (u.parkingTotal) doc.parking = { covered: u.parkingTotal };
    if (hasValues(u.areaBreakdown)) doc.areaBreakdown = clean({ ...u.areaBreakdown });
    if (hasValues(u.parkingSplit)) doc.parkingSplit = clean({ ...u.parkingSplit });
    if (hasValues(u.pricing)) doc.pricing = clean({ ...u.pricing });
    if ((u.waitlist || []).length) doc.waitlist = u.waitlist;
    if (hold) { doc.hold = clean({ type: hold.type, lead: leadIdByKey.get(hold.leadKey), clientName: hold.clientName, since: hold.since ? new Date(hold.since) : undefined, tokenAmount: hold.tokenAmount, agreedValue: hold.agreedValue, closingManagerName: nameFor(hold.closing), remarks: hold.remarks }); make(tHold); }
    unitDocs.push(doc);
  }
  for (const h of c.holds || []) if (!units.some((u) => u.key === h.unitKey)) { tHold.rejected += 1; }
  if (!dryRun && unitDocs.length) {
    if (!projectId) needProject(tUnit, unitDocs.length); else {
      const inserted = await insertChunked(Unit, unitDocs, tUnit, issue, 'Units');
      const keyByNumber = new Map(units.map((u) => [u.unitNumber, u.key]));
      for (const d of inserted) unitIdByKey.set(keyByNumber.get(d.unitNumber), d._id);
    }
  } else if (dryRun) make(tUnit, unitDocs.length);

  // ── 6. Meetings & visits (interactions) ─────────────────────────────────────────────
  const ints = c.interactions || [];
  onProgress('Meetings', 0, ints.length);
  const tInt = tally('Meetings & visits', ints.length);
  const haveInt = new Set();
  for (const part of chunk(ints.map((i) => i.key), 1000)) for (const e of await Interaction.find({ organization: org, importKey: { $in: part } }).select('importKey').lean()) haveInt.add(e.importKey);
  const intDocs = [];
  for (const it of ints) {
    if (haveInt.has(it.key)) { tInt.duplicates += 1; continue; }
    if (!leadKnown(it.leadKey)) { tInt.rejected += 1; continue; }
    const when = it.occurredAt ? new Date(it.occurredAt) : null;
    intDocs.push(clean({
      organization: org, lead: leadIdByKey.get(it.leadKey), user: userFor(it.by) || actor._id, type: it.type || 'Note', direction: it.direction, content: it.content || `${it.type || 'Interaction'} recorded in the source register`,
      outcome: it.outcome, occurredAt: when, meetingMode: it.meetingMode, location: it.location, attendedBy: it.attendedBy, status: it.status, importKey: it.key, importBatch: batchId, createdAt: when || now,
    }));
  }
  if (!dryRun) await insertChunked(Interaction, intDocs, tInt, issue, 'Meetings & visits'); else make(tInt, intDocs.length);

  // ── 7. Bookings (sales) ─────────────────────────────────────────────────────────────
  const sales = c.sales || [];
  onProgress('Bookings', 0, sales.length);
  const tSale = tally('Bookings', sales.length);
  const haveSale = new Set();
  for (const e of await Sale.find({ organization: org, importKey: { $in: sales.map((s) => s.key) } }).select('importKey').lean()) haveSale.add(e.importKey);
  const priorUnitIds = sales.map((s) => unitIdByKey.get(s.unitKey)).filter(Boolean);
  const soldAlready = new Set((await Sale.find({ unit: { $in: priorUnitIds }, status: { $in: ACTIVE_SALE_STATUSES } }).select('unit').lean()).map((s) => String(s.unit)));
  const saleDocs = []; const transitions = [];
  for (const s of sales) {
    if (haveSale.has(s.key)) { tSale.duplicates += 1; continue; }
    const unitId = unitIdByKey.get(s.unitKey);
    const unitIsNew = newUnitKeys.has(s.unitKey);
    if ((!unitId && !(dryRun && unitIsNew)) || !leadKnown(s.leadKey)) { tSale.rejected += 1; issue('error', 'Bookings', null, 'Booking', `Booking for ${s.unitKey} could not be linked to a unit and a client — not created`); continue; }
    if (unitId && soldAlready.has(String(unitId))) { tSale.duplicates += 1; continue; }
    if (unitId && !unitIsNew) {
      // The unit was in the platform before this import. Creating the booking would normally move
      // the unit to booked/sold — that is a change to existing data, so it needs an explicit opt-in.
      if (!options.applyNewBookings) { tSale.rejected += 1; issue('warning', 'Bookings', null, 'Booking', `${s.unitKey} already exists in the platform, so its new booking was not imported (imports never change existing records). Turn on "Apply new bookings to existing units" to import it`); continue; }
      transitions.push({ unitId, status: s.status === 'Registered' ? 'sold' : 'booked', leadKey: s.leadKey });
    }
    const partner = s.brokerKey ? brokerIdByKey.get(s.brokerKey) : null;
    const booked = s.bookingDate ? new Date(s.bookingDate) : null;
    const doc = clean({
      organization: org, project: projectId, unit: unitId, lead: leadIdByKey.get(s.leadKey), salesPerson: userFor(s.closing) || actor._id, salePrice: s.salePrice, status: s.status || 'Booked',
      sourcingManager: userFor(s.sourcing), sourcingManagerName: nameFor(s.sourcing), closingManagerName: nameFor(s.closing), tokenAmount: s.tokenAmount, allInValue: s.allInValue, agreementValuePsf: s.agreementValuePsf,
      allInValuePsf: s.allInValuePsf, stampDuty: s.stampDuty, sourceType: s.sourceType, sourceName: s.sourceName, importKey: s.key, importBatch: batchId, createdAt: booked || now,
    });
    doc.costSheetSnapshot = s.costSheet && Object.keys(s.costSheet).length ? s.costSheet : { agreementValue: s.salePrice, source: 'import' };
    doc.bookingDate = booked; // stays empty when the register has no date — never defaulted to today
    if (s.brokerRatePct > 0) doc.commission = clean({ rate: s.brokerRatePct, amount: Math.round((s.salePrice * s.brokerRatePct) / 100) });
    if (hasValues(s.processTracker)) doc.processTracker = clean({ ...s.processTracker });
    if (hasValues(s.externalStatus)) doc.externalStatus = clean({ ...s.externalStatus });
    if (partner) doc.channelPartnerAttribution = { viaChannelPartner: true, partners: [{ channelPartner: partner, sharePct: 100 }], status: 'approved', taggedBy: actor._id, taggedAt: booked || now };
    saleDocs.push(doc);
  }
  if (!dryRun) {
    await insertChunked(Sale, saleDocs, tSale, issue, 'Bookings');
    for (const t of transitions) { await Unit.updateOne({ _id: t.unitId, status: { $in: ['available', 'blocked'] } }, { $set: { status: t.status } }); }
    if (transitions.length) issue('info', 'Bookings', null, 'Booking', `${transitions.length} existing units moved to booked / sold because a new booking was imported for them`);
  } else make(tSale, saleDocs.length);

  // ── 8. Tasks (checklists) ───────────────────────────────────────────────────────────
  const tasks = c.tasks || [];
  const tTask = tally('Tasks', tasks.length);
  const haveTask = new Set((await Task.find({ organization: org, importKey: { $in: tasks.map((t) => t.key) } }).select('importKey').lean()).map((t) => t.importKey));
  for (const t of tasks) {
    if (haveTask.has(t.key)) { tTask.duplicates += 1; continue; }
    if (!t.title) { tTask.rejected += 1; continue; }
    if (!dryRun) {
      const doneTask = /done|complete|closed/i.test(t.status || '');
      const owner = userFor(t.owner);
      try {
        await Task.create(clean({
          organization: org, title: String(t.title).slice(0, 300), description: [t.description, t.dueText ? `Due (as written in the source checklist): ${t.dueText}` : '', t.owner && !owner ? `Owner: ${t.owner}` : ''].filter(Boolean).join('\n'),
          category: t.category || 'General', status: doneTask ? 'Completed' : 'Open', priority: t.priority || 'Medium', assignedTo: owner, assignmentType: owner ? 'direct' : undefined,
          dueDate: t.dueDate ? new Date(t.dueDate) : undefined, createdBy: actor._id, importKey: t.key, importBatch: batchId,
        }));
        make(tTask);
      } catch (err) { if (err.code === 11000) tTask.duplicates += 1; else { tTask.rejected += 1; issue('warning', 'Tasks', null, 'Task', `A checklist item could not be saved: ${err.message.slice(0, 120)}`); } }
    } else make(tTask);
  }

  // ── 9. Project access for the accounts created here ─────────────────────────────────
  if (!dryRun && projectId) {
    const members = [...new Set([...importUsers.map(String), ...[...userByTeamKey.values()].filter(Boolean).map(String), String(actor._id)])];
    const have = new Set((await ProjectAssignment.find({ organization: org, project: projectId }).select('user').lean()).map((a) => String(a.user)));
    const docs = members.filter((u) => !have.has(u)).map((u) => ({ organization: org, user: u, project: projectId, assignedBy: actor._id, notes: 'Added by data import' }));
    if (docs.length) await ProjectAssignment.insertMany(docs, { ordered: false }).catch(() => {});
  }

  // ── Summary (plain numbers the UI can show; no personal data) ───────────────────────
  const by = (arr, f) => arr.reduce((m, x) => { const k = f(x) || '—'; m[k] = (m[k] || 0) + 1; return m; }, {});
  const summary = {
    project: projectName || null,
    towers: (c.towers || []).map((t) => ({ code: t.code, name: t.name, units: units.filter((u) => u.towerCode === t.code).length })),
    unitsByStatus: by(units, (u) => u.status), bookingsByStatus: by(sales, (s) => s.status), holdsByType: by(c.holds || [], (h) => h.type),
    bookedValue: sales.reduce((a, s) => a + (s.salePrice || 0), 0), holdValue: (c.holds || []).reduce((a, h) => a + (h.agreedValue || 0), 0),
    clientsByStatus: by(leads, (l) => l.status), clientsBySource: by(leads, (l) => l.source), meetingsByType: by(ints, (i) => i.type),
    unitsPriceEstimated: units.filter((u) => u.pricing?.estimated).length, fyTargets: c.project?.fyTargets || [],
  };

  onProgress('Done', 1, 1);
  return { counts: [...counts.values()].filter((t) => t.found || t.created || t.duplicates || t.rejected), accounts, projectId, summary };
}
