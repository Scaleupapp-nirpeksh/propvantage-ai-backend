// File: tests/unit/blockHelpers.test.js
import { objectMapToChartData, num } from '../../services/reports/blockHelpers.js';

describe('blockHelpers', () => {
  describe('objectMapToChartData', () => {
    it('converts an object map to name/value pairs', () => {
      expect(objectMapToChartData({ available: 5, sold: 3 })).toEqual([
        { name: 'available', value: 5 },
        { name: 'sold', value: 3 },
      ]);
    });
    it('returns [] for null/undefined/non-object', () => {
      expect(objectMapToChartData(null)).toEqual([]);
      expect(objectMapToChartData(undefined)).toEqual([]);
      expect(objectMapToChartData(42)).toEqual([]);
    });
  });

  describe('num', () => {
    it('passes through finite numbers', () => {
      expect(num(12.5)).toBe(12.5);
    });
    it('falls back for NaN / non-numbers', () => {
      expect(num(NaN)).toBe(0);
      expect(num(undefined)).toBe(0);
      expect(num('x', -1)).toBe(-1);
    });
  });
});
