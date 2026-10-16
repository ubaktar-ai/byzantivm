// Phase 2 of the Steps screen: after the proposal.
//   6 Client's reply  → the AI reads what changes per card → check → cards updated, marked "changed"
//   7 Supplier confirms the changes → PDF of the changed cards → their new prices → old → new cost,
//     keep your price or your margin → revised proposal
// Per card (in item.spec): _client {status, at, note} · _rev {changes, at, sent_at, priced_at} · _history [...]
import { esc, money, toast, openSheet, sheetHeader, $, $$ } from '../lib.js';
import { store, productsOf, nextSortOrder } from '../store.js';
import { SPEC_SECTIONS, fieldValue } from '../qc-spec.js';
import { parseAmount } from '../money.js';
import { filesOfKind, uploadFiles } from '../files.js';
import { lightingOf, itemNo } from './qc.js';
import { openProposal, acceptedProposal, createOrUpdateProposal } from './order.js';

const num = v => Number(v) || 0;
const round2 = n => Math.round(n * 100) / 100;
const clean = v => String(v == null ? '' : v).trim();
const FIELD = Object.fromEntries(SPEC_SECTIONS.flatMap(s => s.fields).map(f => [f.key, f]));
const LABEL = { quantity: 'Quantity', name: 'Name', notes: 'Special request' };
const label = k => LABEL[k] || (FIELD[k] ? FIELD[k].label : k);
export const shown = (k, v) => (FIELD[k] ? fieldValue(FIELD[k], { [k]: v }) || clean(v) : clean(v));
export const STATUS = { approved: 'Approved', changes: 'Changes', rejected: 'Not wanted', no_reply: 'No reply' };

export const revOf = it => ((it && it.spec) || {})._rev || null;
export const clientOf = it => ((it && it.spec) || {})._client || null;
export const unsent = it => { const r = revOf(it); return !!(r && r.changes && r.changes.length && !r.sent_at); };
export const awaitingPrice = it => { const r = revOf(it); return !!(r && r.sent_at && !r.priced_at); };
const now = () => new Date().toISOString();

// Current value of a field on a card (for "old → new").
const current = (it, k) => (k === 'quantity' ? String(num(it.quantity) || 1) : k === 'name' ? it.name : k === 'notes' ? clean(it.description) : clean((it.spec || {})[k]));

// Record changes on a card: they go into the open round (or a new one) and the history.
export function withChanges(it, changes, extra = {}) {
  const spec = { ...(it.spec || {}) };
  const prev = spec._rev && !spec._rev.sent_at ? spec._rev.changes || [] : [];
  const merged = [...prev.filter(c => !changes.some(n => n.key === c.key)), ...changes.map(c => {
    const was = prev.find(x => x.key === c.key);
    return { ...c, from: was ? was.from : c.from };
  })].filter(c => clean(c.from) !== clean(c.to));
  if (merged.length) spec._rev = { changes: merged, at: now(), sent_at: null, priced_at: null };
  spec._history = [...(spec._history || []), ...(changes.length ? [{ at: now(), kind: 'changed', changes, ...extra }] : [])].slice(-50);
  return spec;
}

// ---------- 6: the client's reply ----------

const isDoc = a => /^image\/|application\/pdf/.test(a.mime || '');
let run = 0;

export function openClientReply(p) {
  const cards = lightingOf(p.id);
  if (!cards.length) { toast('Add product cards first'); return; }
  const recent = [...filesOfKind(p.id, 'inquiry'), ...filesOfKind(p.id, 'general')].filter(isDoc).slice(0, 12);
  const added = [];
  const list = () => [...added, ...recent].map(a => `<label class="check-line"><input type="checkbox" name="file" value="${esc(a.id)}" ${added.includes(a) ? 'checked' : ''}> <span class="grow">${esc(a.name)}</span></label>`).join('')
    || '<p class="muted small">No files yet.</p>';
  openSheet(`
    <form>
      ${sheetHeader('The client’s reply')}
      <div class="fields">
        <p class="muted small">Add what the client sent back — the email (paste it or a screenshot), the marked-up proposal or tear sheets. The AI works out what changes per card; you check before anything changes.</p>
        <div class="field"><span>Files</span><div class="finder-files">${list()}</div>
          <label class="btn small upload-btn">Add pictures or PDF<input type="file" multiple hidden accept="image/*,application/pdf" data-reply-upload></label></div>
        <label class="field"><span>Their email or notes</span><textarea name="text" rows="6" placeholder="e.g. “Love them. Please make the pendant 900 mm and 2700K, and we need 8 instead of 6. The sconce is fine.”"></textarea></label>
      </div>
      <footer><button type="button" class="btn" data-close>Cancel</button><span class="spacer"></span><button type="submit" class="btn primary">Read the reply</button></footer>
    </form>`, {
    wide: true,
    onOpen(sheet) {
      const input = $('[data-reply-upload]', sheet);
      input.addEventListener('change', async e => {
        e.stopPropagation();
        const saved = await uploadFiles(input.files, { project_id: p.id, kind: 'inquiry' });
        input.value = '';
        added.unshift(...saved.filter(isDoc));
        $('.finder-files', sheet).innerHTML = list();
        sheet.dataset.dirty = '1';
      });
    },
    onSubmit(fd, form) {
      const files = $$('[name=file]:checked', form).map(el => store.get('attachments', el.value)).filter(Boolean);
      const text = clean(fd.get('text'));
      if (!files.length && !text) { toast('Add the reply: a file or the email text'); return false; }
      setTimeout(() => readReply(p, files, text), 30);
    },
  });
}

async function readReply(p, files, text) {
  const ticket = ++run;
  openSheet(`<div>${sheetHeader('Reading the client’s reply…')}<div class="ai-wait"><div class="spinner"></div><p class="muted small">Usually 15–40 seconds.</p></div>
    <footer><button type="button" class="btn" data-close>Cancel</button></footer></div>`, { onClose() { if (ticket === run) run++; } });
  const cards = lightingOf(p.id);
  const keys = Object.keys(FIELD).filter(k => FIELD[k].type !== 'files' && FIELD[k].type !== 'lines');
  let res;
  try {
    res = await store.backend.findProducts({
      mode: 'changes', paths: files.map(a => a.path), text,
      cards: cards.map(it => ({ id: it.id, name: it.name, quantity: num(it.quantity) || 1, details: Object.fromEntries(keys.map(k => [k, clean((it.spec || {})[k])]).filter(([, v]) => v)) })),
    });
  } catch (err) {
    if (ticket !== run) return;
    const msg = err.demo ? 'Reading replies with AI works with the team database, not in demo mode. Edit the cards by hand — changes are marked the same way.' : `The reply couldn’t be read: ${err.message || err}`;
    openSheet(`<div>${sheetHeader('The client’s reply')}<p class="ai-problem">${esc(msg)}</p><footer><span class="spacer"></span><button type="button" class="btn primary" data-close>OK</button></footer></div>`);
    return;
  }
  if (ticket !== run) return;
  reviewReply(p, (res && res.result) || {});
}

function reviewReply(p, r) {
  const cards = lightingOf(p.id);
  const byId = new Map(cards.map(it => [it.id, it]));
  const rows = (r.cards || []).filter(c => byId.has(c.item_id));
  const extra = r.new_items || [];
  openSheet(`
    <form class="reply-review">
      ${sheetHeader('Check the client’s changes')}
      <div class="fields">
        ${r.summary ? `<p class="muted small">${esc(r.summary)}</p>` : ''}
        ${rows.length ? rows.map((c, i) => {
          const it = byId.get(c.item_id);
          const changes = (c.changes || []).filter(ch => clean(ch.value) && clean(ch.value) !== current(it, ch.key));
          return `<section class="finder-card">
            <div class="reply-head"><b>${esc(itemNo(it))} · ${esc(it.name)}</b>
              <select name="status_${i}">${Object.entries(STATUS).map(([k, l]) => `<option value="${k}" ${k === c.status ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
            ${changes.length ? changes.map((ch, j) => `
              <label class="check-line"><input type="checkbox" name="use_${i}_${j}" checked>
                <span class="grow">${esc(label(ch.key))}: <s class="muted">${esc(shown(ch.key, current(it, ch.key)) || '—')}</s> →
                  <input name="val_${i}_${j}" value="${esc(ch.value)}" class="reply-val"></span></label>`).join('') : '<p class="muted small">No changes.</p>'}
            ${c.note ? `<p class="small">Client: “${esc(c.note)}”</p>` : ''}
          </section>`;
        }).join('') : '<p class="muted small">The AI found no reply about the cards.</p>'}
        ${extra.length ? `<h3 class="sheet-sub">New products they asked for</h3>${extra.map((n, i) => `
          <label class="check-line"><input type="checkbox" name="new_${i}" checked> <span class="grow"><b>${esc(n.name)}</b> × ${esc(String(num(n.quantity) || 1))}${n.note ? ` — ${esc(n.note)}` : ''}</span></label>`).join('')}` : ''}
      </div>
      <footer><button type="button" class="btn" data-close>Cancel</button><span class="spacer"></span><button type="submit" class="btn primary">Update the cards</button></footer>
    </form>`, {
    wide: true,
    onOpen(sheet) { sheet.dataset.dirty = '1'; },
    async onSubmit(fd) {
      let changed = 0;
      for (let i = 0; i < rows.length; i++) {
        const c = rows[i];
        const it = store.get('items', c.item_id);
        if (!it) continue;
        const changes = (c.changes || []).filter(ch => clean(ch.value) && clean(ch.value) !== current(it, ch.key))
          .map((ch, j) => ({ ch, j })).filter(({ j }) => fd.get(`use_${i}_${j}`) === 'on')
          .map(({ ch, j }) => ({ key: ch.key, label: label(ch.key), from: current(it, ch.key), to: clean(fd.get(`val_${i}_${j}`)) }))
          .filter(ch => ch.to && ch.to !== ch.from);
        const status = fd.get(`status_${i}`) || c.status;
        const patch = {};
        const specChanges = changes.filter(ch => !['quantity', 'name', 'notes'].includes(ch.key));
        changes.forEach(ch => {
          if (ch.key === 'quantity') patch.quantity = parseAmount(ch.to) || num(it.quantity);
          else if (ch.key === 'name') patch.name = ch.to;
          else if (ch.key === 'notes') patch.description = [clean(it.description), ch.to].filter(Boolean).join('\n');
        });
        const spec = withChanges(it, changes, { by: 'client' });
        specChanges.forEach(ch => { spec[ch.key] = ch.to; });
        spec._client = { status, at: now(), note: clean(c.note) };
        spec._history = [...(spec._history || []), { at: now(), kind: 'client', status, note: clean(c.note) }].slice(-50);
        if (changes.length) changed++;
        await store.update('items', it.id, { ...patch, spec }).catch(() => {});
      }
      let order = nextSortOrder(productsOf(p.id));
      for (let i = 0; i < extra.length; i++) {
        if (fd.get(`new_${i}`) !== 'on') continue;
        await store.insert('items', { project_id: p.id, name: clean(extra[i].name), quantity: num(extra[i].quantity) || 1, description: clean(extra[i].note), category: 'lighting', sort_order: order++, spec: {} }).catch(() => {});
      }
      toast(changed ? `${changed} card${changed === 1 ? '' : 's'} changed — send them to the supplier next` : 'Client’s reply saved');
    },
  });
}

// ---------- 7: supplier confirms the changes ----------

export function markSent(p, ids) {
  ids.forEach(id => {
    const it = store.get('items', id);
    const r = revOf(it);
    if (!r || r.sent_at) return;
    const spec = { ...it.spec, _rev: { ...r, sent_at: now() }, _history: [...(it.spec._history || []), { at: now(), kind: 'sent', changes: r.changes }].slice(-50) };
    store.update('items', id, { spec }).catch(() => {});
  });
}

// The supplier's new prices: old cost → new cost; keep your price, keep your margin, or type a new one.
export async function readNewPrices(p, file) {
  const saved = await uploadFiles([file], { project_id: p.id, kind: 'supplier_quote' });
  const att = saved[0];
  if (!att) return;
  openSheet(`<div>${sheetHeader('Reading the supplier’s new prices…')}<div class="ai-wait"><div class="spinner"></div><p class="muted small">Usually 10–40 seconds.</p></div>
    <footer><button type="button" class="btn" data-close>Cancel</button></footer></div>`);
  let data;
  try {
    data = await store.backend.readDocument(att.path, 'supplier');
  } catch (err) {
    const msg = err.demo ? 'Reading prices with AI works with the team database, not in demo mode. Type the new costs in the cost sheet instead.' : `The prices couldn’t be read: ${err.message || err}`;
    openSheet(`<div>${sheetHeader('Supplier’s new prices')}<p class="ai-problem">${esc(msg)}</p><footer><span class="spacer"></span><button type="button" class="btn primary" data-close>OK</button></footer></div>`);
    return;
  }
  const r = (data && data.result) || {};
  const { matchLines } = await import('../ai.js');
  const cards = lightingOf(p.id);
  const lines = (r.lines || []).filter(l => num(l.unit_cost));
  const targets = matchLines(lines, cards, att);
  reviewNewPrices(p, att, r, lines.map((l, i) => ({ line: l, it: store.get('items', targets[i]) })).filter(x => x.it));
}

function reviewNewPrices(p, att, r, rows) {
  const m = v => money(v, p.currency);
  openSheet(`
    <form class="cost-review">
      ${sheetHeader('Check the new prices')}
      <div class="fields">
        <p class="muted small">From <b>${esc(att.name)}</b>${r.supplier ? ` · ${esc(r.supplier)}` : ''}. For each card: the old and new cost, and what happens to your price.</p>
        ${rows.length ? rows.map(({ line, it }, i) => {
          const oldCost = num(it.unit_cost), newCost = num(line.unit_cost), price = num(it.unit_price);
          const margin = price && oldCost ? (price - oldCost) / price : null;
          const keepMargin = margin != null ? round2(newCost / (1 - margin)) : price;
          const diff = oldCost ? Math.round(((newCost - oldCost) / oldCost) * 100) : null;
          return `<section class="finder-card">
            <div class="reply-head"><b>${esc(itemNo(it))} · ${esc(it.name)}</b>
              <span class="${diff > 0 ? 'bad-text' : diff < 0 ? 'good-text' : 'muted'} small">${oldCost ? `${esc(m(oldCost))} → ` : ''}<b>${esc(m(newCost))}</b>${diff ? ` (${diff > 0 ? '+' : ''}${diff}%)` : ''}</span></div>
            <label class="field"><span>New cost per piece</span><input name="cost_${i}" value="${esc(String(newCost))}" inputmode="decimal"></label>
            ${price ? `<div class="field"><span>Your price (now ${esc(m(price))})</span>
              <label class="check-line"><input type="radio" name="price_${i}" value="margin" checked> Keep your margin (${Math.round(margin * 100)}%) → <b>${esc(m(keepMargin))}</b></label>
              <label class="check-line"><input type="radio" name="price_${i}" value="keep"> Keep your price (${esc(m(price))})</label>
              <label class="check-line"><input type="radio" name="price_${i}" value="custom"> New price <input name="custom_${i}" inputmode="decimal" class="reply-val" placeholder="${esc(String(keepMargin))}"></label>
              <input type="hidden" name="keep_${i}" value="${keepMargin}"></div>` : '<p class="muted small">No selling price yet — set it in the cost sheet.</p>'}
          </section>`;
        }).join('') : '<p class="muted small">No prices for these cards were found in the document.</p>'}
      </div>
      <footer><button type="button" class="btn" data-close>Cancel</button><span class="spacer"></span><button type="submit" class="btn primary">Save new prices</button></footer>
    </form>`, {
    wide: true,
    onOpen(sheet) { sheet.dataset.dirty = '1'; },
    async onSubmit(fd) {
      let priceChanged = 0;
      for (let i = 0; i < rows.length; i++) {
        const it = store.get('items', rows[i].it.id);
        const cost = parseAmount(fd.get(`cost_${i}`));
        if (!it || !(cost > 0)) continue;
        const choice = fd.get(`price_${i}`);
        const oldPrice = num(it.unit_price);
        const price = choice === 'margin' ? num(fd.get(`keep_${i}`)) : choice === 'custom' ? parseAmount(fd.get(`custom_${i}`)) || oldPrice : oldPrice;
        if (price !== oldPrice) priceChanged++;
        const r2 = revOf(it);
        const spec = { ...it.spec, ...(r2 ? { _rev: { ...r2, priced_at: now() } } : {}),
          _history: [...(it.spec._history || []), { at: now(), kind: 'cost', from: num(it.unit_cost), to: cost, price_from: oldPrice, price_to: price, file: att.name }].slice(-50) };
        await store.update('items', it.id, { unit_cost: cost, unit_price: price, spec, supplier: clean(r.supplier) || it.supplier }).catch(() => {});
        if (!store.missing.has('supplier_prices')) {
          store.insert('supplier_prices', { project_id: p.id, item_id: it.id, item_name: it.name, party: 'us', person: clean(r.supplier) || it.supplier || '',
            unit_price: cost, currency: clean(r.currency).toUpperCase() || p.currency || '', lead_time: '', notes: `From ${att.name} (after changes)` }).catch(() => {});
        }
      }
      toast(priceChanged ? 'New prices saved — make the revised proposal for the client' : 'New costs saved');
    },
  });
}

// Revised proposal: a new proposal (v2…) with the changes listed in its notes.
export function makeRevisedProposal(p) {
  const cards = lightingOf(p.id);
  const lines = cards.flatMap(it => {
    const h = (((it.spec || {})._history) || []).filter(x => x.kind === 'changed' || x.kind === 'cost');
    const ch = [...new Set(h.flatMap(x => (x.kind === 'changed' ? x.changes.map(c => `${c.label} ${shown(c.key, c.to)}`) : [])))];
    return ch.length ? [`${it.name}: ${ch.join(', ')}`] : [];
  });
  const box = document.querySelector(`[data-flow-notes="${p.id}"]`);
  const notes = [clean(box && box.value), lines.length ? `Changes in this revision:\n${lines.join('\n')}` : ''].filter(Boolean).join('\n\n');
  return createOrUpdateProposal(p, { notes, revised: true });
}

export function roundsSteps(p, step) {
  const cards = lightingOf(p.id);
  const proposal = openProposal(p.id) || acceptedProposal(p.id);
  const replied = cards.filter(clientOf);
  const toSend = cards.filter(unsent);
  const waiting = cards.filter(awaitingPrice);
  const approved = cards.filter(it => (clientOf(it) || {}).status === 'approved');
  const s6 = `
    <p class="muted small">When the client answers — approves, asks for changes or new items — upload their reply. The AI updates the cards; you check first. You can also just edit a card; changes are marked the same way.</p>
    <div class="qc-actions"><button class="btn primary" data-action="flow-reply" data-id="${p.id}" ${cards.length ? '' : 'disabled'}>Upload the client’s reply</button></div>
    ${replied.length ? `<div class="flow-chips">${cards.map(it => {
      const c = clientOf(it);
      return `<span class="chip ${c && c.status === 'approved' ? 'good' : c && c.status === 'rejected' ? 'bad' : c ? 'warn' : ''}">${esc(it.name)}: ${esc(c ? STATUS[c.status] || c.status : 'no reply')}${unsent(it) ? ' · changed' : ''}</span>`;
    }).join('')}</div>` : ''}`;
  const s7 = `
    ${toSend.length ? `<p class="small"><b>${toSend.length} changed card${toSend.length === 1 ? '' : 's'}</b> not sent to the supplier yet: ${toSend.map(it => esc(it.name)).join(', ')}.</p>
      ${toSend.map(it => `<p class="muted small">${esc(it.name)}: ${revOf(it).changes.map(c => `${esc(c.label)} <s>${esc(shown(c.key, c.from) || '—')}</s> → <b>${esc(shown(c.key, c.to))}</b>`).join(' · ')}</p>`).join('')}`
      : waiting.length ? `<p class="small">Waiting for the supplier’s new price: ${waiting.map(it => esc(it.name)).join(', ')}.</p>`
      : '<p class="muted small">No changes waiting for the supplier.</p>'}
    <div class="qc-actions">
      <button class="btn primary" data-action="flow-send-changed" data-id="${p.id}" ${toSend.length ? '' : 'disabled'}>PDF of the changed cards</button>
      <label class="btn upload-btn">Upload supplier’s new prices<input type="file" hidden accept="image/*,application/pdf" data-flow-newprices="${p.id}"></label>
      <button class="btn" data-action="flow-revised" data-id="${p.id}" ${proposal ? '' : 'disabled'}>Revised proposal for the client</button>
    </div>
    <p class="muted small">The PDF highlights what changed and marks the cards as sent. New prices: you choose per card to keep your margin, keep your price, or set a new one.</p>`;
  return [
    step(6, 'Client’s reply', replied.length ? `${approved.length}/${cards.length} approved` : '', s6, { done: cards.length > 0 && approved.length === cards.length }),
    step(7, 'Supplier confirms the changes', toSend.length ? `${toSend.length} to send` : waiting.length ? `${waiting.length} waiting` : '', s7, { attention: toSend.length > 0 || waiting.length > 0 }),
  ].join('');
}

