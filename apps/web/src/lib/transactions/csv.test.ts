import { describe, expect, it } from 'vitest';
import { parseCsv, parseDateCell, parseTypeAlias, toCsv } from './csv';

describe('csv', () => {
  it('round-trips quotes, commas and newlines', () => {
    const csv = toCsv(['a', 'b'], [['x, y', 'say "hi"\nthere'], ['1', '']]);
    expect(parseCsv(csv)).toEqual([['a', 'b'], ['x, y', 'say "hi"\nthere'], ['1', '']]);
  });
  it('detects semicolons, strips BOM, skips blank lines', () => {
    expect(parseCsv('﻿date;amount\r\n2026-10-01;100,50\r\n\r\n')).toEqual([['date', 'amount'], ['2026-10-01', '100,50']]);
  });
  it('neutralises spreadsheet formulas but leaves negative numbers alone', () => {
    expect(toCsv(['c'], [['=HYPERLINK("x")'], ['-5.00'], ['+7 days']])).toBe('c\r\n\'=HYPERLINK(""x"")\r\n-5.00\r\n\'+7 days'.replace('\'=HYPERLINK(""x"")', '"\'=HYPERLINK(""x"")"'));
  });
  it('parses dates and type aliases', () => {
    expect(parseDateCell('05.10.2026')).toBe('2026-10-05');
    expect(parseDateCell('2026-10-05')).toBe('2026-10-05');
    expect(parseDateCell('yesterday')).toBeNull();
    expect(parseTypeAlias('Расход')).toBe('expense');
    expect(parseTypeAlias('x')).toBeNull();
  });
});
