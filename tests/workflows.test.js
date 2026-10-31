import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// YAML treats " #" in an unquoted value as the start of a comment, silently cutting a
// GitHub Actions expression in half (the whole workflow then fails to load).
test('workflow files: no unquoted " #" inside ${{ }} expressions', () => {
  const dir = new URL('../.github/workflows/', import.meta.url);
  for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.yml'))) {
    fs.readFileSync(new URL(f, dir), 'utf8').split('\n').forEach((line, i) => {
      const m = line.match(/^\s*[\w-]+:\s*(.*)$/); if (!m || !m[1].includes('${{')) return;
      const v = m[1].trim();
      if (/^["']/.test(v)) return; // quoted value: fine
      assert.ok(!/\s#/.test(v), `${f}:${i + 1}: quote this value, " #" starts a YAML comment: ${v}`);
    });
  }
});
