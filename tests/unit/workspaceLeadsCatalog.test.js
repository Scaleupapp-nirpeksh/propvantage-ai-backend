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

  describe('daysSinceLastCPFollowUp (headline derived field)', () => {
    const f = () => field('daysSinceLastCPFollowUp');
    it('is derived, numeric, displayable, sortable', () => {
      expect(f().derived).toBe(true);
      expect(f().type).toBe('number');
      expect(f().displayable).toBe(true);
    });
    it('addFields computes lastCPFollowUpAt then days-since with documented fallback chain', () => {
      const stages = f().addFields();
      expect(stages).toHaveLength(2);
      // Stage 1: most-recent CP-history timestamp, falling back to last
      // interaction, then createdAt.
      expect(stages[0].$addFields.__lastCPFollowUpAt).toEqual({
        $ifNull: [
          { $max: '$channelPartnerAttribution.history.at' },
          { $ifNull: ['$engagementMetrics.lastInteractionDate', '$createdAt'] },
        ],
      });
      // Stage 2: integer day delta to now.
      expect(stages[1].$addFields.daysSinceLastCPFollowUp).toEqual({
        $dateDiff: { startDate: '$__lastCPFollowUpAt', endDate: '$$NOW', unit: 'day' },
      });
    });
    it('gte 15 -> { daysSinceLastCPFollowUp: { $gte: 15 } }', () => {
      expect(f().toMatch(OPERATORS.GTE, 15, viewer()))
        .toEqual({ daysSinceLastCPFollowUp: { $gte: 15 } });
    });
  });

  it('marks the default display columns', () => {
    const cols = leadsCatalog.fields.filter((f) => f.defaultColumn).map((f) => f.key);
    expect(cols).toEqual(
      expect.arrayContaining(['status', 'source', 'score', 'daysSinceLastCPFollowUp']),
    );
  });
});
