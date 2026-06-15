// tests/unit/amenityModel.test.js
import mongoose from 'mongoose';
import Amenity from '../../models/amenityModel.js';

const valid = (over = {}) => ({
  organization: new mongoose.Types.ObjectId(),
  name: 'Swimming Pool',
  ...over,
});

describe('Amenity model', () => {
  it('validates a minimal valid document', () => {
    expect(new Amenity(valid()).validateSync()).toBeUndefined();
  });
  it('requires organization and name', () => {
    const err = new Amenity({}).validateSync();
    expect(err.errors.organization).toBeDefined();
    expect(err.errors.name).toBeDefined();
  });
  it('defaults usageCount to 0 and createdBy to null', () => {
    const doc = new Amenity(valid());
    expect(doc.usageCount).toBe(0);
    expect(doc.createdBy).toBeNull();
  });
  it('trims the display name', () => {
    const doc = new Amenity(valid({ name: '  Gym  ' }));
    expect(doc.name).toBe('Gym');
  });
});
