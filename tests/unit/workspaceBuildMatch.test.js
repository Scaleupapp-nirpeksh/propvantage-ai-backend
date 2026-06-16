// tests/unit/workspaceBuildMatch.test.js
// Full unit coverage for buildMatch() — all 12 operators + default throw.
// No mocks: asserts real returned Mongo match fragments.
import { buildMatch, OPERATORS } from '../../services/workspace/operators.js';

describe('buildMatch', () => {
  // --- IS ---
  it('is → exact equality', () => {
    expect(buildMatch('status', OPERATORS.IS, 'New')).toEqual({ status: 'New' });
  });

  // --- IN ---
  it('in (array) → $in array', () => {
    expect(buildMatch('status', OPERATORS.IN, ['New', 'Qualified'])).toEqual({
      status: { $in: ['New', 'Qualified'] },
    });
  });

  it('in (scalar) → wraps in $in array', () => {
    expect(buildMatch('status', OPERATORS.IN, 'New')).toEqual({
      status: { $in: ['New'] },
    });
  });

  // --- NOT_IN ---
  it('notIn (array) → $nin array', () => {
    expect(buildMatch('status', OPERATORS.NOT_IN, ['New', 'Qualified'])).toEqual({
      status: { $nin: ['New', 'Qualified'] },
    });
  });

  it('notIn (scalar) → wraps in $nin array', () => {
    expect(buildMatch('status', OPERATORS.NOT_IN, 'New')).toEqual({
      status: { $nin: ['New'] },
    });
  });

  // --- GT / LT / GTE / LTE ---
  it('gt → $gt', () => {
    expect(buildMatch('score', OPERATORS.GT, 80)).toEqual({ score: { $gt: 80 } });
  });

  it('lt → $lt', () => {
    expect(buildMatch('score', OPERATORS.LT, 80)).toEqual({ score: { $lt: 80 } });
  });

  it('gte → $gte', () => {
    expect(buildMatch('score', OPERATORS.GTE, 80)).toEqual({ score: { $gte: 80 } });
  });

  it('lte → $lte', () => {
    expect(buildMatch('score', OPERATORS.LTE, 80)).toEqual({ score: { $lte: 80 } });
  });

  // --- BETWEEN ---
  it('between [40,60] → $gte/$lte', () => {
    expect(buildMatch('score', OPERATORS.BETWEEN, [40, 60])).toEqual({
      score: { $gte: 40, $lte: 60 },
    });
  });

  it('between with [40] (1 element) throws', () => {
    expect(() => buildMatch('score', OPERATORS.BETWEEN, [40])).toThrow(/BETWEEN requires/);
  });

  it('between with [10, 20, 30] (3 elements) throws', () => {
    expect(() => buildMatch('score', OPERATORS.BETWEEN, [10, 20, 30])).toThrow(/BETWEEN requires/);
  });

  it('between with scalar → treats as [scalar, scalar]', () => {
    expect(buildMatch('score', OPERATORS.BETWEEN, 50)).toEqual({
      score: { $gte: 50, $lte: 50 },
    });
  });

  // --- LAST_N_DAYS ---
  it('lastNDays 7 → $gte roughly 7 days ago', () => {
    const before = Date.now();
    const result = buildMatch('createdAt', OPERATORS.LAST_N_DAYS, 7);
    const after = Date.now();

    expect(result.createdAt).toBeDefined();
    expect(result.createdAt.$gte).toBeInstanceOf(Date);

    const ageMs = Date.now() - result.createdAt.$gte.getTime();
    const ageDays = ageMs / (24 * 60 * 60 * 1000);
    // Should be between 6.9 and 7.1 days
    expect(ageDays).toBeGreaterThanOrEqual(6.9);
    expect(ageDays).toBeLessThanOrEqual(7.1);
  });

  // --- IS_EMPTY ---
  it('isEmpty → $or null / $exists:false', () => {
    expect(buildMatch('status', OPERATORS.IS_EMPTY, null)).toEqual({
      $or: [{ status: null }, { status: { $exists: false } }],
    });
  });

  // --- IS_NOT_EMPTY (guards Critical fix: no duplicate key) ---
  it('isNotEmpty → { $exists:true, $nin:[null] }', () => {
    const result = buildMatch('status', OPERATORS.IS_NOT_EMPTY, null);
    expect(result).toEqual({ status: { $exists: true, $nin: [null] } });
    // Confirm there is exactly one key (duplicate-key bug would still produce one key
    // but with wrong value; this assertion locks in the correct shape)
    expect(Object.keys(result)).toHaveLength(1);
    expect(result.status.$exists).toBe(true);
    expect(result.status.$nin).toEqual([null]);
  });

  // --- CONTAINS (guards Fix 2: regex escape) ---
  it('contains "a.b" → escaped regex, case-insensitive', () => {
    const result = buildMatch('firstName', OPERATORS.CONTAINS, 'a.b');
    expect(result.firstName.$regex).toBe('a\\.b');
    expect(result.firstName.$options).toBe('i');
  });

  it('contains plain text without metacharacters passes through unchanged', () => {
    const result = buildMatch('firstName', OPERATORS.CONTAINS, 'alice');
    expect(result.firstName.$regex).toBe('alice');
    expect(result.firstName.$options).toBe('i');
  });

  it('contains string with multiple metacharacters escapes all', () => {
    const result = buildMatch('firstName', OPERATORS.CONTAINS, 'a.*+?^${}()|[\\]b');
    // Every metachar should be escaped
    expect(result.firstName.$regex).not.toMatch(/[^\\][.*+?^${}()|[\]]/);
  });

  // --- Unknown operator ---
  it('unknown operator → throws /Unsupported operator: badOp/', () => {
    expect(() => buildMatch('status', 'badOp', null)).toThrow(/Unsupported operator: badOp/);
  });
});
