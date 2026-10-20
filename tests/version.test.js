import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { VERSION } from '../src/version.js';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('src/version.js matches package.json', () => assert.equal(VERSION, pkg.version));

test('CHANGELOG has an entry for the current version', () => {
  const log = fs.readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  assert.match(log, new RegExp('^## \\[' + VERSION.replace(/\./g, '\\.') + '\\]', 'm'));
});
