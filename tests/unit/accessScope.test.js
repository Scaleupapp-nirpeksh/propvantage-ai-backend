// tests/unit/accessScope.test.js
// Verifies the off-request project-access derivation used by the scheduled-report job.
// Security-critical: org owners → null (all projects); others → bounded assignment ids;
// unknown user → [] (fail closed, never widens to "all"). ESM mocking pattern.
import { jest } from '@jest/globals';

const findById = jest.fn();
const find = jest.fn();

jest.unstable_mockModule('../../models/userModel.js', () => ({ default: { findById } }));
jest.unstable_mockModule('../../models/projectAssignmentModel.js', () => ({ default: { find } }));

const { getAccessibleProjectIdsForUser } = await import('../../services/reports/accessScope.js');

const userQuery = (user) => ({ select: () => ({ populate: () => Promise.resolve(user) }) });
const assignQuery = (rows) => ({ select: () => ({ lean: () => Promise.resolve(rows) }) });

beforeEach(() => { findById.mockReset(); find.mockReset(); });

describe('getAccessibleProjectIdsForUser', () => {
  it('returns null (all projects) for an org owner and does not query assignments', async () => {
    findById.mockReturnValue(userQuery({ _id: 'u1', organization: 'org1', roleRef: { isOwnerRole: true } }));
    const result = await getAccessibleProjectIdsForUser('u1');
    expect(result).toBeNull();
    expect(find).not.toHaveBeenCalled();
  });

  it('returns the bounded assignment project ids (as strings) for a non-owner', async () => {
    findById.mockReturnValue(userQuery({ _id: 'u2', organization: 'org1', roleRef: { isOwnerRole: false } }));
    find.mockReturnValue(assignQuery([{ project: 'p1' }, { project: 'p2' }]));
    const result = await getAccessibleProjectIdsForUser('u2');
    expect(result).toEqual(['p1', 'p2']);
    expect(find).toHaveBeenCalledWith({ organization: 'org1', user: 'u2' });
  });

  it('returns [] for a non-owner with no assignments (fail closed, downstream treats as no access)', async () => {
    findById.mockReturnValue(userQuery({ _id: 'u3', organization: 'org1', roleRef: { isOwnerRole: false } }));
    find.mockReturnValue(assignQuery([]));
    expect(await getAccessibleProjectIdsForUser('u3')).toEqual([]);
  });

  it('returns [] for an unknown user and never queries assignments (never widens to all)', async () => {
    findById.mockReturnValue(userQuery(null));
    const result = await getAccessibleProjectIdsForUser('ghost');
    expect(result).toEqual([]);
    expect(find).not.toHaveBeenCalled();
  });

  it('returns [] when no user id is provided', async () => {
    expect(await getAccessibleProjectIdsForUser(null)).toEqual([]);
    expect(findById).not.toHaveBeenCalled();
  });
});
