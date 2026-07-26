import { test, expect } from 'bun:test';
import {
  canonicalizeJson,
  parseJsonStrict,
  sha256Bytes,
  sha256Json,
} from '../lib/shared/canonical-json.mjs';

test('JCS: RFC 8785 section 3 sample has the canonical byte sequence', () => {
  const input = {
    numbers: [333333333.33333329, 1E30, 4.50, 2e-3, 1e-27],
    string: "€$\u000f\nA'B\"\\\\\"/",
    literals: [null, true, false],
  };
  const expected = `{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA'B\\"\\\\\\\\\\"/"}`;
  expect(canonicalizeJson(input)).toBe(expected);
});

test('JCS: object keys sort by raw UTF-16 code units while arrays retain order', () => {
  expect(canonicalizeJson({ ö: 1, '\r': 2, '1': 3, '€': 4, '😀': 5, '\ufb33': 6 }))
    .toBe(`{"\\r":2,"1":3,"ö":1,"€":4,"😀":5,"דּ":6}`);
  expect(canonicalizeJson([{ b: 1, a: 2 }, 3, 2, 1]))
    .toBe('[{"a":2,"b":1},3,2,1]');
});

test('SHA-256: raw abc bytes match the published digest', () => {
  expect(sha256Bytes(Buffer.from('abc')))
    .toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('SHA-256: structured values hash their canonical bytes', () => {
  expect(sha256Json({ b: 2, a: 1 }))
    .toBe(sha256Bytes(Buffer.from('{"a":1,"b":2}', 'utf8')));
});

test('strict JSON: decoded duplicate keys are rejected at any depth', () => {
  expect(() => parseJsonStrict('{"a":1,"\\u0061":2}', 'decision')).toThrow(/duplicate.*a/i);
  expect(() => parseJsonStrict('{"outer":{"x":1,"x":2}}', 'contract')).toThrow(/duplicate.*x/i);
});

test('strict JSON: lone UTF-16 surrogates are rejected', () => {
  expect(() => parseJsonStrict('"\\ud800"', 'decision')).toThrow(/surrogate/i);
  expect(() => parseJsonStrict('"\\udc00"', 'decision')).toThrow(/surrogate/i);
});

test('strict JSON: malformed UTF-8 is rejected and __proto__ remains ordinary data', () => {
  expect(() => parseJsonStrict(Buffer.from([0xc3, 0x28]), 'decision'))
    .toThrow(/utf-8/i);
  const value = parseJsonStrict('{"__proto__":{"polluted":true}}', 'decision');
  expect(Object.hasOwn(value, '__proto__')).toBe(true);
  expect({}.polluted).toBeUndefined();
});

test('strict JSON: a UTF-8 BOM is not silently removed from the grammar', () => {
  const bomPrefixedObject = Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d]);
  expect(() => parseJsonStrict(bomPrefixedObject, 'decision'))
    .toThrow(/expected JSON value/i);
});

test('strict JSON: malformed numbers, escapes, separators, and trailing input are rejected', () => {
  for (const source of [
    '01',
    '+1',
    '"\\x"',
    '{"a":1,}',
    '[1,]',
    '{"a" 1}',
    'true false',
  ]) {
    expect(() => parseJsonStrict(source, 'decision')).toThrow();
  }
});

test('JCS: lossy or non-JSON values are rejected', () => {
  expect(() => canonicalizeJson({ value: undefined })).toThrow(/unsupported/i);
  expect(() => canonicalizeJson([, 1])).toThrow(/sparse/i);
  expect(() => canonicalizeJson({ value: NaN })).toThrow(/non-finite/i);
  expect(() => canonicalizeJson({ value: 1n })).toThrow(/unsupported/i);
  const cyclic = {}; cyclic.self = cyclic;
  expect(() => canonicalizeJson(cyclic)).toThrow(/cycle/i);
  expect(canonicalizeJson(-0)).toBe('0');
});

test('JCS: hostile object descriptors cannot be omitted or evaluated twice', () => {
  let reads = 0;
  const accessor = {};
  Object.defineProperty(accessor, 'value', {
    enumerable: true,
    get() {
      reads += 1;
      return reads;
    },
  });
  expect(() => canonicalizeJson(accessor)).toThrow(/accessor/i);
  expect(reads).toBe(0);

  const symbolKey = { visible: true };
  symbolKey[Symbol('hidden')] = 1n;
  expect(() => canonicalizeJson(symbolKey)).toThrow(/symbol/i);

  const nonEnumerable = { visible: true };
  Object.defineProperty(nonEnumerable, 'hidden', { value: undefined });
  expect(() => canonicalizeJson(nonEnumerable)).toThrow(/non-enumerable/i);

  const extraArrayProperty = [1];
  extraArrayProperty.extra = 2;
  expect(() => canonicalizeJson(extraArrayProperty)).toThrow(/array property/i);

  let lengthReads = 0;
  const proxiedArray = new Proxy([1], {
    get(target, key, receiver) {
      if (key === 'length') {
        lengthReads += 1;
        return lengthReads === 1 ? 1 : 0;
      }
      return Reflect.get(target, key, receiver);
    },
  });
  expect(canonicalizeJson(proxiedArray)).toBe('[1]');
  expect(lengthReads).toBe(0);

  expect(() => canonicalizeJson(new Date(0))).toThrow(/non-plain/i);
});

test('JCS: repeated non-cyclic references remain valid JSON data', () => {
  const child = { x: 1 };
  expect(canonicalizeJson({ a: child, b: child }))
    .toBe('{"a":{"x":1},"b":{"x":1}}');
});

test('JCS: selected RFC 8785 Appendix B numbers use ECMAScript serialization', () => {
  const cases = [
    [5e-324, '5e-324'],
    [1.7976931348623157e+308, '1.7976931348623157e+308'],
    [9007199254740992, '9007199254740992'],
    [0.000001, '0.000001'],
    [1e-7, '1e-7'],
  ];
  for (const [value, expected] of cases) expect(canonicalizeJson(value)).toBe(expected);
});
