// File: services/reports/blockHelpers.js
// Description: Pure transform helpers shared by block resolvers. No I/O.

/**
 * Convert an object map ({ statusA: 5, statusB: 3 }) into recharts-friendly
 * [{ name, value }] pairs. Returns [] for anything that isn't a plain object.
 */
export const objectMapToChartData = (obj) => {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return [];
  return Object.entries(obj).map(([name, value]) => ({ name, value }));
};

/**
 * Coerce a value to a finite number, else a fallback (default 0).
 */
export const num = (value, fallback = 0) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;
