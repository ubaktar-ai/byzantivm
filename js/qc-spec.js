// What a lighting spec contains, US/EU defaults, the inspection checklist made from it, and version comparison.
// Fields with `list` show a dropdown you can also type into (choose a value or write your own).

export const SOCKETS_US = ['E26 (medium)', 'E12 (candelabra)', 'E17 (intermediate)', 'E39 (mogul)', 'GU24', 'G9', 'GU10', 'MR16 / GU5.3', 'G4'];
export const SOCKETS_EU = ['E27', 'E14', 'G9', 'GU10', 'GU5.3 / MR16', 'B22 (bayonet)', 'B15 (bayonet)', 'G4', 'R7s'];

export const DIMMING = [
  { id: 'onoff', label: 'On/off (non-dimmable)' },
  { id: 'phase', label: 'Phase dimming (TRIAC / leading edge)' },
  { id: 'elv', label: 'ELV reverse phase (trailing edge)' },
  { id: '0-10v', label: '0–10V' },
  { id: 'dali', label: 'DALI / DALI-2' },
  { id: 'lutron', label: 'Lutron system' },
  { id: 'other', label: 'Other' },
];
const dimLabel = id => (DIMMING.find(d => d.id === id) || {}).label || id;

const yes = v => v === 'yes';
const bulb = s => s.source_type !== 'led';
const led = s => s.source_type === 'led';
const dimmable = s => s.dimming && s.dimming !== 'onoff';

// type: text | number | list (dropdown + own value) | select (fixed) | yesno | textarea | lines (one check per line)
// check: becomes a line on the inspection checklist · measure: the inspector writes down the measured value
export const SPEC_SECTIONS = [
  { id: 'general', title: 'General', fields: [
    { key: 'market', label: 'Installed in', type: 'select', options: [{ id: 'US', label: 'United States' }, { id: 'EU', label: 'Europe' }] },
    { key: 'location_tag', label: 'Room / location tag', type: 'text', placeholder: 'e.g. Dining 01, Lobby P1–P6', check: true },
    { key: 'fixture_type', label: 'Fixture type', type: 'list', list: ['Pendant', 'Chandelier', 'Wall light', 'Ceiling / flush mount', 'Floor lamp', 'Table lamp', 'Recessed downlight', 'Linear', 'Track light', 'Outdoor light'], check: true },
    { key: 'product_code', label: 'Product / model code', type: 'text', check: true },
    { key: 'drawing_rev', label: 'Approved drawing revision', type: 'text', placeholder: 'e.g. Rev C, 12 Oct', check: true },
  ] },
  { id: 'dimensions', title: 'Dimensions & weight', fields: [
    { key: 'overall_size', label: 'Overall size (W × D × H)', type: 'text', placeholder: 'e.g. 900 × 900 × 650 mm', check: true, measure: true },
    { key: 'diameter', label: 'Diameter', type: 'text', placeholder: 'e.g. 450 mm', check: true, measure: true },
    { key: 'overall_drop', label: 'Overall drop (ceiling to bottom)', type: 'text', placeholder: 'e.g. 1500 mm', check: true, measure: true },
    { key: 'shade_size', label: 'Glass / shade size', type: 'text', check: true, measure: true },
    { key: 'weight', label: 'Weight per piece', type: 'text', placeholder: 'e.g. 8.5 kg', check: true, measure: true },
    { key: 'tolerance', label: 'Allowed tolerance', type: 'list', list: ['±1 mm', '±2 mm', '±3 mm', '±5 mm', '±10 mm'] },
  ] },
  { id: 'materials', title: 'Materials', fields: [
    { key: 'body_material', label: 'Body material', type: 'list', list: ['Solid brass', 'Brass-plated steel', 'Aluminium', 'Steel', 'Stainless steel', 'Bronze', 'Copper', 'Wood', 'Ceramic'], check: true },
    { key: 'material_detail', label: 'Grade / thickness / detail', type: 'text', placeholder: 'e.g. C260 brass, 1.5 mm wall', check: true },
    { key: 'glass', label: 'Glass / diffuser', type: 'list', list: ['None', 'Hand-blown clear', 'Hand-blown opal', 'Frosted / acid-etched', 'Ribbed / fluted', 'Coloured glass', 'Alabaster', 'Acrylic diffuser'], check: true },
    { key: 'glass_detail', label: 'Glass detail', type: 'text', placeholder: 'colour, thickness, finish inside/outside', check: true },
    { key: 'shade', label: 'Shade (fabric, paper, metal…)', type: 'text', check: true },
    { key: 'other_materials', label: 'Other materials', type: 'text', check: true },
  ] },
  { id: 'finishes', title: 'Finishes', fields: [
    { key: 'finish', label: 'Main finish', type: 'text', placeholder: 'e.g. Aged brass', check: true },
    { key: 'finish_code', label: 'Finish code', type: 'text', check: true },
    { key: 'finish_sample', label: 'Approved finish sample no.', type: 'text', placeholder: 'number on the physical sample', check: true },
    { key: 'sheen', label: 'Sheen / texture', type: 'list', list: ['Matte', 'Satin', 'Semi-gloss', 'Polished', 'Brushed', 'Hammered'], check: true },
    { key: 'coating', label: 'Protective coating', type: 'list', list: ['Lacquered', 'Unlacquered (living finish)', 'Powder coated', 'Oiled', 'Waxed', 'None'], check: true },
    { key: 'secondary_finish', label: 'Canopy / rod / cable / details finish', type: 'text', placeholder: 'e.g. canopy matches body, black cable', check: true },
    { key: 'finish_match', label: 'All units must match the approved sample', type: 'yesno', check: true },
  ] },
  { id: 'light', title: 'Light source', fields: [
    { key: 'source_type', label: 'Light source', type: 'select', options: [{ id: 'bulb', label: 'Bulb (socket)' }, { id: 'led', label: 'Integrated LED' }] },
    { key: 'socket', label: 'Socket type', type: 'list', list: s => (s.market === 'US' ? [...SOCKETS_US, ...SOCKETS_EU] : [...SOCKETS_EU, ...SOCKETS_US]), show: bulb, check: true },
    { key: 'socket_count', label: 'Number of sockets', type: 'number', show: bulb, check: true },
    { key: 'max_wattage', label: 'Max. wattage per socket', type: 'text', placeholder: 'e.g. 40 W', show: bulb, check: true },
    { key: 'bulbs_included', label: 'Bulbs included', type: 'yesno', show: bulb, check: true },
    { key: 'bulb_spec', label: 'Bulb spec', type: 'text', placeholder: 'e.g. LED filament G95, 4 W, 2700K, dimmable', show: bulb, check: true },
    { key: 'led_power', label: 'LED power', type: 'text', placeholder: 'e.g. 24 W', show: led, check: true },
    { key: 'cct', label: 'Colour temperature', type: 'list', list: ['2200K', '2400K', '2700K', '3000K', '3500K', '4000K', 'Dim-to-warm 3000–1800K', 'Tunable white'], check: true },
    { key: 'cri', label: 'CRI', type: 'list', list: ['≥80', '≥90', '≥95', '≥97'], check: true },
    { key: 'r9', label: 'R9', type: 'text', placeholder: 'e.g. >50', show: led, check: true },
    { key: 'lumens', label: 'Light output', type: 'text', placeholder: 'e.g. 1800 lm', check: true },
    { key: 'beam_angle', label: 'Beam angle', type: 'text', placeholder: 'e.g. 36°', show: led, check: true },
    { key: 'binning', label: 'Colour consistency (binning)', type: 'list', list: ['≤2 SDCM', '≤3 SDCM', '≤5 SDCM'], show: led, check: true },
    { key: 'lifetime', label: 'Lifetime', type: 'text', placeholder: 'e.g. L70 50,000 h', show: led },
  ] },
  { id: 'electrical', title: 'Electrical & driver', fields: [
    { key: 'voltage', label: 'Voltage', type: 'list', list: ['120V', '277V', '120–277V', '230V', '220–240V', '100–277V', '24V DC', '48V DC'], check: true },
    { key: 'frequency', label: 'Frequency', type: 'list', list: ['60 Hz', '50 Hz', '50/60 Hz'], check: true },
    { key: 'driver', label: 'Driver / transformer brand & model', type: 'text', placeholder: 'e.g. eldoLED SOLOdrive 360/A', check: true },
    { key: 'driver_type', label: 'Driver type', type: 'list', list: ['Constant current', 'Constant voltage', 'Electronic transformer', 'Magnetic transformer', 'None (mains)'], check: true },
    { key: 'driver_output', label: 'Driver output', type: 'text', placeholder: 'e.g. 700 mA / 24 V, 25 W', check: true },
    { key: 'driver_location', label: 'Driver location', type: 'list', list: ['In canopy', 'In fixture body', 'Remote — supplied loose', 'Remote — by others'], check: true },
    { key: 'driver_distance', label: 'Max. distance to remote driver', type: 'text', check: true },
    { key: 'driver_access', label: 'Driver replaceable without removing fixture', type: 'yesno', check: true },
    { key: 'flicker_free', label: 'Flicker-free', type: 'yesno', check: true },
  ] },
  { id: 'dimming', title: 'Dimming', fields: [
    { key: 'dimming', label: 'Dimming', type: 'select', options: DIMMING },
    { key: 'lutron_system', label: 'Lutron system', type: 'list', list: ['Hi-lume', 'EcoSystem', 'RadioRA 3', 'HomeWorks', 'Athena', 'Caséta', 'Clear Connect'], show: s => s.dimming === 'lutron', check: true },
    { key: 'dimming_other', label: 'Dimming system', type: 'text', show: s => s.dimming === 'other', check: true },
    { key: 'dimmer', label: 'Tested with dimmer / controller', type: 'text', placeholder: 'brand & model the client will use', show: dimmable, check: true },
    { key: 'dim_range', label: 'Dims down to', type: 'list', list: ['10%', '5%', '1%', '0.1%'], show: dimmable, check: true },
    { key: 'dim_to_warm', label: 'Dim-to-warm', type: 'yesno', show: dimmable, check: true },
    { key: 'dimming_notes', label: 'Dimming notes', type: 'text', show: dimmable, check: true },
  ] },
  { id: 'certification', title: 'Certification & safety', fields: [
    { key: 'certification', label: 'Certification', type: 'list', list: ['UL listed', 'ETL listed', 'cUL / cETL (Canada)', 'UL + cUL', 'CE', 'CE + ENEC', 'UKCA', 'CB report', 'None required'], check: true },
    { key: 'location_rating', label: 'Location rating', type: 'list', list: ['Dry', 'Damp', 'Wet'], check: true },
    { key: 'ip_rating', label: 'IP rating', type: 'list', list: ['IP20', 'IP44', 'IP54', 'IP65', 'IP67'], check: true },
    { key: 'labels', label: 'Certification & rating label on every unit', type: 'yesno', check: true },
    { key: 'wiring', label: 'Wiring / earthing', type: 'text', placeholder: 'e.g. 3-wire: black, white, green ground', check: true },
  ] },
  { id: 'mounting', title: 'Cable & mounting', fields: [
    { key: 'suspension', label: 'Suspension', type: 'list', list: ['Cable', 'Rod(s)', 'Chain', 'Fixed / flush', 'Wall bracket', 'Floor / table'], check: true },
    { key: 'cable_length', label: 'Cable / rod / chain length', type: 'text', placeholder: 'e.g. 2000 mm, field-cuttable', check: true, measure: true },
    { key: 'cable_type', label: 'Cable type & colour', type: 'list', list: ['Black braided fabric', 'Gold braided fabric', 'Clear PVC', 'Black PVC', 'White PVC', 'Steel cable + power cord'], check: true },
    { key: 'adjustable', label: 'Height adjustable on site', type: 'yesno', check: true },
    { key: 'canopy', label: 'Canopy size & finish', type: 'text', placeholder: 'e.g. Ø120 × 30 mm, matches body', check: true, measure: true },
    { key: 'junction_box', label: 'Junction box', type: 'list', list: s => (s.market === 'US'
      ? ['US 4" octagon / round box', 'US single-gang box', 'Surface mount', 'EU round box (Ø60 mm)']
      : ['EU round box (Ø60 mm)', 'Surface mount', 'US 4" octagon / round box', 'US single-gang box']), check: true },
    { key: 'ceiling', label: 'Ceiling / wall type', type: 'list', list: ['Plasterboard', 'Concrete', 'Wood', 'Sloped ceiling'], check: true },
    { key: 'sloped_adapter', label: 'Sloped-ceiling adapter', type: 'yesno', check: true },
    { key: 'mounting_hardware', label: 'Mounting hardware supplied', type: 'text', check: true },
  ] },
  { id: 'packing', title: 'Packaging & documents', fields: [
    { key: 'packaging', label: 'Packaging', type: 'list', list: ['Wooden crate', 'Double-wall carton', 'Carton + foam', 'Carton + custom foam insert'], check: true },
    { key: 'label_tag', label: 'Box labelled with room / location tag', type: 'yesno', check: true },
    { key: 'spare_parts', label: 'Spare parts', type: 'text', placeholder: 'e.g. 2 spare bulbs, 1 spare glass', check: true },
    { key: 'install_manual', label: 'Installation manual', type: 'yesno', check: true },
    { key: 'wiring_diagram', label: 'Wiring diagram', type: 'yesno', check: true },
    { key: 'test_report', label: 'Factory test report', type: 'yesno', check: true },
    { key: 'warranty', label: 'Warranty', type: 'text', placeholder: 'e.g. 2 years', check: true },
  ] },
  { id: 'requests', title: 'Special requests', fields: [
    { key: 'special_requests', label: 'One request per line — each becomes its own check', type: 'lines', check: true },
    { key: 'notes', label: 'Other notes', type: 'textarea' },
  ] },
];

export const ALL_FIELDS = SPEC_SECTIONS.flatMap(s => s.fields);

export function defaultSpec(market = 'EU') {
  const us = market === 'US';
  return {
    market,
    source_type: 'bulb',
    socket: us ? 'E26 (medium)' : 'E27',
    voltage: us ? '120V' : '230V',
    frequency: us ? '60 Hz' : '50 Hz',
    certification: us ? 'UL listed' : 'CE',
    junction_box: us ? 'US 4" octagon / round box' : 'EU round box (Ø60 mm)',
    location_rating: 'Dry',
    dimming: 'phase',
    finish_match: 'yes',
    labels: 'yes',
    label_tag: 'yes',
    install_manual: 'yes',
    tolerance: '±3 mm',
    cri: '≥90',
    cct: '2700K',
  };
}

const isEmpty = v => v == null || String(v).trim() === '';
export const visible = (f, s) => !f.show || f.show(s);

export function fieldValue(f, s) {
  const v = s[f.key];
  if (isEmpty(v)) return '';
  if (f.type === 'yesno') return yes(v) ? 'Yes' : v === 'no' ? 'No' : String(v);
  if (f.type === 'select') {
    if (f.key === 'dimming') return dimLabel(v);
    return (f.options.find(o => o.id === v) || {}).label || String(v);
  }
  return String(v).trim();
}

// The product facts that belong to a spec version (copied in when the version is issued).
export const productFacts = it => ({ name: it.name, quantity: Number(it.quantity) || 1, supplier: it.supplier || '', supplier_ref: it.supplier_ref || '' });

// Readable list of what's in a spec: [{ section, rows: [[label, value]] }]
export function specRows(spec) {
  const s = spec || {};
  return SPEC_SECTIONS.map(sec => ({
    title: sec.title,
    rows: sec.fields.filter(f => visible(f, s) && f.type !== 'lines').map(f => [f.label, fieldValue(f, s)]).filter(([, v]) => v),
    lines: sec.fields.filter(f => f.type === 'lines').flatMap(f => String(s[f.key] || '').split('\n').map(x => x.trim()).filter(Boolean)),
  })).filter(sec => sec.rows.length || sec.lines.length);
}

// What changed between two specs (and product facts): [{ label, from, to }]
export function specDiff(a, b) {
  const sa = a || {}, sb = b || {};
  const out = [];
  const pa = sa._product || {}, pb = sb._product || {};
  [['name', 'Product'], ['quantity', 'Quantity'], ['supplier', 'Supplier'], ['supplier_ref', 'Supplier ref.']].forEach(([k, l]) => {
    if (String(pa[k] ?? '') !== String(pb[k] ?? '')) out.push({ label: l, from: String(pa[k] ?? ''), to: String(pb[k] ?? '') });
  });
  ALL_FIELDS.forEach(f => {
    const va = visible(f, sa) ? fieldValue(f, sa) : '';
    const vb = visible(f, sb) ? fieldValue(f, sb) : '';
    if (va !== vb) out.push({ label: f.label, from: va, to: vb });
  });
  return out;
}

export const STAGES = [
  { id: 'sample', label: 'Samples' },
  { id: 'production', label: 'During production' },
  { id: 'final', label: 'Final (before shipping)' },
  { id: 'delivery', label: 'On delivery / site' },
];
export const INSPECTORS = [
  { id: 'supplier', label: 'Supplier (photos / video)' },
  { id: 'us', label: 'Us at the workshop' },
  { id: 'third_party', label: 'Third-party inspector' },
  { id: 'client', label: 'Client / installer on site' },
];

// The checklist for an inspection: every filled-in spec line + standard tests for that stage.
export function checklist(spec, stage) {
  const s = spec || {};
  const p = s._product || {};
  const lines = [];
  const add = (key, label, expected = '', measure = false) => lines.push({ key, label, expected, measure });
  if (stage === 'delivery') {
    add('qty', 'All units delivered', `${p.quantity || 1} pcs`, true);
    add('packaging_ok', 'Packaging undamaged on arrival');
    add('no_damage', 'No transit damage (glass, finish, dents, bent parts)');
    add('labels_tag', 'Boxes labelled with room / location tag', fieldValue({ key: 'location_tag', type: 'text' }, s));
    add('docs', 'Manual, wiring diagram and spare parts in the boxes');
    add('works', 'Tested on site: lights on' + (dimmable(s) ? ', dims smoothly without flicker or buzz' : ''));
    return lines;
  }
  if (stage !== 'sample') add('qty', 'Quantity — all units made', `${p.quantity || 1} pcs`, true);
  SPEC_SECTIONS.forEach(sec => sec.fields.forEach(f => {
    if (!f.check || !visible(f, s)) return;
    if (stage === 'sample' && !['materials', 'finishes', 'light'].includes(sec.id)) return;
    if (f.type === 'lines') {
      String(s[f.key] || '').split('\n').map(x => x.trim()).filter(Boolean)
        .forEach((r, i) => add(`req_${i}`, `Special request: ${r}`, 'As requested'));
      return;
    }
    const v = fieldValue(f, s);
    if (v && v !== 'No') add(f.key, f.label, v, !!f.measure);
  }));
  if (stage === 'final' || stage === 'production') {
    add('light_test', 'Every unit switched on and tested (burn-in)');
    if (dimmable(s)) add('dim_test', `Dimming tested on ${s.dimmer || 'the specified dimmer'} — full range, no flicker or buzz`, dimLabel(s.dimming));
    add('colour_match', 'All units side by side: finish and light colour match each other and the sample');
    add('workmanship', 'No scratches, dents, glue marks, loose parts or finish defects');
    add('electrical_safety', 'Wiring, strain relief and earth / ground connection correct');
  }
  if (stage === 'final') {
    add('packed', 'Packed as specified, protected for transport');
    add('docs', 'Manual, wiring diagram, test report and spare parts packed');
  }
  return lines;
}
