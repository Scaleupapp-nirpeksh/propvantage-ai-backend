// Sales Intelligence over an imported synthetic organisation (in-memory Mongo).
import { jest } from '@jest/globals';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
const { default: Organization } = await import('../../models/organizationModel.js');
const { default: User } = await import('../../models/userModel.js');
const { seedDefaultRoles } = await import('../../data/defaultRoles.js');
const { runImport } = await import('../../services/import/importService.js');
const { getSalesIntelligence, fyOf } = await import('../../services/analytics/salesIntelligenceService.js');
const { misWorkbook, stackingWorkbook } = await import('./helpers/importWorkbooks.js');

jest.setTimeout(120000);
let mongod; let org; let data;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create(); await mongoose.connect(mongod.getUri());
  org = await Organization.create({ name: 'Insight Test Developers', country: 'India', city: 'Mumbai', type: 'builder' });
  const owner = await User.create({ organization: org._id, firstName: 'Admin', lastName: 'Owner', email: 'owner@insight-dev.test', password: 'Demo@1234', role: 'Business Head', isActive: true, invitationStatus: 'accepted' });
  await seedDefaultRoles(org._id, owner._id);
  await runImport({ files: [{ name: 'mis.xlsx', buffer: await misWorkbook() }, { name: 'stack.xlsx', buffer: await stackingWorkbook() }], mode: 'commit', options: { projectName: 'Alpha Residences', emailDomain: 'insight-dev.test', defaultPassword: 'Demo@1234' }, organizationId: org._id, actor: owner, background: false });
  data = await getSalesIntelligence({ organizationId: org._id });
});
afterAll(async () => { await mongoose.disconnect(); await mongod.stop(); });

describe('sales intelligence', () => {
  test('financial years follow the April–March convention', () => {
    expect(fyOf('2025-04-01T00:00:00Z')).toBe('FY2026'); expect(fyOf('2026-03-31T00:00:00Z')).toBe('FY2026'); expect(fyOf('2026-04-01T00:00:00Z')).toBe('FY2027');
  });

  test('inventory adds up and absorption counts everything that is not available', () => {
    const t = data.inventory.totals;
    expect(t.total).toBe(5); expect(t.available + t.blocked + t.booked + t.sold).toBe(5); expect(t.absorptionPct).toBe(60);
    expect(data.inventory.byTower.reduce((a, x) => a + x.total, 0)).toBe(5);
  });

  test('bookings, holds and sources are reported; an apartment on hold is never counted as a booking', () => {
    expect(data.velocity.byFy.reduce((a, f) => a + f.bookings, 0)).toBe(2);
    expect(data.holds.total).toBe(1); expect(data.holds.byType[0]).toMatchObject({ type: 'EOI', count: 1, withToken: 1 });
    expect(data.sources.find((x) => x.source === 'Channel Partner').bookings).toBe(1);
    expect(data.channelPartners.top[0]).toMatchObject({ firm: 'Acme Realtors', bookings: 1 });
  });

  test('the monthly series is calendar-true (no skipped months)', () => {
    const m = data.velocity.months.map((x) => x.month);
    expect(m[0]).toBe('2024-05'); expect(m[1]).toBe('2024-06');
    const next = (k) => { const [y, mo] = k.split('-').map(Number); return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`; };
    for (let i = 1; i < m.length; i += 1) expect(m[i]).toBe(next(m[i - 1]));
  });

  test('carries no client names or contact details', () => {
    const blob = JSON.stringify(data);
    for (const needle of ['Rahul', 'Verma', 'Anita', 'Desai', 'Vikram', 'ABCDE1234F', '9876543210']) expect(blob).not.toContain(needle);
  });

  test('another organisation sees nothing of this one', async () => {
    const other = await Organization.create({ name: 'Someone Else Builders', country: 'India', city: 'Pune', type: 'builder' });
    const d = await getSalesIntelligence({ organizationId: other._id });
    expect(d.inventory.totals.total).toBe(0); expect(d.team).toHaveLength(0); expect(d.headlines.every((h) => !/Acme/.test(h.detail))).toBe(true);
  });
});
