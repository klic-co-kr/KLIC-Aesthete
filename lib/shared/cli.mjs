import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function skillRoot() {
  const here = new URL('.', import.meta.url).pathname; // .../lib/shared/
  return path.resolve(here, '..', '..');
}

// symlink-safe "am I the entry module?" check (skill runs via symlink in production)
export function isMain(importMetaUrl) {
  try {
    return fs.realpathSync(process.argv[1] || '') === fs.realpathSync(fileURLToPath(importMetaUrl));
  } catch {
    return false;
  }
}

export function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

// minimal argv parser: positional args + --flag value pairs
export function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next != null && !next.startsWith('--')) { flags[key] = next; i++; }
      else flags[key] = true;
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}
