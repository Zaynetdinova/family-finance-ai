import { describe, expect, it } from 'vitest';
import { isAuthorizedCron } from './cron-auth';

describe('isAuthorizedCron', () => {
  const s = 'x'.repeat(32);
  it('accepts only the exact bearer secret', () => {
    expect(isAuthorizedCron(`Bearer ${s}`, s)).toBe(true);
    expect(isAuthorizedCron(`Bearer ${s}x`, s)).toBe(false);
    expect(isAuthorizedCron(s, s)).toBe(false);
    expect(isAuthorizedCron(null, s)).toBe(false);
  });
  it('is disabled without a strong secret', () => {
    expect(isAuthorizedCron('Bearer short', 'short')).toBe(false);
    expect(isAuthorizedCron('Bearer ', undefined)).toBe(false);
  });
});
