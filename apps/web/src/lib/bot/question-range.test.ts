import { describe, expect, it } from 'vitest';
import { questionRange } from './question-range';

describe('questionRange', () => {
  it('keeps a valid past period and clips a future end to today', () => {
    expect(questionRange('2026-09-01', '2026-09-30', '2026-10-19')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(questionRange('2026-10-01', '2026-10-31', '2026-10-19')).toEqual({ from: '2026-10-01', to: '2026-10-19' });
  });
  it('falls back to month-to-date for missing, invalid, reversed or future periods', () => {
    const def = { from: '2026-10-01', to: '2026-10-19' };
    expect(questionRange(null, null, '2026-10-19')).toEqual(def);
    expect(questionRange('2026-02-30', '2026-03-01', '2026-10-19')).toEqual(def);
    expect(questionRange('2026-09-30', '2026-09-01', '2026-10-19')).toEqual(def);
    expect(questionRange('2027-01-01', '2027-01-31', '2026-10-19')).toEqual(def);
  });
});
