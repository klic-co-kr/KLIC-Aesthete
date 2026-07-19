// Ratcliff/Obershelp gestalt pattern matching → similarity in 0..1.
// D_ro(S1,S2) = 2*Km / (len(S1)+len(S2))  where Km = total chars matched across
// recursively-found longest common substrings. Used to match labels/categories for proximity grouping.

export function ratcliffObershelp(s1, s2) {
  if (s1 == null && s2 == null) return 1;
  if (s1 == null || s2 == null) return 0;
  const a = String(s1);
  const b = String(s2);
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const matched = countMatched(a, b);
  return (2 * matched) / (a.length + b.length);
}

function countMatched(a, b) {
  let total = 0;
  let x = a;
  let y = b;
  // bound iterations to avoid pathological cost
  let guard = 0;
  while (x.length > 0 && y.length > 0 && guard++ < 256) {
    const c = longestCommonSubstring(x, y);
    if (!c) break;
    total += c.length;
    const ix = x.indexOf(c);
    x = x.slice(0, ix) + x.slice(ix + c.length);
    const iy = y.indexOf(c);
    y = y.slice(0, iy) + y.slice(iy + c.length);
  }
  return total;
}

function longestCommonSubstring(a, b) {
  let best = '';
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      let k = 0;
      while (i + k < a.length && j + k < b.length && a[i + k] === b[j + k]) k++;
      if (k > best.length) best = a.slice(i, i + k);
    }
  }
  return best;
}
