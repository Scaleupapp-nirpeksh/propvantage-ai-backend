// tests/unit/leadEnumMigrationMaps.test.js
import {
  mapSource, mapBudgetSource, mapStatus, mapFollowUpType, NEW_SOURCES,
} from '../../data/leadEnumMigrationMaps.js';

describe('lead enum migration maps', () => {
  it('maps legacy sources onto the 6 new sources', () => {
    expect(mapSource('Walk-in')).toBe('Direct');
    expect(mapSource('Cold Call')).toBe('Cold Calling');
    expect(mapSource('Website')).toBe('Marketing');
    expect(mapSource('Property Portal')).toBe('Marketing');
    expect(mapSource('Social Media')).toBe('Marketing');
    expect(mapSource('Advertisement')).toBe('Marketing');
    expect(mapSource('Other')).toBe('Direct');
    expect(mapSource('Referral')).toBe('Referral');
    expect(mapSource('Channel Partner')).toBe('Channel Partner');
  });
  it('passes through already-new sources and defaults the unknown to Direct', () => {
    NEW_SOURCES.forEach((s) => expect(mapSource(s)).toBe(s));
    expect(mapSource('???')).toBe('Direct');
  });
  it('collapses budget source to self_funded / bank_loan', () => {
    expect(mapBudgetSource('self_reported')).toBe('self_funded');
    expect(mapBudgetSource('pre_approved')).toBe('bank_loan');
    expect(mapBudgetSource('loan_approved')).toBe('bank_loan');
    expect(mapBudgetSource('verified')).toBe('bank_loan');
    expect(mapBudgetSource('bank_loan')).toBe('bank_loan');
    expect(mapBudgetSource('self_funded')).toBe('self_funded');
  });
  it('remaps removed statuses (conservative) and passes valid ones through', () => {
    expect(mapStatus('Contacted')).toBe('New');
    expect(mapStatus('Site Visit Scheduled')).toBe('Qualified');
    expect(mapStatus('Unqualified')).toBe('Lost');
    expect(mapStatus('Negotiating')).toBe('Negotiating');
    expect(mapStatus('Booked')).toBe('Booked');
  });
  it('remaps follow-up types whatsapp→text, site_visit→meeting', () => {
    expect(mapFollowUpType('whatsapp')).toBe('text');
    expect(mapFollowUpType('site_visit')).toBe('meeting');
    expect(mapFollowUpType('call')).toBe('call');
  });
});
