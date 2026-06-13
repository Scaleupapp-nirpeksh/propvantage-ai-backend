// File: tests/unit/reportController.test.js
import { getCatalog } from '../../controllers/reportController.js';

const mockRes = () => {
  const res = {};
  res.json = (payload) => { res._json = payload; return res; };
  res.status = (code) => { res._status = code; return res; };
  return res;
};

describe('reportController.getCatalog', () => {
  it('returns the permission-filtered catalog as { success, data }', async () => {
    const req = { userPermissions: ['analytics:advanced'], isOwner: false };
    const res = mockRes();
    await getCatalog(req, res, () => {});
    expect(res._json.success).toBe(true);
    expect(Array.isArray(res._json.data)).toBe(true);
    expect(res._json.data.find((b) => b.type === 'kpi.revenue')).toBeDefined();
    // metadata only — no resolve functions leak to the client
    expect(res._json.data.every((b) => b.resolve === undefined)).toBe(true);
  });

  it('hides gated blocks when the user lacks the permission', async () => {
    const req = { userPermissions: [], isOwner: false };
    const res = mockRes();
    await getCatalog(req, res, () => {});
    expect(res._json.data.find((b) => b.type === 'kpi.revenue')).toBeUndefined();
    expect(res._json.data.find((b) => b.type === 'layout.hero')).toBeDefined();
  });
});
