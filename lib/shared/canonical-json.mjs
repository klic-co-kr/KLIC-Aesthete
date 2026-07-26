import { createHash } from 'node:crypto';

function assertUnicodeScalarString(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new Error('unsupported lone high surrogate');
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new Error('unsupported lone low surrogate');
    }
  }
}

function snapshotIJsonValue(value, active = new WeakSet()) {
  if (value === null) return null;

  const kind = typeof value;
  if (kind === 'string') {
    assertUnicodeScalarString(value);
    return value;
  }
  if (kind === 'number') {
    if (!Number.isFinite(value)) throw new Error('unsupported non-finite number');
    return value;
  }
  if (kind === 'boolean') return value;
  if (kind !== 'object') throw new Error(`unsupported JSON value type: ${kind}`);

  if (active.has(value)) throw new Error('unsupported cycle in JSON value');
  active.add(value);
  try {
    if (Array.isArray(value)) {
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const length = descriptors.length.value;
      for (const key of Reflect.ownKeys(descriptors)) {
        if (typeof key === 'symbol') throw new Error('unsupported symbol array property');
        if (key === 'length') continue;
        if (!/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= length) {
          throw new Error(`unsupported array property '${key}'`);
        }
      }
      const snapshot = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[index];
        if (!descriptor) throw new Error('unsupported sparse array');
        if (!descriptor.enumerable) throw new Error('unsupported non-enumerable array element');
        if (!Object.hasOwn(descriptor, 'value')) throw new Error('unsupported accessor array element');
        snapshot.push(snapshotIJsonValue(descriptor.value, active));
      }
      return snapshot;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error('unsupported non-plain JSON object');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const snapshot = {};
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key === 'symbol') throw new Error('unsupported symbol object property');
      assertUnicodeScalarString(key);
      const descriptor = descriptors[key];
      if (!descriptor.enumerable) throw new Error(`unsupported non-enumerable property '${key}'`);
      if (!Object.hasOwn(descriptor, 'value')) throw new Error(`unsupported accessor property '${key}'`);
      Object.defineProperty(snapshot, key, {
        value: snapshotIJsonValue(descriptor.value, active),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return snapshot;
  } finally {
    active.delete(value);
  }
}

export function canonicalizeJson(value) {
  const snapshot = snapshotIJsonValue(value);
  const emit = (node) => {
    if (node === null || typeof node !== 'object') return JSON.stringify(node);
    if (Array.isArray(node)) return `[${node.map(emit).join(',')}]`;
    return `{${Object.keys(node).sort().map((key) => `${JSON.stringify(key)}:${emit(node[key])}`).join(',')}}`;
  };
  return emit(snapshot);
}

export const sha256Bytes = (bytes) =>
  createHash('sha256').update(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)).digest('hex');

export const sha256Json = (value) =>
  sha256Bytes(Buffer.from(canonicalizeJson(value), 'utf8'));

export function parseJsonStrict(bytesOrText, label = 'JSON') {
  let text;
  if (typeof bytesOrText === 'string') {
    text = bytesOrText;
  } else if (Buffer.isBuffer(bytesOrText) || bytesOrText instanceof Uint8Array) {
    try {
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytesOrText);
    } catch {
      throw new Error(`${label}: invalid UTF-8`);
    }
  } else {
    throw new Error(`${label}: expected JSON bytes or text`);
  }

  let index = 0;
  const fail = (message) => {
    throw new Error(`${label}: ${message} at offset ${index}`);
  };
  const skipWhitespace = () => {
    while (
      text[index] === ' '
      || text[index] === '\t'
      || text[index] === '\n'
      || text[index] === '\r'
    ) {
      index += 1;
    }
  };

  const parseString = () => {
    if (text[index] !== '"') fail('expected string');
    const start = index;
    index += 1;
    let escaped = false;
    while (index < text.length) {
      const code = text.charCodeAt(index);
      const character = text[index];
      if (!escaped && code <= 0x1f) fail('unescaped control character in string');
      if (escaped) {
        escaped = false;
        index += 1;
        continue;
      }
      if (character === '\\') {
        escaped = true;
        index += 1;
        continue;
      }
      if (character === '"') {
        index += 1;
        let value;
        try {
          value = JSON.parse(text.slice(start, index));
        } catch {
          fail('invalid string escape');
        }
        try {
          assertUnicodeScalarString(value);
        } catch (error) {
          fail(error.message);
        }
        return value;
      }
      index += 1;
    }
    fail('unterminated string');
  };

  const parseNumber = () => {
    const match = text.slice(index)
      .match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (!match) fail('invalid number');
    index += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) fail('non-finite number');
    return value;
  };

  const parseValue = () => {
    skipWhitespace();
    const character = text[index];
    if (character === '"') return parseString();
    if (character === '{') {
      index += 1;
      skipWhitespace();
      const target = Object.create(null);
      const keys = new Set();
      if (text[index] === '}') {
        index += 1;
      } else {
        while (true) {
          skipWhitespace();
          const key = parseString();
          if (keys.has(key)) throw new Error(`${label}: duplicate key '${key}'`);
          keys.add(key);
          skipWhitespace();
          if (text[index] !== ':') fail("expected ':'");
          index += 1;
          target[key] = parseValue();
          skipWhitespace();
          if (text[index] === '}') {
            index += 1;
            break;
          }
          if (text[index] !== ',') fail("expected ',' or '}'");
          index += 1;
        }
      }
      const value = {};
      for (const key of Object.keys(target)) {
        Object.defineProperty(value, key, {
          value: target[key],
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
      return value;
    }
    if (character === '[') {
      index += 1;
      skipWhitespace();
      const value = [];
      if (text[index] === ']') {
        index += 1;
        return value;
      }
      while (true) {
        value.push(parseValue());
        skipWhitespace();
        if (text[index] === ']') {
          index += 1;
          return value;
        }
        if (text[index] !== ',') fail("expected ',' or ']'");
        index += 1;
      }
    }
    if (text.startsWith('true', index)) {
      index += 4;
      return true;
    }
    if (text.startsWith('false', index)) {
      index += 5;
      return false;
    }
    if (text.startsWith('null', index)) {
      index += 4;
      return null;
    }
    if (character === '-' || (character >= '0' && character <= '9')) {
      return parseNumber();
    }
    fail('expected JSON value');
  };

  const value = parseValue();
  skipWhitespace();
  if (index !== text.length) fail('trailing non-whitespace');
  snapshotIJsonValue(value);
  return value;
}
