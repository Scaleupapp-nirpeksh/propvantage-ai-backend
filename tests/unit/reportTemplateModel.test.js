// File: tests/unit/reportTemplateModel.test.js
import mongoose from 'mongoose';
import ReportTemplate from '../../models/reportTemplateModel.js';

const validDoc = () => ({
  organization: new mongoose.Types.ObjectId(),
  name: 'Monthly Leadership Report',
});

describe('ReportTemplate model', () => {
  it('validates a minimal valid document', () => {
    const doc = new ReportTemplate(validDoc());
    expect(doc.validateSync()).toBeUndefined();
  });

  it('applies defaults', () => {
    const doc = new ReportTemplate(validDoc());
    expect(doc.status).toBe('active');
    expect(doc.delivery.mode).toBe('review_then_send');
    expect(doc.access.gate).toBe('email');
    expect(doc.access.expiresAfterDays).toBe(90);
    expect(doc.scope.period.preset).toBe('last_30d');
  });

  it('requires organization and name', () => {
    const doc = new ReportTemplate({});
    const err = doc.validateSync();
    expect(err.errors.organization).toBeDefined();
    expect(err.errors.name).toBeDefined();
  });

  it('rejects an invalid delivery mode', () => {
    const doc = new ReportTemplate({ ...validDoc(), delivery: { mode: 'nope' } });
    expect(doc.validateSync().errors['delivery.mode']).toBeDefined();
  });
});
