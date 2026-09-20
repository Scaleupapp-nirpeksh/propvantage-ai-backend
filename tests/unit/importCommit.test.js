// The import, end to end, against an in-memory Mongo: insert-only, no duplicates on
// re-import, no edits to what already exists, other organisations untouched.
import { jest } from '@jest/globals';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');

const { default: Organization } = await import('../../models/organizationModel.js');
const { default: User } = await import('../../models/userModel.js');
const { default: Project } = await import('../../models/projectModel.js');
const { default: Unit } = await import('../../models/unitModel.js');
const { default: Lead } = await import('../../models/leadModel.js');
const { default: Sale } = await import('../../models/salesModel.js');
const { default: Interaction } = await import('../../models/interactionModel.js');
const { default: ChannelPartner } = await import('../../models/channelPartnerModel.js');
const { default: ImportBatch } = await import('../../models/importBatchModel.js');
const { seedDefaultRoles } = await import('../../data/defaultRoles.js');
const { runImport } = await import('../../services/import/importService.js');
const { migrateSaleUnitIndex } = await import('../../utils/ensureIndexes.js');
const { misWorkbook, stackingWorkbook } = await import('./helpers/importWorkbooks.js');

jest.setTimeout(120000);

let mongod; let org; let owner; let other; let files;
const OPTIONS = { emailDomain: 'example-dev.test', defaultPassword: 'Demo@1234', projectName: 'Alpha Residences' };

async function makeOrg(name, email) {
  const o = await Organization.create({ name, country: 'India', city: 'Mumbai', type: 'builder' });
  const u = await User.create({ organization: o._id, firstName: 'Admin', lastName: 'Owner', email, password: 'Demo@1234', role: 'Business Head', isActive: true, invitationStatus: 'accepted' });
  const roles = await seedDefaultRoles(o._id, u._id);
  u.roleRef = roles.find((r) => r.isOwnerRole)._id; await u.save({ validateBeforeSave: false });
  return { o, u };
}

const fingerprint = async (orgId) => {
  const out = {};
  for (const [n, M] of Object.entries({ Project, Unit, Lead, Sale, Interaction, ChannelPartner, User })) {
    const rows = await M.collection.find({ organization: orgId }).sort({ _id: 1 }).toArray();
    out[n] = crypto.createHash('md5').update(JSON.stringify(rows)).digest('hex');
  }
  return out;
};

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  for (const M of [Sale, Lead, Unit, Interaction, ChannelPartner, User]) await M.init();
  ({ o: org, u: owner } = await makeOrg('Importer Test Developers', 'owner@example-dev.test'));
  other = await makeOrg('Existing Demo Builders', 'owner@demo-builders.test');
  // Old-shape data in another organisation (no import fields at all) — must keep working untouched.
  const p = await Project.create({ organization: other.o._id, name: 'Demo Heights', type: 'apartment', status: 'launched', location: { city: 'Pune', area: 'Baner' }, totalUnits: 2, priceRange: { min: 1, max: 2 }, targetRevenue: 10 });
  const un = await Unit.create({ organization: other.o._id, project: p._id, unitNumber: 'T1-101', type: '2BHK', floor: 1, areaSqft: 900, basePrice: 9000000, currentPrice: 9000000, status: 'sold' });
  const l = await Lead.create({ organization: other.o._id, project: p._id, firstName: 'Demo', lastName: 'Buyer', phone: '+919999999999', source: 'Direct', status: 'Booked' });
  await Sale.create({ organization: other.o._id, project: p._id, unit: un._id, lead: l._id, salesPerson: other.u._id, salePrice: 9000000, costSheetSnapshot: { a: 1 } });
  files = [{ name: 'mis.xlsx', buffer: await misWorkbook() }, { name: 'stack.xlsx', buffer: await stackingWorkbook() }];
});

afterAll(async () => { await mongoose.disconnect(); await mongod.stop(); });

describe('import · validate, import, re-import', () => {
  let otherBefore;

  test('validate (dry run) reports what would be created and writes nothing', async () => {
    otherBefore = await fingerprint(other.o._id);
    const b = await runImport({ files, mode: 'dry_run', options: OPTIONS, organizationId: org._id, actor: owner });
    expect(b.status).toBe('validated');
    const n = Object.fromEntries(b.counts.map((x) => [x.entity, x]));
    expect(n.Units.created).toBe(5); expect(n.Bookings.created).toBe(2); expect(n['Holds (EOI / blocked)'].created).toBe(1);
    expect(await Unit.countDocuments({ organization: org._id })).toBe(0);
    expect(await Lead.countDocuments({ organization: org._id })).toBe(0);
    expect(await User.countDocuments({ organization: org._id })).toBe(1);
  });

  test('import creates the project, inventory, clients, bookings, accounts', async () => {
    const b = await runImport({ files, mode: 'commit', options: OPTIONS, organizationId: org._id, actor: owner, background: false });
    expect(b.status).toBe('completed'); expect(b.error).toBeFalsy();
    const project = await Project.findOne({ organization: org._id });
    expect(project.name).toBe('Alpha Residences');
    expect(await Unit.countDocuments({ organization: org._id })).toBe(5);
    expect(await Sale.countDocuments({ organization: org._id })).toBe(2);
    expect(await Interaction.countDocuments({ organization: org._id })).toBe(3);
    expect(await ChannelPartner.countDocuments({ organization: org._id })).toBe(1);

    const held = await Unit.findOne({ organization: org._id, 'hold.type': 'EOI' });
    expect(held.status).toBe('blocked'); expect(held.hold.lead).toBeTruthy(); expect(held.hold.tokenAmount).toBe(1000000);

    const sale = await Sale.findOne({ organization: org._id, status: 'Booked' }).populate('salesPerson', 'email');
    expect(sale.salesPerson.email).toBe('meera.shah@example-dev.test');
    expect(sale.commission.rate).toBe(2); expect(sale.channelPartnerAttribution.viaChannelPartner).toBe(true);
    expect(sale.createdAt.toISOString().slice(0, 10)).toBe('2024-05-10'); // history is back-dated, not stamped today
  });

  test('accounts: real team members + a placeholder for every unfilled role; passwords work and are never stored in history', async () => {
    const meera = await User.findOne({ email: 'meera.shah@example-dev.test' }).select('+password').populate('roleRef', 'name');
    expect(meera.isActive).toBe(true); expect(meera.roleRef.name).toBe('Sales Manager'); expect(await meera.matchPassword('Demo@1234')).toBe(true);
    const bh = await User.findOne({ email: 'businesshead.testrole@example-dev.test' }).populate('roleRef', 'name');
    expect(`${bh.firstName} ${bh.lastName}`).toBe('BusinessHead TestRole'); expect(bh.roleRef.name).toBe('Business Head');
    expect(JSON.stringify(await ImportBatch.find({}).lean())).not.toContain('Demo@1234');
  });

  test('PAN is encrypted at rest and readable through the model; Aadhaar is last-four only', async () => {
    const raw = await Lead.collection.findOne({ organization: org._id, 'kyc.pan': { $exists: true } });
    expect(raw.kyc.pan).not.toBe('ABCDE1234F'); expect(raw.kyc.aadhaarLast4).toBe('9012');
    expect(JSON.stringify(raw)).not.toMatch(/123456789012/);
    expect((await Lead.findById(raw._id)).kyc.pan).toBe('ABCDE1234F');
  });

  test('importing the same files again creates nothing and changes nothing', async () => {
    const before = await fingerprint(org._id);
    const b = await runImport({ files, mode: 'commit', options: OPTIONS, organizationId: org._id, actor: owner, background: false });
    expect(b.counts.reduce((a, x) => a + x.created, 0)).toBe(0);
    expect(b.counts.find((x) => x.entity === 'Units').duplicates).toBe(5);
    expect(await fingerprint(org._id)).toEqual(before);
  });

  test('records edited in the platform are never overwritten by a later import', async () => {
    await Unit.updateOne({ organization: org._id, unitNumber: 'T1-301' }, { $set: { currentPrice: 12345678, remarks: 'edited by a user' } });
    await runImport({ files, mode: 'commit', options: OPTIONS, organizationId: org._id, actor: owner, background: false });
    const u = await Unit.findOne({ organization: org._id, unitNumber: 'T1-301' });
    expect(u.currentPrice).toBe(12345678); expect(u.remarks).toBe('edited by a user');
  });

  test('a new booking for an apartment that already exists is held back unless explicitly allowed', async () => {
    await Sale.deleteMany({ organization: org._id, status: 'Registered' });
    await Unit.updateOne({ organization: org._id, unitNumber: 'T1-102' }, { $set: { status: 'available' } });
    let b = await runImport({ files, mode: 'commit', options: OPTIONS, organizationId: org._id, actor: owner, background: false });
    expect(b.counts.find((x) => x.entity === 'Bookings').rejected).toBe(1);
    expect((await Unit.findOne({ organization: org._id, unitNumber: 'T1-102' })).status).toBe('available');
    b = await runImport({ files, mode: 'commit', options: { ...OPTIONS, applyNewBookings: true }, organizationId: org._id, actor: owner, background: false });
    expect(b.counts.find((x) => x.entity === 'Bookings').created).toBe(1);
    expect((await Unit.findOne({ organization: org._id, unitNumber: 'T1-102' })).status).toBe('sold');
  });

  test('another organisation — same unit numbers, old-shape records — is untouched', async () => {
    expect(await fingerprint(other.o._id)).toEqual(otherBefore);
    expect(await Lead.countDocuments({ organization: other.o._id })).toBe(1);
  });

  test('every run is kept in the import history', async () => {
    const rows = await ImportBatch.find({ organization: org._id }).sort({ createdAt: 1 }).lean();
    expect(rows.length).toBeGreaterThanOrEqual(5);
    expect(rows[0].mode).toBe('dry_run'); expect(rows[1].mode).toBe('commit');
    expect(rows[1].files.map((f) => f.format).sort()).toEqual(['developer_mis', 'stacking_sheet']);
    expect(rows[1].files[0].sha256).toHaveLength(64);
  });
});

describe('sales · one live booking per apartment', () => {
  test('a cancelled booking frees the apartment; two live bookings are still refused', async () => {
    const s = await Sale.findOne({ organization: other.o._id }); s.status = 'Cancelled'; await s.save();
    const base = { organization: other.o._id, project: s.project, unit: s.unit, lead: s.lead, salesPerson: other.u._id, costSheetSnapshot: {} };
    await expect(Sale.create({ ...base, salePrice: 2 })).resolves.toBeTruthy();
    await expect(Sale.create({ ...base, salePrice: 3 })).rejects.toMatchObject({ code: 11000 });
  });

  test('the legacy global unique index is replaced safely (as it will be on the live database)', async () => {
    const names = async () => (await Sale.collection.indexes()).map((i) => i.name);
    // Recreate the pre-migration state: only the old global unique index on `unit`.
    await Sale.deleteMany({});
    await Sale.collection.dropIndex('unit_active_unique');
    await Sale.collection.createIndex({ unit: 1 }, { name: 'unit_1', unique: true });
    expect(await names()).toContain('unit_1');
    expect(await migrateSaleUnitIndex()).toBe('migrated');
    expect(await names()).toContain('unit_active_unique'); expect(await names()).not.toContain('unit_1');
    expect(await migrateSaleUnitIndex()).toBe('already-migrated');
  });
});
