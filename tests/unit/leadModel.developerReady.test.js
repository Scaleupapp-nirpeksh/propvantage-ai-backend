// tests/unit/leadModel.developerReady.test.js
import mongoose from 'mongoose';
import Lead from '../../models/leadModel.js';

const validLead = (over = {}) => ({
  organization: new mongoose.Types.ObjectId(),
  project: new mongoose.Types.ObjectId(),
  firstName: 'Asha',
  phone: '9876543210',
  ...over,
});

describe('Lead model — developer-ready refactor', () => {
  it('validates a minimal valid document', () => {
    expect(new Lead(validLead()).validateSync()).toBeUndefined();
  });
  it('defaults source to Direct and accepts the 6 new sources', () => {
    expect(new Lead(validLead()).source).toBe('Direct');
    ['Channel Partner', 'Management', 'Direct', 'Referral', 'Marketing', 'Cold Calling']
      .forEach((s) => expect(new Lead(validLead({ source: s })).validateSync()).toBeUndefined());
  });
  it('rejects a legacy source value', () => {
    expect(new Lead(validLead({ source: 'Walk-in' })).validateSync().errors.source).toBeDefined();
  });
  it('defaults budgetSource to self_funded and rejects legacy values', () => {
    expect(new Lead(validLead()).budget.budgetSource).toBe('self_funded');
    expect(new Lead(validLead({ budget: { budgetSource: 'pre_approved' } }))
      .validateSync().errors['budget.budgetSource']).toBeDefined();
  });
  it('uses the 4-level priority enum (no Critical)', () => {
    expect(new Lead(validLead({ priority: 'Critical' })).validateSync().errors.priority).toBeDefined();
    ['High', 'Medium', 'Low', 'Very Low']
      .forEach((p) => expect(new Lead(validLead({ priority: p })).validateSync()).toBeUndefined());
  });
  it('uses the new status set: accepts Revived, rejects removed statuses', () => {
    expect(new Lead(validLead({ status: 'Revived' })).validateSync()).toBeUndefined();
    ['Contacted', 'Site Visit Scheduled', 'Unqualified']
      .forEach((s) => expect(new Lead(validLead({ status: s })).validateSync().errors.status).toBeDefined());
  });
  it('drops the floor.specific path', () => {
    const doc = new Lead(validLead({ requirements: { floor: { preference: 'high', specific: 12 } } }));
    expect(doc.requirements.floor.preference).toBe('high');
    expect(doc.requirements.floor.specific).toBeUndefined();
  });
  it('derives priority from occupancy timeline via updatePriority()', () => {
    const hi = new Lead(validLead({ requirements: { timeline: 'immediate' } }));
    hi.updatePriority();
    expect(hi.priority).toBe('High');
    const lo = new Lead(validLead({ requirements: { timeline: '12+_months' } }));
    lo.updatePriority();
    expect(lo.priority).toBe('Very Low');
  });
  it('scoreStatus virtual no longer returns a temperature label', () => {
    const doc = new Lead(validLead({ score: 95 }));
    expect(['High', 'Medium', 'Low', 'Very Low']).toContain(doc.scoreStatus);
    expect(doc.scoreStatus).not.toMatch(/Lead/);
  });
  it('accepts the new + legacy follow-up types (superset incl. text)', () => {
    ['call', 'email', 'meeting', 'text', 'whatsapp', 'site_visit'].forEach((t) =>
      expect(new Lead(validLead({ followUpSchedule: { followUpType: t } })).validateSync()).toBeUndefined());
  });
  it('supports statusHistory and sourceDetail', () => {
    const doc = new Lead(validLead({
      statusHistory: [{ status: 'New' }],
      sourceDetail: { management: { contactName: 'Promoter A' } },
    }));
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.statusHistory[0].status).toBe('New');
    expect(doc.sourceDetail.management.contactName).toBe('Promoter A');
    expect(doc.statusHistory[0].changedBy).toBeNull();
    expect(new Lead(validLead()).revivedCount).toBe(0);
  });
});
