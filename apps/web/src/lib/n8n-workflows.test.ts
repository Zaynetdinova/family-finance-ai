import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(__dirname, '../../../../n8n');
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));

describe('n8n workflow exports', () => {
  it('exist', () => expect(files.length).toBeGreaterThanOrEqual(2));
  for (const f of files) {
    const text = readFileSync(join(dir, f), 'utf8');
    const wf = JSON.parse(text) as { nodes: { name: string; type: string; credentials?: Record<string, { id: string }> }[]; connections: Record<string, unknown> };
    it(`${f}: contains no secrets`, () => {
      expect(text).not.toMatch(/Bearer\s+[A-Za-z0-9]/);
      expect(text).not.toMatch(/sb_secret_|sk-[A-Za-z0-9]|bot\d+:/);
      for (const n of wf.nodes) for (const c of Object.values(n.credentials ?? {})) expect(c.id).toBe('REPLACE_AFTER_IMPORT');
    });
    it(`${f}: every connection points to an existing node`, () => {
      const names = new Set(wf.nodes.map((n) => n.name));
      for (const [from, v] of Object.entries(wf.connections)) {
        expect(names.has(from)).toBe(true);
        for (const branch of (v as { main: { node: string }[][] }).main) for (const c of branch) expect(names.has(c.node)).toBe(true);
      }
    });
    it(`${f}: calls an authenticated app endpoint`, () => {
      const http = wf.nodes.find((n) => n.type === 'n8n-nodes-base.httpRequest')!;
      expect(http.credentials?.httpHeaderAuth).toBeDefined();
      expect(text).toMatch(/\/api\/(jobs\/tick|fx\/refresh)/);
    });
  }
});
