// tests/unit/reflectionService.test.js
// Unit tests for services/people/reflectionService.js
// Mocks: WeeklyReflection model, openAIService.transcribeAudio, hierarchyService.getManagerChain, User model
// No live DB / network.

import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';

// =============================================================================
// MOCKS
// =============================================================================

// WeeklyReflection model
const mockFind         = jest.fn();
const mockFindOne      = jest.fn();
const mockFindOneAndUpdate = jest.fn();
const mockFindById     = jest.fn();

// Helper: make mockFindOne return an object whose .lean() resolves to `val`
const findOneReturns = (val) =>
  mockFindOne.mockReturnValueOnce({ lean: () => Promise.resolve(val) });

jest.unstable_mockModule('../../models/weeklyReflectionModel.js', () => ({
  default: {
    find:             mockFind,
    findOne:          mockFindOne,
    findOneAndUpdate: mockFindOneAndUpdate,
    findById:         mockFindById,
  },
  REQUIRED_ANSWER_FIELDS: ['wins', 'areasToImprove', 'dislikes', 'achievements', 'plansNextWeek'],
  MIN_ANSWER_LENGTH: 500,
}));

// openAIService transcribeAudio
const mockTranscribeAudio = jest.fn();
jest.unstable_mockModule('../../services/openAIService.js', () => ({
  getSalesInsightsForLead: jest.fn(),
  transcribeAudio: mockTranscribeAudio,
}));

// hierarchyService.getManagerChain
const mockGetManagerChain = jest.fn();
jest.unstable_mockModule('../../services/people/hierarchyService.js', () => ({
  getManagerChain: mockGetManagerChain,
  getSubtree: jest.fn(),
  getTeam: jest.fn(),
  resolveDepartment: jest.fn(),
  isOwnerLevel: jest.fn(() => false),
  getHeadRoleForUser: jest.fn(),
  DEPARTMENT_BY_ROLE: {},
  HEAD_ROLE_BY_DEPARTMENT: {},
}));

// User model (used by ack)
const mockUserFindById = jest.fn();
// Helper: make mockUserFindById return an object whose .lean() resolves to `val`
const userFindByIdReturns = (val) =>
  mockUserFindById.mockReturnValueOnce({ lean: () => Promise.resolve(val) });

jest.unstable_mockModule('../../models/userModel.js', () => ({
  default: { findById: mockUserFindById },
}));

// =============================================================================
// SERVICE IMPORT (after mocks registered)
// =============================================================================

const {
  isoWeekOf,
  weekStartOf,
  weekEndOf,
  upsertDraft,
  submit,
  currentStatus,
  transcribe,
  ack,
  listForUser,
  listForUserId,
} = await import('../../services/people/reflectionService.js');

// =============================================================================
// HELPERS
// =============================================================================

const ORG  = new mongoose.Types.ObjectId();
const UID  = new mongoose.Types.ObjectId();
const USER = { _id: UID, organization: ORG };

/** Return a string of exactly `n` characters */
const str = (n) => 'a'.repeat(n);

/** Create a minimal reflection doc mock with .save() */
const makeDoc = (overrides = {}) => ({
  _id:          new mongoose.Types.ObjectId(),
  organization: ORG,
  user:         UID,
  isoWeek:      '2026-W25',
  weekStart:    new Date('2026-06-15T00:00:00Z'),
  weekEnd:      new Date('2026-06-21T23:59:59.999Z'),
  status:       'draft',
  submittedAt:  null,
  managerAck:   null,
  answers: {
    wins:            '',
    areasToImprove:  '',
    dislikes:        '',
    achievements:    '',
    plansNextWeek:   '',
    other:           '',
  },
  save: jest.fn().mockResolvedValue(undefined),
  ...overrides,
});

beforeEach(() => {
  jest.resetAllMocks();
});

// =============================================================================
// isoWeekOf
// =============================================================================

describe('isoWeekOf', () => {
  test('2026-06-15 (Mon) → 2026-W25', () => {
    expect(isoWeekOf(new Date('2026-06-15T12:00:00Z'))).toBe('2026-W25');
  });

  test('2026-06-21 (Sun) → 2026-W25', () => {
    expect(isoWeekOf(new Date('2026-06-21T23:00:00Z'))).toBe('2026-W25');
  });

  test('2026-06-22 (Mon) → 2026-W26', () => {
    expect(isoWeekOf(new Date('2026-06-22T00:30:00Z'))).toBe('2026-W26');
  });

  // Year boundary: 2025-12-29 (Mon) is in ISO week 2026-W01
  test('2025-12-29 (Mon) → 2026-W01', () => {
    expect(isoWeekOf(new Date('2025-12-29T12:00:00Z'))).toBe('2026-W01');
  });

  // 2026-01-01 (Thu) is also in 2026-W01
  test('2026-01-01 (Thu) → 2026-W01', () => {
    expect(isoWeekOf(new Date('2026-01-01T12:00:00Z'))).toBe('2026-W01');
  });

  // 2026-01-04 (Sun) is still in 2026-W01
  test('2026-01-04 (Sun) → 2026-W01', () => {
    expect(isoWeekOf(new Date('2026-01-04T12:00:00Z'))).toBe('2026-W01');
  });

  // 2026-01-05 (Mon) is 2026-W02
  test('2026-01-05 (Mon) → 2026-W02', () => {
    expect(isoWeekOf(new Date('2026-01-05T12:00:00Z'))).toBe('2026-W02');
  });

  // 2024 is a leap year; 2024-12-30 (Mon) is in 2025-W01
  test('2024-12-30 (Mon) → 2025-W01', () => {
    expect(isoWeekOf(new Date('2024-12-30T12:00:00Z'))).toBe('2025-W01');
  });
});

// =============================================================================
// weekStartOf / weekEndOf
// =============================================================================

describe('weekStartOf', () => {
  test('returns Monday 00:00:00 UTC for a Wednesday', () => {
    const wed = new Date('2026-06-17T14:30:00Z');
    const start = weekStartOf(wed);
    expect(start.toISOString()).toBe('2026-06-15T00:00:00.000Z');
  });

  test('returns same day for a Monday', () => {
    const mon = new Date('2026-06-15T08:00:00Z');
    const start = weekStartOf(mon);
    expect(start.toISOString()).toBe('2026-06-15T00:00:00.000Z');
  });
});

describe('weekEndOf', () => {
  test('returns Sunday 23:59:59.999 UTC for a Wednesday', () => {
    const wed = new Date('2026-06-17T14:30:00Z');
    const end = weekEndOf(wed);
    expect(end.toISOString()).toBe('2026-06-21T23:59:59.999Z');
  });
});

// =============================================================================
// upsertDraft
// =============================================================================

describe('upsertDraft', () => {
  test('calls findOneAndUpdate with the correct filter + set', async () => {
    const savedDoc = makeDoc();
    // findOne returns null → no existing doc (brand-new draft)
    mockFindOne.mockReturnValueOnce({ lean: () => Promise.resolve(null) });
    mockFindOneAndUpdate.mockResolvedValueOnce(savedDoc);

    const result = await upsertDraft(USER, '2026-W26', { wins: 'something' });

    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ organization: ORG, user: UID, isoWeek: '2026-W26' }),
      expect.objectContaining({ $set: expect.objectContaining({ 'answers.wins': 'something' }) }),
      expect.objectContaining({ upsert: true, new: true }),
    );
    expect(result).toBe(savedDoc);
  });

  test('succeeds when existing doc is a draft', async () => {
    const savedDoc = makeDoc({ status: 'draft' });
    // findOne returns a draft doc
    mockFindOne.mockReturnValueOnce({ lean: () => Promise.resolve({ status: 'draft' }) });
    mockFindOneAndUpdate.mockResolvedValueOnce(savedDoc);

    const result = await upsertDraft(USER, '2026-W26', { wins: 'updated' });
    expect(result).toBe(savedDoc);
    expect(mockFindOneAndUpdate).toHaveBeenCalled();
  });

  test('throws 400 when existing reflection is already submitted', async () => {
    // findOne returns a submitted doc
    mockFindOne.mockReturnValueOnce({ lean: () => Promise.resolve({ status: 'submitted' }) });

    const err = await upsertDraft(USER, '2026-W26', { wins: 'override attempt' }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/already submitted/i);
    expect(err.statusCode).toBe(400);
    // Must NOT proceed to write
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });

  test('throws when weekEnd is in the past', async () => {
    // 2020-W01 is well in the past — lock check fires before findOne
    await expect(upsertDraft(USER, '2020-W01', {})).rejects.toThrow('locked');
  });
});

// =============================================================================
// submit
// =============================================================================

describe('submit', () => {
  // A doc with all required answers set to exactly MIN_ANSWER_LENGTH chars
  const fullAnswers = {
    wins:           str(500),
    areasToImprove: str(500),
    dislikes:       str(500),
    achievements:   str(500),
    plansNextWeek:  str(500),
    other:          '',
  };

  test('rejects when any required answer is shorter than 500 chars', async () => {
    const doc = makeDoc({
      isoWeek: '2026-W26',
      weekEnd: new Date(Date.now() + 7 * 86400000),
      answers: {
        wins:           str(499),   // too short
        areasToImprove: str(500),
        dislikes:       str(500),
        achievements:   str(50),    // too short
        plansNextWeek:  str(500),
        other:          '',
      },
    });
    mockFindOne.mockResolvedValueOnce(doc);

    const err = await submit(USER, '2026-W26').catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.shortFields).toEqual(expect.arrayContaining(['wins', 'achievements']));
    expect(err.shortFields).not.toContain('areasToImprove');
    expect(err.message).toMatch(/wins/);
    expect(err.message).toMatch(/achievements/);
  });

  test('succeeds when ALL required answers are exactly 500 chars', async () => {
    const doc = makeDoc({
      isoWeek: '2026-W26',
      weekEnd: new Date(Date.now() + 7 * 86400000),
      answers: { ...fullAnswers },
    });
    mockFindOne.mockResolvedValueOnce(doc);

    const result = await submit(USER, '2026-W26');

    expect(result.status).toBe('submitted');
    expect(result.submittedAt).toBeInstanceOf(Date);
    expect(doc.save).toHaveBeenCalled();
  });

  test('succeeds when required answers exceed 500 chars', async () => {
    const doc = makeDoc({
      isoWeek: '2026-W26',
      weekEnd: new Date(Date.now() + 7 * 86400000),
      answers: {
        wins:           str(600),
        areasToImprove: str(501),
        dislikes:       str(750),
        achievements:   str(500),
        plansNextWeek:  str(1000),
        other:          str(50),  // optional — no minimum
      },
    });
    mockFindOne.mockResolvedValueOnce(doc);

    const result = await submit(USER, '2026-W26');
    expect(result.status).toBe('submitted');
  });

  test('throws LOCKED when weekEnd is in the past', async () => {
    await expect(submit(USER, '2020-W01')).rejects.toThrow('locked');
  });

  test('throws 404 when no draft exists', async () => {
    // weekEnd in the future (2026-W26)
    mockFindOne.mockResolvedValueOnce(null);
    const err = await submit(USER, '2026-W26').catch((e) => e);
    expect(err.statusCode).toBe(404);
  });

  test('lists all short fields by name (not just the first)', async () => {
    const doc = makeDoc({
      isoWeek: '2026-W26',
      weekEnd: new Date(Date.now() + 7 * 86400000),
      answers: {
        wins:           str(10),
        areasToImprove: str(10),
        dislikes:       str(10),
        achievements:   str(10),
        plansNextWeek:  str(10),
        other:          '',
      },
    });
    mockFindOne.mockResolvedValueOnce(doc);

    const err = await submit(USER, '2026-W26').catch((e) => e);
    expect(err.shortFields.sort()).toEqual(
      ['wins', 'areasToImprove', 'dislikes', 'achievements', 'plansNextWeek'].sort()
    );
  });
});

// =============================================================================
// currentStatus
// =============================================================================

describe('currentStatus', () => {
  test("returns status 'none' when no reflection exists for current week", async () => {
    // First call: current week doc (chained .lean())
    findOneReturns(null);
    // Second call: previous week doc
    findOneReturns({ status: 'submitted' });

    const result = await currentStatus(USER);

    expect(result.status).toBe('none');
    expect(result.isoWeek).toMatch(/^\d{4}-W\d{2}$/);
    expect(result.weekStart).toBeInstanceOf(Date);
    expect(result.weekEnd).toBeInstanceOf(Date);
  });

  test("returns status 'draft' when a draft exists", async () => {
    findOneReturns({ status: 'draft' });        // current week
    findOneReturns({ status: 'submitted' });    // prior week

    const result = await currentStatus(USER);
    expect(result.status).toBe('draft');
    expect(result.overdue).toBe(false);
  });

  test("returns status 'submitted' when submitted", async () => {
    findOneReturns({ status: 'submitted' });
    findOneReturns({ status: 'submitted' });

    const result = await currentStatus(USER);
    expect(result.status).toBe('submitted');
  });

  test('overdue is true when last week is unsubmitted (draft)', async () => {
    findOneReturns({ status: 'draft' });   // current week
    findOneReturns({ status: 'draft' });   // prior week not submitted → overdue

    const result = await currentStatus(USER);
    expect(result.overdue).toBe(true);
  });

  test('overdue is true when last week has no document at all', async () => {
    findOneReturns({ status: 'draft' });   // current week
    findOneReturns(null);                  // prior week missing → overdue

    const result = await currentStatus(USER);
    expect(result.overdue).toBe(true);
  });

  test('overdue is false when last week was submitted', async () => {
    findOneReturns(null);                         // current week missing
    findOneReturns({ status: 'submitted' });       // prior week submitted

    const result = await currentStatus(USER);
    expect(result.overdue).toBe(false);
  });
});

// =============================================================================
// transcribe
// =============================================================================

describe('transcribe', () => {
  test('calls openAIService transcribeAudio and returns its text', async () => {
    mockTranscribeAudio.mockResolvedValueOnce('Hello world');
    const buf = Buffer.from('audio data');
    const result = await transcribe(buf, 'audio/webm');

    expect(mockTranscribeAudio).toHaveBeenCalledWith(buf, 'audio/webm');
    expect(result).toBe('Hello world');
  });

  test('throws 502 when transcribeAudio returns null (best-effort failure)', async () => {
    mockTranscribeAudio.mockResolvedValueOnce(null);
    const err = await transcribe(Buffer.from('x'), 'audio/webm').catch((e) => e);
    expect(err.statusCode).toBe(502);
    expect(err.message).toMatch(/transcription failed/i);
  });
});

// =============================================================================
// ack
// =============================================================================

describe('ack', () => {
  const MANAGER_ID = new mongoose.Types.ObjectId();
  const AUTHOR_ID  = new mongoose.Types.ObjectId();

  const manager = { _id: MANAGER_ID, organization: ORG, role: 'Sales Head' };
  const author  = { _id: AUTHOR_ID,  organization: ORG, role: 'Sales Executive' };

  test('stores managerAck when manager IS in the author chain', async () => {
    const doc = makeDoc({ _id: new mongoose.Types.ObjectId(), user: AUTHOR_ID });
    mockFindById.mockResolvedValueOnce(doc);              // reflection
    userFindByIdReturns(author);                           // author user doc (chained .lean())
    mockGetManagerChain.mockResolvedValueOnce([manager]);  // chain contains manager

    const result = await ack(manager, doc._id, 'Good work');

    expect(result.managerAck).toMatchObject({
      by:   MANAGER_ID,
      note: 'Good work',
    });
    expect(result.managerAck.at).toBeInstanceOf(Date);
    expect(doc.save).toHaveBeenCalled();
  });

  test('throws 403 when manager is NOT in the chain', async () => {
    const outsider = { _id: new mongoose.Types.ObjectId(), organization: ORG, role: 'Finance Head' };
    const doc = makeDoc({ user: AUTHOR_ID });
    mockFindById.mockResolvedValueOnce(doc);
    userFindByIdReturns(author);
    // Chain does not include outsider
    mockGetManagerChain.mockResolvedValueOnce([manager]);

    const err = await ack(outsider, doc._id, 'Note').catch((e) => e);
    expect(err.statusCode).toBe(403);
    expect(err.message).toMatch(/not in.*manager chain/i);
    expect(doc.save).not.toHaveBeenCalled();
  });

  test('throws 404 when reflection is not found', async () => {
    mockFindById.mockResolvedValueOnce(null);
    const err = await ack(manager, new mongoose.Types.ObjectId(), 'x').catch((e) => e);
    expect(err.statusCode).toBe(404);
  });

  test('accepts an empty note', async () => {
    const doc = makeDoc({ user: AUTHOR_ID });
    mockFindById.mockResolvedValueOnce(doc);
    userFindByIdReturns(author);
    mockGetManagerChain.mockResolvedValueOnce([manager]);

    const result = await ack(manager, doc._id, '');
    expect(result.managerAck.note).toBe('');
  });

  test('trims whitespace from the note', async () => {
    const doc = makeDoc({ user: AUTHOR_ID });
    mockFindById.mockResolvedValueOnce(doc);
    userFindByIdReturns(author);
    mockGetManagerChain.mockResolvedValueOnce([manager]);

    const result = await ack(manager, doc._id, '  spaces  ');
    expect(result.managerAck.note).toBe('spaces');
  });
});

// =============================================================================
// listForUser
// =============================================================================

describe('listForUser', () => {
  /** Build a chainable mock: find().sort().limit().lean() */
  const mockFindChain = (resolvedValue) => {
    const chain = {
      sort:  jest.fn(),
      limit: jest.fn(),
      lean:  jest.fn().mockResolvedValue(resolvedValue),
    };
    chain.sort.mockReturnValue(chain);
    chain.limit.mockReturnValue(chain);
    mockFind.mockReturnValueOnce(chain);
    return chain;
  };

  test('queries by organization and user._id', async () => {
    const chain = mockFindChain([]);
    await listForUser(USER);
    expect(mockFind).toHaveBeenCalledWith({ organization: ORG, user: UID });
    expect(chain.sort).toHaveBeenCalledWith({ weekStart: -1 });
  });

  test('sorts descending by weekStart', async () => {
    const docs = [
      makeDoc({ weekStart: new Date('2026-06-15T00:00:00Z') }),
      makeDoc({ weekStart: new Date('2026-06-08T00:00:00Z') }),
    ];
    const chain = mockFindChain(docs);
    const result = await listForUser(USER);
    expect(chain.sort).toHaveBeenCalledWith({ weekStart: -1 });
    expect(result).toBe(docs);
  });

  test('applies the default limit of 12', async () => {
    const chain = mockFindChain([]);
    await listForUser(USER);
    expect(chain.limit).toHaveBeenCalledWith(12);
  });

  test('applies a custom limit when provided', async () => {
    const chain = mockFindChain([]);
    await listForUser(USER, 5);
    expect(chain.limit).toHaveBeenCalledWith(5);
  });

  test('returns an empty array when the user has no reflections', async () => {
    mockFindChain([]);
    const result = await listForUser(USER);
    expect(result).toEqual([]);
  });
});

// =============================================================================
// listForUserId
// =============================================================================

describe('listForUserId', () => {
  test('queries WeeklyReflection by the given orgId and userId', async () => {
    const targetUserId = new mongoose.Types.ObjectId();
    const docs = [
      { _id: new mongoose.Types.ObjectId(), isoWeek: '2026-W25', status: 'submitted' },
    ];

    mockFind.mockReturnValueOnce({
      sort:  jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean:  jest.fn().mockResolvedValue(docs),
    });

    const result = await listForUserId(ORG, targetUserId, 12);

    expect(mockFind).toHaveBeenCalledWith(
      expect.objectContaining({
        organization: ORG,
        user: targetUserId,
      }),
    );
    expect(result).toEqual(docs);
  });

  test('applies the limit parameter', async () => {
    const targetUserId = new mongoose.Types.ObjectId();
    const sortMock  = jest.fn().mockReturnThis();
    const limitMock = jest.fn().mockReturnThis();
    mockFind.mockReturnValueOnce({
      sort:  sortMock,
      limit: limitMock,
      lean:  jest.fn().mockResolvedValue([]),
    });

    await listForUserId(ORG, targetUserId, 5);
    expect(limitMock).toHaveBeenCalledWith(5);
  });
});
