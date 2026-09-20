// Format adapters against small synthetic workbooks built in memory (fictional people only).
import ExcelJS from 'exceljs';
import { parseFiles } from '../../services/import/parse.js';
import { misWorkbook, stackingWorkbook } from './helpers/importWorkbooks.js';

describe('import · developer MIS adapter', () => {
  let c; let files;
  beforeAll(async () => { ({ canonical: c, files } = await parseFiles([{ name: 'mis.xlsx', buffer: await misWorkbook() }])); });

  test('is recognised', () => { expect(files[0].format).toBe('developer_mis'); });

  test('units: tower-prefixed numbers, statuses, service levels skipped', () => {
    expect(c.units.map((u) => u.key).sort()).toEqual(['T1-101', 'T1-102', 'T1-201 & 202', 'T1-301']);
    const st = Object.fromEntries(c.units.map((u) => [u.key, u.status]));
    expect(st).toEqual({ 'T1-101': 'booked', 'T1-102': 'sold', 'T1-201 & 202': 'blocked', 'T1-301': 'available' });
    expect(c.issues.some((i) => /service level/.test(i.message))).toBe(true);
  });

  test('sold / registered rows become bookings; EOI becomes a hold, never a sale', () => {
    expect(c.sales.map((s) => `${s.unitKey}:${s.status}`).sort()).toEqual(['T1-101:Booked', 'T1-102:Registered']);
    expect(c.holds).toHaveLength(1);
    expect(c.holds[0]).toMatchObject({ unitKey: 'T1-201 & 202', type: 'EOI', tokenAmount: 1000000 });
  });

  test('client KYC: PAN kept, Aadhaar reduced to last four, phone normalised', () => {
    const l = c.leads.find((x) => x.key === 'rahul verma');
    expect(l.kyc.pan).toBe('ABCDE1234F'); expect(l.kyc.aadhaarLast4).toBe('9012');
    expect(JSON.stringify(l)).not.toMatch(/123456789012|1234 5678 9012/);
    expect(l.phone).toBe('+919876543210'); expect(l.status).toBe('Booked'); expect(l.source).toBe('Channel Partner');
  });

  test('the same client in the register and the meeting log is one client', () => {
    expect(c.leads.filter((x) => x.key === 'rahul verma')).toHaveLength(1);
    expect(c.interactions.filter((i) => i.leadKey === 'rahul verma')).toHaveLength(1);
  });

  test('meeting types map to interaction types', () => {
    const types = c.interactions.map((i) => i.type).sort();
    expect(types).toEqual(['Meeting', 'Site Visit', 'Video Call']);
  });

  test('channel partner and price-less unit handling', () => {
    expect(c.brokers.map((b) => b.firmName)).toEqual(['Acme Realtors']);
    const unsold = c.units.find((u) => u.key === 'T1-301');
    expect(unsold.currentPrice).toBeGreaterThan(0); expect(unsold.pricing.estimated).toBe(true);
  });

  test('team: closing manager named on three deals is a team member', () => {
    expect(c.team.map((t) => t.name)).toContain('Meera Shah');
  });
});

describe('import · stacking sheet + register together', () => {
  test('grid cells already in the register (incl. halves of a combined apartment) are not created twice', async () => {
    const { canonical: c, files } = await parseFiles([{ name: 'stack.xlsx', buffer: await stackingWorkbook() }, { name: 'mis.xlsx', buffer: await misWorkbook() }]);
    expect(files.map((f) => f.format).sort()).toEqual(['developer_mis', 'stacking_sheet']);
    const keys = c.units.map((u) => u.key).sort();
    expect(keys).toEqual(['T1-101', 'T1-102', 'T1-201 & 202', 'T1-301', 'T1-302']);
    expect(c.units.find((u) => u.key === 'T1-101').facing).toBe('North');
  });

  test('an unknown workbook is reported, not guessed at', async () => {
    const wb = new ExcelJS.Workbook(); wb.addWorksheet('Random').addRow(['hello', 'world']);
    const { canonical: c, files } = await parseFiles([{ name: 'odd.xlsx', buffer: Buffer.from(await wb.xlsx.writeBuffer()) }]);
    expect(files[0].format).toBe('unrecognised');
    expect(c.issues.some((i) => i.severity === 'error')).toBe(true);
  });
});
