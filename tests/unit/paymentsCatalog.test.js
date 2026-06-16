// tests/unit/paymentsCatalog.test.js
import mongoose from 'mongoose';
import paymentsCatalog from '../../services/workspace/catalogs/paymentsCatalog.js';

const field = (key) => paymentsCatalog.fields.find((f) => f.key === key);
const viewerCtx = { organization: new mongoose.Types.ObjectId(), userId: new mongoose.Types.ObjectId(), accessibleProjectIds: [], isOwner: true, permissions: [] };

describe('paymentsCatalog', () => {
  it('module=payments, baseModel=PaymentTransaction', () => {
    expect(paymentsCatalog.module).toBe('payments');
    expect(paymentsCatalog.baseModel).toBe('PaymentTransaction');
  });

  it('status enum mirrors the PaymentTransaction model', () => {
    expect(field('status').enumValues).toEqual(
      ['pending', 'processing', 'completed', 'cleared', 'bounced', 'cancelled', 'refunded']
    );
  });

  it('paymentMethod enum mirrors the model', () => {
    expect(field('paymentMethod').enumValues).toEqual(
      ['cash', 'cheque', 'bank_transfer', 'online_payment', 'card_payment', 'demand_draft', 'home_loan']
    );
  });

  describe('toMatch', () => {
    it('status in → $in', () => {
      expect(field('status').toMatch('in', ['pending', 'processing'], viewerCtx))
        .toEqual({ status: { $in: ['pending', 'processing'] } });
    });
    it('paymentMethod is → equality', () => {
      expect(field('paymentMethod').toMatch('is', 'cheque', viewerCtx)).toEqual({ paymentMethod: 'cheque' });
    });
    it('amount gte → $gte (coerced)', () => {
      expect(field('amount').toMatch('gte', '250000', viewerCtx)).toEqual({ amount: { $gte: 250000 } });
    });
    it('paymentDate lastNDays → $gte cutoff Date', () => {
      const frag = field('paymentDate').toMatch('lastNDays', 7, viewerCtx);
      expect(frag.paymentDate.$gte).toBeInstanceOf(Date);
    });
  });

  describe('derived daysOverdue', () => {
    const f = () => field('daysOverdue');
    it('is derived and number-typed', () => {
      expect(f().derived).toBe(true);
      expect(f().type).toBe('number');
    });
    it('addFields() computes 0 for settled payments, else days since paymentDate', () => {
      const stage = f().addFields();
      const expr = stage.$addFields.daysOverdue;
      expect(expr).toHaveProperty('$cond');
      // settled branch (then) is 0
      expect(expr.$cond.then).toBe(0);
      // unsettled branch (else) is a day diff from paymentDate
      expect(expr.$cond.else.$dateDiff).toMatchObject({ startDate: '$paymentDate', unit: 'day' });
    });
    it('toMatch operates on the derived key', () => {
      expect(f().toMatch('gt', 0, viewerCtx)).toEqual({ daysOverdue: { $gt: 0 } });
    });
  });

  it('scope narrows to accessible projects for non-owners', () => {
    const a = new mongoose.Types.ObjectId();
    const ctx = { ...viewerCtx, isOwner: false, accessibleProjectIds: [a.toString()] };
    expect(paymentsCatalog.scope(ctx)).toEqual({
      organization: ctx.organization,
      project: { $in: [new mongoose.Types.ObjectId(a.toString())] },
    });
  });
});
