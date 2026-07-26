import fs from 'node:fs';
import path from 'node:path';
import {
  parseJsonStrict,
  sha256Bytes,
  sha256Json,
} from './shared/canonical-json.mjs';
import { detectDomain, SUPPORTED_DOMAINS } from './adapters/index.mjs';
import { DEFAULT_PARAMS } from './skill-params.mjs';
import { DEFAULT_TOKENS } from './tokens.mjs';

const INSTALLATION_PACKAGE_FILES = ['package.json', 'bun.lock', 'package-lock.json'];
const LOWER_HEX_256 = /^[0-9a-f]{64}$/;

export class ReceiptInputError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ReceiptInputError';
    this.code = code;
  }
}

export const DEFAULT_IO = Object.freeze({
  readFile: (filePath) => fs.readFileSync(filePath),
});

export function createOperationIo(baseIo = DEFAULT_IO) {
  const buffers = new Map();
  return {
    readFile(filePath) {
      const absolute = path.resolve(filePath);
      if (!buffers.has(absolute)) {
        buffers.set(absolute, Buffer.from(baseIo.readFile(absolute)));
      }
      return buffers.get(absolute);
    },
  };
}

function relativePath(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join('/');
}

function walkRegularFiles(directory, {
  root,
  accept,
  rejectSymlinks,
  tolerateMissing = false,
}) {
  let directoryStat;
  try {
    directoryStat = fs.lstatSync(directory);
  } catch (error) {
    if (tolerateMissing && error?.code === 'ENOENT') return [];
    throw error;
  }
  if (directoryStat.isSymbolicLink()) {
    if (rejectSymlinks) {
      throw new Error(`symlink is not allowed: ${relativePath(root, directory)}`);
    }
    return [];
  }
  if (!directoryStat.isDirectory()) {
    throw new Error(`manifest namespace is not a directory: ${relativePath(root, directory)}`);
  }

  let names;
  try {
    names = fs.readdirSync(directory).sort();
  } catch (error) {
    if (tolerateMissing && error?.code === 'ENOENT') return [];
    throw error;
  }

  const files = [];
  for (const name of names) {
    const filePath = path.join(directory, name);
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink()) {
      if (rejectSymlinks) throw new Error(`symlink is not allowed: ${relativePath(root, filePath)}`);
      continue;
    }
    if (stat.isDirectory()) {
      files.push(...walkRegularFiles(filePath, {
        root,
        accept,
        rejectSymlinks,
        tolerateMissing,
      }));
    } else if (stat.isFile()) {
      const relative = relativePath(root, filePath);
      if (accept(relative)) files.push(relative);
    }
  }
  return files;
}

function assertRequiredRegularFile(root, relative) {
  const stat = fs.lstatSync(path.join(root, relative));
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`required installation file is not regular: ${relative}`);
  }
}

function manifestFromFiles(root, files, io) {
  const entries = [...new Set(files)]
    .map((relative) => ({
      relative_path: relative,
      sha256: sha256Bytes(io.readFile(path.join(root, relative))),
    }))
    .sort((left, right) => (
      left.relative_path < right.relative_path
        ? -1
        : left.relative_path > right.relative_path
          ? 1
          : 0
    ));
  return { files: entries, sha256: sha256Json(entries) };
}

export function captureInstallationManifest(root, io = DEFAULT_IO) {
  try {
    const absoluteRoot = path.resolve(root);
    const libraryFiles = walkRegularFiles(path.join(absoluteRoot, 'lib'), {
      root: absoluteRoot,
      accept: (relative) => relative.endsWith('.mjs'),
      rejectSymlinks: true,
    });
    for (const relative of INSTALLATION_PACKAGE_FILES) {
      assertRequiredRegularFile(absoluteRoot, relative);
    }
    return manifestFromFiles(
      absoluteRoot,
      [...libraryFiles, ...INSTALLATION_PACKAGE_FILES],
      io,
    );
  } catch (error) {
    if (error instanceof ReceiptInputError) throw error;
    throw new ReceiptInputError(
      'INSTALLATION_INPUT_INVALID',
      `installation manifest capture failed: ${error.message}`,
    );
  }
}

function isAllowedManifestPath(relative, kind) {
  if (kind === 'installation') {
    return INSTALLATION_PACKAGE_FILES.includes(relative)
      || /^lib\/[^/](?:.*\/)?[^/]*\.mjs$/.test(relative);
  }
  if (kind === 'schemas') return /^schemas\/[^/]+\.json$/.test(relative);
  return false;
}

function validateManifestPaths(files, kind) {
  if (!Array.isArray(files)) throw new Error(`invalid manifest path list for ${kind}`);
  const seen = new Set();
  for (const entry of files) {
    const relative = entry?.relative_path;
    const segments = typeof relative === 'string' ? relative.split('/') : [];
    const invalid = (
      typeof relative !== 'string'
      || relative === ''
      || path.isAbsolute(relative)
      || relative.includes('\\')
      || segments.some((segment) => segment === '' || segment === '.' || segment === '..')
      || !isAllowedManifestPath(relative, kind)
      || seen.has(relative)
      || !LOWER_HEX_256.test(entry?.sha256)
    );
    if (invalid) throw new Error(`invalid manifest path or digest: ${String(relative)}`);
    seen.add(relative);
  }
}

function validateStoredManifest(stored, kind) {
  validateManifestPaths(stored?.files, kind);
  if (
    !LOWER_HEX_256.test(stored?.sha256)
    || stored.sha256 !== sha256Json(stored.files)
  ) {
    throw new Error(`invalid manifest aggregate digest for ${kind}`);
  }
}

function discoverCurrentFiles(root, kind) {
  const absoluteRoot = path.resolve(root);
  if (kind === 'installation') {
    const libraryFiles = walkRegularFiles(path.join(absoluteRoot, 'lib'), {
      root: absoluteRoot,
      accept: (relative) => relative.endsWith('.mjs'),
      rejectSymlinks: true,
      tolerateMissing: true,
    });
    const packageFiles = INSTALLATION_PACKAGE_FILES.filter((relative) => {
      try {
        const stat = fs.lstatSync(path.join(absoluteRoot, relative));
        if (stat.isSymbolicLink()) {
          throw new Error(`symlink is not allowed: ${relative}`);
        }
        return stat.isFile();
      } catch (error) {
        if (error?.code === 'ENOENT') return false;
        throw error;
      }
    });
    return [...libraryFiles, ...packageFiles];
  }
  if (kind === 'schemas') {
    return walkRegularFiles(path.join(absoluteRoot, 'schemas'), {
      root: absoluteRoot,
      accept: (relative) => /^schemas\/[^/]+\.json$/.test(relative),
      rejectSymlinks: true,
      tolerateMissing: true,
    });
  }
  throw new Error(`invalid manifest kind: ${kind}`);
}

function captureManifestForStoredKind(root, kind, io) {
  const files = discoverCurrentFiles(root, kind);
  return manifestFromFiles(path.resolve(root), files, io);
}

function compareManifestEntries(stored, current) {
  const storedByPath = new Map(stored.map((entry) => [entry.relative_path, entry.sha256]));
  const currentByPath = new Map(current.map((entry) => [entry.relative_path, entry.sha256]));
  const paths = [...new Set([...storedByPath.keys(), ...currentByPath.keys()])].sort();
  const changes = [];
  for (const relative of paths) {
    if (!currentByPath.has(relative)) {
      changes.push({ code: 'MANIFEST_FILE_MISSING', relative_path: relative });
    } else if (!storedByPath.has(relative)) {
      changes.push({ code: 'MANIFEST_FILE_ADDED', relative_path: relative });
    } else if (storedByPath.get(relative) !== currentByPath.get(relative)) {
      changes.push({ code: 'MANIFEST_FILE_CHANGED', relative_path: relative });
    }
  }
  return { matches: changes.length === 0, changes };
}

export function compareCurrentManifest(stored, root, kind, io = DEFAULT_IO) {
  validateStoredManifest(stored, kind);
  const current = captureManifestForStoredKind(root, kind, io);
  return compareManifestEntries(stored.files, current.files);
}

export function captureRuntime(runtime = process) {
  if (!runtime.versions?.bun) {
    throw new ReceiptInputError('BUN_REQUIRED', 'receipt-backed execution requires Bun');
  }
  return {
    engine: 'bun',
    version: runtime.versions.bun,
    platform: runtime.platform,
    arch: runtime.arch,
    locale: new Intl.Collator().resolvedOptions().locale,
    versions_sha256: sha256Json({ ...runtime.versions }),
  };
}

function readConfigIfPresent(root, relative, io) {
  const filePath = path.join(root, relative);
  if (!fs.existsSync(filePath)) return { exists: false, value: null };
  try {
    return {
      exists: true,
      value: parseJsonStrict(io.readFile(filePath), relative),
    };
  } catch {
    return { exists: true, value: null };
  }
}

export function resolveEffectiveParams(root, profile, io = DEFAULT_IO) {
  const global = readConfigIfPresent(root, 'skill-params.json', io);
  const profiled = profile
    ? readConfigIfPresent(root, `skill-params.${profile}.json`, io)
    : { exists: false, value: null };
  const selected = profiled.exists ? profiled.value : global.value;
  return {
    proximity: {
      ...DEFAULT_PARAMS.proximity,
      ...(selected?.proximity || {}),
    },
  };
}

export function resolveEffectiveTokens(root, io = DEFAULT_IO) {
  const stored = readConfigIfPresent(root, 'tokens.json', io).value;
  return {
    colors: [...(stored?.colors || DEFAULT_TOKENS.colors)],
    fontScale: [...(stored?.fontScale || DEFAULT_TOKENS.fontScale)],
    radii: [...(stored?.radii || DEFAULT_TOKENS.radii)],
  };
}

function normalizeAdapterAndSlide(filePath, flags = {}) {
  if (
    flags.domain !== undefined
    && flags.domain !== null
    && !SUPPORTED_DOMAINS.includes(flags.domain)
  ) {
    throw new ReceiptInputError(
      'DOMAIN_INVALID',
      `unsupported explicit domain: ${String(flags.domain)}`,
    );
  }
  if (
    flags.slide !== undefined
    && flags.slide !== null
    && (!Number.isInteger(flags.slide) || flags.slide <= 0)
  ) {
    throw new ReceiptInputError(
      'SLIDE_INVALID',
      `slide must be a positive integer: ${String(flags.slide)}`,
    );
  }
  const adapter = detectDomain(filePath, flags.domain);
  return {
    adapter,
    effective_slide: adapter === 'pptx' ? (flags.slide ?? 1) : null,
  };
}

export function snapshotArtifact(filePath, flags = {}, io = DEFAULT_IO) {
  const normalized = normalizeAdapterAndSlide(filePath, flags);
  try {
    const supplied = io.readFile(path.resolve(filePath));
    const bytes = Buffer.isBuffer(supplied) ? supplied : Buffer.from(supplied);
    return {
      status: 'bound',
      bytes,
      sha256: sha256Bytes(bytes),
      ...normalized,
      error: null,
    };
  } catch (error) {
    return {
      status: 'unreadable',
      bytes: null,
      sha256: null,
      ...normalized,
      error,
    };
  }
}

export function snapshotContract(filePath, io = DEFAULT_IO) {
  try {
    const supplied = io.readFile(path.resolve(filePath));
    const bytes = Buffer.isBuffer(supplied) ? supplied : Buffer.from(supplied);
    return {
      status: 'bound',
      bytes,
      sha256: sha256Bytes(bytes),
      value: parseJsonStrict(bytes, 'contract'),
    };
  } catch (error) {
    throw new ReceiptInputError(
      'CONTRACT_INPUT_INVALID',
      `contract input invalid: ${error.message}`,
    );
  }
}

export function captureSchemaBundle(root, io = DEFAULT_IO) {
  try {
    const absoluteRoot = path.resolve(root);
    const files = walkRegularFiles(path.join(absoluteRoot, 'schemas'), {
      root: absoluteRoot,
      accept: (relative) => /^schemas\/[^/]+\.json$/.test(relative),
      rejectSymlinks: true,
    }).sort();
    const buffers = new Map();
    const entries = [];
    for (const relative of files) {
      const supplied = io.readFile(path.join(absoluteRoot, relative));
      const bytes = Buffer.isBuffer(supplied) ? supplied : Buffer.from(supplied);
      parseJsonStrict(bytes, relative);
      buffers.set(relative, bytes);
      entries.push({ relative_path: relative, sha256: sha256Bytes(bytes) });
    }
    return {
      buffers,
      manifest: { files: entries, sha256: sha256Json(entries) },
    };
  } catch (error) {
    if (error instanceof ReceiptInputError) throw error;
    throw new ReceiptInputError(
      'SCHEMA_INPUT_INVALID',
      `schema bundle capture failed: ${error.message}`,
    );
  }
}

export function normalizePostPolicy(input) {
  const adapter = input.adapter;
  if (!SUPPORTED_DOMAINS.includes(adapter)) {
    throw new ReceiptInputError(
      'DOMAIN_INVALID',
      `unsupported policy adapter: ${String(adapter)}`,
    );
  }
  if (
    input.slide !== undefined
    && input.slide !== null
    && (!Number.isInteger(input.slide) || input.slide <= 0)
  ) {
    throw new ReceiptInputError(
      'SLIDE_INVALID',
      `policy slide must be a positive integer: ${String(input.slide)}`,
    );
  }
  const normalizeOptionalString = (value, field) => {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string') {
      throw new ReceiptInputError(
        'POLICY_INPUT_INVALID',
        `policy ${field} must be a string or null`,
      );
    }
    return value;
  };
  const effectiveSlide = adapter === 'pptx' ? (input.slide ?? 1) : null;
  return {
    adapter: { id: adapter, effective_slide: effectiveSlide },
    profile: normalizeOptionalString(input.profile, 'profile'),
    structure: normalizeOptionalString(input.structure, 'structure'),
    lint: Boolean(input.lint),
    vuln: Boolean(input.vuln),
    vuln_gate: Boolean(input.vulnGate),
    slop: Boolean(input.slop),
    slop_gate: Boolean(input.slopGate),
    slop_autofix: Boolean(input.slopAutofix),
    human_on_unfixable: Boolean(input.humanOnUnfixable),
    artifact_type: normalizeOptionalString(input.type, 'artifact type'),
    resources: {
      params_sha256: sha256Json(input.params),
      tokens_sha256: input.lint ? sha256Json(input.tokens) : null,
      schemas: structuredClone(input.schemas),
      on_disk_installation: structuredClone(input.installation),
    },
    validation: {
      mode: input.validator.name,
      version: input.validator.version,
    },
    runtime: structuredClone(input.runtime),
  };
}
