// tests/unit/taskSource.test.js
import mongoose from 'mongoose';
import Task from '../../models/taskModel.js';

const valid = (over = {}) => ({
  organization: new mongoose.Types.ObjectId(),
  title: 'A task',
  createdBy: new mongoose.Types.ObjectId(),
  ...over,
});

describe('Task.source segregation field', () => {
  it("defaults source to 'internal'", () => {
    const doc = new Task(valid());
    expect(doc.source).toBe('internal');
  });

  it("accepts 'support_ticket'", () => {
    const doc = new Task(valid({ source: 'support_ticket' }));
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.source).toBe('support_ticket');
  });

  it('rejects an unknown source', () => {
    const err = new Task(valid({ source: 'whatever' })).validateSync();
    expect(err.errors.source).toBeDefined();
  });

  it("accepts 'SupportTicket' as a linkedEntity type", () => {
    const doc = new Task(
      valid({
        linkedEntity: { entityType: 'SupportTicket', entityId: new mongoose.Types.ObjectId() },
      })
    );
    expect(doc.validateSync()).toBeUndefined();
  });
});
