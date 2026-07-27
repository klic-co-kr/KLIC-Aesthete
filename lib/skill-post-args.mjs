import { ReceiptInputError } from './skill-snapshot.mjs';

const VALUE_FLAGS = new Set([
  'domain',
  'slide',
  'profile',
  'contract',
  'intent',
  'type',
  'structure',
  'out-dir',
]);
const PRESENCE_FLAGS = new Set([
  'lint',
  'vuln',
  'vuln-gate',
  'slop',
  'slop-gate',
  'slop-autofix',
  'human-on-unfixable',
]);

export function parsePostArgs(argv) {
  if (!Array.isArray(argv) || !argv.every((value) => typeof value === 'string')) {
    throw new ReceiptInputError(
      'POLICY_INPUT_INVALID',
      'post arguments must be strings',
    );
  }
  const positional = [];
  const flags = {};
  const seen = new Set();
  let outDirFlag;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    if (token === '--' || token.includes('=')) {
      throw new ReceiptInputError(
        'POLICY_INPUT_INVALID',
        `unsupported flag spelling: ${token}`,
      );
    }
    const name = token.slice(2);
    if (!VALUE_FLAGS.has(name) && !PRESENCE_FLAGS.has(name)) {
      throw new ReceiptInputError(
        'POLICY_INPUT_INVALID',
        `unknown flag: --${name}`,
      );
    }
    if (seen.has(name)) {
      throw new ReceiptInputError(
        'POLICY_INPUT_INVALID',
        `duplicate flag: --${name}`,
      );
    }
    seen.add(name);
    if (PRESENCE_FLAGS.has(name)) {
      flags[name] = true;
      continue;
    }
    const value = argv[index + 1];
    if (
      typeof value !== 'string'
      || value.length === 0
      || value.startsWith('--')
    ) {
      throw new ReceiptInputError(
        name === 'intent' ? 'INTENT_INPUT_INVALID' : 'POLICY_INPUT_INVALID',
        `--${name} requires one non-empty value`,
      );
    }
    index += 1;
    if (name === 'out-dir') outDirFlag = value;
    else flags[name] = value;
  }
  if (positional.length !== 1 || positional[0].length === 0) {
    throw new ReceiptInputError(
      'POLICY_INPUT_INVALID',
      'post requires exactly one artifact positional',
    );
  }
  return { inputPath: positional[0], flags, outDirFlag };
}
