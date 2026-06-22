// tests/unit/reflectionReminders.test.js
// Unit tests for jobs/reflectionReminders.js
// Mocks all I/O (DB models, notificationService, reflectionService). No live Mongo.

import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';

// =============================================================================
// MOCKS
// =============================================================================

// Organization model
const mockOrgFind = jest.fn();
jest.unstable_mockModule('../../models/organizationModel.js', () => ({
  default: { find: mockOrgFind },
}));

// User model
const mockUserFind = jest.fn();
jest.unstable_mockModule('../../models/userModel.js', () => ({
  default: { find: mockUserFind },
}));

// WeeklyReflection model
const mockWRFindOne = jest.fn();
jest.unstable_mockModule('../../models/weeklyReflectionModel.js', () => ({
  default: { findOne: mockWRFindOne },
}));

// reflectionService — only isoWeekOf is needed
const mockIsoWeekOf = jest.fn(() => '2026-W26');
jest.unstable_mockModule('../../services/people/reflectionService.js', () => ({
  isoWeekOf: mockIsoWeekOf,
  upsertDraft: jest.fn(),
  submit: jest.fn(),
  currentStatus: jest.fn(),
  transcribe: jest.fn(),
  ack: jest.fn(),
  listForUser: jest.fn(),
}));

// notificationService
const mockCreateNotification = jest.fn();
jest.unstable_mockModule('../../services/notificationService.js', () => ({
  createNotification: mockCreateNotification,
}));

// =============================================================================
// IMPORT UNDER TEST
// =============================================================================

const { sendReflectionDueReminders } = await import('../../jobs/reflectionReminders.js');

// =============================================================================
// FIXTURES
// =============================================================================

const ORG_ID  = new mongoose.Types.ObjectId();
const USER_A  = { _id: new mongoose.Types.ObjectId(), role: 'Sales Executive' };
const USER_B  = { _id: new mongoose.Types.ObjectId(), role: 'Sales Manager' };

// Helper: configure Organization.find to return a single org
function withOrgs(...orgs) {
  mockOrgFind.mockReturnValueOnce({
    select: jest.fn().mockReturnThis(),
    lean:   jest.fn().mockResolvedValueOnce(orgs),
  });
}

// Helper: configure User.find to return given members
function withMembers(...members) {
  mockUserFind.mockReturnValueOnce({
    select: jest.fn().mockReturnThis(),
    lean:   jest.fn().mockResolvedValueOnce(members),
  });
}

// Helper: WeeklyReflection.findOne().lean() returns value
function withReflection(value) {
  mockWRFindOne.mockReturnValueOnce({ lean: () => Promise.resolve(value) });
}

beforeEach(() => {
  jest.resetAllMocks();
  mockIsoWeekOf.mockReturnValue('2026-W26');
  mockCreateNotification.mockResolvedValue({ _id: new mongoose.Types.ObjectId() });
});

// =============================================================================
// TESTS
// =============================================================================

describe('sendReflectionDueReminders', () => {
  test('emits reflection_due only to members without a submitted current-week reflection', async () => {
    // USER_A has submitted; USER_B has not
    withOrgs({ _id: ORG_ID, name: 'Acme' });
    withMembers(USER_A, USER_B);

    // USER_A — submitted reflection exists
    withReflection({ _id: new mongoose.Types.ObjectId(), status: 'submitted' });
    // USER_B — no submitted reflection
    withReflection(null);

    const summary = await sendReflectionDueReminders(new Date('2026-06-26T01:00:00Z'));

    expect(summary.orgs).toBe(1);
    expect(summary.notified).toBe(1);
    expect(summary.failed).toHaveLength(0);

    // createNotification called exactly once — for USER_B only
    expect(mockCreateNotification).toHaveBeenCalledTimes(1);
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        organization: ORG_ID,
        recipient:    USER_B._id,
        type:         'reflection_due',
      })
    );
  });

  test('does NOT notify members who have already submitted', async () => {
    withOrgs({ _id: ORG_ID, name: 'Acme' });
    withMembers(USER_A);

    // USER_A — submitted
    withReflection({ _id: new mongoose.Types.ObjectId(), status: 'submitted' });

    const summary = await sendReflectionDueReminders(new Date('2026-06-26T01:00:00Z'));

    expect(summary.notified).toBe(0);
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });

  test('notifies all members when none have submitted', async () => {
    withOrgs({ _id: ORG_ID, name: 'Acme' });
    withMembers(USER_A, USER_B);

    // Neither has submitted
    withReflection(null);
    withReflection(null);

    const summary = await sendReflectionDueReminders(new Date('2026-06-26T01:00:00Z'));

    expect(summary.notified).toBe(2);
    expect(mockCreateNotification).toHaveBeenCalledTimes(2);
  });

  test('uses isoWeekOf(asOf) for the current-week lookup', async () => {
    mockIsoWeekOf.mockReturnValue('2026-W20');
    withOrgs({ _id: ORG_ID, name: 'Acme' });
    withMembers(USER_A);
    withReflection(null);

    await sendReflectionDueReminders(new Date('2026-05-15T01:00:00Z'));

    // isoWeekOf should have been called with the asOf date
    expect(mockIsoWeekOf).toHaveBeenCalledWith(new Date('2026-05-15T01:00:00Z'));

    // The reflection lookup must use the week returned by isoWeekOf
    expect(mockWRFindOne).toHaveBeenCalledWith(
      expect.objectContaining({ isoWeek: '2026-W20' })
    );
  });

  test('returns zero counts when there are no orgs', async () => {
    withOrgs(); // empty

    const summary = await sendReflectionDueReminders();

    expect(summary.orgs).toBe(0);
    expect(summary.notified).toBe(0);
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });

  test('returns zero notified when org has no active members', async () => {
    withOrgs({ _id: ORG_ID, name: 'Acme' });
    withMembers(); // empty

    const summary = await sendReflectionDueReminders();

    expect(summary.notified).toBe(0);
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });

  test('handles Organization.find failure gracefully', async () => {
    mockOrgFind.mockReturnValueOnce({
      select: jest.fn().mockReturnThis(),
      lean:   jest.fn().mockRejectedValueOnce(new Error('DB down')),
    });

    const summary = await sendReflectionDueReminders();

    expect(summary.notified).toBe(0);
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });

  test('processes remaining orgs when User.find fails for one org', async () => {
    const ORG2 = new mongoose.Types.ObjectId();

    // Two orgs
    mockOrgFind.mockReturnValueOnce({
      select: jest.fn().mockReturnThis(),
      lean:   jest.fn().mockResolvedValueOnce([
        { _id: ORG_ID, name: 'Org1' },
        { _id: ORG2,   name: 'Org2' },
      ]),
    });

    // First org: User.find fails
    mockUserFind
      .mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        lean:   jest.fn().mockRejectedValueOnce(new Error('timeout')),
      })
      // Second org: one member without a reflection
      .mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        lean:   jest.fn().mockResolvedValueOnce([USER_A]),
      });

    withReflection(null);

    const summary = await sendReflectionDueReminders();

    expect(summary.orgs).toBe(2);
    expect(summary.notified).toBe(1);   // only org2's member was notified
    expect(summary.failed).toHaveLength(1);
    expect(summary.failed[0].step).toBe('fetchMembers');
  });
});
