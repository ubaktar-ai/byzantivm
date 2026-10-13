// Quality-control PDFs: specification cards (client or supplier, one product or the whole order), QC report, issue report.
import { store, personName, drawingOf, roundsOf, attachmentsWhere } from './store.js';
import { toast, parseDate } from './lib.js';
import { fileUrls } from './files.js';
import { specRows, specDiff, showsFor, STAGES, INSPECTORS, IMAGE_GROUPS } from './qc-spec.js';
import { ISSUE_STATUSES, issueStatus, latestVersion, viewSpec, itemNo, lightingOf } from './views/qc.js';
import { samplesOf, sampleStatus, sampleDecision, SAMPLE_STATUSES, outcomePhotos } from './views/qc-more.js';
import { preloadPdf, startDocument, finishDocument, docLocale, loadLogo, safeFileName, presentPdf } from './pdf.js';

const lbl = (list, id) => (list.find(x => x.id === id) || {}).label || id || '';
const when = iso => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
// Documents need real dates, not "Today".
const fmtDate = s => parseDate(String(s).slice(0, 10)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const day = s => (s ? fmtDate(s) : '—');

// Photos for the PDF (JPEG, max 1000 px).
async function loadImage(att) {
  if (!att || !/^image\//.test(att.mime || '')) return null;
  const url = (await fileUrls([att.path]))[att.path];
  if (!url) return null;
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.crossOrigin = 'anonymous';
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('image'));
    i.src = url;
  });
  const scale = Math.min(1, 1000 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return { dataUrl: c.toDataURL('image/jpeg', 0.82), w: c.width, h: c.height, name: att.name };
}
const loadImages = async ids => (await Promise.all((ids || []).map(id => loadImage(store.get('attachments', id)).catch(() => null)))).filter(Boolean);

// The newest drawing image sent to the client for this product (approved round first).
async function drawingImage(itemId) {
  const d = itemId && drawingOf(itemId);
  if (!d) return null;
  const rounds = roundsOf(d.id).slice().reverse();
  const ordered = [...rounds.filter(r => r.status === 'approved'), ...rounds];
  for (const r of ordered) {
    const att = attachmentsWhere('round_id', r.id).find(a => /^image\//.test(a.mime || ''));
    if (att) return loadImage(att).catch(() => null);
  }
  return null;
}

// ---------- Small layout kit on top of the shared letterhead ----------

function kit(ctx) {
  const { doc, M, R, accent, grey, line, font } = ctx;
  let y = ctx.top;
  const k = {
    get y() { return y; },
    set y(v) { y = v; },
    room(h) {
      if (y + h <= 272) return;
      doc.addPage();
      doc.setFillColor(...accent);
      doc.rect(0, 0, 210, 4, 'F');
      y = 18;
    },
    title(text, meta) {
      // Shrink long titles so they never run into the details on the right.
      let size = 22;
      font('bold', size, accent);
      while (size > 14 && doc.getTextWidth(text) > R - 72 - M) { size -= 1; font('bold', size, accent); }
      doc.text(text, M, y + 8);
      let my = y + 2;
      meta.filter(([, v]) => v).forEach(([key, v]) => {
        font('normal', 8.5, grey);
        doc.text(key, R - 70, my);
        font('bold', 9);
        const lines = doc.splitTextToSize(String(v), 46).slice(0, 2);
        doc.text(lines, R, my, { align: 'right' });
        my += 5 + (lines.length - 1) * 4.2;
      });
      y = Math.max(y + 18, my + 4);
    },
    heading(text, need = 22) {
      k.room(need); // keep the heading together with what follows it
      y += 3;
      font('bold', 8.5, accent);
      doc.text(text.toUpperCase(), M, y);
      doc.setDrawColor(...line);
      doc.setLineWidth(0.2);
      doc.line(M, y + 1.8, R, y + 1.8);
      y += 7;
    },
    para(text, { size = 9.5, color, bold = false } = {}) {
      if (!text) return;
      font(bold ? 'bold' : 'normal', size, color);
      const lines = doc.splitTextToSize(String(text), R - M);
      lines.forEach(l => { k.room(5); doc.text(l, M, y); y += size * 0.47; });
      y += 1.5;
    },
    // Label / value rows; `box` draws a tick box for the supplier.
    rows(rows, { box = false } = {}) {
      const x0 = box ? M + 7 : M;
      rows.forEach(([key, val]) => {
        font('normal', 9, grey);
        const kl = doc.splitTextToSize(key, 58);
        font('bold', 9.5);
        const vl = doc.splitTextToSize(String(val), R - x0 - 64);
        const h = Math.max(kl.length, vl.length) * 4.4 + 2;
        k.room(h);
        if (box) { doc.setDrawColor(...grey); doc.setLineWidth(0.3); doc.rect(M, y - 3.2, 3.6, 3.6); }
        font('normal', 9, grey);
        doc.text(kl, x0, y);
        font('bold', 9.5);
        doc.text(vl, x0 + 62, y);
        y += h;
      });
    },
    photos: async imgs => {
      const w = (R - M - 8) / 3;
      let col = 0;
      let rowH = 0;
      for (const im of imgs) {
        const h = Math.min(w * (im.h / im.w), 70);
        const ww = h * (im.w / im.h);
        if (col === 0) k.room(h + 4);
        doc.addImage(im.dataUrl, 'JPEG', M + col * (w + 4), y, ww, h);
        rowH = Math.max(rowH, h);
        col++;
        if (col === 3) { col = 0; y += rowH + 4; rowH = 0; }
      }
      if (col) y += rowH + 4;
    },
    image(im, maxH = 110) {
      if (!im) return;
      const maxW = R - M;
      const s = Math.min(maxW / im.w, maxH / im.h);
      k.room(im.h * s + 4);
      doc.addImage(im.dataUrl, 'JPEG', M, y, im.w * s, im.h * s);
      y += im.h * s + 4;
    },
    signature(labels) {
      k.room(34);
      y += 6;
      const w = (R - M - 10) / labels.length;
      labels.forEach((l, i) => {
        const x = M + i * (w + 5);
        doc.setDrawColor(...ctx.ink);
        doc.setLineWidth(0.3);
        doc.line(x, y + 14, x + w, y + 14);
        font('normal', 8, grey);
        doc.text(l, x, y + 18);
      });
      y += 26;
    },
  };
  return k;
}

function context(projectId, title) {
  const p = store.get('projects', projectId);
  const company = (p && store.get('companies', p.company_id)) || {};
  const client = p && store.get('clients', p.client_id);
  const { t } = docLocale(company, 'en');
  return { p, company, client, t, title };
}

// ---------- Specification cards (client or supplier) — one product per page, or the whole order ----------

// Image box: the picture fitted inside, or an empty placeholder.
function imageBox(ctx, im, x, y, w, h, caption) {
  const { doc, grey, line, font } = ctx;
  font('bold', 7.5, grey);
  doc.text(caption.toUpperCase(), x + w / 2, y - 1.5, { align: 'center' });
  if (im) {
    const s = Math.min(w / im.w, h / im.h);
    const iw = im.w * s, ih = im.h * s;
    doc.addImage(im.dataUrl, 'JPEG', x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
  } else {
    doc.setDrawColor(...line);
    doc.setLineWidth(0.3);
    doc.setLineDashPattern([1.5, 1.5], 0);
    doc.rect(x, y, w, h);
    doc.setLineDashPattern([], 0);
    font('normal', 8, grey);
    doc.text('Image', x + w / 2, y + h / 2, { align: 'center' });
  }
}

const APPROVER = { internal: 'Us', supplier: 'Supplier', client: 'Client' };
// Specification cards are printed in dark moss green for both companies.
const SPEC_CARD_COLOR = '#4a5d23';

async function cardPage(ctx, k, entry, party, c) {
  const { doc, grey, font, M, R, accent } = ctx;
  const { item, version: v, spec } = entry;
  const prod = spec._product || {};
  const template = c.company.qc_template || {};
  const supplierCopy = party === 'supplier';
  const itemNoText = prod.item_no || (item ? itemNo(item) : '');
  k.title(supplierCopy ? 'PRODUCTION SPECIFICATION CARD' : 'SPECIFICATION CARD', [
    ['Order no.', c.p.order_no || '—'],
    ['Item no.', itemNoText],
    ['Project', c.p.name],
    ['Client', c.client ? c.client.name : ''],
    ['Version', v ? `v${v.version_no} · ${fmtDate(v.created_at)}` : 'DRAFT — not issued'],
  ]);
  font('bold', 15);
  const nameLines = doc.splitTextToSize(prod.name || entry.name, R - M);
  doc.text(nameLines, M, k.y);
  k.y += nameLines.length * 6;
  font('normal', 9.5, grey);
  doc.text([`Quantity: ${prod.quantity || 1} pcs`, spec.location_tag ? `Location: ${spec.location_tag}` : '', supplierCopy && prod.supplier ? `Supplier: ${prod.supplier}${prod.supplier_ref ? ` · ref. ${prod.supplier_ref}` : ''}` : ''].filter(Boolean).join('   ·   '), M, k.y + 1);
  k.y += 7;
  if (supplierCopy) {
    k.para('Make the products exactly as specified on this approved specification card. Nothing may be changed after approval — any change must be requested through your link and approved by us and the client in a new version before you go ahead.', { size: 8.5, color: grey });
  }

  // Pictures: received from client · proposed · outcome (first of each here, the rest in the gallery)
  const groups = spec._images || {};
  const visionImgs = await loadImages(groups.vision || []);
  let offerImgs = await loadImages(groups.offer || []);
  if (!offerImgs.length && item) { const d = await drawingImage(item.id); if (d) offerImgs = [d]; }
  const outcomeImgs = item ? await loadImages(outcomePhotos(item.id)) : [];
  const w = (R - M - 8) / 3, h = 48;
  k.room(h + 8);
  k.y += 3;
  imageBox(ctx, visionImgs[0], M, k.y, w, h, IMAGE_GROUPS[0].label);
  imageBox(ctx, offerImgs[0], M + w + 4, k.y, w, h, IMAGE_GROUPS[1].label);
  imageBox(ctx, outcomeImgs[0], M + 2 * (w + 4), k.y, w, h, 'Outcome');
  k.y += h + 6;

  if (v && v.version_no > 1) {
    const prev = store.all('spec_versions').find(x => x.item_id === v.item_id && x.version_no === v.version_no - 1);
    // Only changes to details this party sees (supplier name/ref only on the supplier copy).
    const changes = prev ? specDiff(prev.spec, v.spec).filter(ch => (ch.key === '_supplier' || ch.key === '_supplier_ref' ? supplierCopy
      : ch.key.startsWith('_') ? true : showsFor(v.spec, ch.key, party, template))) : [];
    k.heading(`Changes from v${v.version_no - 1}`);
    if (v.change_reason) k.para(`Reason: ${v.change_reason}`, { size: 9 });
    k.rows(changes.map(ch => [ch.label, `${ch.from || '—'}  →  ${ch.to || '—'}`]));
  }

  specRows(spec, party, template).forEach(sec => {
    k.heading(sec.title);
    k.rows(sec.rows, { box: supplierCopy });
    if (sec.lines.length) k.rows(sec.lines.map((l, i) => [`Request ${i + 1}`, l]), { box: supplierCopy });
  });

  // Samples
  const samples = item ? samplesOf(item.id) : [];
  if (samples.length) {
    k.heading('Samples', samples.some(x => x.photos.length) ? 70 : 22);
    for (const smp of samples) {
      const dec = sampleDecision(smp);
      const status = lbl(SAMPLE_STATUSES, sampleStatus(smp));
      k.rows([[smp.title, [
        `Sent ${smp.sent_on ? fmtDate(smp.sent_on) : fmtDate(smp.created_at)}${smp.tracking ? ` · ${smp.carrier} ${smp.tracking}` : ''}`,
        `${status}${dec ? ` — ${dec.person ? `${dec.person}, ` : ''}${fmtDate(dec.created_at)}${dec.note ? ` — “${dec.note}”` : ''}` : ''}`,
      ].join('\n')]]);
      const im = await loadImages(smp.photos.slice(0, 3));
      if (im.length) await k.photos(im);
    }
  }

  // Every other picture (no limit)
  const more = [
    [IMAGE_GROUPS[0].label, visionImgs.slice(1)], [IMAGE_GROUPS[1].label, offerImgs.slice(1)], ['Outcome', outcomeImgs.slice(1)],
  ].filter(([, list]) => list.length);
  for (const [title, list] of more) {
    k.heading(`More pictures — ${title}`, 62);
    await k.photos(list);
  }

  // Approvals: us, supplier, client
  k.heading('Approval', 52);
  const bw = (R - M - 8) / 3;
  const top = k.y;
  ['internal', 'supplier', 'client'].forEach((party2, i) => {
    const x = M + i * (bw + 4);
    const a = v && store.all('qc_approvals').filter(r => r.version_id === v.id && r.party === party2).sort((p1, p2) => (p1.created_at < p2.created_at ? -1 : 1)).pop();
    font('bold', 8.5, accent);
    doc.text(party2 === 'internal' ? (c.company.legal_name || c.company.name || 'Us') : APPROVER[party2], x, top);
    if (a) {
      const ok = a.decision === 'approved';
      font('bold', 9.5, ok ? [22, 130, 70] : [200, 40, 40]);
      doc.text(ok ? (party2 === 'supplier' ? 'CONFIRMED' : 'APPROVED') : 'NOT APPROVED', x, top + 6);
      font('normal', 8.5);
      doc.text(doc.splitTextToSize([a.person, a.method, when(a.created_at)].filter(Boolean).join(' · '), bw), x, top + 11);
    } else {
      doc.setDrawColor(...ctx.ink);
      doc.setLineWidth(0.25);
      [['Name', 10], ['Signature', 20], ['Date', 30]].forEach(([t, dy]) => {
        doc.line(x, top + dy, x + bw, top + dy);
        font('normal', 7, grey);
        doc.text(t, x, top + dy + 3);
      });
    }
  });
  k.y = top + 38;
  k.para(v ? `Version v${v.version_no} issued ${when(v.created_at)} · this version can't be changed. Production needs approval from all three.` : 'Draft — not issued yet. Approvals are recorded on issued versions only.', { size: 7.5, color: grey });
}

async function buildCards(entries, party, fonts, logo) {
  const c = context(entries[0].projectId);
  const supplierCopy = party === 'supplier';
  const ctx = startDocument({ fonts, logo, company: { ...c.company, color: SPEC_CARD_COLOR }, t: c.t, title: `${supplierCopy ? 'Production specification cards' : 'Specification cards'} ${c.p.name}` });
  const k = kit(ctx);
  const { doc, grey, font, M, R, accent } = ctx;
  if (entries.length > 1) {
    // Cover: the whole order at a glance
    k.title(supplierCopy ? 'PRODUCTION SPECIFICATION CARDS' : 'SPECIFICATION CARDS', [
      ['Order no.', c.p.order_no || '—'], ['Project', c.p.name], ['Client', c.client ? c.client.name : ''], ['Items', String(entries.length)],
    ]);
    k.heading('Items');
    k.rows(entries.map(e => {
      const pr = e.spec._product || {};
      return [`${pr.item_no || (e.item ? itemNo(e.item) : '')}  ${pr.name || e.name}`, `${pr.quantity || 1} pcs${e.spec.location_tag ? ` · ${e.spec.location_tag}` : ''} · ${e.version ? `v${e.version.version_no}` : 'draft'}`];
    }));
  }
  for (let i = 0; i < entries.length; i++) {
    if (entries.length > 1 || i > 0) {
      doc.addPage();
      doc.setFillColor(...accent);
      doc.rect(0, 0, 210, 4, 'F');
      font('normal', 8, grey);
      doc.text([c.company.legal_name || c.company.name, c.p.order_no, c.p.name].filter(Boolean).join('  ·  '), M, 12);
      k.y = 22;
    }
    await cardPage(ctx, k, entries[i], party, c);
  }
  finishDocument({ doc, company: c.company, t: c.t, font, M, R, line: ctx.line, grey });
  const base = entries.length > 1 ? `${supplierCopy ? 'Production specification cards' : 'Specification cards'} ${c.p.order_no || c.p.name}`
    : `${supplierCopy ? 'Production specification card' : 'Specification card'} ${c.p.order_no ? `${c.p.order_no} ` : ''}${(entries[0].spec._product || {}).item_no || ''} ${entries[0].name}`;
  return { out: { blob: doc.output('blob'), fileName: `${safeFileName(base.replace(/\s+/g, ' ').trim())}.pdf` }, c };
}

// ---------- QC report (client) ----------

async function buildInspection(insp, fonts, logo) {
  const c = context(insp.project_id);
  const ver = store.get('spec_versions', insp.version_id);
  const ctx = startDocument({ fonts, logo, company: c.company, t: c.t, title: `QC report ${insp.item_name}` });
  const k = kit(ctx);
  const { doc, grey, font, M, R } = ctx;
  const pass = insp.outcome === 'pass';
  k.title('QUALITY CONTROL REPORT', [
    ['Order', c.p ? c.p.name : ''],
    ['Client', c.client && c.client.name],
    ['Stage', lbl(STAGES, insp.stage)],
    ['Inspected', day(insp.inspected_on)],
    ['By', `${lbl(INSPECTORS, insp.inspector)}${insp.inspector_name ? ` — ${insp.inspector_name}` : ''}`],
  ]);
  font('bold', 15);
  doc.text(insp.item_name, M, k.y);
  font('normal', 9.5, grey);
  doc.text(`Checked against ${ver ? `spec v${ver.version_no}` : 'the draft spec'}${insp.units_checked ? ` · ${insp.units_checked} units checked` : ''}`, M, k.y + 6);
  doc.setFillColor(...(pass ? [22, 130, 70] : [200, 40, 40]));
  doc.roundedRect(R - 30, k.y - 6, 30, 10, 2, 2, 'F');
  font('bold', 11, [255, 255, 255]);
  doc.text(pass ? 'PASS' : 'FAIL', R - 15, k.y + 0.8, { align: 'center' });
  k.y += 14;

  const results = insp.results || [];
  const counts = ['pass', 'fail', 'na'].map(r => results.filter(x => x.result === r).length);
  k.para(`${counts[0]} passed · ${counts[1]} failed · ${counts[2]} not applicable`, { size: 9, color: grey });
  k.heading('Checklist');
  for (const x of results) {
    font('bold', 9.5);
    const labelLines = doc.splitTextToSize(x.label, R - M - 24);
    font('normal', 8.5);
    const detail = [x.expected && `Spec: ${x.expected}`, x.measured && `Measured: ${x.measured}`, x.note].filter(Boolean).join('  ·  ');
    const dl = detail ? doc.splitTextToSize(detail, R - M - 24) : [];
    k.room(labelLines.length * 4.4 + dl.length * 4 + 3);
    const color = x.result === 'pass' ? [22, 130, 70] : x.result === 'fail' ? [200, 40, 40] : grey;
    font('bold', 8.5, color);
    doc.text(x.result === 'pass' ? 'PASS' : x.result === 'fail' ? 'FAIL' : 'N/A', M, k.y);
    font('bold', 9.5);
    doc.text(labelLines, M + 22, k.y);
    let yy = k.y + labelLines.length * 4.4;
    if (dl.length) { font('normal', 8.5, grey); doc.text(dl, M + 22, yy); yy += dl.length * 4; }
    k.y = yy + 2.5;
    if (x.photos && x.photos.length && x.result === 'fail') await k.photos(await loadImages(x.photos));
  }
  const overall = await loadImages([...(insp.photos || []), ...results.filter(x => x.result !== 'fail').flatMap(x => x.photos || [])]);
  if (overall.length) { k.heading('Photos', 62); await k.photos(overall); }
  if (insp.notes) { k.heading('Notes'); k.para(insp.notes); }
  const issues = store.all('qc_issues').filter(i => i.inspection_id === insp.id);
  if (issues.length) {
    k.heading('Issues to resolve');
    issues.forEach(i => k.para(`#${i.number} ${i.title} — ${lbl(ISSUE_STATUSES, issueStatus(i))}`, { size: 9 }));
  }
  k.heading('Client sign-off');
  k.signature(['Name', 'Signature', 'Date']);
  k.para(`Report recorded ${when(insp.created_at)} by ${personName(insp.created_by) || '—'} · this report can't be changed.`, { size: 7.5, color: grey });
  finishDocument({ doc, company: c.company, t: c.t, font, M, R, line: ctx.line, grey });
  return { out: { blob: doc.output('blob'), fileName: `${safeFileName(`QC report ${insp.item_name} ${insp.inspected_on || ''}`)}.pdf` }, c };
}

// ---------- Issue report (supplier) ----------

async function buildIssue(issue, fonts, logo) {
  const c = context(issue.project_id);
  const ctx = startDocument({ fonts, logo, company: c.company, t: c.t, title: `Issue report #${issue.number}` });
  const k = kit(ctx);
  const { doc, grey, font, M, R } = ctx;
  const item = store.get('items', issue.item_id);
  k.title(`ISSUE REPORT #${issue.number}`, [
    ['Order', c.p ? c.p.name : ''],
    ['Product', issue.item_name || 'Whole order'],
    ['Supplier', item ? item.supplier : ''],
    ['Reported', fmtDate(issue.created_at.slice(0, 10))],
    ['Fix by', issue.due_date ? day(issue.due_date) : ''],
  ]);
  font('bold', 14);
  const tl = doc.splitTextToSize(issue.title, R - M);
  doc.text(tl, M, k.y);
  k.y += tl.length * 6 + 2;
  k.rows([
    ['Severity', lbl([{ id: 'minor', label: 'Minor' }, { id: 'major', label: 'Major' }, { id: 'critical', label: 'Critical' }], issue.severity)],
    ['Status', lbl(ISSUE_STATUSES, issueStatus(issue))],
    ['Should be (spec)', issue.expected || '—'],
    ['Found', issue.found || '—'],
    ...(issue.required_action ? [['Required action', issue.required_action]] : []),
  ]);
  if (issue.description) { k.heading('Details'); k.para(issue.description); }
  const imgs = await loadImages(issue.photos);
  if (imgs.length) { k.heading('Photos', 62); await k.photos(imgs); }
  const ups = store.all('qc_issue_updates').filter(u => u.issue_id === issue.id).sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  if (ups.length) {
    k.heading('History');
    for (const u of ups) {
      k.para(`${when(u.created_at)} — ${lbl(ISSUE_STATUSES, u.status)}${u.note ? `: ${u.note}` : ''}${u.cost ? ` (cost ${u.cost}${u.paid_by ? `, paid by ${u.paid_by}` : ''})` : ''}`, { size: 9 });
      const ui = await loadImages(u.photos);
      if (ui.length) await k.photos(ui);
    }
  }
  k.heading('Supplier acknowledgement');
  k.para('We acknowledge this issue and will carry out the required action by the date above.', { size: 9, color: grey });
  k.signature(['Name', 'Signature', 'Date']);
  k.para(`Issue recorded ${when(issue.created_at)} by ${personName(issue.created_by) || '—'}.`, { size: 7.5, color: grey });
  finishDocument({ doc, company: c.company, t: c.t, font, M, R, line: ctx.line, grey });
  return { out: { blob: doc.output('blob'), fileName: `${safeFileName(`Issue ${issue.number} ${issue.title}`).slice(0, 80)}.pdf` }, c };
}

// ---------- Public ----------

// kind: 'card' (product id) · 'version' (spec version id) · 'cards' (order id) · 'inspection' · 'issue'
export async function createQcPdf(kind, id, party = 'client') {
  let entries = null;
  let rec = null;
  const entryFor = (item, version) => ({
    item, version, projectId: (version || item).project_id, name: (item && item.name) || (version && version.item_name) || '',
    spec: viewSpec(version, item),
  });
  if (kind === 'card') {
    const it = store.get('items', id);
    if (it) entries = [entryFor(it, latestVersion(it.id))];
  } else if (kind === 'version') {
    const v = store.get('spec_versions', id);
    if (v) entries = [entryFor(store.get('items', v.item_id), v)];
  } else if (kind === 'cards') {
    const list = lightingOf(id);
    if (!list.length) { toast('No lighting products in this order'); return; }
    entries = list.map(it => entryFor(it, latestVersion(it.id)));
  } else {
    rec = kind === 'inspection' ? store.get('qc_inspections', id) : store.get('qc_issues', id);
  }
  const projectId = entries ? entries[0] && entries[0].projectId : rec && rec.project_id;
  if (!projectId) return;
  const p = store.get('projects', projectId);
  const company = p && store.get('companies', p.company_id);
  toast('Creating PDF…');
  let res;
  try {
    const [fonts, logo] = await Promise.all([preloadPdf(), loadLogo(company).catch(() => null)]);
    res = entries ? await buildCards(entries, party, fonts, logo)
      : kind === 'inspection' ? await buildInspection(rec, fonts, logo)
      : await buildIssue(rec, fonts, logo);
  } catch (err) {
    console.error(err);
    toast(`Couldn't create the PDF: ${err.message || err}`);
    return;
  }
  return presentPdf(res.out, { company: res.c.company, client: res.c.client });
}
