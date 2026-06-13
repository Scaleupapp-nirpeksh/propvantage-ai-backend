// File: tests/unit/permissions.test.js
import { PERMISSIONS, ALL_PERMISSIONS } from '../../config/permissions.js';

describe('REPORTS permissions', () => {
  it('exposes view/manage/approve on PERMISSIONS.REPORTS', () => {
    expect(PERMISSIONS.REPORTS).toEqual({
      VIEW: 'reports:view',
      MANAGE: 'reports:manage',
      APPROVE: 'reports:approve',
    });
  });

  it('includes the reports permissions in ALL_PERMISSIONS', () => {
    expect(ALL_PERMISSIONS).toEqual(
      expect.arrayContaining(['reports:view', 'reports:manage', 'reports:approve'])
    );
  });
});
