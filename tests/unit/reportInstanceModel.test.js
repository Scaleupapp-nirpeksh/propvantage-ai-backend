// File: tests/unit/reportInstanceModel.test.js
import mongoose from 'mongoose';
import ReportInstance from '../../models/reportInstanceModel.js';

const validDoc = () => ({
  organization: new mongoose.Types.ObjectId(),
  title: 'Monthly Leadership Report — May 2026',
});

describe('ReportInstance model', () => {
  it('validates a minimal valid document', () => {
    expect(new ReportInstance(validDoc()).validateSync()).toBeUndefined();
  });

  it('defaults review and distribution status and stats', () => {
    const doc = new ReportInstance(validDoc());
    expect(doc.review.status).toBe('draft');
    expect(doc.distribution.status).toBe('not_sent');
    expect(doc.stats.totalViews).toBe(0);
    expect(doc.gate).toBe('email');
  });

  it('requires organization', () => {
    expect(new ReportInstance({ title: 'x' }).validateSync().errors.organization).toBeDefined();
  });

  it('stores frozen block data as mixed', () => {
    const doc = new ReportInstance({
      ...validDoc(),
      blocks: [{ id: 'b1', type: 'kpi.revenue', order: 0, data: { value: 1234, unit: 'currency' } }],
    });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.blocks[0].data.value).toBe(1234);
  });
});
