// tests/unit/supportInboxModel.test.js
import mongoose from 'mongoose';
import SupportInbox from '../../models/supportInboxModel.js';

const valid = (over = {}) => ({
  organization: new mongoose.Types.ObjectId(),
  address: 'help@helpdesk.example.com',
  ...over,
});

describe('SupportInbox model', () => {
  it('validates a minimal valid document', () => {
    expect(new SupportInbox(valid()).validateSync()).toBeUndefined();
  });

  it('requires organization and address', () => {
    const err = new SupportInbox({}).validateSync();
    expect(err.errors.organization).toBeDefined();
    expect(err.errors.address).toBeDefined();
  });

  it('lowercases + trims the address', () => {
    const doc = new SupportInbox(valid({ address: '  25South@HelpDesk.Example.COM  ' }));
    expect(doc.address).toBe('25south@helpdesk.example.com');
  });

  it('defaults active to true', () => {
    expect(new SupportInbox(valid()).active).toBe(true);
  });

  it('declares a unique index on address', () => {
    const idx = SupportInbox.schema.indexes();
    const addressUnique = idx.some(
      ([fields, opts]) => fields.address === 1 && opts && opts.unique === true
    );
    // `unique: true` on the path also registers a unique index.
    const pathUnique = SupportInbox.schema.path('address').options.unique === true;
    expect(addressUnique || pathUnique).toBe(true);
  });
});
