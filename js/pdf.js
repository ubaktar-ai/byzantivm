// Printable quotes & invoices as real PDF files (jsPDF + embedded Inter font,
// so accented characters print correctly). Everything is loaded on first use.
import { esc, icon, openSheet, sheetHeader, toast, parseDate, $ } from './lib.js';
import { store, contactsOf, productsOf, shipmentsOf } from './store.js';
import { itemsOf, costsOf, quotesOf, quoteTotal } from './money.js';
import { fileUrls } from './files.js';

export const DOC_LANGUAGES = [
  { id: 'en', label: 'English', locale: 'en-GB' },
  { id: 'nl', label: 'Nederlands', locale: 'nl-NL' },
];

const T = {
  en: {
    quote: 'PROPOSAL', invoice: 'INVOICE', packing: 'PACKING LIST', shipTo: 'Ship to', order: 'Order', shipDate: 'Ship date',
    carrier: 'Carrier', tracking: 'Tracking', packages: 'Packages', weight: 'Weight', pieces: 'pieces', item: 'Item',
    received: 'Received in good condition', signature: 'Name, date & signature', number: 'Number', date: 'Date', due: 'Due date', valid: 'Valid until',
    billTo: 'Bill to', quoteFor: 'Prepared for', project: 'Project', description: 'Description', qty: 'Qty',
    unit: 'Unit price', amount: 'Amount', subtotal: 'Subtotal', vat: 'VAT', total: 'Total', notes: 'Notes',
    payment: 'Payment details', bank: 'Bank', iban: 'IBAN', swift: 'BIC/SWIFT', reference: 'Reference',
    taxId: 'VAT ID', clientTax: 'VAT ID', reg: 'KvK no.', attn: 'Attn.', page: 'Page', of: 'of',
    thanks: 'Thank you for your business.', terms: 'Terms', pay: 'Please pay by', subject: 'Subject',
    reverse_charge: 'VAT reverse-charged', outside_eu: 'No Dutch VAT', kor: 'VAT exempt (KOR)',
    reverse_chargeNote: 'VAT reverse-charged: VAT is to be accounted for by the recipient (Article 196, EU VAT Directive 2006/112/EC).',
    outside_euNote: 'Not subject to Dutch VAT: service supplied to a recipient established outside the EU.',
    korNote: 'Exempt from VAT under the Dutch small business scheme (KOR).',
  },
  nl: {
    quote: 'OFFERTE', invoice: 'FACTUUR', packing: 'PAKBON', shipTo: 'Afleveradres', order: 'Order', shipDate: 'Verzenddatum',
    carrier: 'Vervoerder', tracking: 'Track & trace', packages: 'Colli', weight: 'Gewicht', pieces: 'stuks', item: 'Artikel',
    received: 'In goede staat ontvangen', signature: 'Naam, datum & handtekening', number: 'Nummer', date: 'Datum', due: 'Vervaldatum', valid: 'Geldig tot',
    billTo: 'Factuur aan', quoteFor: 'Offerte voor', project: 'Project', description: 'Omschrijving', qty: 'Aantal',
    unit: 'Prijs per stuk', amount: 'Bedrag', subtotal: 'Subtotaal', vat: 'Btw', total: 'Totaal', notes: 'Opmerkingen',
    payment: 'Betaalgegevens', bank: 'Bank', iban: 'IBAN', swift: 'BIC', reference: 'Kenmerk',
    taxId: 'Btw-id', clientTax: 'Btw-id', reg: 'KvK-nummer', attn: 'T.a.v.', page: 'Pagina', of: 'van',
    thanks: 'Bedankt voor de samenwerking.', terms: 'Voorwaarden', pay: 'Graag betalen vóór', subject: 'Onderwerp',
    reverse_charge: 'Btw verlegd', outside_eu: 'Geen Nederlandse btw', kor: 'Vrijgesteld (KOR)',
    reverse_chargeNote: 'Btw verlegd naar de afnemer (artikel 196 Btw-richtlijn 2006/112/EG).',
    outside_euNote: 'Niet belast met Nederlandse btw: dienst verricht voor een afnemer gevestigd buiten de EU.',
    korNote: 'Vrijgesteld van btw op grond van de kleineondernemersregeling (KOR).',
  },
};

// A US company (Byzantivm) uses American English, sales tax instead of VAT, EIN and US bank details.
const US_LABELS = {
  vat: 'Sales tax', taxId: 'EIN', clientTax: 'Tax ID', reg: 'Reg. no.', iban: 'Account no.', swift: 'Routing / SWIFT',
};

// ---------- Loading jsPDF, fonts and logos (once) ----------

let libPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load the PDF library'));
    document.head.appendChild(s);
  });
}

async function fontBase64(url) {
  const buf = await (await fetch(url)).arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function preloadPdf() {
  libPromise ||= Promise.all([
    window.jspdf ? null : loadScript('vendor/jspdf.umd.min.js'),
    fontBase64('vendor/fonts/Inter-Regular.ttf'),
    fontBase64('vendor/fonts/Inter-SemiBold.ttf'),
  ]).then(([, regular, semibold]) => ({ regular, semibold }))
    .catch(err => { libPromise = null; throw err; });
  return libPromise;
}

const logoCache = new Map(); // logo_path -> { dataUrl, w, h }

// Built-in logos, used until a logo is uploaded in Team → Document details.
const BUILT_IN_LOGOS = [
  [/byzant/i, 'icons/logo-byzantivm.svg'],
  [/demya/i, 'icons/logo-demya.png'],
];
function builtInLogo(company) {
  const hit = BUILT_IN_LOGOS.find(([re]) => re.test(`${company.id} ${company.name}`));
  return hit ? new URL(hit[1], document.baseURI).href : '';
}

async function loadLogo(company) {
  if (!company) return null;
  const key = company.logo_path || `builtin:${company.id}`;
  if (logoCache.has(key)) return logoCache.get(key);
  const url = company.logo_path ? (await fileUrls([company.logo_path]))[company.logo_path] : builtInLogo(company);
  if (!url) return null;
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.crossOrigin = 'anonymous';
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('Logo could not be loaded'));
    i.src = url;
  });
  // Re-encode as PNG (keeps transparency, normalises any format).
  const scale = Math.min(1, 800 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const logo = { dataUrl: c.toDataURL('image/png'), w: c.width, h: c.height };
  logoCache.set(key, logo);
  return logo;
}

// ---------- Helpers ----------

const num = v => Number(v) || 0;
const round2 = n => Math.round(n * 100) / 100;

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  const n = m ? parseInt(m[1], 16) : 0x333333;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function safeFileName(s) {
  return (s || 'document').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'document';
}

// ---------- Shared page layout: accent bar, logo, company details, footer ----------

function startDocument({ fonts, logo, company, t, title }) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  doc.addFileToVFS('Inter-Regular.ttf', fonts.regular);
  doc.addFont('Inter-Regular.ttf', 'Inter', 'normal');
  doc.addFileToVFS('Inter-SemiBold.ttf', fonts.semibold);
  doc.addFont('Inter-SemiBold.ttf', 'Inter', 'bold');
  doc.setProperties({ title, author: company.legal_name || company.name, creator: 'Studio' });

  const W = 210, M = 18, R = W - M;
  const accent = hexToRgb(company.color);
  const ink = [28, 27, 25], grey = [110, 106, 98], line = [225, 222, 215];
  const font = (weight, size, color = ink) => { doc.setFont('Inter', weight); doc.setFontSize(size); doc.setTextColor(...color); };

  doc.setFillColor(...accent);
  doc.rect(0, 0, W, 4, 'F');

  // Logo or company name (left)
  let y = 16;
  if (logo) {
    const maxW = 55, maxH = 22;
    const s = Math.min(maxW / logo.w, maxH / logo.h);
    doc.addImage(logo.dataUrl, 'PNG', M, y, logo.w * s, logo.h * s);
  } else {
    font('bold', 18);
    doc.text(company.legal_name || company.name || '', M, y + 8);
  }

  // Company details (right)
  const companyLines = [
    ...(company.address || '').split('\n'),
    [company.email, company.phone].filter(Boolean).join(' · '),
    company.website,
    company.tax_id ? `${t.taxId}: ${company.tax_id}` : '',
    company.registration ? `${t.reg}: ${company.registration}` : '',
  ].map(x => (x || '').trim()).filter(Boolean);
  font('bold', 10);
  doc.text(company.legal_name || company.name || '', R, y + 3, { align: 'right' });
  font('normal', 8.5, grey);
  companyLines.forEach((l, i) => doc.text(l, R, y + 8 + i * 4, { align: 'right' }));
  const top = Math.max(y + 30, y + 10 + companyLines.length * 4) + 4;
  return { doc, W, M, R, accent, ink, grey, line, font, top };
}

function finishDocument({ doc, company, t, font, M, R, line, grey }) {
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...line);
    doc.setLineWidth(0.2);
    doc.line(M, 283, R, 283);
    font('normal', 7.5, grey);
    const pageLabel = `${t.page} ${i} ${t.of} ${pages}`;
    // Drop the least important parts until the footer fits next to the page number.
    const parts = [company.legal_name || company.name, company.tax_id ? `${t.taxId} ${company.tax_id}` : '',
      company.registration ? `${t.reg} ${company.registration}` : '', company.iban ? `${t.iban} ${company.iban}` : ''].filter(Boolean);
    const room = R - M - doc.getTextWidth(pageLabel) - 6;
    while (parts.length > 1 && doc.getTextWidth(parts.join('  ·  ')) > room) parts.pop();
    doc.text(doc.splitTextToSize(parts.join('  ·  '), room)[0] || '', M, 288);
    doc.text(pageLabel, R, 288, { align: 'right' });
  }
}

// Labels, locale and formatters for a company's documents.
function docLocale(company, preferred) {
  const us = (company.country || 'NL') === 'US';
  const lang = us ? 'en' : T[preferred] ? preferred : (T[company.doc_language] ? company.doc_language : 'en');
  return {
    us,
    t: us ? { ...T.en, ...US_LABELS } : T[lang],
    locale: us ? 'en-US' : DOC_LANGUAGES.find(l => l.id === lang).locale,
  };
}

// ---------- Building the document ----------

function buildPdf(kind, rec, fonts, logo) {
  const p = store.get('projects', rec.project_id);
  const company = store.get('companies', p.company_id) || {};
  const client = store.get('clients', p.client_id);
  const contact = client ? contactsOf(client.id)[0] : null;
  const { us, t, locale } = docLocale(company, rec.language);
  const treatment = us ? 'standard' : (rec.vat_treatment || 'standard');
  const fmtMoney = v => new Intl.NumberFormat(locale, { style: 'currency', currency: p.currency }).format(v);
  const fmtNum = v => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(v);
  const fmtDay = d => (d ? parseDate(d).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' }) : '—');

  const lines = kind === 'quote'
    ? itemsOf(rec.id).map(i => ({ description: i.description, qty: num(i.quantity), unit: num(i.unit_price), amount: round2(num(i.quantity) * num(i.unit_price)) }))
    : [{ description: [rec.title, p.name].filter(Boolean).join(' — '), qty: 1, unit: num(rec.amount), amount: num(rec.amount) }];
  const subtotal = round2(lines.reduce((s, l) => s + l.amount, 0));
  const vatRate = treatment === 'standard' ? num(rec.vat_rate) : 0;
  const vat = round2(subtotal * vatRate / 100);
  const total = round2(subtotal + vat);

  const docTitle = `${kind === 'quote' ? t.quote : t.invoice} ${rec.number || ''}`.trim();
  const { doc, W, M, R, accent, ink, grey, line, font, top } = startDocument({ fonts, logo, company, t, title: docTitle });
  let y = top;

  // Title + meta
  font('bold', 24, accent);
  doc.text(kind === 'quote' ? t.quote : t.invoice, M, y + 8);
  const meta = [
    [t.number, rec.number || '—'],
    [t.date, fmtDay(rec.issue_date)],
    kind === 'quote' ? [t.valid, fmtDay(rec.valid_until)] : [t.due, fmtDay(rec.due_date)],
  ];
  meta.forEach(([k, v], i) => {
    font('normal', 9, grey);
    doc.text(k, R - 52, y + 2 + i * 5.5);
    font('bold', 9.5);
    doc.text(String(v), R, y + 2 + i * 5.5, { align: 'right' });
  });
  y += 22;

  // Bill to
  font('bold', 8, grey);
  doc.text((kind === 'quote' ? t.quoteFor : t.billTo).toUpperCase(), M, y);
  y += 5.5;
  font('bold', 11.5);
  doc.text(client ? client.name : '—', M, y);
  font('normal', 9.5, ink);
  const clientLines = client ? [
    contact ? `${t.attn} ${contact.name}${contact.role ? `, ${contact.role}` : ''}` : '',
    ...(client.address || '').split('\n'),
    client.tax_id ? `${t.clientTax}: ${client.tax_id}` : '',
    client.email || (contact && contact.email) || '',
  ].map(s => (s || '').trim()).filter(Boolean) : [];
  clientLines.forEach((l, i) => doc.text(l, M, y + 5 + i * 4.6));
  y += 5 + clientLines.length * 4.6 + 4;
  const labelled = (lab, value) => {
    font('normal', 9.5, grey);
    doc.text(`${lab}: `, M, y);
    const x = M + doc.getTextWidth(`${lab}: `) + 0.5;
    font('bold', 9.5);
    doc.text(doc.splitTextToSize(value, R - x)[0], x, y);
    y += 5.5;
  };
  labelled(t.project, p.name);
  if (kind === 'quote' && rec.title && rec.title.trim() !== p.name.trim()) labelled(t.subject, rec.title);
  y += 3.5;

  // Line items table
  const col = { desc: M + 3, qty: 128, unit: 158, amount: R - 3 };
  const header = () => {
    doc.setFillColor(244, 243, 239);
    doc.rect(M, y - 5, R - M, 8, 'F');
    font('bold', 8.5, grey);
    doc.text(t.description, col.desc, y);
    doc.text(t.qty, col.qty, y, { align: 'right' });
    doc.text(t.unit, col.unit, y, { align: 'right' });
    doc.text(t.amount, col.amount, y, { align: 'right' });
    y += 8;
  };
  // Start a new page when there's no room; table rows repeat the column header, other content doesn't.
  const pageBreak = (need, tableRow = false) => {
    if (y + need < 262) return;
    doc.addPage();
    doc.setFillColor(...accent);
    doc.rect(0, 0, W, 4, 'F');
    y = 20;
    if (tableRow) header();
  };
  header();
  lines.forEach(l => {
    font('normal', 9.5);
    const wrapped = doc.splitTextToSize(l.description || '', col.qty - col.desc - 18);
    const h = Math.max(1, wrapped.length) * 4.6 + 3;
    pageBreak(h, true);
    doc.text(wrapped, col.desc, y);
    doc.text(fmtNum(l.qty), col.qty, y, { align: 'right' });
    doc.text(fmtMoney(l.unit), col.unit, y, { align: 'right' });
    font('bold', 9.5);
    doc.text(fmtMoney(l.amount), col.amount, y, { align: 'right' });
    y += h;
    doc.setDrawColor(...line);
    doc.setLineWidth(0.2);
    doc.line(M, y - 3.5, R, y - 3.5);
  });

  // Totals
  pageBreak(30);
  y += 3;
  const totalRow = (label, value, strong = false) => {
    font(strong ? 'bold' : 'normal', strong ? 12 : 9.5, strong ? ink : grey);
    doc.text(label, col.unit - 22, y);
    font('bold', strong ? 12 : 9.5, strong ? accent : ink);
    doc.text(value, col.amount, y, { align: 'right' });
    y += strong ? 8 : 5.5;
  };
  // A US document without sales tax just shows the total.
  if (!(us && vatRate === 0)) {
    totalRow(t.subtotal, fmtMoney(subtotal));
    totalRow(treatment === 'standard' ? `${t.vat} ${fmtNum(vatRate)}%` : t[treatment], fmtMoney(vat));
    doc.setDrawColor(...ink);
    doc.setLineWidth(0.4);
    doc.line(col.unit - 22, y - 3, R, y - 3);
    y += 2;
  }
  totalRow(t.total, fmtMoney(total), true);
  y += 4;

  // Notes, terms, payment details
  const block = (title, text) => {
    if (!text || !String(text).trim()) return;
    font('normal', 9.5);
    const wrapped = doc.splitTextToSize(String(text).trim(), R - M);
    pageBreak(8 + wrapped.length * 4.4);
    font('bold', 8, grey);
    doc.text(title.toUpperCase(), M, y);
    y += 5;
    font('normal', 9.5);
    doc.text(wrapped, M, y);
    y += wrapped.length * 4.4 + 5;
  };
  if (treatment !== 'standard') block(t.vat, t[`${treatment}Note`]);
  block(t.notes, rec.notes);
  block(t.terms, company.payment_terms);
  if (kind === 'invoice' && (company.iban || company.bank_name)) {
    const pay = [
      company.bank_name ? `${t.bank}: ${company.bank_name}` : '',
      company.iban ? `${t.iban}: ${company.iban}` : '',
      company.swift ? `${t.swift}: ${company.swift}` : '',
      `${t.reference}: ${rec.number || ''}`,
      rec.due_date ? `${t.pay}: ${fmtDay(rec.due_date)}` : '',
    ].filter(Boolean).join('\n');
    block(t.payment, pay);
  }
  font('normal', 9.5, grey);
  pageBreak(8);
  doc.text(t.thanks, M, y);

  finishDocument({ doc, company, t, font, M, R, line, grey });

  return { blob: doc.output('blob'), fileName: `${safeFileName(rec.number || docTitle)}.pdf`, total };
}

// ---------- Packing list / delivery note ----------

function buildPackingList(p, fonts, logo) {
  const company = store.get('companies', p.company_id) || {};
  const client = store.get('clients', p.client_id);
  const contact = client ? contactsOf(client.id)[0] : null;
  const { t, locale } = docLocale(company, company.doc_language);
  const fmtNum = v => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(v);
  const fmtDay = d => (d ? parseDate(d).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' }) : '—');
  const products = productsOf(p.id);
  const shipment = shipmentsOf(p.id).slice(-1)[0] || null;
  const address = ((p.delivery_address || '').trim() || (client && client.address) || '').split('\n').map(x => x.trim()).filter(Boolean);

  const { doc, M, R, accent, ink, grey, line, font, top } = startDocument({ fonts, logo, company, t, title: `${t.packing} ${p.name}` });
  let y = top;

  font('bold', 24, accent);
  doc.text(t.packing, M, y + 8);
  let my = y + 2;
  [[t.order, p.name], [t.date, fmtDay(new Date().toISOString().slice(0, 10))], [t.shipDate, fmtDay(shipment && shipment.shipped_date)]]
    .forEach(([k, v]) => {
      font('normal', 9, grey);
      doc.text(k, R - 66, my);
      font('bold', 9.5);
      const lines = doc.splitTextToSize(String(v), 46).slice(0, 2);
      doc.text(lines, R, my, { align: 'right' });
      my += 5.5 + (lines.length - 1) * 4.4;
    });
  y = Math.max(y + 22, my + 4);

  // Ship to (left) and carrier details (right)
  font('bold', 8, grey);
  doc.text(t.shipTo.toUpperCase(), M, y);
  if (shipment) doc.text(t.carrier.toUpperCase(), 120, y);
  y += 5.5;
  font('bold', 11.5);
  doc.text(client ? client.name : '—', M, y);
  font('normal', 9.5);
  const shipLines = [contact ? `${t.attn} ${contact.name}` : '', ...address, contact && contact.phone ? contact.phone : ''].filter(Boolean);
  shipLines.forEach((l, i) => doc.text(l, M, y + 5 + i * 4.6));
  if (shipment) {
    const carrierLines = [shipment.carrier, shipment.tracking ? `${t.tracking}: ${shipment.tracking}` : '', shipment.packages ? `${t.packages}: ${shipment.packages}` : ''].filter(Boolean);
    font('bold', 11.5);
    doc.text(carrierLines[0] || '—', 120, y);
    font('normal', 9.5);
    carrierLines.slice(1).forEach((l, i) => doc.text(l, 120, y + 5 + i * 4.6));
  }
  y += 5 + Math.max(shipLines.length, 2) * 4.6 + 8;

  // Items table
  const col = { desc: M + 3, qty: 150, weight: R - 3 };
  const header = () => {
    doc.setFillColor(244, 243, 239);
    doc.rect(M, y - 5, R - M, 8, 'F');
    font('bold', 8.5, grey);
    doc.text(t.item, col.desc, y);
    doc.text(t.qty, col.qty, y, { align: 'right' });
    doc.text(t.weight, col.weight, y, { align: 'right' });
    y += 8;
  };
  header();
  let pieces = 0, weight = 0;
  products.forEach(it => {
    const qty = num(it.quantity) || 0;
    const w = num(it.weight_kg) * qty;
    pieces += qty; weight += w;
    font('bold', 10);
    const name = doc.splitTextToSize(it.name, col.qty - col.desc - 20);
    font('normal', 8.5);
    const detail = doc.splitTextToSize([it.dimensions, it.materials].filter(Boolean).join(' · '), col.qty - col.desc - 20);
    const h = name.length * 4.8 + detail.length * 4 + 4;
    if (y + h > 250) {
      doc.addPage();
      doc.setFillColor(...accent);
      doc.rect(0, 0, 210, 4, 'F');
      y = 20;
      header();
    }
    font('bold', 10);
    doc.text(name, col.desc, y);
    doc.text(fmtNum(qty), col.qty, y, { align: 'right' });
    font('normal', 9.5);
    doc.text(w ? `${fmtNum(w)} kg` : '—', col.weight, y, { align: 'right' });
    font('normal', 8.5, grey);
    if (detail.length && detail[0]) doc.text(detail, col.desc, y + name.length * 4.8);
    y += h;
    doc.setDrawColor(...line);
    doc.setLineWidth(0.2);
    doc.line(M, y - 3.5, R, y - 3.5);
  });
  y += 2;
  font('bold', 10);
  doc.text(`${fmtNum(pieces)} ${t.pieces}`, col.qty, y, { align: 'right' });
  doc.text(weight ? `${fmtNum(weight)} kg` : '', col.weight, y, { align: 'right' });
  y += 10;

  if (shipment && shipment.notes) {
    font('bold', 8, grey);
    doc.text(t.notes.toUpperCase(), M, y);
    font('normal', 9.5);
    const wrapped = doc.splitTextToSize(shipment.notes, R - M);
    doc.text(wrapped, M, y + 5);
    y += 5 + wrapped.length * 4.4 + 6;
  }

  // Signature box for the person receiving the delivery
  if (y > 240) { doc.addPage(); y = 24; }
  font('bold', 8, grey);
  doc.text(t.received.toUpperCase(), M, y);
  doc.setDrawColor(...ink);
  doc.setLineWidth(0.3);
  doc.line(M, y + 18, M + 80, y + 18);
  font('normal', 8, grey);
  doc.text(t.signature, M, y + 22);

  finishDocument({ doc, company, t, font, M, R, line, grey });
  return { blob: doc.output('blob'), fileName: `${safeFileName(`${t.packing} ${p.name}`)}.pdf` };
}

// ---------- Cost report (internal): what each product costs us next to what we charge ----------

function buildCostReport(p, fonts, logo) {
  const company = store.get('companies', p.company_id) || {};
  const client = store.get('clients', p.client_id);
  const { locale } = docLocale(company, 'en');
  const t = T.en;
  const fmtMoney = v => new Intl.NumberFormat(locale, { style: 'currency', currency: p.currency || 'EUR' }).format(v);
  const fmtNum = v => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(v);
  const pct = (profit, price) => (price ? `${Math.round((profit / price) * 100)}%` : '—');
  const products = productsOf(p.id);
  const title = 'Cost report';

  const { doc, M, R, accent, ink, grey, line, font, top } = startDocument({ fonts, logo, company, t, title: `${title} ${p.name}` });
  let y = top;
  font('bold', 24, accent);
  doc.text(title.toUpperCase(), M, y + 8);
  font('bold', 8, [176, 58, 46]);
  doc.text('INTERNAL — NOT FOR THE CLIENT', M, y + 14);
  let my = y + 2;
  [['Order no.', p.order_no || '—'], ['Project', p.name], ['Client', client ? client.name : '—'],
    ['Date', new Date().toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })]].forEach(([k, v]) => {
    font('normal', 9, grey);
    doc.text(k, R - 66, my);
    font('bold', 9.5);
    const lines = doc.splitTextToSize(String(v), 44).slice(0, 2);
    doc.text(lines, R, my, { align: 'right' });
    my += 5.5 + (lines.length - 1) * 4.4;
  });
  y = Math.max(y + 24, my + 4);

  // Products: cost and price side by side
  const col = { desc: M + 2, qty: 86, uCost: 107, cost: 129, uPrice: 150, price: 172, mg: R - 1 };
  const newPage = () => {
    doc.addPage();
    doc.setFillColor(...accent);
    doc.rect(0, 0, 210, 4, 'F');
    y = 20;
  };
  const header = () => {
    doc.setFillColor(244, 243, 239);
    doc.rect(M, y - 5, R - M, 8, 'F');
    font('bold', 7.5, grey);
    doc.text('PRODUCT', col.desc, y);
    [['QTY', col.qty], ['COST / PC', col.uCost], ['COST', col.cost], ['PRICE / PC', col.uPrice], ['PRICE', col.price], ['MARGIN', col.mg]]
      .forEach(([h, x]) => doc.text(h, x, y, { align: 'right' }));
    y += 8;
  };
  font('bold', 8, grey);
  doc.text('PRODUCTS', M, y);
  y += 7;
  header();
  let cost = 0, price = 0;
  products.forEach((it, i) => {
    const qty = num(it.quantity) || 0;
    const c = round2(num(it.unit_cost) * qty), pr = round2(num(it.unit_price) * qty);
    cost += c; price += pr;
    font('bold', 9);
    const name = doc.splitTextToSize(`${it.item_no || String(i + 1).padStart(2, '0')}  ${it.name}`, col.qty - col.desc - 12);
    font('normal', 7.5);
    const detail = doc.splitTextToSize([it.supplier, it.supplier_ref].filter(Boolean).join(' · '), col.qty - col.desc - 12);
    const h = name.length * 4.4 + (detail[0] ? detail.length * 3.6 : 0) + 4;
    if (y + h > 262) { newPage(); header(); }
    font('bold', 9);
    doc.text(name, col.desc, y);
    font('normal', 8.5);
    doc.text(fmtNum(qty), col.qty, y, { align: 'right' });
    doc.text(num(it.unit_cost) ? fmtMoney(num(it.unit_cost)) : '—', col.uCost, y, { align: 'right' });
    doc.text(num(it.unit_price) ? fmtMoney(num(it.unit_price)) : '—', col.uPrice, y, { align: 'right' });
    font('bold', 8.5);
    doc.text(c ? fmtMoney(c) : '—', col.cost, y, { align: 'right' });
    doc.text(pr ? fmtMoney(pr) : '—', col.price, y, { align: 'right' });
    const m = pr && c ? (pr - c) / pr : null;
    font('bold', 8.5, m == null ? grey : m < 0.2 ? [176, 58, 46] : [46, 125, 70]);
    doc.text(m == null ? '—' : `${Math.round(m * 100)}%`, col.mg, y, { align: 'right' });
    if (detail[0]) { font('normal', 7.5, grey); doc.text(detail, col.desc, y + name.length * 4.4); }
    y += h;
    doc.setDrawColor(...line);
    doc.setLineWidth(0.2);
    doc.line(M, y - 3.5, R, y - 3.5);
  });
  cost = round2(cost); price = round2(price);
  font('bold', 9);
  doc.text('Products total', col.desc, y + 1);
  doc.text(fmtMoney(cost), col.cost, y + 1, { align: 'right' });
  doc.text(fmtMoney(price), col.price, y + 1, { align: 'right' });
  doc.text(pct(price - cost, price), col.mg, y + 1, { align: 'right' });
  y += 12;

  // Other costs: shipping and project expenses
  const extra = [
    ...shipmentsOf(p.id).filter(x => num(x.cost)).map(x => [`Shipping${x.carrier ? ` — ${x.carrier}` : ''}`, num(x.cost)]),
    ...costsOf(p.id).filter(c => num(c.amount)).map(c => [[c.description, c.vendor].filter(Boolean).join(' — '), num(c.amount)]),
  ];
  const extraTotal = round2(extra.reduce((s, [, v]) => s + v, 0));
  if (extra.length) {
    if (y + 14 + extra.length * 6 > 262) newPage();
    font('bold', 8, grey);
    doc.text('OTHER COSTS', M, y);
    y += 6;
    extra.forEach(([label, v]) => {
      if (y > 262) newPage();
      font('normal', 9);
      doc.text(doc.splitTextToSize(label, col.uPrice - col.desc - 10)[0], col.desc, y);
      doc.text(fmtMoney(v), col.cost, y, { align: 'right' });
      y += 6;
    });
    font('bold', 9);
    doc.text('Other costs total', col.desc, y);
    doc.text(fmtMoney(extraTotal), col.cost, y, { align: 'right' });
    y += 12;
  }

  // Totals side by side
  if (y + 52 > 275) newPage();
  const totalCost = round2(cost + extraTotal);
  const profit = round2(price - totalCost);
  const approved = quotesOf(p.id).filter(q => q.status === 'approved');
  const approvedTotal = round2(approved.reduce((s, q) => s + quoteTotal(q), 0));
  const boxW = (R - M - 6) / 2;
  [[M, 'TOTAL COST', totalCost, extra.length ? `Products ${fmtMoney(cost)} + other ${fmtMoney(extraTotal)}` : 'Products'],
    [M + boxW + 6, 'TOTAL PRICED', price, approved.length && approvedTotal !== price ? `Approved proposal: ${fmtMoney(approvedTotal)}` : 'Excl. tax']]
    .forEach(([x, label, v, note]) => {
      doc.setFillColor(244, 243, 239);
      doc.roundedRect(x, y, boxW, 26, 2, 2, 'F');
      font('bold', 8, grey);
      doc.text(label, x + 5, y + 7);
      font('bold', 17);
      doc.text(fmtMoney(v), x + 5, y + 16);
      font('normal', 7.5, grey);
      doc.text(doc.splitTextToSize(note, boxW - 10)[0], x + 5, y + 22);
    });
  y += 33;
  doc.setFillColor(...(profit < 0 ? [176, 58, 46] : accent));
  doc.roundedRect(M, y, R - M, 16, 2, 2, 'F');
  font('bold', 10, [255, 255, 255]);
  doc.text(profit < 0 ? 'LOSS' : 'PROFIT', M + 5, y + 10);
  doc.text(`${fmtMoney(profit)}   ·   margin ${pct(profit, price)}`, R - 5, y + 10, { align: 'right' });
  y += 24;
  const unpriced = products.filter(i => !num(i.unit_price)).length;
  if (unpriced) {
    font('bold', 8.5, [176, 58, 46]);
    doc.text(`${unpriced} product${unpriced === 1 ? ' has' : 's have'} no price yet — ${unpriced === 1 ? 'its' : 'their'} cost is counted, but not ${unpriced === 1 ? 'its' : 'their'} price.`, M, y);
    y += 5;
  }
  font('normal', 7.5, grey);
  doc.text('Amounts exclude tax. Margin = (price − cost) ÷ price.', M, y);

  finishDocument({ doc, company, t, font, M, R, line, grey });
  return { blob: doc.output('blob'), fileName: `${safeFileName(`${title} ${p.order_no || ''} ${p.name}`.replace(/\s+/g, ' '))}.pdf` };
}

// ---------- Public: create, then share / open ----------

export async function createPdf(kind, id) {
  const byProject = kind === 'packing' || kind === 'costs';
  const rec = byProject ? store.get('projects', id) : store.get(kind === 'quote' ? 'quotes' : 'invoices', id);
  if (!rec) return;
  const p = byProject ? rec : store.get('projects', rec.project_id);
  const company = p && store.get('companies', p.company_id);
  const client = p && store.get('clients', p.client_id);
  toast('Creating PDF…');
  let out;
  try {
    const [fonts, logo] = await Promise.all([preloadPdf(), loadLogo(company).catch(() => null)]);
    out = kind === 'packing' ? buildPackingList(rec, fonts, logo)
      : kind === 'costs' ? buildCostReport(rec, fonts, logo)
      : buildPdf(kind, rec, fonts, logo);
  } catch (err) {
    console.error(err);
    toast(`Couldn't create the PDF: ${err.message || err}`);
    return;
  }
  return presentPdf(out, { company, client, rec });
}

// The "PDF ready" sheet: share (Mail, WhatsApp, AirDrop, Files) or open.
export function presentPdf(out, { company, client, rec = {} } = {}) {
  const file = new File([out.blob], out.fileName, { type: 'application/pdf' });
  const url = URL.createObjectURL(out.blob);
  const canShare = !!(navigator.canShare && navigator.canShare({ files: [file] }));
  openSheet(`
    <div class="pdf-ready" tabindex="-1">
      ${sheetHeader(out.fileName)}
      <div class="pdf-body">
        <div class="pdf-icon">PDF</div>
        <p><b>${esc(out.fileName)}</b> is ready.</p>
        <p class="muted small">${canShare ? 'Share it by Mail, WhatsApp or AirDrop, or save it to Files.' : 'Open it to view, print or save.'}</p>
        ${!(company && (company.legal_name || company.address || company.iban)) ? `<p class="notice warn small">Tip: add your company address, tax number and bank details in <b>Team &amp; settings → Companies → Document details</b>.</p>` : ''}
        ${rec.vat_treatment === 'reverse_charge' && !(client && client.tax_id) ? `<p class="notice warn small">Reverse-charged invoices must show the client's VAT ID — add it on the client's page, then make the PDF again.</p>` : ''}
      </div>
      <footer>
        <a class="btn" href="${url}" target="_blank" rel="noopener" download="${esc(out.fileName)}">${icon.external} Open</a>
        <span class="spacer"></span>
        ${canShare ? `<button type="button" class="btn primary" data-share>${icon.upload} Share / Save</button>` : ''}
      </footer>
    </div>`, {
    onOpen(sheet) {
      const b = $('[data-share]', sheet);
      if (b) b.addEventListener('click', () => {
        navigator.share({ files: [file], title: out.fileName }).catch(err => {
          if (err && err.name !== 'AbortError') toast('Sharing failed — use Open instead');
        });
      });
    },
    onClose() { setTimeout(() => URL.revokeObjectURL(url), 60000); },
  });
  return out;
}

export { buildPdf, startDocument, finishDocument, docLocale, loadLogo, builtInLogo, safeFileName, hexToRgb };
