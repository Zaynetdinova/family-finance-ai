import { describe, expect, it } from 'vitest';
import { safeNext } from './safe-next';

describe('safeNext', () => {
  it('keeps same-site paths', () => {
    expect(safeNext('/join?token=abc')).toBe('/join?token=abc');
    expect(safeNext('/transactions')).toBe('/transactions');
  });
  it('rejects external and protocol-relative targets', () => {
    for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)', '', null, undefined]) {
      expect(safeNext(bad as string)).toBe('/');
    }
  });
});
