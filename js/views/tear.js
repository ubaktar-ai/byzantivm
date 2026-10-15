// Tear sheets: a short, client-facing product sheet for a light (pictures, description and the key details),
// made into a 1–2 page PDF. The details are the spec's own fields, so they are filled in once; the tear sheet
// only adds its own pictures, a description, a lead time and which details to leave off.
import { esc, openSheet, sheetHeader, toast, $ } from '../lib.js';
import { store } from '../store.js';
import { SPEC_SECTIONS, visible, fieldValue } from '../qc-spec.js';
import { fieldHtml, readSpec, wireSpecFields, photoPicker, wirePhotos, templateOf, itemNo, lightingOf } from './qc.js';

const FIELD = Object.fromEntries(SPEC_SECTIONS.flatMap(s => s.fields).map(f => [f.key, f]));

export const TEAR_SECTIONS = [
  { title: 'Dimensions', keys: ['overall_size', 'diameter', 'overall_drop', 'weight'] },
  { title: 'Materials', keys: ['body_material', 'material_detail', 'glass', 'glass_detail', 'shade', 'other_materials'] },
  { title: 'Finishes', keys: ['finish', 'finish_code', 'sheen', 'coating', 'secondary_finish'] },
  { title: 'Lighting', keys: ['source_type', 'socket', 'socket_count', 'max_wattage', 'bulbs_included', 'bulb_spec', 'led_brand', 'led_power',
    'cct', 'cri', 'lumens', 'light_direction', 'beam_angle', 'dimming', 'lutron_system', 'dimming_other', 'dim_range'] },
  { title: 'Driver & electrical', keys: ['voltage', 'frequency', 'driver_brand', 'driver', 'driver_type', 'driver_output', 'driver_location'] },
  { title: 'Mounting & certification', keys: ['suspension', 'cable_length', 'canopy', 'certification', 'ip_rating', 'location_rating'] },
].map(sec => ({ ...sec, fields: sec.keys.map(k => FIELD[k]).filter(f => f && f.type !== 'files') }));

export const tearOf = it => ({ description: '', lead_time: '', images: [], hidden: [], ...(((it && it.spec) || {})._tear || {}) });

// What the tear sheet shows: [{ title, rows: [[label, value]] }] — filled-in details that apply and aren't switched off.
export function tearRows(it) {
  const spec = (it && it.spec) || {};
  const hidden = new Set(tearOf(it).hidden);
  return TEAR_SECTIONS.map(sec => ({
    title: sec.title,
    rows: sec.fields.filter(f => visible(f, spec) && !hidden.has(f.key)).map(f => [f.label, fieldValue(f, spec)]).filter(([, v]) => v),
  })).filter(sec => sec.rows.length);
}

// Pictures for the sheet: its own, else the spec's proposed (then received) pictures. The first one is the big one.
export function tearImages(it) {
  const spec = (it && it.spec) || {};
  const own = tearOf(it).images;
  if (own.length) return own;
  const groups = spec._images || {};
  return (groups.offer && groups.offer.length ? groups.offer : groups.vision) || [];
}

export function openTearSheet(it) {
  const p = it && store.get('projects', it.project_id);
  if (!p) return;
  const template = templateOf(p);
  const spec = { ...(it.spec || {}) };
  const tear = tearOf(it);
  const hidden = new Set(tear.hidden);
  const bag = { tear: [...tear.images] };
  const onSheet = f => `<label class="vis tear-on" title="Show this detail on the tear sheet"><input type="checkbox" name="tear_on_${f.key}" ${hidden.has(f.key) ? '' : 'checked'}><span>On sheet</span></label>`;
  openSheet(`
    <form class="spec-form tear-form">
      ${sheetHeader(`Tear sheet — ${it.name}`)}
      <div class="fields">
        <p class="muted small">Item ${esc(itemNo(it))} · ${esc(it.name)} × ${esc(String(Number(it.quantity) || 1))}. A short product sheet for the client.
          The details below are the same as in the spec — changing one here changes it there too. Empty details never print.</p>
        <details class="spec-sec" open>
          <summary>Pictures &amp; description</summary>
          <div class="spec-images">
            <div class="spec-img-group"><b>Pictures</b> <span class="muted small">The first one is printed large. Without pictures here, the spec’s Proposed pictures are used.</span>
              ${photoPicker('tear', 'Add images', true)}</div>
          </div>
          <div class="spec-grid">
            <label class="field wide"><span>Description</span>
              <textarea name="tear_description" rows="3" placeholder="e.g. Hand-blown opal glass pendant on a satin brass canopy, made to order for the lobby.">${esc(tear.description)}</textarea></label>
            <label class="field"><span>Lead time</span><input name="tear_lead_time" value="${esc(tear.lead_time)}" placeholder="e.g. 10–12 weeks after approval" autocomplete="off"></label>
          </div>
        </details>
        ${TEAR_SECTIONS.map((sec, i) => `
          <details class="spec-sec" ${i < 2 ? 'open' : ''}>
            <summary>${esc(sec.title)}</summary>
            <div class="spec-grid">${sec.fields.map(f => fieldHtml(f, spec, template, { toggles: onSheet })).join('')}</div>
          </details>`).join('')}
        <label class="check-row"><input type="checkbox" name="tear_price"> <span>Show the price on this PDF</span></label>
      </div>
      <footer>
        <span class="spacer"></span>
        <button type="submit" class="btn primary" data-pdf style="order:2">Save &amp; make PDF</button>
        <button type="button" class="btn" data-close style="order:0">Cancel</button>
        <button type="submit" class="btn" style="order:1">Save</button>
      </footer>
    </form>`, {
    wide: true,
    onOpen(sheet) {
      const form = $('form', sheet);
      wirePhotos(sheet, { project_id: it.project_id, item_id: it.id }, bag, { removable: true });
      bag.onChange = () => { sheet.dataset.dirty = '1'; };
      wireSpecFields(form, spec, template);
    },
    async onSubmit(fd, form, submitter) {
      const next = readSpec(form, spec);
      next._tear = {
        description: String(fd.get('tear_description') || '').trim(),
        lead_time: String(fd.get('tear_lead_time') || '').trim(),
        images: bag.tear || [],
        hidden: TEAR_SECTIONS.flatMap(sec => sec.fields).filter(f => form.elements[`tear_on_${f.key}`] && !form.elements[`tear_on_${f.key}`].checked).map(f => f.key),
      };
      try { await store.update('items', it.id, { spec: next }); } catch (err) { return false; }
      if (submitter && submitter.hasAttribute('data-pdf')) {
        const price = !!fd.get('tear_price');
        setTimeout(() => makeTearPdf('one', it.id, { price }), 50);
      } else toast('Tear sheet saved');
    },
  });
}

// All tear sheets of an order: ask about prices, then one PDF.
function openOrderTearSheet(p) {
  const lights = lightingOf(p.id);
  if (!lights.length) { toast('No lighting products in this order'); return; }
  openSheet(`
    <form>
      ${sheetHeader('Tear sheets — whole order')}
      <div class="fields">
        <p>${lights.length} light${lights.length === 1 ? '' : 's'}, each on its own page${lights.length > 1 ? 's' : ''}.</p>
        <label class="check-row"><input type="checkbox" name="price"> <span>Show prices</span></label>
      </div>
      <footer><button type="button" class="btn" data-close>Cancel</button><span class="spacer"></span><button type="submit" class="btn primary">Make PDF</button></footer>
    </form>`, {
    onSubmit(fd) { setTimeout(() => makeTearPdf('order', p.id, { price: !!fd.get('price') }), 50); },
  });
}

export const makeTearPdf = (kind, id, opts) => import('../qc-pdf.js').then(m => m.createTearPdf(kind, id, opts));

export function tearAction(action, el) {
  const id = el.dataset.id;
  if (action === 'tear-edit') { const it = store.get('items', id); if (it) openTearSheet(it); return true; }
  if (action === 'tear-pdf') { makeTearPdf('one', id, { price: false }); return true; }
  if (action === 'tear-order') { const p = store.get('projects', id); if (p) openOrderTearSheet(p); return true; }
  return false;
}
