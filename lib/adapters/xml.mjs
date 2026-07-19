// Tolerant XML scanner → element tree. Not spec-perfect; good enough for extracting
// geometric attributes from SVG and OOXML slide XML. Namespace prefixes are KEPT
// in `tag` (e.g. "p:sp", "a:off"); use localName() to compare the part after ':'.
// Each node: { tag, attrs:{}, children:[], text:'' }

const VOID_TAGS = new Set([
  'rect', 'circle', 'ellipse', 'line', 'path', 'polygon', 'polyline',
  'image', 'use', 'a:off', 'a:ext', 'br', 'img', 'meta', 'link', 'input', 'hr',
]);
export { VOID_TAGS };

export function parseXml(input) {
  const src = String(input ?? '');
  const root = { tag: '#document', attrs: {}, children: [], text: '' };
  const stack = [root];
  let i = 0;
  const n = src.length;
  const top = () => stack[stack.length - 1];

  while (i < n) {
    if (src[i] !== '<') {
      let j = src.indexOf('<', i);
      if (j < 0) j = n;
      const txt = src.slice(i, j);
      if (txt.trim()) top().text += txt;
      i = j;
      continue;
    }
    if (src.startsWith('<!--', i)) { const e = src.indexOf('-->', i + 4); i = e < 0 ? n : e + 3; continue; }
    if (src.startsWith('<![CDATA[', i)) {
      const e = src.indexOf(']]>', i + 9);
      top().text += e < 0 ? src.slice(i + 9) : src.slice(i + 9, e);
      i = e < 0 ? n : e + 3; continue;
    }
    if (src[i + 1] === '?') { const e = src.indexOf('?>', i); i = e < 0 ? n : e + 2; continue; }
    if (src[i + 1] === '!') { const e = src.indexOf('>', i); i = e < 0 ? n : e + 1; continue; }

    if (src[i + 1] === '/') {
      const e = src.indexOf('>', i);
      const name = src.slice(i + 2, e < 0 ? n : e).trim();
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].tag === name || localName(stack[k].tag) === localName(name)) {
          stack.length = k;
          break;
        }
      }
      i = e < 0 ? n : e + 1;
      continue;
    }

    // opening tag
    i++;
    let name = '';
    while (i < n && src[i] !== '>' && src[i] !== '/' && !/\s/.test(src[i])) name += src[i++];
    const attrs = {};
    let selfClose = false;
    while (i < n && src[i] !== '>') {
      while (i < n && /\s/.test(src[i])) i++;
      if (src[i] === '>' || src[i] === '/') {
        if (src[i] === '/') { selfClose = true; i++; }
        break;
      }
      let an = '';
      while (i < n && src[i] !== '>' && src[i] !== '=' && !/\s/.test(src[i])) an += src[i++];
      while (i < n && /\s/.test(src[i])) i++;
      let av = '';
      if (src[i] === '=') {
        i++;
        while (i < n && /\s/.test(src[i])) i++;
        const q = src[i];
        if (q === '"' || q === "'") {
          i++;
          while (i < n && src[i] !== q) av += src[i++];
          if (src[i] === q) i++;
        } else {
          while (i < n && src[i] !== '>' && !/\s/.test(src[i])) av += src[i++];
        }
      }
      if (an) attrs[an] = decodeEntities(av);
    }
    if (src[i] === '>') i++;

    const el = { tag: name, attrs, children: [], text: '' };
    top().children.push(el);
    if (selfClose || VOID_TAGS.has(name) || VOID_TAGS.has(localName(name))) {
      // leaf
    } else {
      stack.push(el);
    }
  }
  return root;
}

export function localName(tag) {
  const k = String(tag).lastIndexOf(':');
  return k >= 0 ? tag.slice(k + 1) : tag;
}

// depth-first collect of descendants whose tag (full or local) matches `name`
export function findByTag(el, name) {
  const out = [];
  const walk = (e) => {
    for (const c of e.children) {
      if (c.tag === name || localName(c.tag) === name) out.push(c);
      walk(c);
    }
  };
  walk(el);
  return out;
}

// text content of an element (concatenated descendant text)
export function textOf(el) {
  let s = el.text || '';
  for (const c of el.children) s += textOf(c);
  return s.trim();
}

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
