import { describe, expect, it } from 'vitest';
import { extractionJsonSchema, parseExtraction } from './ai-schema';
import { extraction } from './fixtures';

describe('AI output validation', () => {
  it('accepts a well-formed extraction (object or JSON string)', () => {
    const e = extraction({ amount: '8500', currency_raw: 'рублей' });
    expect(parseExtraction(e).ok).toBe(true);
    expect(parseExtraction(JSON.stringify(e)).ok).toBe(true);
  });
  it('rejects non-JSON, unknown fields, bad amounts and out-of-range confidence', () => {
    expect(parseExtraction('not json').ok).toBe(false);
    expect(parseExtraction({ ...extraction(), balance: '1e9' }).ok).toBe(false);
    expect(parseExtraction(extraction({ amount: '12.345' })).ok).toBe(false);
    expect(parseExtraction(extraction({ amount: '-5' })).ok).toBe(false);
    expect(parseExtraction(extraction({ confidence: 1.5 })).ok).toBe(false);
    expect(parseExtraction(extraction({ type: 'withdraw' as never })).ok).toBe(false);
  });
  it('has no currency code or computed fields the model could fill in', () => {
    const props = Object.keys((extractionJsonSchema() as { properties: object }).properties);
    expect(props).not.toContain('currency');
    expect(props).not.toContain('base_amount');
    expect(props).not.toContain('fx_rate');
  });
});
