// tests/unit/salesCatalog.test.js
import mongoose from 'mongoose';
import salesCatalog from '../../services/workspace/catalogs/salesCatalog.js';

const field = (key) => salesCatalog.fields.find((f) => f.key === key);
const viewerCtx = { organization: new mongoose.Types.ObjectId(), userId: new mongoose.Types.ObjectId(), accessibleProjectIds: [], isOwner: true, permissions: [] };

describe('salesCatalog', () => {
  it('declares module=sales, label, and baseModel=Sale', () => {
    expect(salesCatalog.module).toBe('sales');
    expect(salesCatalog.label).toBe('Sales / Bookings');
    expect(salesCatalog.baseModel).toBe('Sale');
  });

  it('exposes status as an enum mirroring the Sale model', () => {
    const f = field('status');
    expect(f.type).toBe('enum');
    expect(f.enumValues).toEqual(['Pending Approval', 'Booked', 'Agreement Signed', 'Registered', 'Completed', 'Cancelled']);
    expect(f.operators).toEqual(expect.arrayContaining(['is', 'in', 'notIn']));
  });

  describe('toMatch', () => {
    it('status is → equality', () => {
      expect(field('status').toMatch('is', 'Booked', viewerCtx)).toEqual({ status: 'Booked' });
    });
    it('status in → $in', () => {
      expect(field('status').toMatch('in', ['Booked', 'Registered'], viewerCtx))
        .toEqual({ status: { $in: ['Booked', 'Registered'] } });
    });
    it('status notIn → $nin', () => {
      expect(field('status').toMatch('notIn', ['Cancelled'], viewerCtx))
        .toEqual({ status: { $nin: ['Cancelled'] } });
    });
    it('salePrice gte → $gte (number coerced)', () => {
      expect(field('salePrice').toMatch('gte', '5000000', viewerCtx)).toEqual({ salePrice: { $gte: 5000000 } });
    });
    it('salePrice between → $gte/$lte', () => {
      expect(field('salePrice').toMatch('between', [1000000, 5000000], viewerCtx))
        .toEqual({ salePrice: { $gte: 1000000, $lte: 5000000 } });
    });
    it('bookingDate lastNDays → $gte a cutoff Date', () => {
      const frag = field('bookingDate').toMatch('lastNDays', 30, viewerCtx);
      expect(frag.bookingDate.$gte).toBeInstanceOf(Date);
      const ageMs = Date.now() - frag.bookingDate.$gte.getTime();
      expect(ageMs).toBeGreaterThanOrEqual(29 * 86400000);
      expect(ageMs).toBeLessThanOrEqual(31 * 86400000);
    });
    it('channelPartner is → ObjectId-cast equality', () => {
      const id = new mongoose.Types.ObjectId();
      expect(field('channelPartner').toMatch('is', id.toString(), viewerCtx))
        .toEqual({ channelPartner: new mongoose.Types.ObjectId(id.toString()) });
    });
    it('channelPartner isNotEmpty → $ne null', () => {
      expect(field('channelPartner').toMatch('isNotEmpty', null, viewerCtx))
        .toEqual({ channelPartner: { $ne: null } });
    });
  });

  describe('derived daysInCurrentStatus', () => {
    const f = () => field('daysInCurrentStatus');
    it('is derived and number-typed', () => {
      expect(f().derived).toBe(true);
      expect(f().type).toBe('number');
    });
    it('addFields() emits a $addFields stage computing whole days since updatedAt', () => {
      const stage = f().addFields();
      expect(stage).toHaveProperty('$addFields.daysInCurrentStatus');
      const expr = stage.$addFields.daysInCurrentStatus;
      expect(expr.$dateDiff).toMatchObject({ startDate: '$updatedAt', unit: 'day' });
    });
    it('toMatch operates on the derived key', () => {
      expect(f().toMatch('gte', 15, viewerCtx)).toEqual({ daysInCurrentStatus: { $gte: 15 } });
    });
  });

  it('scope(viewerCtx) returns org match for an owner (no project narrowing)', () => {
    expect(salesCatalog.scope(viewerCtx)).toEqual({ organization: viewerCtx.organization });
  });

  it('scope(viewerCtx) narrows to accessible projects for a non-owner', () => {
    const a = new mongoose.Types.ObjectId();
    const ctx = { ...viewerCtx, isOwner: false, accessibleProjectIds: [a.toString()] };
    expect(salesCatalog.scope(ctx)).toEqual({
      organization: ctx.organization,
      project: { $in: [new mongoose.Types.ObjectId(a.toString())] },
    });
  });
});
