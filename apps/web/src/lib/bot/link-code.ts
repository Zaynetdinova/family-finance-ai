import { createHash } from 'node:crypto';

export const hashLinkCode = (code: string) => createHash('sha256').update(code.trim(), 'utf8').digest('hex');
