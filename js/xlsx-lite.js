// Read the cell text of an Excel file (.xlsx) in the browser — enough to hand a luminaire schedule to the AI.
// An .xlsx is a zip of XML files; this reads the zip's directory, inflates the parts it needs and returns
// [{ name, rows: [[cell, cell…], …] }] per sheet. No formulas are evaluated (the saved values are used).

async function unzip(buf) {
  const view = new DataView(buf);
  // The end-of-central-directory record is in the last 64 KB.
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('This is not an Excel (.xlsx) file');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const files = new Map();
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(buf, p + 46, nameLen));
    files.set(name, { method, size, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return {
    has: name => files.has(name),
    async text(name) {
      const f = files.get(name);
      if (!f) return '';
      const start = f.local + 30 + view.getUint16(f.local + 26, true) + view.getUint16(f.local + 28, true);
      const raw = new Uint8Array(buf, start, f.size);
      if (f.method === 0) return dec.decode(raw);
      const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Response(stream).text();
    },
  };
}

const xml = s => new DOMParser().parseFromString(s, 'application/xml');
const colIndex = ref => { let n = 0; for (const ch of String(ref).replace(/\d+/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };

export async function readXlsx(file) {
  const zip = await unzip(await file.arrayBuffer());
  const shared = [];
  const ss = await zip.text('xl/sharedStrings.xml');
  if (ss) xml(ss).querySelectorAll('si').forEach(si => shared.push([...si.querySelectorAll('t')].map(t => t.textContent).join('')));
  const wb = xml(await zip.text('xl/workbook.xml'));
  const rels = xml(await zip.text('xl/_rels/workbook.xml.rels'));
  const target = {};
  rels.querySelectorAll('Relationship').forEach(r => { target[r.getAttribute('Id')] = r.getAttribute('Target'); });
  const sheets = [];
  for (const s of wb.querySelectorAll('sheet')) {
    const rid = s.getAttribute('r:id') || s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    let path = target[rid] || '';
    path = path.startsWith('/') ? path.slice(1) : `xl/${path.replace(/^\.\//, '')}`;
    if (!zip.has(path)) continue;
    const doc = xml(await zip.text(path));
    const rows = [];
    doc.querySelectorAll('sheetData > row').forEach(row => {
      const cells = [];
      row.querySelectorAll('c').forEach(c => {
        const t = c.getAttribute('t');
        const v = c.querySelector('v');
        let val = '';
        if (t === 's' && v) val = shared[Number(v.textContent)] || '';
        else if (t === 'inlineStr') val = [...c.querySelectorAll('t')].map(x => x.textContent).join('');
        else if (v) val = v.textContent;
        cells[colIndex(c.getAttribute('r'))] = String(val).replace(/\s+/g, ' ').trim();
      });
      if (cells.some(Boolean)) rows.push(Array.from(cells, x => x || ''));
    });
    sheets.push({ name: s.getAttribute('name') || 'Sheet', rows });
  }
  return sheets;
}
