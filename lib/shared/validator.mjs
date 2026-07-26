import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { parseJsonStrict } from './canonical-json.mjs';
import { skillRoot } from './cli.mjs';
import { ReceiptInputError } from '../skill-snapshot.mjs';
import { validateReceiptV1Shape } from '../skill-receipt-core.mjs';

// Schema validation is OPTIONAL at runtime (graceful degraded mode, like pateo).
// ajv is a dev/install-time convenience; without it, callers' own checks still apply.

let validators = null; // null=uninitialized, false=ajv-unavailable, object=loaded

const STRICT_TYPES = [
  'alt',
  'contract',
  'report',
  'brief',
  'intent',
  'vuln-report',
  'slop-report',
  'validation-corpus',
  'decision',
];

async function defaultLoadAjv() {
  const { default: Ajv2020 } = await import('ajv/dist/2020.js');
  const require = createRequire(import.meta.url);
  const packagePath = require.resolve('ajv/package.json');
  const metadata = parseJsonStrict(fs.readFileSync(packagePath), 'ajv package metadata');
  return { Ajv2020, version: metadata.version };
}

export async function createRunValidator(bundle, loadAjvImpl = defaultLoadAjv) {
  let loaded;
  try {
    loaded = await loadAjvImpl();
  } catch (error) {
    throw new ReceiptInputError(
      'AJV_REQUIRED',
      `mandatory AJV validator unavailable: ${error.message}`,
    );
  }

  try {
    const Ajv2020 = loaded?.Ajv2020 || loaded?.default;
    if (typeof Ajv2020 !== 'function' || typeof loaded?.version !== 'string') {
      throw new Error('AJV loader did not provide constructor and installed version');
    }
    if (!(bundle?.buffers instanceof Map)) throw new Error('schema bundle buffers are missing');

    const commonBytes = bundle.buffers.get('schemas/common.schema.json');
    if (!commonBytes) throw new Error('schemas/common.schema.json is missing');
    const common = parseJsonStrict(commonBytes, 'schemas/common.schema.json');
    const defs = common.$defs || {};
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const runValidators = {};

    for (const type of STRICT_TYPES) {
      const relative = `schemas/${type}.schema.json`;
      const bytes = bundle.buffers.get(relative);
      if (!bytes) throw new Error(`${relative} is missing`);
      const schema = parseJsonStrict(bytes, relative);
      schema.$defs = { ...defs, ...(schema.$defs || {}) };
      const rewritten = JSON.stringify(schema).replace(
        /common\.schema\.json#\/\$defs\//g,
        '#/$defs/',
      );
      runValidators[type] = ajv.compile(JSON.parse(rewritten));
    }

    return {
      name: 'ajv',
      version: loaded.version,
      validate(type, data) {
        const validator = runValidators[type];
        if (!validator) throw new Error(`unknown strict schema type: ${type}`);
        if (!validator(data)) {
          const messages = (validator.errors || []).map((error) => (
            annotatePath(error.instancePath, data, error.message || 'invalid')
          ));
          throw new Error(
            `${type} schema validation failed:\n  - ${messages.join('\n  - ')}`,
          );
        }
        if (type === 'decision') {
          // JSON Schema cannot express raw member order or a JCS aggregate
          // digest. Keep the captured schema as the structural authority, then
          // apply the version-pinned semantic checks at this emission seam.
          const receipt = validateReceiptV1Shape(data);
          if (receipt.status === 'invalid') {
            throw new Error(
              `decision receipt validation failed: ${receipt.issues
                .map((issue) => issue.code)
                .join(', ')}`,
            );
          }
        }
      },
    };
  } catch (error) {
    if (error instanceof ReceiptInputError) throw error;
    throw new ReceiptInputError(
      'SCHEMA_INPUT_INVALID',
      `strict schema validator creation failed: ${error.message}`,
    );
  }
}

async function loadAjv() {
  if (validators !== null) return;
  try {
    const { default: Ajv2020 } = await import('ajv/dist/2020.js');
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const schemasDir = path.join(skillRoot(), 'schemas');
    const common = JSON.parse(fs.readFileSync(path.join(schemasDir, 'common.schema.json'), 'utf8'));
    const defs = common.$defs || {};
    validators = {};
    for (const t of [
      'alt',
      'contract',
      'report',
      'brief',
      'intent',
      'vuln-report',
      'slop-report',
      'validation-corpus',
    ]) {
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
