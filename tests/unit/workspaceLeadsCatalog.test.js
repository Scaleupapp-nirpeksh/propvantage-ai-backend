// tests/unit/workspaceLeadsCatalog.test.js
// Unit-tests each Leads FieldDescriptor's toMatch() + the derived addFields()
// pipeline shapes. DB-free — asserts the Mongo fragments/stages directly.
import mongoose from 'mongoose';
import { leadsCatalog } from '../../services/workspace/catalogs/leadsCatalog.js';
import { OPERATORS } from '../../services/workspace/operators.js';

const field = (key) => leadsCatalog.fields.find((f) => f.key === key);
const viewer = (over = {}) => ({
  organization: new mongoose.Types.ObjectId(),
  userId: new mongoose.Types.ObjectId(),
  accessibleProjectIds: null,
  isOwner: true,
  permissions: [],
  ...over,
});

describe('leadsCatalog', () => {
  it('is the leads module bound to the Lead base model', () => {
    expect(leadsCatalog.module).toBe('leads');
    expect(leadsCatalog.baseModel).toBe('Lead');
  });

  describe('status (enum)', () => {
    const f = () => field('status');
    it('carries the real Lead status enum', () => {
      expect(f().type).toBe('enum');
      expect(f().enumValues).toEqual([
        'pending', 'New', 'Qualified', 'Site Visit Completed',
        'Negotiating', 'Booked', 'Lost', 'Revived',
      ]);
    });
    it('toMatch is -> { status: value }', () => {
      expect(f().toMatch(OPERATORS.IS, 'New', viewer())).toEqual({ status: 'New' });
    });
    it('toMatch in -> { status: { $in: [...] } }', () => {
      expect(f().toMatch(OPERATORS.IN, ['New', 'Qualified'], viewer()))
        .toEqual({ status: { $in: ['New', 'Qualified'] } });
    });
  });

  describe('source (enum incl. Channel Partner / Management)', () => {
    const f = () => field('source');
    it('carries the real source enum', () => {
      expect(f().enumValues).toEqual([
        'Channel Partner', 'Management', 'Direct', 'Referral', 'Marketing', 'Cold Calling',
      ]);
    });
    it('toMatch is -> { source: "Channel Partner" }', () => {
      expect(f().toMatch(OPERATORS.IS, 'Channel Partner', viewer()))
        .toEqual({ source: 'Channel Partner' });
    });
  });

  describe('assignedTo (ref)', () => {
    const f = () => field('assignedTo');
    it('is a ref and casts the value to an ObjectId for `is`', () => {
      const id = new mongoose.Types.ObjectId();
      expect(f().type).toBe('ref');
      const frag = f().toMatch(OPERATORS.IS, id.toString(), viewer());
      expect(frag.assignedTo).toBeInstanceOf(mongoose.Types.ObjectId);
      expect(frag.assignedTo.toString()).toBe(id.toString());
    });
    it('isEmpty -> unassigned leads', () => {
      const frag = f().toMatch(OPERATORS.IS_EMPTY, null, viewer());
      expect(frag).toEqual({ $or: [{ assignedTo: null }, { assignedTo: { $exists: false } }] });
    });
  });

  describe('assignedToMe (derived boolean)', () => {
    const f = () => field('assignedToMe');
    it('is derived and not directly displayable as a column', () => {
      expect(f().derived).toBe(true);
      expect(f().type).toBe('boolean');
    });
    it('true -> matches assignedTo === viewer.userId', () => {
      const v = viewer();
      const frag = f().toMatch(OPERATORS.IS, true, v);
      expect(frag.assignedTo.toString()).toBe(v.userId.toString());
    });
    it('false -> matches assignedTo !== viewer.userId', () => {
      const v = viewer();
      const frag = f().toMatch(OPERATORS.IS, false, v);
      expect(frag.assignedTo.$ne.toString()).toBe(v.userId.toString());
    });
  });

  describe('score (number)', () => {
    const f = () => field('score');
    it('gte -> { score: { $gte: 80 } }', () => {
      expect(f().toMatch(OPERATORS.GTE, 80, viewer())).toEqual({ score: { $gte: 80 } });
    });
    it('between -> { score: { $gte, $lte } }', () => {
      expect(f().toMatch(OPERATORS.BETWEEN, [40, 60], viewer()))
        .toEqual({ score: { $gte: 40, $lte: 60 } });
    });
  });

  describe('createdAt (date)', () => {
    const f = () => field('createdAt');
    it('lastNDays -> { createdAt: { $gte: <date> } }', () => {
      const frag = f().toMatch(OPERATORS.LAST_N_DAYS, 7, viewer());
      expect(frag.createdAt.$gte).toBeInstanceOf(Date);
      const ageMs = Date.now() - frag.createdAt.$gte.getTime();
      expect(ageMs).toBeGreaterThan(6.9 * 864e5);
      expect(ageMs).toBeLessThan(7.1 * 864e5);
    });
  });

  describe('daysInCurrentStatus (derived from statusChangedAt)', () => {
    const f = () => field('daysInCurrentStatus');
    it('declares an addFields stage computing days from statusChangedAt', () => {
      const stages = f().addFields();
      expect(stages).toHaveLength(1);
      const set = stages[0].$addFields.daysInCurrentStatus;
      expect(set).toEqual({
        $dateDiff: {
          startDate: { $ifNull: ['$statusChangedAt', '$createdAt'] },
          endDate: '$$NOW',
          unit: 'day',
        },
      });
    });
    it('gte -> { daysInCurrentStatus: { $gte: 15 } }', () => {
      expect(f().toMatch(OPERATORS.GTE, 15, viewer()))
        .toEqual({ daysInCurrentStatus: { $gte: 15 } });
    });
  });

  describe('daysSinceLastCPFollowUp (CP-only, headline derived field)', () => {
    const f = () => field('daysSinceLastCPFollowUp');
    it('is derived, numeric, displayable, sortable', () => {
      expect(f().derived).toBe(true);
      expect(f().type).toBe('number');
      expect(f().displayable).toBe(true);
    });
    it('addFields uses ONLY the max CP history timestamp (no fallback)', () => {
      const stages = f().addFields();
      expect(stages).toHaveLength(2);
      expect(stages[0].$addFields.__lastCPFollowUpAt).toEqual({
        $max: '$channelPartnerAttribution.history.at',
      });
      expect(stages[1].$addFields.daysSinceLastCPFollowUp).toEqual({
        $dateDiff: { startDate: '$__lastCPFollowUpAt', endDate: '$$NOW', unit: 'day' },
      });
    });
    it('gte 20 -> { daysSinceLastCPFollowUp: { $gte: 20 } }', () => {
      expect(f().toMatch(OPERATORS.GTE, 20, viewer()))
        .toEqual({ daysSinceLastCPFollowUp: { $gte: 20 } });
    });
  });

  describe('daysSinceLastActivity (general, with fallback)', () => {
    const f = () => field('daysSinceLastActivity');
    it('exists, derived, numeric, displayable', () => {
      expect(f()).toBeDefined();
      expect(f().derived).toBe(true);
      expect(f().type).toBe('number');
      expect(f().displayable).toBe(true);
    });
    it('addFields takes the max of CP history, last interaction, status change, created', () => {
      const stages = f().addFields();
      expect(stages).toHaveLength(2);
      expect(stages[0].$addFields.__lastActivityAt).toEqual({
        $max: [
          { $max: '$channelPartnerAttribution.history.at' },
          '$engagementMetrics.lastInteractionDate',
          '$statusChangedAt',
          '$createdAt',
        ],
      });
      expect(stages[1].$addFields.daysSinceLastActivity).toEqual({
        $dateDiff: { startDate: '$__lastActivityAt', endDate: '$$NOW', unit: 'day' },
      });
    });
  });

  it('marks the default display columns', () => {
    const cols = leadsCatalog.fields.filter((f) => f.defaultColumn).map((f) => f.key);
    expect(cols).toEqual(
      expect.arrayContaining(['status', 'source', 'score', 'daysSinceLastCPFollowUp']),
    );
  });

  describe('cpStatus (enum)', () => {
    const f = () => field('cpStatus');
    it('carries the real attribution status enum', () => {
      expect(f().type).toBe('enum');
      expect(f().enumValues).toEqual(['tagged', 'pending', 'approved', 'rejected']);
    });
    it('is -> { "channelPartnerAttribution.status": value }', () => {
      expect(f().toMatch(OPERATORS.IS, 'pending', viewer()))
        .toEqual({ 'channelPartnerAttribution.status': 'pending' });
    });
    it('lifts the nested status to a top-level cpStatus for display', () => {
      expect(f().addFields()).toEqual([
        { $addFields: { cpStatus: '$channelPartnerAttribution.status' } },
      ]);
    });
  });

  describe('channelPartner (array ref)', () => {
    const f = () => field('channelPartner');
    it('is an array ref to ChannelPartner.firmName, displayable', () => {
      expect(f().type).toBe('ref');
      expect(f().refArray).toBe(true);
      expect(f().refModel).toBe('ChannelPartner');
      expect(f().refPath).toBe('channelPartnerAttribution.partners.channelPartner');
      expect(f().refLabelFields).toEqual(['firmName']);
      expect(f().displayable).toBe(true);
    });
    it('isNotEmpty -> a CP is tagged (partners.0 exists)', () => {
      expect(f().toMatch(OPERATORS.IS_NOT_EMPTY, null, viewer()))
        .toEqual({ 'channelPartnerAttribution.partners.0': { $exists: true } });
    });
    it('isEmpty -> no CP tagged', () => {
      expect(f().toMatch(OPERATORS.IS_EMPTY, null, viewer()))
        .toEqual({ 'channelPartnerAttribution.partners.0': { $exists: false } });
    });
  });

  describe('cpAgent (array ref)', () => {
    const f = () => field('cpAgent');
    it('is an array ref to User, displayable', () => {
      expect(f().type).toBe('ref');
      expect(f().refArray).toBe(true);
      expect(f().refModel).toBe('User');
      expect(f().refPath).toBe('channelPartnerAttribution.partners.agentUser');
      expect(f().refLabelFields).toEqual(['firstName', 'lastName']);
      expect(f().displayable).toBe(true);
    });
    it('isNotEmpty -> some partner has an agentUser', () => {
      expect(f().toMatch(OPERATORS.IS_NOT_EMPTY, null, viewer())).toEqual({
        'channelPartnerAttribution.partners': { $elemMatch: { agentUser: { $ne: null } } },
      });
    });
  });
});
