// tests/unit/workspaceLayoutModel.test.js
import mongoose from 'mongoose';
import WorkspaceLayout, { CARD_SIZES } from '../../models/workspaceLayoutModel.js';

const valid = (over = {}) => ({
  organization: new mongoose.Types.ObjectId(),
  userId: new mongoose.Types.ObjectId(),
  ...over,
});

describe('WorkspaceLayout model', () => {
  it('exports the three card sizes', () => {
    expect(CARD_SIZES).toEqual(['sm', 'md', 'lg']);
  });

  it('validates a minimal valid document with empty items', () => {
    const doc = new WorkspaceLayout(valid());
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.items).toEqual([]);
  });

  it('requires organization and userId', () => {
    const err = new WorkspaceLayout({}).validateSync();
    expect(err.errors.organization).toBeDefined();
    expect(err.errors.userId).toBeDefined();
  });

  it('validates an item with cardId + order and defaults size to md', () => {
    const doc = new WorkspaceLayout(valid({
      items: [{ cardId: new mongoose.Types.ObjectId(), order: 0 }],
    }));
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.items[0].size).toBe('md');
  });

  it('requires cardId on each item', () => {
    const doc = new WorkspaceLayout(valid({ items: [{ order: 0 }] }));
    expect(doc.validateSync().errors['items.0.cardId']).toBeDefined();
  });

  it('rejects an invalid item size', () => {
    const doc = new WorkspaceLayout(valid({
      items: [{ cardId: new mongoose.Types.ObjectId(), order: 0, size: 'xl' }],
    }));
    expect(doc.validateSync().errors['items.0.size']).toBeDefined();
  });

  it('declares a unique index on userId', () => {
    const userIndex = WorkspaceLayout.schema.indexes().find(
      ([keys]) => keys.userId === 1 && Object.keys(keys).length === 1
    );
    expect(userIndex).toBeDefined();
    expect(userIndex[1].unique).toBe(true);
  });
});
