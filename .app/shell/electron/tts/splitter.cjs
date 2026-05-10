// Splitter — port ของ split_lines / split_chars จาก _lib.py
// แต่อัพเกรดให้ใช้ Intl.Segmenter (ICU word breaker) สำหรับภาษาไทย/จีน/ญี่ปุ่น
// ที่ไม่ใช้ space แยกคำ — กันการตัดกลางคำ เช่น "เป|็น" → "เป็น"

const LETTER_RE = /[\p{L}\p{N}]/u;

// Lazy init — ใช้ ICU ที่ฝังมากับ Node 18+ ตัดคำตามภาษา
let _wordSegmenter = null;
function getWordSegmenter() {
  if (_wordSegmenter) return _wordSegmenter;
  try {
    _wordSegmenter = new Intl.Segmenter('th', { granularity: 'word' });
  } catch {
    _wordSegmenter = null;
  }
  return _wordSegmenter;
}

function segmentWords(text) {
  const seg = getWordSegmenter();
  if (!seg) return null;
  return [...seg.segment(text)].map((s) => s.segment);
}

function splitLines(text, linesPerChunk) {
  if (linesPerChunk <= 0) return [text];
  const out = [];
  let buf = [];
  let nonempty = 0;
  for (const line of text.split('\n')) {
    buf.push(line);
    if (line.trim()) nonempty += 1;
    if (nonempty >= linesPerChunk) {
      out.push(buf.join('\n').trim());
      buf = [];
      nonempty = 0;
    }
  }
  if (buf.length) {
    const tail = buf.join('\n').trim();
    if (tail) {
      if (out.length && tail.length < 200) {
        out[out.length - 1] += '\n' + tail;
      } else {
        out.push(tail);
      }
    }
  }
  const merged = [];
  for (const chunk of out) {
    if (LETTER_RE.test(chunk)) merged.push(chunk);
    else if (merged.length) merged[merged.length - 1] += '\n' + chunk;
  }
  return merged;
}

// Build chunks by accumulating words until we hit maxChars.
// Each chunk ends at a word boundary — never mid-word/mid-cluster.
function splitLongLineByWords(line, maxChars) {
  const words = segmentWords(line);
  if (!words || !words.length) return splitLongLineFallback(line, maxChars);

  const out = [];
  let buf = '';
  for (const w of words) {
    // single word longer than maxChars (rare for Thai, can happen for URLs/IDs)
    if (w.length > maxChars) {
      if (buf.trim()) { out.push(buf.trim()); buf = ''; }
      // hard-cut at maxChars only as last resort
      let rest = w;
      while (rest.length > maxChars) {
        out.push(rest.slice(0, maxChars).trim());
        rest = rest.slice(maxChars);
      }
      buf = rest;
      continue;
    }
    if (buf.length + w.length > maxChars && buf.trim().length > 0) {
      out.push(buf.trim());
      buf = '';
    }
    buf += w;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

// Fallback (Intl.Segmenter not available) — punctuation/space boundaries.
function splitLongLineFallback(line, maxChars) {
  const out = [];
  while (line.length > maxChars) {
    const candidates = [];
    for (const ch of ['。', '?', '!', 'ฯ', '๛', '.']) {
      const idx = line.lastIndexOf(ch, maxChars);
      if (idx > 0) candidates.push(idx + 1);
    }
    for (const ch of [',', ':', ';', '—', '…']) {
      const idx = line.lastIndexOf(ch, maxChars);
      if (idx > 0) candidates.push(idx + 1);
    }
    const sp = line.lastIndexOf(' ', maxChars);
    if (sp > 0) candidates.push(sp);
    const valid = candidates.filter((c) => c >= maxChars * 0.4);
    const cut = valid.length ? Math.max(...valid) : maxChars;
    out.push(line.slice(0, cut).trim());
    line = line.slice(cut).replace(/^\s+/, '');
  }
  if (line.trim()) out.push(line.trim());
  return out;
}

function splitChars(text, maxChars) {
  if (!Number.isFinite(maxChars) || maxChars < 10) maxChars = 100;
  text = text.replace(/[`"]/g, "'");
  const chunks = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.length <= maxChars) chunks.push(line);
    else chunks.push(...splitLongLineByWords(line, maxChars));
  }
  return chunks.filter((c) => LETTER_RE.test(c));
}

module.exports = { splitLines, splitChars, segmentWords };
