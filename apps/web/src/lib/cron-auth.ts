import { timingSafeEqual } from 'node:crypto';

/**
 * Scheduler requests must carry `Authorization: Bearer $CRON_SECRET` (n8n, cron-job.org and
 * Vercel Cron all support this). A missing or short secret disables the endpoint entirely.
 */
export function isAuthorizedCron(authorization: string | null, secret = process.env.CRON_SECRET): boolean {
  if (!secret || secret.length < 16 || !authorization) return false;
  const a = Buffer.from(authorization);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}
