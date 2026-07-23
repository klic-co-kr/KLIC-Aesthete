import fs from 'node:fs';
import path from 'node:path';
import { skillRoot } from './cli.mjs';

// Schema validation is OPTIONAL at runtime (graceful degraded mode, like pateo).
// ajv is a dev/install-time convenience; without it, callers' own checks still apply.

let validators = null; // null=uninitialized, false=ajv-unavailable, object=loaded

async function loadAjv() {
  if (validators !== null) return;
  try {
    const { default: Ajv2020 } = await import('ajv/dist/2020.js');
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const schemasDir = path.join(skillRoot(), 'schemas');
    const common = JSON.parse(fs.readFileSync(path.join(schemasDir, 'common.schema.json'), 'utf8'));
    const defs = common.$defs || {};
    validators = {};
    for (const t of ['alt', 'contract', 'report', 'brief', 'vuln-report', 'slop-report', 'validation-corpus']) {
      let schema = JSON.parse(fs.readFileSync(path.join(schemasDir, `${t}.schema.json`), 'utf8'));
      // bundle shared $defs and rewrite common.schema.json#/$defs/X -> #/$defs/X
      schema.$defs = { ...defs, ...(schema.$defs || {}) };
      const rewritten = JSON.stringify(schema).replace(
        /common\.schema\.json#\/\$defs\//g,
        '#/$defs/',
      );
      validators[t] = ajv.compile(JSON.parse(rewritten));
    }
  } catch (err) {
    const missing = err && (err.code === 'ERR_MODULE_NOT_FOUND' || err.code === 'MODULE_NOT_FOUND');
    if (missing) {
      console.warn(
        'aesthete: ajv is not installed — skipping schema validation. '
        + 'Run "npm install" in the skill folder to enable it; measurement still runs.',
      );
      validators = false;
    } else {
      throw err;
    }
  }
}

export async function validate(type, data) {
  await loadAjv();
  if (!validators) return; // degraded — caller's own checks apply
  const v = validators[type];
  if (!v) return;
  if (!v(data)) {
    const msgs = (v.errors || []).map((e) => annotatePath(e.instancePath, data, e.message || 'invalid'));
    throw new Error(`${type} schema validation failed:\n  - ${msgs.join('\n  - ')}`);
  }
}

// annotate a JSON instance path with the nearest enclosing id/label (pateo validator.mjs pattern)
export function annotatePath(instancePath, data, message) {
  try {
    const parts = String(instancePath).split('/').filter(Boolean);
    let cur = data;
    let hint = null;
    for (const p of parts) {
      cur = cur?.[p];
      if (cur && typeof cur === 'object' && (cur.id || cur.label)) {
        hint = JSON.stringify(cur.id ?? cur.label);
      }
    }
    return hint != null ? `${instancePath} (id/label: ${hint}) ${message}` : `${instancePath} ${message}`;
  } catch {
    return `${instancePath} ${message}`;
  }
}
