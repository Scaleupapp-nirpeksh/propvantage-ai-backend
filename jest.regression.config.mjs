// File: jest.regression.config.mjs
// Jest config dedicated to the regression suite (the existing tests/*.js
// scripts under tests/ are standalone runners, not Jest tests — we leave
// them alone and tell Jest exactly where to find the regression suite).
export default {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/regression/suites/**/*.test.js'],
  globalSetup: '<rootDir>/tests/regression/_lib/setup.js',
  testTimeout: 30000,
  maxWorkers: 1, // tests share auth state; serial avoids flakes
  reporters: ['default'],
  verbose: true,
};
