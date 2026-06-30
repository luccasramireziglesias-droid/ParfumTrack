import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');

describe('build.js', () => {
  it('regenerates index.html identically from src/ (no drift)', () => {
    const before = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    execFileSync('node', ['scripts/build.js'], { cwd: ROOT });
    const after = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    expect(after).toBe(before);
  });
});
