// tests/unit/projectsCatalog.test.js
// Unit tests for the projectsCatalog: module metadata, enum values, toMatch
// shapes, derived city field, and scope() logic.
import mongoose from 'mongoose';
import projectsCatalog, {
  PROJECT_STATUS_VALUES,
  PROJECT_TYPE_VALUES,
} from '../../services/workspace/catalogs/projectsCatalog.js';

const field = (key) => projectsCatalog.fields.find((f) => f.key === key);

describe('projectsCatalog — metadata', () => {
  it('module=projects, baseModel=Project, label=Projects', () => {
    expect(projectsCatalog.module).toBe('projects');
    expect(projectsCatalog.baseModel).toBe('Project');
    expect(projectsCatalog.label).toBe('Projects');
  });
});

describe('projectsCatalog — exported enums match the model', () => {
  it('PROJECT_STATUS_VALUES mirrors projectModel.js', () => {
    expect(PROJECT_STATUS_VALUES).toEqual([
      'planning', 'pre-launch', 'launched', 'under-construction', 'completed', 'on-hold',
    ]);
  });

  it('PROJECT_TYPE_VALUES mirrors projectModel.js', () => {
    expect(PROJECT_TYPE_VALUES).toEqual([
      'apartment', 'villa', 'plot', 'commercial',
    ]);
  });

  it('status field enumValues equal PROJECT_STATUS_VALUES', () => {
    expect(field('status').enumValues).toEqual(PROJECT_STATUS_VALUES);
  });

  it('type field enumValues equal PROJECT_TYPE_VALUES', () => {
    expect(field('type').enumValues).toEqual(PROJECT_TYPE_VALUES);
  });
});

describe('projectsCatalog — toMatch shapes', () => {
  it('name contains → case-insensitive regex on name path', () => {
    const frag = field('name').toMatch('contains', 'sunrise');
    expect(frag.name).toEqual({ $regex: 'sunrise', $options: 'i' });
  });

  it('name is → equality match on name', () => {
    const frag = field('name').toMatch('is', 'Sunrise Heights');
    expect(frag).toEqual({ name: 'Sunrise Heights' });
  });

  it('status is → equality match', () => {
    const frag = field('status').toMatch('is', 'launched');
    expect(frag).toEqual({ status: 'launched' });
  });

  it('status in → $in array', () => {
    const frag = field('status').toMatch('in', ['launched', 'completed']);
    expect(frag).toEqual({ status: { $in: ['launched', 'completed'] } });
  });

  it('status notIn → $nin array', () => {
    const frag = field('status').toMatch('notIn', ['on-hold', 'planning']);
    expect(frag).toEqual({ status: { $nin: ['on-hold', 'planning'] } });
  });

  it('type in → $in on type path', () => {
    const frag = field('type').toMatch('in', ['apartment', 'villa']);
    expect(frag).toEqual({ type: { $in: ['apartment', 'villa'] } });
  });

  it('totalUnits gt → $gt on totalUnits', () => {
    const frag = field('totalUnits').toMatch('gt', 100);
    expect(frag).toEqual({ totalUnits: { $gt: 100 } });
  });

  it('targetRevenue between → $gte/$lte range', () => {
    const frag = field('targetRevenue').toMatch('between', [1000000, 5000000]);
    expect(frag).toEqual({ targetRevenue: { $gte: 1000000, $lte: 5000000 } });
  });

  it('launchDate lastNDays → $gte a date ~N days ago', () => {
    const before = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000 - 2000);
    const frag = field('launchDate').toMatch('lastNDays', 30);
    const after = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000 + 2000);
    expect(frag.launchDate.$gte.getTime()).toBeGreaterThan(before.getTime());
    expect(frag.launchDate.$gte.getTime()).toBeLessThan(after.getTime());
  });

  it('expectedCompletionDate lte → $lte', () => {
    const d = new Date('2027-12-31');
    const frag = field('expectedCompletionDate').toMatch('lte', d);
    expect(frag).toEqual({ expectedCompletionDate: { $lte: d } });
  });

  it('createdAt gt → $gt on createdAt', () => {
    const d = new Date('2025-01-01');
    const frag = field('createdAt').toMatch('gt', d);
    expect(frag).toEqual({ createdAt: { $gt: d } });
  });
});

describe('projectsCatalog — city derived field', () => {
  const cityField = () => field('city');

  it('city is derived:true', () => {
    expect(cityField().derived).toBe(true);
  });

  it('city addFields() returns a stage lifting $location.city to top-level city', () => {
    const stages = cityField().addFields();
    expect(Array.isArray(stages)).toBe(true);
    expect(stages).toHaveLength(1);
    expect(stages[0]).toEqual({ $addFields: { city: '$location.city' } });
  });

  it('city toMatch targets the nested location.city path', () => {
    const frag = cityField().toMatch('is', 'Mumbai');
    expect(frag).toEqual({ 'location.city': 'Mumbai' });
  });

  it('city contains targets nested location.city with regex', () => {
    const frag = cityField().toMatch('contains', 'Pun');
    expect(frag['location.city']).toEqual({ $regex: 'Pun', $options: 'i' });
  });

  it('city is displayable and defaultColumn', () => {
    expect(cityField().displayable).toBe(true);
    expect(cityField().defaultColumn).toBe(true);
  });
});

describe('projectsCatalog — scope()', () => {
  const ORG = new mongoose.Types.ObjectId();
  const P1 = new mongoose.Types.ObjectId();
  const P2 = new mongoose.Types.ObjectId();

  it('owner (accessibleProjectIds=null) → org-only match, no _id constraint', () => {
    const ctx = { organization: ORG, userId: new mongoose.Types.ObjectId(), accessibleProjectIds: null, isOwner: true, permissions: [] };
    const match = projectsCatalog.scope(ctx);
    expect(match.organization.toString()).toBe(ORG.toString());
    expect(match._id).toBeUndefined();
  });

  it('non-owner with accessibleProjectIds → _id $in the allowed list', () => {
    const ctx = { organization: ORG, userId: new mongoose.Types.ObjectId(), accessibleProjectIds: [P1.toString(), P2.toString()], isOwner: false, permissions: [] };
    const match = projectsCatalog.scope(ctx);
    expect(match.organization.toString()).toBe(ORG.toString());
    expect(match._id).toBeDefined();
    expect(match._id.$in).toHaveLength(2);
    // The IDs should be ObjectIds (cast by toObjectId inside scope).
    expect(match._id.$in[0].toString()).toBe(P1.toString());
    expect(match._id.$in[1].toString()).toBe(P2.toString());
  });

  it('non-owner with empty accessibleProjectIds → _id $in [] (no results)', () => {
    const ctx = { organization: ORG, userId: new mongoose.Types.ObjectId(), accessibleProjectIds: [], isOwner: false, permissions: [] };
    const match = projectsCatalog.scope(ctx);
    expect(match._id).toEqual({ $in: [] });
  });
});
