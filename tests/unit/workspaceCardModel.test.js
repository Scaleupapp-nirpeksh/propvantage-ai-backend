// tests/unit/workspaceCardModel.test.js
import mongoose from 'mongoose';
import WorkspaceCard, { WORKSPACE_MODULES, RENDER_MODES } from '../../models/workspaceCardModel.js';

const valid = (over = {}) => ({
  organization: new mongoose.Types.ObjectId(),
  ownerId: new mongoose.Types.ObjectId(),
  title: 'Stale CP leads',
  module: 'leads',
  ...over,
});

describe('WorkspaceCard model', () => {
  it('exports the five modules and two render modes', () => {
    expect(WORKSPACE_MODULES).toEqual(['leads', 'sales', 'payments', 'tasks', 'channelPartners']);
    expect(RENDER_MODES).toEqual(['list', 'metric']);
  });

  it('validates a minimal valid document', () => {
    expect(new WorkspaceCard(valid()).validateSync()).toBeUndefined();
  });

  it('requires organization, ownerId, title and module', () => {
    const err = new WorkspaceCard({}).validateSync();
    expect(err.errors.organization).toBeDefined();
    expect(err.errors.ownerId).toBeDefined();
    expect(err.errors.title).toBeDefined();
    expect(err.errors.module).toBeDefined();
  });

  it('defaults renderMode=list, visibility=private, metricConfig.agg=count, metricConfig.field=null', () => {
    const doc = new WorkspaceCard(valid());
    expect(doc.renderMode).toBe('list');
    expect(doc.visibility).toBe('private');
    expect(doc.metricConfig.agg).toBe('count');
    expect(doc.metricConfig.field).toBeNull();
    expect(doc.sharedWithUsers).toEqual([]);
    expect(doc.sharedWithRoles).toEqual([]);
  });

  it('rejects an unknown module', () => {
    expect(new WorkspaceCard(valid({ module: 'bogus' })).validateSync().errors.module).toBeDefined();
  });

  it('rejects an unknown renderMode and an unknown metricConfig.agg', () => {
    expect(new WorkspaceCard(valid({ renderMode: 'chart' })).validateSync().errors.renderMode).toBeDefined();
    expect(
      new WorkspaceCard(valid({ metricConfig: { agg: 'median' } })).validateSync().errors['metricConfig.agg']
    ).toBeDefined();
  });

  it('rejects an unknown visibility', () => {
    expect(new WorkspaceCard(valid({ visibility: 'public' })).validateSync().errors.visibility).toBeDefined();
  });

  it('stores queryPlan as mixed (arbitrary shape accepted)', () => {
    const doc = new WorkspaceCard(valid({
      queryPlan: { module: 'leads', logic: 'AND', filters: [{ field: 'source', op: 'is', value: 'Channel Partner' }], sort: null, limit: 50 },
    }));
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.queryPlan.filters[0].field).toBe('source');
  });
});
