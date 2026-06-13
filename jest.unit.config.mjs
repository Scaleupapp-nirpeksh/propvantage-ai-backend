// File: jest.unit.config.mjs
// Fast, DB-free unit tests for new domains. Run with:
//   npm run test:unit
// Kept separate from the regression suite (jest.regression.config.mjs).
export default {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/unit/**/*.test.js'],
  testTimeout: 10000,
  reporters: ['default'],
  verbose: true,
};
