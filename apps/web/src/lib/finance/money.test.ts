import { describe, expect, it } from 'vitest';
import { amountToString, convertMinor, divRound, formatMinor, parseAmount, parseRate, ratioBp, rateToString } from './money';

describe('money', () => {
  it('parses decimals exactly, with comma and spaces', () => {
    expect(parseAmount('120 000')).toBe(12_000_000n);
    expect(parseAmount('8500,50')).toBe(850_050n);
    expect(parseAmount('0.1') + parseAmount('0.2')).toBe(parseAmount('0.3')); // no float drift
  });
  it('rejects more than two decimals and garbage', () => {
    expect(() => parseAmount('1.234')).toThrow();
    expect(() => parseAmount('abc')).toThrow();
  });
  it('round-trips to canonical strings', () => {
    expect(amountToString(parseAmount('1234.5'))).toBe('1234.50');
    expect(amountToString(-5n)).toBe('-0.05');
  });
  it('rounds half away from zero', () => {
    expect(divRound(5n, 2n)).toBe(3n);
    expect(divRound(-5n, 2n)).toBe(-3n);
    expect(divRound(4n, 3n)).toBe(1n);
  });
  it('converts with scaled rates', () => {
    expect(convertMinor(parseAmount('35'), parseRate('90.5'))).toBe(parseAmount('3167.50'));
    expect(rateToString(parseRate('0.09'))).toBe('0.0900000000');
  });
  it('computes ratios in basis points; null for zero denominator', () => {
    expect(ratioBp(1n, 3n)).toBe(3333);
    expect(ratioBp(1n, 0n)).toBeNull();
  });
  it('formats with an unambiguous currency label', () => {
    expect(formatMinor(parseAmount('8500'), 'RUB')).toContain('₽');
    expect(formatMinor(parseAmount('450'), 'ARS')).toContain('AR$');
    expect(formatMinor(parseAmount('35'), 'USD')).toContain('US$');
  });
});
