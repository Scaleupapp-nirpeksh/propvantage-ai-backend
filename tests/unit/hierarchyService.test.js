// tests/unit/hierarchyService.test.js
// Unit tests for the hierarchy resolver service.
// Uses jest.unstable_mockModule — no live Mongo.
import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';

// ─── Mock User model ──────────────────────────────────────────────────────────
const mockUserFind = jest.fn();
jest.unstable_mockModule('../../models/userModel.js', () => ({
  default: { find: mockUserFind },
}));

// Helper: wrap mockUserFind to return a lean array
const usersFind = (arr) =>
  mockUserFind.mockReturnValue({ lean: () => Promise.resolve(arr) });

// ─── Import service under test ────────────────────────────────────────────────
const {
  DEPARTMENT_BY_ROLE,
  HEAD_ROLE_BY_DEPARTMENT,
  resolveDepartment,
  getHeadRoleForUser,
  isOwnerLevel,
  getTeam,
  getManagerChain,
  getSubtree,
} = await import('../../services/people/hierarchyService.js');

const ORG = new mongoose.Types.ObjectId();

// ─── Helpers to build minimal user objects ────────────────────────────────────
const makeUser = (role, overrides = {}) => ({
  _id: new mongoose.Types.ObjectId(),
  organization: ORG,
  role,
  roleRef: null,
  ...overrides,
});

const makeCustomUser = (department, overrides = {}) => ({
  _id: new mongoose.Types.ObjectId(),
  organization: ORG,
  role: null,
  roleRef: { department, isOwnerRole: false },
  ...overrides,
});

const makeOwnerRoleUser = (overrides = {}) => ({
  _id: new mongoose.Types.ObjectId(),
  organization: ORG,
  role: null,
  roleRef: { isOwnerRole: true },
  ...overrides,
});

beforeEach(() => {
  mockUserFind.mockReset();
});

// ─── DEPARTMENT_BY_ROLE map ───────────────────────────────────────────────────
describe('DEPARTMENT_BY_ROLE', () => {
  test('Sales Executive maps to Sales Head', () => {
    expect(DEPARTMENT_BY_ROLE['Sales Executive']).toBe('Sales Head');
  });
  test('Channel Partner Agent maps to Sales Head', () => {
    expect(DEPARTMENT_BY_ROLE['Channel Partner Agent']).toBe('Sales Head');
  });
  test('Channel Partner Manager maps to Sales Head', () => {
    expect(DEPARTMENT_BY_ROLE['Channel Partner Manager']).toBe('Sales Head');
  });
  test('Channel Partner Admin maps to Sales Head', () => {
    expect(DEPARTMENT_BY_ROLE['Channel Partner Admin']).toBe('Sales Head');
  });
  test('Sales Manager maps to Sales Head', () => {
    expect(DEPARTMENT_BY_ROLE['Sales Manager']).toBe('Sales Head');
  });
  test('Finance Manager maps to Finance Head', () => {
    expect(DEPARTMENT_BY_ROLE['Finance Manager']).toBe('Finance Head');
  });
  test('Head roles map to Business Head', () => {
    expect(DEPARTMENT_BY_ROLE['Sales Head']).toBe('Business Head');
    expect(DEPARTMENT_BY_ROLE['Finance Head']).toBe('Business Head');
    expect(DEPARTMENT_BY_ROLE['Legal Head']).toBe('Business Head');
    expect(DEPARTMENT_BY_ROLE['CRM Head']).toBe('Business Head');
    expect(DEPARTMENT_BY_ROLE['Marketing Head']).toBe('Business Head');
    expect(DEPARTMENT_BY_ROLE['Project Director']).toBe('Business Head');
  });
});

// ─── HEAD_ROLE_BY_DEPARTMENT map ─────────────────────────────────────────────
describe('HEAD_ROLE_BY_DEPARTMENT', () => {
  test('Sales Head is head of Sales department', () => {
    expect(HEAD_ROLE_BY_DEPARTMENT['Sales Head']).toBe('Sales Head');
  });
  test('Finance Head is head of Finance department', () => {
    expect(HEAD_ROLE_BY_DEPARTMENT['Finance Head']).toBe('Finance Head');
  });
});

// ─── resolveDepartment ────────────────────────────────────────────────────────
describe('resolveDepartment', () => {
  test('Sales Executive → "Sales Head" (via role string)', () => {
    expect(resolveDepartment(makeUser('Sales Executive'))).toBe('Sales Head');
  });
  test('Channel Partner Agent → "Sales Head" (via role string)', () => {
    expect(resolveDepartment(makeUser('Channel Partner Agent'))).toBe('Sales Head');
  });
  test('Finance Manager → "Finance Head"', () => {
    expect(resolveDepartment(makeUser('Finance Manager'))).toBe('Finance Head');
  });
  test('Sales Head → "Business Head" (head rolls up to owner tier)', () => {
    expect(resolveDepartment(makeUser('Sales Head'))).toBe('Business Head');
  });
  test('Business Head → "Business Head" (owner-tier role)', () => {
    expect(resolveDepartment(makeUser('Business Head'))).toBe('Business Head');
  });
  test('Custom role with roleRef.department set → returns that department', () => {
    const user = makeCustomUser('Finance Head');
    expect(resolveDepartment(user)).toBe('Finance Head');
  });
  test('Custom role with no matching department → "unassigned"', () => {
    const user = makeCustomUser(undefined);
    expect(resolveDepartment(user)).toBe('unassigned');
  });
  test('No role and no roleRef → "unassigned"', () => {
    const user = { _id: new mongoose.Types.ObjectId(), organization: ORG, role: null, roleRef: null };
    expect(resolveDepartment(user)).toBe('unassigned');
  });
  test('roleRef.isOwnerRole true → "Business Head"', () => {
    expect(resolveDepartment(makeOwnerRoleUser())).toBe('Business Head');
  });
});

// ─── isOwnerLevel ─────────────────────────────────────────────────────────────
describe('isOwnerLevel', () => {
  test('Business Head role → true', () => {
    expect(isOwnerLevel(makeUser('Business Head'))).toBe(true);
  });
  test('roleRef.isOwnerRole true → true', () => {
    expect(isOwnerLevel(makeOwnerRoleUser())).toBe(true);
  });
  test('Sales Head → false', () => {
    expect(isOwnerLevel(makeUser('Sales Head'))).toBe(false);
  });
  test('Sales Executive → false', () => {
    expect(isOwnerLevel(makeUser('Sales Executive'))).toBe(false);
  });
  test('null role, null roleRef → false', () => {
    expect(isOwnerLevel({ role: null, roleRef: null })).toBe(false);
  });
});

// ─── getHeadRoleForUser ───────────────────────────────────────────────────────
describe('getHeadRoleForUser', () => {
  test('Sales Executive → "Sales Head"', () => {
    expect(getHeadRoleForUser(makeUser('Sales Executive'))).toBe('Sales Head');
  });
  test('Channel Partner Agent → "Sales Head"', () => {
    expect(getHeadRoleForUser(makeUser('Channel Partner Agent'))).toBe('Sales Head');
  });
  test('Finance Manager → "Finance Head"', () => {
    expect(getHeadRoleForUser(makeUser('Finance Manager'))).toBe('Finance Head');
  });
  test('Sales Head → "Business Head" (head reports to owner)', () => {
    expect(getHeadRoleForUser(makeUser('Sales Head'))).toBe('Business Head');
  });
  test('Business Head → null (no manager above owner)', () => {
    expect(getHeadRoleForUser(makeUser('Business Head'))).toBeNull();
  });
  test('roleRef.isOwnerRole true → null', () => {
    expect(getHeadRoleForUser(makeOwnerRoleUser())).toBeNull();
  });
  test('unmapped custom role → "Business Head" (unassigned rolls up to owner)', () => {
    const user = makeCustomUser(undefined);
    expect(getHeadRoleForUser(user)).toBe('Business Head');
  });
});

// ─── getTeam ─────────────────────────────────────────────────────────────────
describe('getTeam', () => {
  test('Sales Head gets all users whose department is Sales Head, excluding head itself', async () => {
    const head = makeUser('Sales Head');
    const member1 = makeUser('Sales Executive');
    const member2 = makeUser('Channel Partner Agent');
    usersFind([member1, member2]);

    const result = await getTeam(head);
    expect(result).toEqual([member1, member2]);

    // Verify query was org-scoped and excluded the head
    expect(mockUserFind).toHaveBeenCalledWith(
      expect.objectContaining({
        organization: ORG,
        _id: expect.objectContaining({ $ne: head._id }),
      })
    );
  });

  test('Finance Head gets Finance Manager members', async () => {
    const head = makeUser('Finance Head');
    const member = makeUser('Finance Manager');
    usersFind([member]);

    const result = await getTeam(head);
    expect(result).toEqual([member]);
  });

  test('owner-level user sees all org members (excluding self)', async () => {
    const owner = makeUser('Business Head');
    const everyone = [makeUser('Sales Head'), makeUser('Finance Manager')];
    usersFind(everyone);

    const result = await getTeam(owner);
    expect(result).toEqual(everyone);
    // For owner, no role filter is applied
    expect(mockUserFind).toHaveBeenCalledWith(
      expect.objectContaining({
        organization: ORG,
        _id: expect.objectContaining({ $ne: owner._id }),
      })
    );
  });
});

// ─── getManagerChain ─────────────────────────────────────────────────────────
describe('getManagerChain', () => {
  test('Sales Executive → [Sales Head user, Business Head user]', async () => {
    const salesHead = makeUser('Sales Head');
    const businessHead = makeUser('Business Head');

    // First call: find Sales Head
    mockUserFind
      .mockReturnValueOnce({ lean: () => Promise.resolve([salesHead]) })
      // Second call: find Business Head / owner
      .mockReturnValueOnce({ lean: () => Promise.resolve([businessHead]) });

    const chain = await getManagerChain(makeUser('Sales Executive'));
    expect(chain).toEqual([salesHead, businessHead]);
  });

  test('Sales Head → [Business Head user]', async () => {
    const businessHead = makeUser('Business Head');
    mockUserFind.mockReturnValueOnce({ lean: () => Promise.resolve([businessHead]) });

    const chain = await getManagerChain(makeUser('Sales Head'));
    expect(chain).toEqual([businessHead]);
  });

  test('Business Head → empty array (no manager above owner)', async () => {
    const chain = await getManagerChain(makeUser('Business Head'));
    expect(chain).toEqual([]);
    expect(mockUserFind).not.toHaveBeenCalled();
  });

  test('roleRef.isOwnerRole true → empty array', async () => {
    const chain = await getManagerChain(makeOwnerRoleUser());
    expect(chain).toEqual([]);
  });

  test('unmapped custom role → [Business Head user] (unassigned rolls up to owner)', async () => {
    const businessHead = makeUser('Business Head');
    mockUserFind.mockReturnValueOnce({ lean: () => Promise.resolve([businessHead]) });

    const chain = await getManagerChain(makeCustomUser(undefined));
    expect(chain).toEqual([businessHead]);
  });
});

// ─── getSubtree ───────────────────────────────────────────────────────────────
describe('getSubtree', () => {
  test('Owner → scope "org", all org user ids', async () => {
    const owner = makeUser('Business Head');
    const u1 = makeUser('Sales Head');
    const u2 = makeUser('Finance Manager');
    usersFind([u1, u2]);

    const result = await getSubtree(owner);
    expect(result.scope).toBe('org');
    expect(result.userIds).toEqual(expect.arrayContaining([u1._id, u2._id]));
    expect(result.userIds).toHaveLength(2);
  });

  test('roleRef.isOwnerRole → scope "org"', async () => {
    const owner = makeOwnerRoleUser();
    usersFind([makeUser('Sales Head')]);

    const result = await getSubtree(owner);
    expect(result.scope).toBe('org');
  });

  test('Head → scope "department", correct userIds (excluding head)', async () => {
    const head = makeUser('Sales Head');
    const member1 = makeUser('Sales Executive');
    const member2 = makeUser('Channel Partner Agent');
    usersFind([member1, member2]);

    const result = await getSubtree(head);
    expect(result.scope).toBe('department');
    expect(result.userIds).toEqual(expect.arrayContaining([member1._id, member2._id]));
    expect(result.userIds).toHaveLength(2);
  });

  test('member → scope "self", only own id', async () => {
    const member = makeUser('Sales Executive');

    const result = await getSubtree(member);
    expect(result.scope).toBe('self');
    expect(result.userIds).toEqual([member._id]);
    expect(mockUserFind).not.toHaveBeenCalled();
  });

  test('unmapped custom role (unassigned) → scope "self"', async () => {
    const user = makeCustomUser(undefined);

    const result = await getSubtree(user);
    expect(result.scope).toBe('self');
    expect(result.userIds).toEqual([user._id]);
  });

  test('Finance Head → scope "department" with Finance Manager members', async () => {
    const head = makeUser('Finance Head');
    const fm = makeUser('Finance Manager');
    usersFind([fm]);

    const result = await getSubtree(head);
    expect(result.scope).toBe('department');
    expect(result.userIds).toEqual([fm._id]);
  });
});
