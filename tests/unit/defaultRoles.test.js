// File: tests/unit/defaultRoles.test.js
import { DEFAULT_ROLES } from '../../data/defaultRoles.js';

const byName = (name) => DEFAULT_ROLES.find((r) => r.name === name);

describe('default role grants for reports', () => {
  it('Organization Owner has all three reports permissions', () => {
    const perms = byName('Organization Owner').permissions;
    expect(perms).toEqual(
      expect.arrayContaining(['reports:view', 'reports:manage', 'reports:approve'])
    );
  });

  it('Business Head has reports:manage', () => {
    expect(byName('Business Head').permissions).toContain('reports:manage');
  });

  it.each(['Project Director', 'Sales Head', 'Marketing Head', 'Finance Head'])(
    '%s can view, manage and approve reports',
    (roleName) => {
      const perms = byName(roleName).permissions;
      expect(perms).toContain('reports:view');
      expect(perms).toContain('reports:manage');
      expect(perms).toContain('reports:approve');
    }
  );

  it.each(['Sales Manager', 'Finance Manager', 'Sales Executive'])(
    '%s is not granted any reports permission',
    (roleName) => {
      const perms = byName(roleName).permissions;
      expect(perms).not.toContain('reports:view');
      expect(perms).not.toContain('reports:manage');
      expect(perms).not.toContain('reports:approve');
    }
  );
});
