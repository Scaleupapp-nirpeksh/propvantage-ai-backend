// tests/unit/workspaceCatalogRegistry.test.js
import { getCatalog, listCatalogModules } from '../../services/workspace/catalogs/index.js';
import { leadsCatalog } from '../../services/workspace/catalogs/leadsCatalog.js';

describe('catalog registry', () => {
  it('returns the leads catalog by module key', () => {
    expect(getCatalog('leads')).toBe(leadsCatalog);
  });

  it('lists the currently registered modules (leads is wired in this region)', () => {
    expect(listCatalogModules()).toContain('leads');
  });

  it('throws a clear error for an unknown module', () => {
    expect(() => getCatalog('invoices')).toThrow(/Unknown or unregistered module: invoices/);
  });

  it('throws for a missing module key', () => {
    expect(() => getCatalog()).toThrow(/module is required/);
  });
});
