// tests/unit/supportTicketsCatalog.test.js
import mongoose from 'mongoose';
import supportTicketsCatalog from '../../services/workspace/catalogs/supportTicketsCatalog.js';
import {
  TICKET_STATUSES,
  TICKET_PRIORITIES,
  TICKET_CATEGORIES,
} from '../../models/supportTicketModel.js';

const field = (key) => supportTicketsCatalog.fields.find((f) => f.key === key);
const userId = new mongoose.Types.ObjectId();
const viewerCtx = {
  organization: new mongoose.Types.ObjectId(),
  userId,
  accessibleProjectIds: null,
  isOwner: true,
  permissions: [],
};

describe('supportTicketsCatalog', () => {
  it('module=supportTickets, baseModel=SupportTicket, label set', () => {
    expect(supportTicketsCatalog.module).toBe('supportTickets');
    expect(supportTicketsCatalog.label).toBe('Support Tickets');
    expect(supportTicketsCatalog.baseModel).toBe('SupportTicket');
  });

  it('status/category/priority enums are sourced from the SupportTicket model', () => {
    expect(field('status').enumValues).toEqual(TICKET_STATUSES);
    expect(field('category').enumValues).toEqual(TICKET_CATEGORIES);
    expect(field('priority').enumValues).toEqual(TICKET_PRIORITIES);
  });

  it('expected status values are present', () => {
    expect(field('status').enumValues).toEqual([
      'new', 'assigned', 'in_progress', 'waiting_on_client', 'resolved', 'closed',
    ]);
  });

  it('expected category values are present', () => {
    expect(field('category').enumValues).toEqual(['sales', 'legal', 'crm', 'finance', 'other']);
  });

  describe('toMatch — string fields', () => {
    it('displayId contains → case-insensitive regex on displayId', () => {
      expect(field('displayId').toMatch('contains', 'TKT-0004', viewerCtx))
        .toEqual({ displayId: { $regex: 'TKT-0004', $options: 'i' } });
    });
    it('displayId is → equality on displayId', () => {
      expect(field('displayId').toMatch('is', 'TKT-000412', viewerCtx))
        .toEqual({ displayId: 'TKT-000412' });
    });
    it('subject contains → regex on subject', () => {
      expect(field('subject').toMatch('contains', 'refund', viewerCtx))
        .toEqual({ subject: { $regex: 'refund', $options: 'i' } });
    });
  });

  describe('toMatch — enum fields', () => {
    it('status is → equality', () => {
      expect(field('status').toMatch('is', 'new', viewerCtx)).toEqual({ status: 'new' });
    });
    it('status in → $in', () => {
      expect(field('status').toMatch('in', ['new', 'assigned'], viewerCtx))
        .toEqual({ status: { $in: ['new', 'assigned'] } });
    });
    it('category notIn → $nin', () => {
      expect(field('category').toMatch('notIn', ['other'], viewerCtx))
        .toEqual({ category: { $nin: ['other'] } });
    });
    it('priority in → $in', () => {
      expect(field('priority').toMatch('in', ['Critical', 'High'], viewerCtx))
        .toEqual({ priority: { $in: ['Critical', 'High'] } });
    });
  });

  describe('derived clientEmail', () => {
    const f = () => field('clientEmail');
    it('is a derived, displayable string lift of client.email', () => {
      expect(f().derived).toBe(true);
      expect(f().displayable).toBe(true);
      expect(f().type).toBe('string');
      expect(f().addFields()).toEqual([{ $addFields: { clientEmail: '$client.email' } }]);
    });
    it('toMatch targets the nested client.email path', () => {
      expect(f().toMatch('is', 'jane@acme.com', viewerCtx)).toEqual({ 'client.email': 'jane@acme.com' });
      expect(f().toMatch('contains', 'acme', viewerCtx))
        .toEqual({ 'client.email': { $regex: 'acme', $options: 'i' } });
    });
  });

  describe('ref assignee', () => {
    const f = () => field('assignee');
    it('is a single-ref to User lifted as assignee_label', () => {
      expect(f().type).toBe('ref');
      expect(f().refModel).toBe('User');
      expect(f().refPath).toBe('assignee');
      expect(f().refLabelFields).toEqual(['firstName', 'lastName']);
      expect(f().refArray).toBeUndefined(); // single-ref, not array
    });
    it('is → ObjectId equality on assignee', () => {
      const id = new mongoose.Types.ObjectId();
      expect(f().toMatch('is', id.toString(), viewerCtx)).toEqual({ assignee: id });
    });
    it('isEmpty → null/missing', () => {
      expect(f().toMatch('isEmpty', null, viewerCtx))
        .toEqual({ $or: [{ assignee: null }, { assignee: { $exists: false } }] });
    });
    it('isNotEmpty → present and non-null', () => {
      expect(f().toMatch('isNotEmpty', null, viewerCtx))
        .toEqual({ assignee: { $exists: true, $nin: [null] } });
    });
  });

  describe('date fields', () => {
    it('createdAt lastNDays → $gte cutoff Date', () => {
      expect(field('createdAt').toMatch('lastNDays', 7, viewerCtx).createdAt.$gte).toBeInstanceOf(Date);
    });
    it('closedAt between → $gte/$lte range', () => {
      const a = new Date('2026-01-01');
      const b = new Date('2026-02-01');
      expect(field('closedAt').toMatch('between', [a, b], viewerCtx))
        .toEqual({ closedAt: { $gte: a, $lte: b } });
    });
  });

  describe('derived daysOpen', () => {
    const f = () => field('daysOpen');
    it('addFields() is a $dateDiff from createdAt to now in days', () => {
      const expr = f().addFields();
      expect(expr).toEqual([
        {
          $addFields: {
            daysOpen: { $dateDiff: { startDate: '$createdAt', endDate: '$$NOW', unit: 'day' } },
          },
        },
      ]);
    });
    it('toMatch gte → number filter on daysOpen', () => {
      expect(f().toMatch('gte', 30, viewerCtx)).toEqual({ daysOpen: { $gte: 30 } });
    });
  });

  it('scope: org-only (no project field on SupportTicket)', () => {
    expect(supportTicketsCatalog.scope(viewerCtx)).toEqual({ organization: viewerCtx.organization });
    expect(supportTicketsCatalog.projectField).toBeUndefined();
  });
});
