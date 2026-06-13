// File: tests/unit/reportViewModel.test.js
import mongoose from 'mongoose';
import ReportView from '../../models/reportViewModel.js';

const validDoc = () => ({
  organization: new mongoose.Types.ObjectId(),
  reportInstance: new mongoose.Types.ObjectId(),
  publicSlug: 'abc123',
  email: 'investor@example.com',
});

describe('ReportView model', () => {
  it('validates a minimal valid document', () => {
    expect(new ReportView(validDoc()).validateSync()).toBeUndefined();
  });

  it('defaults viewCount to 1 and isForwarded to false', () => {
    const doc = new ReportView(validDoc());
    expect(doc.viewCount).toBe(1);
    expect(doc.isForwarded).toBe(false);
  });

  it('requires organization, reportInstance and email', () => {
    const err = new ReportView({}).validateSync();
    expect(err.errors.organization).toBeDefined();
    expect(err.errors.reportInstance).toBeDefined();
    expect(err.errors.email).toBeDefined();
  });
});
