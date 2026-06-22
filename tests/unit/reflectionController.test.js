// tests/unit/reflectionController.test.js
// Thin handler tests for controllers/reflectionController.js
// Mocks reflectionService + WeeklyReflection model. No DB/network.

import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';

// =============================================================================
// MOCKS
// =============================================================================

// reflectionService
const mockCurrentStatus = jest.fn();
const mockUpsertDraft   = jest.fn();
const mockSubmit        = jest.fn();
const mockAck           = jest.fn();
const mockTranscribe    = jest.fn();
const mockIsoWeekOf     = jest.fn(() => '2026-W26');
const mockListForUser   = jest.fn();

jest.unstable_mockModule('../../services/people/reflectionService.js', () => ({
  currentStatus: mockCurrentStatus,
  upsertDraft:   mockUpsertDraft,
  submit:        mockSubmit,
  ack:           mockAck,
  transcribe:    mockTranscribe,
  isoWeekOf:     mockIsoWeekOf,
  listForUser:   mockListForUser,
}));

// WeeklyReflection model
const mockFindOne = jest.fn();
jest.unstable_mockModule('../../models/weeklyReflectionModel.js', () => ({
  default: { findOne: mockFindOne },
  REQUIRED_ANSWER_FIELDS: ['wins', 'areasToImprove', 'dislikes', 'achievements', 'plansNextWeek'],
  MIN_ANSWER_LENGTH: 500,
}));

// =============================================================================
// CONTROLLER IMPORT
// =============================================================================

const {
  listMine,
  getCurrent,
  getReflection,
  saveDraft,
  submitReflection,
  ackReflection,
  transcribeAudio,
} = await import('../../controllers/reflectionController.js');

// =============================================================================
// TEST HELPERS
// =============================================================================

const ORG = new mongoose.Types.ObjectId();
const UID = new mongoose.Types.ObjectId();
const USER = { _id: UID, organization: ORG };

const mockRes = () => {
  const res = {};
  res.json   = jest.fn((payload) => { res._json = payload; return res; });
  res.status = jest.fn((code)    => { res._status = code;  return res; });
  return res;
};

const mockNext = jest.fn();

beforeEach(() => {
  jest.resetAllMocks();
  mockNext.mockReset();
  // Restore default isoWeekOf after resetAllMocks clears it
  mockIsoWeekOf.mockReturnValue('2026-W26');
});

// =============================================================================
// listMine
// =============================================================================

describe('listMine', () => {
  test('returns the list for req.user wrapped in { success, data }', async () => {
    const docs = [
      { _id: new mongoose.Types.ObjectId(), isoWeek: '2026-W26', status: 'submitted' },
      { _id: new mongoose.Types.ObjectId(), isoWeek: '2026-W25', status: 'submitted' },
    ];
    mockListForUser.mockResolvedValueOnce(docs);

    const req = { user: USER, query: {} };
    const res = mockRes();
    await listMine(req, res, mockNext);

    expect(mockListForUser).toHaveBeenCalledWith(USER, 12);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: docs });
  });

  test('passes ?limit= to listForUser (capped at 50)', async () => {
    mockListForUser.mockResolvedValueOnce([]);

    const req = { user: USER, query: { limit: '5' } };
    const res = mockRes();
    await listMine(req, res, mockNext);

    expect(mockListForUser).toHaveBeenCalledWith(USER, 5);
  });

  test('caps limit at 50 when a larger value is supplied', async () => {
    mockListForUser.mockResolvedValueOnce([]);

    const req = { user: USER, query: { limit: '100' } };
    const res = mockRes();
    await listMine(req, res, mockNext);

    expect(mockListForUser).toHaveBeenCalledWith(USER, 50);
  });

  test('uses default limit 12 when ?limit= is absent or invalid', async () => {
    mockListForUser.mockResolvedValueOnce([]);

    const req = { user: USER, query: { limit: 'bad' } };
    const res = mockRes();
    await listMine(req, res, mockNext);

    expect(mockListForUser).toHaveBeenCalledWith(USER, 12);
  });

  test('propagates service errors to next', async () => {
    const err = new Error('DB error');
    mockListForUser.mockRejectedValueOnce(err);

    const req = { user: USER, query: {} };
    const res = mockRes();
    await listMine(req, res, mockNext);

    expect(mockNext).toHaveBeenCalledWith(err);
  });
});

// =============================================================================
// getCurrent
// =============================================================================

describe('getCurrent', () => {
  test('returns currentStatus result wrapped in { success, data }', async () => {
    const statusPayload = {
      isoWeek:   '2026-W26',
      status:    'draft',
      weekStart: new Date(),
      weekEnd:   new Date(),
      overdue:   false,
    };
    mockCurrentStatus.mockResolvedValueOnce(statusPayload);

    const req = { user: USER };
    const res = mockRes();
    await getCurrent(req, res, mockNext);

    expect(mockCurrentStatus).toHaveBeenCalledWith(USER);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: statusPayload });
  });

  test('propagates service errors to next', async () => {
    const err = new Error('DB error');
    mockCurrentStatus.mockRejectedValueOnce(err);

    const req = { user: USER };
    const res = mockRes();
    await getCurrent(req, res, mockNext);

    expect(mockNext).toHaveBeenCalledWith(err);
  });
});

// =============================================================================
// getReflection
// =============================================================================

describe('getReflection', () => {
  test('returns the found document', async () => {
    const doc = { _id: new mongoose.Types.ObjectId(), isoWeek: '2026-W25', status: 'submitted' };
    mockFindOne.mockReturnValueOnce({ lean: () => Promise.resolve(doc) });

    const req = { user: USER, query: { isoWeek: '2026-W25' } };
    const res = mockRes();
    await getReflection(req, res, mockNext);

    expect(res.json).toHaveBeenCalledWith({ success: true, data: doc });
  });

  test('calls next with 404 when not found', async () => {
    mockFindOne.mockReturnValueOnce({ lean: () => Promise.resolve(null) });

    const req = { user: USER, query: { isoWeek: '2026-W25' } };
    const res = mockRes();
    await getReflection(req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });

  test('defaults to current week when isoWeek not in query', async () => {
    const doc = { _id: new mongoose.Types.ObjectId(), isoWeek: '2026-W26', status: 'none' };
    mockFindOne.mockReturnValueOnce({ lean: () => Promise.resolve(doc) });

    const req = { user: USER, query: {} };
    const res = mockRes();
    await getReflection(req, res, mockNext);

    // isoWeekOf mock returns '2026-W26'
    expect(mockFindOne).toHaveBeenCalledWith(
      expect.objectContaining({ isoWeek: '2026-W26' })
    );
  });
});

// =============================================================================
// saveDraft
// =============================================================================

describe('saveDraft', () => {
  test('calls upsertDraft with correct params and returns { success, data }', async () => {
    const doc = { _id: new mongoose.Types.ObjectId(), status: 'draft' };
    mockUpsertDraft.mockResolvedValueOnce(doc);

    const req = {
      user:   USER,
      params: { isoWeek: '2026-W26' },
      body:   { wins: 'a'.repeat(500) },
    };
    const res = mockRes();
    await saveDraft(req, res, mockNext);

    expect(mockUpsertDraft).toHaveBeenCalledWith(USER, '2026-W26', req.body);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: doc });
  });

  test('accepts answers nested under req.body.answers', async () => {
    const answers = { wins: 'some content' };
    const doc = { _id: new mongoose.Types.ObjectId() };
    mockUpsertDraft.mockResolvedValueOnce(doc);

    const req = {
      user:   USER,
      params: { isoWeek: '2026-W26' },
      body:   { answers },
    };
    const res = mockRes();
    await saveDraft(req, res, mockNext);

    expect(mockUpsertDraft).toHaveBeenCalledWith(USER, '2026-W26', answers);
  });

  test('propagates lock error from service', async () => {
    const err = Object.assign(new Error('locked'), { statusCode: 400 });
    mockUpsertDraft.mockRejectedValueOnce(err);

    const req = {
      user:   USER,
      params: { isoWeek: '2020-W01' },
      body:   {},
    };
    const res = mockRes();
    await saveDraft(req, res, mockNext);
    expect(mockNext).toHaveBeenCalledWith(err);
  });

  test('strips unknown fields from body before calling upsertDraft', async () => {
    const doc = { _id: new mongoose.Types.ObjectId(), status: 'draft' };
    mockUpsertDraft.mockResolvedValueOnce(doc);

    const req = {
      user:   USER,
      params: { isoWeek: '2026-W26' },
      body:   {
        wins:           'good wins',
        areasToImprove: 'some area',
        __proto__leak:  'ignored',
        adminFlag:      true,
        extraKey:       'should not pass through',
      },
    };
    const res = mockRes();
    await saveDraft(req, res, mockNext);

    // upsertDraft should receive ONLY the known answer fields
    const calledWith = mockUpsertDraft.mock.calls[0][2];
    expect(calledWith).toEqual({ wins: 'good wins', areasToImprove: 'some area' });
    expect(calledWith).not.toHaveProperty('adminFlag');
    expect(calledWith).not.toHaveProperty('extraKey');
    expect(calledWith).not.toHaveProperty('__proto__leak');
  });
});

// =============================================================================
// submitReflection
// =============================================================================

describe('submitReflection', () => {
  test('calls submit and returns the updated document', async () => {
    const doc = { _id: new mongoose.Types.ObjectId(), status: 'submitted' };
    mockSubmit.mockResolvedValueOnce(doc);

    const req = { user: USER, params: { isoWeek: '2026-W26' } };
    const res = mockRes();
    await submitReflection(req, res, mockNext);

    expect(mockSubmit).toHaveBeenCalledWith(USER, '2026-W26');
    expect(res.json).toHaveBeenCalledWith({ success: true, data: doc });
  });

  test('propagates validation error from service', async () => {
    const err = Object.assign(new Error('wins must be ≥500 chars'), {
      statusCode: 422,
      shortFields: ['wins'],
    });
    mockSubmit.mockRejectedValueOnce(err);

    const req = { user: USER, params: { isoWeek: '2026-W26' } };
    const res = mockRes();
    await submitReflection(req, res, mockNext);
    expect(mockNext).toHaveBeenCalledWith(err);
  });
});

// =============================================================================
// ackReflection
// =============================================================================

describe('ackReflection', () => {
  test('calls ack and returns the updated doc', async () => {
    const refId = new mongoose.Types.ObjectId();
    const doc   = { _id: refId, managerAck: { note: 'Great job', by: UID } };
    mockAck.mockResolvedValueOnce(doc);

    const req = {
      user:   USER,
      params: { id: refId.toString() },
      body:   { note: 'Great job' },
    };
    const res = mockRes();
    await ackReflection(req, res, mockNext);

    expect(mockAck).toHaveBeenCalledWith(USER, refId.toString(), 'Great job');
    expect(res.json).toHaveBeenCalledWith({ success: true, data: doc });
  });

  test('defaults note to empty string when not provided', async () => {
    const refId = new mongoose.Types.ObjectId();
    mockAck.mockResolvedValueOnce({ _id: refId });

    const req = {
      user:   USER,
      params: { id: refId.toString() },
      body:   {},
    };
    const res = mockRes();
    await ackReflection(req, res, mockNext);

    expect(mockAck).toHaveBeenCalledWith(USER, refId.toString(), '');
  });

  test('propagates 403 when manager not in chain', async () => {
    const err = Object.assign(new Error('Unauthorized'), { statusCode: 403 });
    mockAck.mockRejectedValueOnce(err);

    const req = {
      user:   USER,
      params: { id: new mongoose.Types.ObjectId().toString() },
      body:   {},
    };
    const res = mockRes();
    await ackReflection(req, res, mockNext);
    expect(mockNext).toHaveBeenCalledWith(err);
  });
});

// =============================================================================
// transcribeAudio
// =============================================================================

describe('transcribeAudio', () => {
  test('returns the transcript text when req.file is present', async () => {
    mockTranscribe.mockResolvedValueOnce('Hello transcribed text');

    const req = {
      user: USER,
      file: { buffer: Buffer.from('audio'), mimetype: 'audio/webm' },
    };
    const res = mockRes();
    await transcribeAudio(req, res, mockNext);

    expect(mockTranscribe).toHaveBeenCalledWith(req.file.buffer, req.file.mimetype);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { text: 'Hello transcribed text' } });
  });

  test('responds 400 when req.file is missing', async () => {
    const req = { user: USER, file: undefined };
    const res = mockRes();
    await transcribeAudio(req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
    expect(mockTranscribe).not.toHaveBeenCalled();
  });

  test('propagates transcription errors', async () => {
    const err = Object.assign(new Error('Audio transcription failed'), { statusCode: 502 });
    mockTranscribe.mockRejectedValueOnce(err);

    const req = {
      user: USER,
      file: { buffer: Buffer.from('bad'), mimetype: 'audio/mp3' },
    };
    const res = mockRes();
    await transcribeAudio(req, res, mockNext);
    expect(mockNext).toHaveBeenCalledWith(err);
  });
});
