// tests/unit/moraleService.test.js
// Unit tests for services/people/moraleService.js
// Mocks: @anthropic-ai/sdk, WeeklyReflection, MoraleSummary, hierarchyService.getTeam
// No live DB / network.
//
// Run:
//   node --experimental-vm-modules node_modules/jest/bin/jest.js \
//     --config jest.unit.config.mjs tests/unit/moraleService.test.js

import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';

// =============================================================================
// MOCKS — must be registered BEFORE the service is imported
// =============================================================================

// ── @anthropic-ai/sdk ──────────────────────────────────────────────────────
const mockMessagesCreate = jest.fn();

jest.unstable_mockModule('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    constructor() {
      this.messages = { create: mockMessagesCreate };
    }
  },
}));

// ── WeeklyReflection model ─────────────────────────────────────────────────
// find() returns an object whose .lean() resolves to the configured value.
const mockReflectionFindImpl = jest.fn();
const mockReflectionFindOne = jest.fn();

// Wrap so that .find(...).lean() works
const mockReflectionFind = jest.fn((...args) => {
  const result = mockReflectionFindImpl(...args);
  return { lean: () => result };
});

jest.unstable_mockModule('../../models/weeklyReflectionModel.js', () => ({
  default: {
    find:    mockReflectionFind,
    findOne: mockReflectionFindOne,
  },
  REQUIRED_ANSWER_FIELDS: ['wins', 'areasToImprove', 'dislikes', 'achievements', 'plansNextWeek'],
  MIN_ANSWER_LENGTH: 500,
}));

// ── MoraleSummary model ────────────────────────────────────────────────────
const mockMoraleFindOneImpl = jest.fn();
const mockMoraleFindOneAndUpdate = jest.fn();

// findOne(...).lean() pattern
const mockMoraleFindOne = jest.fn((...args) => {
  const result = mockMoraleFindOneImpl(...args);
  return { lean: () => result };
});

jest.unstable_mockModule('../../models/moraleSummaryModel.js', () => ({
  default: {
    findOne:          mockMoraleFindOne,
    findOneAndUpdate: mockMoraleFindOneAndUpdate,
  },
}));

// ── hierarchyService ─────────────────────────────────────────────────────
const mockGetTeam = jest.fn();

jest.unstable_mockModule('../../services/people/hierarchyService.js', () => ({
  getTeam:              mockGetTeam,
  getManagerChain:      jest.fn(),
  getSubtree:           jest.fn(),
  resolveDepartment:    jest.fn(),
  isOwnerLevel:         jest.fn(() => false),
  getHeadRoleForUser:   jest.fn(),
  DEPARTMENT_BY_ROLE:   {},
  HEAD_ROLE_BY_DEPARTMENT: {},
}));

// =============================================================================
// SERVICE IMPORT (after mocks registered)
// =============================================================================

const { analyzeReflection, buildTeamMorale, buildOrgMorale } =
  await import('../../services/people/moraleService.js');

// =============================================================================
// HELPERS
// =============================================================================

const ORG  = new mongoose.Types.ObjectId();
const UID1 = new mongoose.Types.ObjectId();
const UID2 = new mongoose.Types.ObjectId();
const HEAD_ID = new mongoose.Types.ObjectId();

const HEAD_USER = {
  _id:          HEAD_ID,
  organization: ORG,
  role:         'Sales Head',
};

/** Minimal reflection document with a save() mock */
const makeReflectionDoc = (overrides = {}) => ({
  _id:          new mongoose.Types.ObjectId(),
  organization: ORG,
  user:         UID1,
  isoWeek:      '2026-W25',
  status:       'submitted',
  answers: {
    wins:           'Great week closing 3 leads',
    areasToImprove: 'Time management on follow-ups',
    dislikes:       'Too many internal meetings',
    achievements:   'Hit monthly target two weeks early',
    plansNextWeek:  'Focus on pipeline top-of-funnel',
  },
  sentiment: null,
  save: jest.fn().mockResolvedValue(undefined),
  ...overrides,
});

/** Build a successful Anthropic response containing a JSON string */
function mockAnthropicResponse(jsonObj) {
  return {
    content: [
      { type: 'text', text: JSON.stringify(jsonObj) },
    ],
  };
}

/** Build a lean reflection (no .save) suitable for WeeklyReflection.find results */
const makeLeanReflection = (userId = UID1, overrides = {}) => ({
  _id:          new mongoose.Types.ObjectId(),
  organization: ORG,
  user:         userId,
  isoWeek:      '2026-W25',
  status:       'submitted',
  answers: {
    wins:           'Closed two deals',
    areasToImprove: 'Documentation lag',
    dislikes:       'Long approval cycles',
    achievements:   'Exceeded target',
    plansNextWeek:  'Onboard new leads',
  },
  sentiment: {
    score:       0.6,
    label:       'positive',
    themes:      ['strong week'],
    riskSignals: [],
  },
  ...overrides,
});

beforeEach(() => {
  jest.resetAllMocks();
  // Re-wire after resetAllMocks clears implementations
  mockReflectionFind.mockImplementation((...args) => {
    const result = mockReflectionFindImpl(...args);
    return { lean: () => result };
  });
  mockMoraleFindOne.mockImplementation((...args) => {
    const result = mockMoraleFindOneImpl(...args);
    return { lean: () => result };
  });
});

// =============================================================================
// analyzeReflection
// =============================================================================

describe('analyzeReflection', () => {
  test('parses valid strict JSON from Claude and returns sentiment object', async () => {
    const sentimentPayload = {
      score:       0.72,
      label:       'positive',
      themes:      ['strong pipeline', 'team collaboration'],
      riskSignals: ['workload'],
    };

    mockMessagesCreate.mockResolvedValueOnce(mockAnthropicResponse(sentimentPayload));

    const doc = makeReflectionDoc();
    const result = await analyzeReflection(doc);

    expect(result).not.toBeNull();
    expect(result.score).toBeCloseTo(0.72, 2);
    expect(result.label).toBe('positive');
    expect(result.themes).toEqual(expect.arrayContaining(['strong pipeline']));
    expect(result.riskSignals).toEqual(['workload']);
  });

  test('persists sentiment onto the reflection document when successful', async () => {
    const sentimentPayload = {
      score:       -0.4,
      label:       'negative',
      themes:      ['burnout signals'],
      riskSignals: ['burnout', 'frustration'],
    };

    mockMessagesCreate.mockResolvedValueOnce(mockAnthropicResponse(sentimentPayload));

    const doc = makeReflectionDoc();
    await analyzeReflection(doc);

    expect(doc.save).toHaveBeenCalledTimes(1);
    expect(doc.sentiment).toBeDefined();
    expect(doc.sentiment.score).toBeCloseTo(-0.4, 2);
    expect(doc.sentiment.label).toBe('negative');
    expect(doc.sentiment.analyzedAt).toBeInstanceOf(Date);
    expect(typeof doc.sentiment.model).toBe('string');
  });

  test('returns null when Claude response JSON is malformed', async () => {
    mockMessagesCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'This is not JSON at all!' }],
    });

    const doc = makeReflectionDoc();
    const result = await analyzeReflection(doc);

    expect(result).toBeNull();
    expect(doc.save).not.toHaveBeenCalled();
  });

  test('returns null when JSON is valid but missing required fields', async () => {
    mockMessagesCreate.mockResolvedValueOnce(
      mockAnthropicResponse({ unexpected: 'shape' })
    );

    const doc = makeReflectionDoc();
    const result = await analyzeReflection(doc);

    expect(result).toBeNull();
  });

  test('returns null when Anthropic client throws (never throws to caller)', async () => {
    mockMessagesCreate.mockRejectedValueOnce(new Error('Network timeout'));

    const doc = makeReflectionDoc();

    // Must not throw
    await expect(analyzeReflection(doc)).resolves.toBeNull();
    expect(doc.save).not.toHaveBeenCalled();
  });

  test('returns null when content array is empty', async () => {
    mockMessagesCreate.mockResolvedValueOnce({ content: [] });

    const doc = makeReflectionDoc();
    const result = await analyzeReflection(doc);

    expect(result).toBeNull();
  });

  test('handles fenced ```json block and still parses', async () => {
    const sentimentPayload = {
      score:       0.1,
      label:       'neutral',
      themes:      ['routine week'],
      riskSignals: [],
    };
    const fencedText = `\`\`\`json\n${JSON.stringify(sentimentPayload)}\n\`\`\``;
    mockMessagesCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: fencedText }],
    });

    const doc = makeReflectionDoc();
    const result = await analyzeReflection(doc);

    expect(result).not.toBeNull();
    expect(result.label).toBe('neutral');
  });

  test('strips unknown riskSignals and keeps only allowed values', async () => {
    mockMessagesCreate.mockResolvedValueOnce(
      mockAnthropicResponse({
        score:       -0.3,
        label:       'negative',
        themes:      [],
        riskSignals: ['burnout', 'made-up-signal', 'flight-risk'],
      })
    );

    const doc = makeReflectionDoc();
    const result = await analyzeReflection(doc);

    expect(result.riskSignals).toEqual(['burnout', 'flight-risk']);
  });

  test('returns parsed sentiment object (not null) when doc.save() throws after successful Claude analysis', async () => {
    const sentimentPayload = {
      score:       0.55,
      label:       'positive',
      themes:      ['great close rate', 'team momentum'],
      riskSignals: ['workload'],
    };

    mockMessagesCreate.mockResolvedValueOnce(mockAnthropicResponse(sentimentPayload));

    const doc = makeReflectionDoc({
      save: jest.fn().mockRejectedValue(new Error('DB write failed')),
    });

    // Must not throw — save error is swallowed
    const result = await analyzeReflection(doc);

    // The analysis result must survive the save failure
    expect(result).not.toBeNull();
    expect(typeof result.score).toBe('number');
    expect(result.score).toBeCloseTo(0.55, 2);
    expect(result.label).toBe('positive');
    expect(Array.isArray(result.themes)).toBe(true);
    expect(result.themes).toEqual(expect.arrayContaining(['great close rate']));
    expect(Array.isArray(result.riskSignals)).toBe(true);
    expect(result.riskSignals).toEqual(['workload']);
  });
});

// =============================================================================
// buildTeamMorale
// =============================================================================

describe('buildTeamMorale', () => {
  const isoWeek = '2026-W25';

  test('aggregates submitted reflections for the head\'s team and upserts a MoraleSummary with scope=team', async () => {
    const teamMembers = [
      { _id: UID1 },
      { _id: UID2 },
    ];
    mockGetTeam.mockResolvedValueOnce(teamMembers);

    const leanReflections = [
      makeLeanReflection(UID1),
      makeLeanReflection(UID2, { sentiment: null }),
    ];
    // mockReflectionFindImpl controls what .find().lean() resolves to
    mockReflectionFindImpl.mockResolvedValueOnce(leanReflections);

    const moralePayload = {
      moraleScore:         72,
      narrative:           'The team had a strong week.',
      topPositiveThemes:   ['pipeline momentum'],
      topNegativeThemes:   ['documentation lag'],
      peopleToCheckIn:     [],
      risks:               [],
    };
    mockMessagesCreate.mockResolvedValueOnce(mockAnthropicResponse(moralePayload));

    // Prior week: no data → trendVsLastWeek = null
    mockMoraleFindOneImpl.mockResolvedValueOnce(null);

    const returnedDoc = {
      _id:   new mongoose.Types.ObjectId(),
      scope: 'team',
      head:  HEAD_ID,
      isoWeek,
      moraleScore: 72,
    };
    mockMoraleFindOneAndUpdate.mockResolvedValueOnce(returnedDoc);

    const result = await buildTeamMorale(ORG, HEAD_USER, isoWeek);

    // hierarchyService.getTeam was called with the head
    expect(mockGetTeam).toHaveBeenCalledWith(HEAD_USER);

    // WeeklyReflection.find scoped to org + isoWeek + submitted + team member ids
    expect(mockReflectionFind).toHaveBeenCalledWith(
      expect.objectContaining({
        organization: ORG,
        isoWeek,
        status: 'submitted',
      })
    );

    // MoraleSummary was upserted with correct scope + head
    expect(mockMoraleFindOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'team', head: HEAD_ID, isoWeek }),
      expect.objectContaining({ $set: expect.objectContaining({ moraleScore: 72 }) }),
      expect.any(Object)
    );

    expect(result.scope).toBe('team');
  });

  test('upserts with reflectionsAnalyzed = 0 when no members submitted', async () => {
    mockGetTeam.mockResolvedValueOnce([{ _id: UID1 }]);
    mockReflectionFindImpl.mockResolvedValueOnce([]); // no submitted reflections
    mockMoraleFindOneImpl.mockResolvedValueOnce(null);

    const returnedDoc = {
      _id: new mongoose.Types.ObjectId(),
      scope: 'team',
      head: HEAD_ID,
      isoWeek,
      moraleScore: 50,
      reflectionsAnalyzed: 0,
    };
    mockMoraleFindOneAndUpdate.mockResolvedValueOnce(returnedDoc);

    const result = await buildTeamMorale(ORG, HEAD_USER, isoWeek);

    expect(mockMoraleFindOneAndUpdate).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        $set: expect.objectContaining({ reflectionsAnalyzed: 0 }),
      }),
      expect.any(Object)
    );
    expect(result.reflectionsAnalyzed).toBe(0);
  });
});

// =============================================================================
// buildOrgMorale
// =============================================================================

describe('buildOrgMorale', () => {
  const isoWeek = '2026-W25';

  test('fetches all submitted org reflections and upserts scope=org MoraleSummary with head=null', async () => {
    const reflections = [
      makeLeanReflection(UID1),
      makeLeanReflection(UID2),
    ];
    mockReflectionFindImpl.mockResolvedValueOnce(reflections);

    const moralePayload = {
      moraleScore:         65,
      narrative:           'Mixed signals across the org.',
      topPositiveThemes:   ['deal momentum'],
      topNegativeThemes:   ['process bottlenecks'],
      peopleToCheckIn:     [{ userId: String(UID1), reason: 'burnout signals' }],
      risks:               ['widespread workload pressure'],
    };
    mockMessagesCreate.mockResolvedValueOnce(mockAnthropicResponse(moralePayload));

    mockMoraleFindOneImpl.mockResolvedValueOnce(null); // no prior week data

    const returnedDoc = {
      _id:   new mongoose.Types.ObjectId(),
      scope: 'org',
      head:  null,
      isoWeek,
      moraleScore: 65,
    };
    mockMoraleFindOneAndUpdate.mockResolvedValueOnce(returnedDoc);

    const result = await buildOrgMorale(ORG, isoWeek);

    // org scope query — no team filter
    expect(mockReflectionFind).toHaveBeenCalledWith(
      expect.objectContaining({
        organization: ORG,
        isoWeek,
        status: 'submitted',
      })
    );

    // head must be null for org scope
    expect(mockMoraleFindOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'org', head: null, isoWeek }),
      expect.any(Object),
      expect.any(Object)
    );

    expect(result.scope).toBe('org');
  });

  test('uses trendVsLastWeek when prior week summary exists', async () => {
    mockReflectionFindImpl.mockResolvedValueOnce([makeLeanReflection(UID1)]);

    mockMessagesCreate.mockResolvedValueOnce(
      mockAnthropicResponse({
        moraleScore:       70,
        narrative:         'Good week.',
        topPositiveThemes: [],
        topNegativeThemes: [],
        peopleToCheckIn:   [],
        risks:             [],
      })
    );

    // Prior week had moraleScore 60 → trend = 70 - 60 = +10
    mockMoraleFindOneImpl.mockResolvedValueOnce({ moraleScore: 60 });

    const returnedDoc = {
      _id: new mongoose.Types.ObjectId(),
      scope: 'org',
      head: null,
      isoWeek,
      moraleScore: 70,
      trendVsLastWeek: 10,
    };
    mockMoraleFindOneAndUpdate.mockResolvedValueOnce(returnedDoc);

    const result = await buildOrgMorale(ORG, isoWeek);

    // The $set passed to findOneAndUpdate should contain trendVsLastWeek = 10
    const setArg = mockMoraleFindOneAndUpdate.mock.calls[0][1].$set;
    expect(setArg.trendVsLastWeek).toBe(10);
  });
});
