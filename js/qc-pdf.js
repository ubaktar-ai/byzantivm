// Quality-control PDFs: specification cards (client or supplier, one product or the whole order), QC report, issue report.
import { store, personName, drawingOf, roundsOf, attachmentsWhere } from './store.js';
import { toast, parseDate } from './lib.js';
import { fileUrls } from './files.js';
import { specRows, specDiff, showsFor, STAGES, INSPECTORS, IMAGE_GROUPS, SPEC_SECTIONS, fieldValue } from './qc-spec.js';
import { ISSUE_STATUSES, issueStatus, latestVersion, viewSpec, itemNo, lightingOf } from './views/qc.js';
import { samplesOf, sampleStatus, sampleDecision, SAMPLE_STATUSES, outcomePhotos } from './views/qc-more.js';
import { preloadPdf, startDocument, finishDocument, docLocale, loadLogo, safeFileName, presentPdf } from './pdf.js';
import { tearOf, tearRows, tearImages } from './views/tear.js';
const SPEC_FIELDS = Object.fromEntries(SPEC_SECTIONS.flatMap(sec => sec.fields).map(f => [f.key, f]));

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

// ---------- Tear sheets (client-facing product sheet, 1–2 pages per light; no prices) ----------

// Picture fitted and centred in a light box.
function fitBox(ctx, im, x, y, w, h) {
  const { doc } = ctx;
  doc.setFillColor(247, 246, 242);
  doc.rect(x, y, w, h, 'F');
  if (!im) return;
  const s = Math.min(w / im.w, h / im.h);
  doc.addImage(im.dataUrl, 'JPEG', x + (w - im.w * s) / 2, y + (h - im.h * s) / 2, im.w * s, im.h * s);
}

async function tearPage(ctx, k, it, c) {
  const { doc, grey, font, M, R, accent, line } = ctx;
  const tear = tearOf(it);
  const qty = Number(it.quantity) || 1;

  // Title
  font('bold', 8.5, accent);
  doc.text('TEAR SHEET', M, k.y + 1);
  let size = 22;
  font('bold', size);
  while (size > 15 && doc.getTextWidth(it.name) > R - M) { size -= 1; font('bold', size); }
  const name = doc.splitTextToSize(it.name, R - M).slice(0, 2);
  doc.text(name, M, k.y + 10);
  k.y += 10 + (name.length - 1) * size * 0.42 + 6;
  font('normal', 9, grey);
  doc.text([`Item ${itemNo(it)}`, c.p.order_no ? `Order ${c.p.order_no}` : '', c.p.name, `Quantity ${qty}`].filter(Boolean).join('   ·   '), M, k.y);
  k.y += 6;

  // Pictures: one large, up to four small
  let imgs = await loadImages(tearImages(it).slice(0, 5));
  if (!imgs.length) { const d = await drawingImage(it.id); if (d) imgs = [d]; }
  if (imgs.length) {
    const heroH = imgs.length > 1 ? 80 : 95;
    fitBox(ctx, imgs[0], M, k.y, R - M, heroH);
    k.y += heroH + 3;
    const thumbs = imgs.slice(1, 5);
    if (thumbs.length) {
      const w = (R - M - 9) / 4;
      thumbs.forEach((im, i) => fitBox(ctx, im, M + i * (w + 3), k.y, w, 26));
      k.y += 29;
    }
  }
  k.y += 2;
  if (tear.description) k.para(tear.description, { size: 10 });

  // Details in two balanced columns; long sections carry on in the next column or page.
  const colW = (R - M - 8) / 2;
  const labelW = 30;
  const newPage = () => {
    doc.addPage();
    doc.setFillColor(...accent);
    doc.rect(0, 0, 210, 4, 'F');
    font('normal', 8, grey);
    doc.text([c.company.legal_name || c.company.name, it.name].filter(Boolean).join('  ·  '), M, 12);
  };
  const sections = tearRows(it).map(sec => ({
    title: sec.title,
    rows: sec.rows.map(([key, val]) => {
      font('normal', 8, grey);
      const kl = doc.splitTextToSize(key, labelW - 2);
      font('bold', 8.5);
      const vl = doc.splitTextToSize(String(val), colW - labelW);
      return { kl, vl, h: Math.max(kl.length * 3.6, vl.length * 3.9) + 2 };
    }),
  }));
  sections.forEach(sec => { sec.h = 10.5 + sec.rows.reduce((t, r) => t + r.h, 0); });
  let colTop = k.y + 2, y = colTop, ci = 0, bottom = colTop;
  // Left column ends about halfway through what's left, so both columns come out even.
  let left = sections.reduce((t, sec) => t + sec.h, 0);
  let target = colTop + Math.min(272 - colTop, left / 2 + 6);
  const advance = () => {
    bottom = Math.max(bottom, y);
    if (ci === 0) { ci = 1; y = colTop; return; }
    newPage();
    ci = 0; colTop = y = bottom = 22;
    target = colTop + Math.min(272 - colTop, left / 2 + 6);
  };
  const heading = (title, x) => {
    font('bold', 8, accent);
    doc.text(title.toUpperCase(), x, y);
    doc.setDrawColor(...line);
    doc.setLineWidth(0.2);
    doc.line(x, y + 1.6, x + colW, y + 1.6);
    y += 6.5;
  };
  sections.forEach(sec => {
    if (ci === 0 && y > colTop && y + sec.h / 2 > target) advance();
    if (y + 6.5 + sec.rows[0].h > 272) advance();
    heading(sec.title, M + ci * (colW + 8));
    sec.rows.forEach(r => {
      if (y + r.h > 272) { advance(); heading(`${sec.title} (cont.)`, M + ci * (colW + 8)); }
      const x = M + ci * (colW + 8);
      font('normal', 8, grey);
      doc.text(r.kl, x, y);
      font('bold', 8.5);
      doc.text(r.vl, x + labelW, y);
      y += r.h;
      left -= r.h;
    });
    left -= 10.5;
    y += 4;
  });
  k.y = Math.max(bottom, y);

  // The original next to our version (when the product was based on a brand's item)
  const o = (it.spec || {})._original;
  if (o && tear.show_original) {
    const custom = ((it.spec || {})._custom || []).filter(ch => ch.ours);
    const show = (key, v) => { const f = SPEC_FIELDS[key]; return f ? fieldValue(f, { [key]: v }) || String(v || '') : String(v || ''); };
    const pic = (await loadImages((o.images || []).slice(0, 1)))[0];
    const tx = pic ? M + 50 : M;
    const tw = R - tx;
    const cw = [tw * 0.32, tw * 0.34, tw * 0.34];
    const rows = custom.map(ch => {
      font('normal', 8.5);
      const cells = [ch.label, show(ch.key, ch.original) || '—', show(ch.key, ch.ours)].map((t2, ci2) => doc.splitTextToSize(t2, cw[ci2] - 3));
      return { cells, h: Math.max(...cells.map(cl => cl.length)) * 3.9 + 2.5 };
    });
    const need = Math.max(pic ? 50 : 0, 16 + rows.reduce((t2, r) => t2 + r.h, 0) + (rows.length ? 7 : 6));
    k.heading('The original & our version', need + 12);
    const top = k.y;
    if (pic) fitBox(ctx, pic, M, top - 2, 45, 45);
    font('bold', 10);
    doc.text(doc.splitTextToSize(`Based on ${[o.brand, o.model].filter(Boolean).join(' ')}`, tw)[0], tx, top + 2);
    font('normal', 8, grey);
    doc.text([o.designer ? `Design: ${o.designer}` : '', o.product_url].filter(Boolean).map(t2 => doc.splitTextToSize(t2, tw)[0]), tx, top + 7);
    let ty = top + (o.designer && o.product_url ? 16 : 12);
    if (rows.length) {
      font('bold', 7.5, grey);
      ['DETAIL', 'ORIGINAL', 'OUR VERSION'].forEach((h2, ci2) => doc.text(h2, tx + cw.slice(0, ci2).reduce((a2, b2) => a2 + b2, 0), ty));
      ty += 5;
      rows.forEach(r => {
        r.cells.forEach((cl, ci2) => {
          font(ci2 === 2 ? 'bold' : 'normal', 8.5, ci2 === 0 ? grey : ci2 === 2 ? accent : undefined);
          doc.text(cl, tx + cw.slice(0, ci2).reduce((a2, b2) => a2 + b2, 0), ty);
        });
        doc.setDrawColor(...line);
        doc.setLineWidth(0.15);
        doc.line(tx, ty + r.h - 3, R, ty + r.h - 3);
        ty += r.h;
      });
    } else {
      font('normal', 9);
      doc.text('Made to the original’s specification.', tx, ty);
      ty += 6;
    }
    k.y = Math.max(ty, pic ? top + 46 : ty) + 4;
  }
}

async function buildTearSheets(items, fonts, logo) {
  const c = context(items[0].project_id);
  const ctx = startDocument({ fonts, logo, company: c.company, t: c.t, title: `Tear sheet ${items.length === 1 ? items[0].name : c.p.name}` });
  const k = kit(ctx);
  for (let i = 0; i < items.length; i++) {
    if (i > 0) {
      // Each light starts on a new page with the letterhead's accent bar.
      ctx.doc.addPage();
      ctx.doc.setFillColor(...ctx.accent);
      ctx.doc.rect(0, 0, 210, 4, 'F');
      ctx.font('normal', 8, ctx.grey);
      ctx.doc.text([c.company.legal_name || c.company.name, c.p.order_no, c.p.name].filter(Boolean).join('  ·  '), ctx.M, 12);
      k.y = 22;
    }
    await tearPage(ctx, k, items[i], c);
  }
  finishDocument({ ...ctx, company: c.company, t: c.t });
  const name = items.length === 1 ? `Tear sheet ${itemNo(items[0])} ${items[0].name}` : `Tear sheets ${c.p.order_no || ''} ${c.p.name}`;
  return { out: { blob: ctx.doc.output('blob'), fileName: `${safeFileName(name.replace(/\s+/g, ' '))}.pdf` }, c };
}

export async function createTearPdf(kind, id) {
  const items = kind === 'order' ? lightingOf(id) : [store.get('items', id)].filter(Boolean);
  if (!items.length) { toast('No lighting products in this order'); return; }
  const p = store.get('projects', items[0].project_id);
  const company = p && store.get('companies', p.company_id);
  toast('Creating PDF…');
  let res;
  try {
    const [fonts, logo] = await Promise.all([preloadPdf(), loadLogo(company).catch(() => null)]);
    res = await buildTearSheets(items, fonts, logo);
  } catch (err) {
    console.error(err);
    toast(`Couldn't create the PDF: ${err.message || err}`);
    return;
  }
  return presentPdf(res.out, { company: res.c.company, client: res.c.client });
}

// ---------- Price request PDF (for the supplier: no original price, no prices, no client) ----------

export async function createRfqPdf(projectId, itemIds) {
  const items = itemIds.map(id => store.get('items', id)).filter(Boolean);
  if (!items.length) return;
  const p = store.get('projects', projectId);
  const company = p && store.get('companies', p.company_id);
  toast('Creating PDF…');
  let res;
  try {
    const [fonts, logo] = await Promise.all([preloadPdf(), loadLogo(company).catch(() => null)]);
    const c = context(projectId);
    const ctx = startDocument({ fonts, logo, company: c.company, t: c.t, title: `Price request ${c.p.order_no || c.p.name}` });
    const k = kit(ctx);
    const { doc, grey, font, M, R, accent, line, ink } = ctx;
    const ref = c.p.order_no || c.p.name;
    const show = (key, v) => { const f = SPEC_FIELDS[key]; return f ? fieldValue(f, { [key]: v }) || String(v || '') : String(v || ''); };
    if (items.length > 1) {
      k.title('PRICE REQUEST', [['Order', ref], ['Items', String(items.length)], ['Date', fmtDate(new Date().toISOString())]]);
      k.para('Please send your price per piece and lead time for each item below, made as described. Write it on each page or reply with your quote.', { size: 9.5 });
      k.heading('Items');
      k.rows(items.map(it => [`${itemNo(it)}  ${it.name}`, `${Number(it.quantity) || 1} pcs`]));
    }
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const spec = it.spec || {};
      if (items.length > 1 || i > 0) {
        doc.addPage();
        doc.setFillColor(...accent);
        doc.rect(0, 0, 210, 4, 'F');
        font('normal', 8, grey);
        doc.text([c.company.legal_name || c.company.name, ref ? `Order ${ref}` : ''].filter(Boolean).join('  ·  '), M, 12);
        k.y = 22;
      }
      k.title('PRICE REQUEST', [['Order', ref], ['Item no.', itemNo(it)], ['Quantity', `${Number(it.quantity) || 1} pcs`], ['Date', fmtDate(new Date().toISOString())]]);
      font('bold', 15);
      const nameLines = doc.splitTextToSize(it.name, R - M);
      doc.text(nameLines, M, k.y);
      k.y += nameLines.length * 6 + 2;
      // Pictures: proposed, tear sheet, the original's and the client's
      const o = spec._original;
      const ids = [...new Set([...((spec._images || {}).offer || []), ...(((spec._tear || {}).images) || []), ...((o && o.images) || []), ...((spec._images || {}).vision || [])])];
      const imgs = await loadImages(ids.slice(0, 6));
      if (imgs.length) await k.photos(imgs);
      // Changes since the last time we sent this card: the supplier must update the price.
      const rev = spec._rev;
      if (rev && (rev.changes || []).length && !rev.priced_at) {
        k.heading('Changed since last time — please update your price');
        k.rows(rev.changes.map(ch => [ch.label, `${show(ch.key, ch.from) || '—'}  →  ${show(ch.key, ch.to)}`]));
      }
      const changes = (spec._custom || []).filter(ch => ch && ch.ours && showsFor(spec, ch.key, 'supplier', c.company.qc_template || {}));
      if (changes.length) {
        k.heading('Changed from the original');
        k.rows(changes.map(ch => [ch.label, `${show(ch.key, ch.original) || '—'}  →  ${show(ch.key, ch.ours)}`]));
      }
      specRows(spec, 'supplier', c.company.qc_template || {}).forEach(sec => {
        k.heading(sec.title);
        k.rows(sec.rows);
        if (sec.lines.length) k.rows(sec.lines.map((l, n) => [`Request ${n + 1}`, l]));
      });
      if (o) {
        k.heading('The original we’re based on');
        k.para([[o.brand, o.model].filter(Boolean).join(' — '), o.designer ? `design ${o.designer}` : ''].filter(Boolean).join('  ·  '), { bold: true, size: 9.5 });
        if (o.description) k.para(o.description, { size: 9 });
        const rows = Object.entries(o.specs || {}).filter(([key, v]) => SPEC_FIELDS[key] && String(v || '').trim()).map(([key, v]) => [SPEC_FIELDS[key].label, show(key, v)]);
        if (rows.length) k.rows(rows);
      }
      // Space for the supplier's answer
      k.heading('Your price', 46);
      [['Price per piece (currency)', 0], ['Lead time', 0], ['Notes', 0]].forEach(([label]) => {
        font('normal', 9, grey);
        doc.text(label, M, k.y + 4);
        doc.setDrawColor(...ink);
        doc.setLineWidth(0.25);
        doc.line(M + 52, k.y + 5, R, k.y + 5);
        k.y += 11;
      });
      doc.setDrawColor(...line);
    }
    finishDocument({ ...ctx, company: c.company, t: c.t });
    res = { out: { blob: doc.output('blob'), fileName: `${safeFileName(`Price request ${ref}`)}.pdf` }, c };
  } catch (err) {
    console.error(err);
    toast(`Couldn't create the PDF: ${err.message || err}`);
    return;
  }
  return presentPdf(res.out, { company: res.c.company });
}

// ---------- Supplier payout slip: what we pay the supplier after a client payment ----------
// Supplier prices only — no client, no selling prices — so it can go to the supplier with the transfer.
export async function createPayoutPdf(payoutId) {
  const out = store.get('supplier_payouts', payoutId);
  if (!out) return;
  const p = store.get('projects', out.project_id);
  const company = p && store.get('companies', p.company_id);
  toast('Creating PDF…');
  let res;
  try {
    const [fonts, logo] = await Promise.all([preloadPdf(), loadLogo(company).catch(() => null)]);
    const c = context(out.project_id);
    const ref = c.p.order_no || c.p.name;
    const ctx = startDocument({ fonts, logo, company: c.company, t: c.t, title: `Supplier payout ${out.number || ref}` });
    const k = kit(ctx);
    const { doc, grey, font, M, R, accent, line } = ctx;
    const cur = c.p.currency;
    const m = v => new Intl.NumberFormat(cur === 'USD' ? 'en-US' : 'en-GB', { style: 'currency', currency: cur }).format(Number(v) || 0);
    k.title('SUPPLIER PAYOUT', [['Slip no.', out.number], ['Order', ref], ['Date', fmtDate(out.created_at || new Date().toISOString())],
      ['Status', out.status === 'paid' ? `Paid ${out.paid_date ? fmtDate(out.paid_date) : ''}`.trim() : 'To pay']]);
    k.rows([['Pay to', out.supplier || '—'], ['For', out.title || ''], ...(out.notes ? [['Note', out.notes]] : [])]);
    // The items at the supplier's price
    const items = store.all('items').filter(i => i.project_id === out.project_id).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    k.heading('Order at your prices');
    const cols = [M, R - 72, R - 40, R];
    font('normal', 8, grey);
    doc.text('Item', cols[0], k.y); doc.text('Qty', cols[1], k.y, { align: 'right' });
    doc.text('Price / pc', cols[2], k.y, { align: 'right' }); doc.text('Total', cols[3], k.y, { align: 'right' });
    k.y += 5;
    let total = 0;
    items.forEach(it => {
      const q = Number(it.quantity) || 1;
      const u = Number(it.unit_cost) || 0;
      total += q * u;
      const name = doc.splitTextToSize(`${itemNo(it)}  ${it.name}`, cols[1] - M - 14);
      k.room(name.length * 4.4 + 2);
      font('normal', 9.5);
      doc.text(name, cols[0], k.y);
      doc.text(String(q), cols[1], k.y, { align: 'right' });
      doc.text(u ? m(u) : '—', cols[2], k.y, { align: 'right' });
      doc.text(u ? m(q * u) : '—', cols[3], k.y, { align: 'right' });
      k.y += name.length * 4.4 + 2;
    });
    doc.setDrawColor(...line); doc.setLineWidth(0.2); doc.line(M, k.y - 1, R, k.y - 1);
    k.y += 4;
    // Payments: earlier slips, this one, what is left
    const slips = store.all('supplier_payouts').filter(x => x.project_id === out.project_id && x.status !== 'cancelled')
      .sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    const before = slips.slice(0, slips.findIndex(x => x.id === out.id)).reduce((s, x) => s + (Number(x.amount) || 0), 0);
    const left = Math.max(0, Math.round((total - before - (Number(out.amount) || 0)) * 100) / 100);
    const sums = [['Order total', m(total)], ...(before ? [['Paid / on earlier slips', m(before)]] : [])];
    sums.forEach(([key, v]) => { font('normal', 9.5, grey); doc.text(key, R - 50, k.y, { align: 'right' }); font('bold', 9.5); doc.text(v, R, k.y, { align: 'right' }); k.y += 5.5; });
    k.room(14);
    doc.setFillColor(...accent);
    doc.rect(R - 95, k.y - 4.5, 95, 9, 'F');
    font('bold', 11, [255, 255, 255]);
    doc.text(out.title || 'This payment', R - 92, k.y + 1.5);
    doc.text(m(out.amount), R - 3, k.y + 1.5, { align: 'right' });
    k.y += 11;
    font('normal', 9.5, grey); doc.text('Still to pay after this', R - 50, k.y, { align: 'right' });
    font('bold', 9.5); doc.text(m(left), R, k.y, { align: 'right' });
    k.y += 8;
    k.signature(['Approved by', 'Paid on (date)']);
    finishDocument({ ...ctx, company: c.company, t: c.t });
    res = { out: { blob: doc.output('blob'), fileName: `${safeFileName(`Supplier payout ${out.number || ref}`)}.pdf` }, c };
  } catch (err) {
    console.error(err);
    toast(`Couldn't create the PDF: ${err.message || err}`);
    return;
  }
  return presentPdf(res.out, { company: res.c.company });
}
