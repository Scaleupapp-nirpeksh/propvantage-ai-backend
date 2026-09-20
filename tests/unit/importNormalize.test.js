// Pure helpers of the Excel importer — no database, no files.
import * as N from '../../services/import/normalize.js';
import { TeamRegistry, issueCollector } from '../../services/import/canonical.js';
import { usernameFor, cleanDomain } from '../../services/import/commit.js';

describe('import · normalize', () => {
  test('numbers: rupee signs, commas, crore / lakh words, blanks', () => {
    expect(N.num('₹ 1,25,00,000')).toBe(12500000);
    expect(N.num('12.5 Cr')).toBe(125000000);
    expect(N.num('45 Lakh')).toBe(4500000);
    expect(N.num('')).toBeNull();
    expect(N.num('-')).toBeNull();
    expect(N.num(3437)).toBe(3437);
  });

  test('phones: spreadsheet floats and bare 10-digit numbers become +91…', () => {
    expect(N.phone(9876543210)).toBe('+919876543210');
    expect(N.phone('98765 43210')).toBe('+919876543210');
    expect(N.phone('+91 98765-43210')).toBe('+919876543210');
    expect(N.phone('n/a')).toBeFalsy();
  });

  test('aadhaar is never kept in full — last four digits only', () => {
    expect(N.aadhaarLast4('1234 5678 9012')).toBe('9012');
    expect(N.aadhaarLast4(123456789012)).toBe('9012');
    expect(N.aadhaarLast4('')).toBeFalsy();
  });

  test('PAN is validated and upper-cased', () => {
    expect(N.pan('abcde1234f')).toBe('ABCDE1234F');
    expect(N.pan('not a pan')).toBeFalsy();
  });

  test('person names: titles stripped, bracket notes kept aside, companies detected', () => {
    const p = N.personName('Mr. Rahul Verma (Amit ref)');
    expect(p.first).toBe('Rahul'); expect(p.last).toBe('Verma'); expect(p.note).toBe('Amit ref'); expect(p.isCompany).toBe(false);
    expect(N.personName('Skyline Holdings Pvt Ltd').isCompany).toBe(true);
    expect(N.nameKey('Mr. Rahul  VERMA')).toBe(N.nameKey('rahul verma'));
  });

  test('unit keys carry the tower, keep suffixes and combined apartments', () => {
    expect(N.unitKey('T1', 4902)).toBe('T1-4902');
    expect(N.unitKey('t2', '1501 B')).toBe('T2-1501 B');
    expect(N.unitKey('T1', '4401 & 4402')).toBe('T1-4401 & 4402');
  });

  test('dates: DD-MM-YYYY strings and Date objects', () => {
    expect(N.date('25-04-2024').toISOString().slice(0, 10)).toMatch(/2024-04-2[45]/);
    expect(N.date(new Date('2024-04-25T00:00:00Z'))).toBeInstanceOf(Date);
    expect(N.date('soon')).toBeNull();
  });

  test('firm keys ignore suffix words', () => {
    expect(N.firmKey('Acme Realtors Pvt Ltd')).toBe(N.firmKey('ACME realty'));
  });
});

describe('import · team registry', () => {
  test('keeps real, frequently named people; folds misspellings; drops non-people', () => {
    const t = new TeamRegistry();
    for (let i = 0; i < 12; i += 1) t.add('Rukmini Iyer', 'closing');
    for (let i = 0; i < 2; i += 1) t.add('Rukimini', 'closing');
    for (let i = 0; i < 20; i += 1) t.add('Existing Client', 'sourcing');
    t.add('Oneoff Person', 'sourcing');
    const list = t.list();
    expect(list.map((x) => x.name)).toEqual(['Rukmini Iyer']);
    expect(list[0].mentions).toBe(14);
    expect(list[0].aliases).toEqual(expect.arrayContaining(['rukmini', 'rukimini']));
  });
});

describe('import · issue collector', () => {
  test('caps repeats of the same message so reports stay readable', () => {
    const issues = []; const issue = issueCollector(issues);
    for (let i = 0; i < 40; i += 1) issue('warning', 'MIS', i, 'Price', `T1-${1000 + i}: no rate`);
    expect(issues.length).toBeLessThanOrEqual(6);
  });
});

describe('import · account naming', () => {
  test('usernames and domains', () => {
    expect(usernameFor('Meera Shah')).toBe('meera.shah');
    expect(usernameFor('Kabir')).toBe('kabir');
    expect(cleanDomain(' @25Residencies.com ')).toBe('25residencies.com');
    expect(cleanDomain('someone@example.org')).toBe('example.org');
  });
});
