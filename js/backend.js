// Two interchangeable backends with the same interface:
//  - SupabaseBackend: the real shared database (team logins, live updates)
//  - LocalBackend: demo mode, data saved only on this device
import { uuid } from './lib.js';

export const keyOf = table => (table === 'team_members' ? 'email' : 'id');

// Foreign keys, mirroring supabase/schema.sql: when a parent row is deleted,
// children are deleted ('cascade') or have the link cleared ('null').
export const RELATIONS = {
  projects: [['tasks', 'project_id', 'cascade'], ['comments', 'project_id', 'cascade'],
    ['deliverables', 'project_id', 'cascade'], ['attachments', 'project_id', 'cascade'],
    ['quotes', 'project_id', 'cascade'], ['costs', 'project_id', 'cascade'], ['invoices', 'project_id', 'cascade']],
  quotes: [['quote_items', 'quote_id', 'cascade']],
  tasks: [['comments', 'task_id', 'cascade'], ['attachments', 'task_id', 'cascade']],
  clients: [['contacts', 'client_id', 'cascade'], ['projects', 'client_id', 'null']],
  deliverables: [['feedback_rounds', 'deliverable_id', 'cascade']],
  feedback_rounds: [['attachments', 'round_id', 'cascade']],
};

// ---------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------

export class SupabaseBackend {
  constructor(url, anonKey) {
    this.mode = 'cloud';
    this.sb = window.supabase.createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }

  async getUser() {
    const { data } = await this.sb.auth.getSession();
    return data.session ? data.session.user : null;
  }

  onAuthChange(cb) {
    this.sb.auth.onAuthStateChange((event, session) => cb(event, session ? session.user : null));
  }

  async signIn(email, password) {
    const { error } = await this.sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  async signUp(email, password, fullName) {
    const { data, error } = await this.sb.auth.signUp({
      email, password,
      options: { data: { full_name: fullName }, emailRedirectTo: appUrl() },
    });
    if (error) throw error;
    return { needsConfirmation: !data.session };
  }

  async resetPassword(email) {
    const { error } = await this.sb.auth.resetPasswordForEmail(email, { redirectTo: appUrl() });
    if (error) throw error;
  }

  async updatePassword(password) {
    const { error } = await this.sb.auth.updateUser({ password });
    if (error) throw error;
  }

  async signOut() {
    await this.sb.auth.signOut();
  }

  async isTeamMember() {
    const { data, error } = await this.sb.rpc('is_team_member');
    if (error) throw error;
    return !!data;
  }

  async selectAll(table, { order, limit } = {}) {
    const rows = [];
    const page = 1000;
    for (let from = 0; ; from += page) {
      let q = this.sb.from(table).select('*');
      if (order) q = q.order(order.column, { ascending: !!order.ascending });
      const to = limit ? Math.min(from + page, limit) - 1 : from + page - 1;
      const { data, error } = await q.range(from, to);
      if (error) throw error;
      rows.push(...data);
      if (data.length < page || (limit && rows.length >= limit)) break;
    }
    return rows;
  }

  async insert(table, row) {
    const { data, error } = await this.sb.from(table).insert(row).select().single();
    if (error) throw error;
    return data;
  }

  async update(table, id, patch) {
    const { data, error } = await this.sb.from(table).update(patch).eq(keyOf(table), id).select().single();
    if (error) throw error;
    return data;
  }

  async remove(table, id) {
    const { error } = await this.sb.from(table).delete().eq(keyOf(table), id);
    if (error) throw error;
  }

  // ---------- Files (private "files" storage bucket) ----------

  async uploadFile(path, blob, contentType) {
    const { error } = await this.sb.storage.from('files').upload(path, blob, { contentType, upsert: false });
    if (error) throw error;
  }

  // Temporary links (valid 1 hour) for showing / opening files.
  async signedUrls(paths) {
    if (!paths.length) return {};
    const { data, error } = await this.sb.storage.from('files').createSignedUrls(paths, 3600);
    if (error) throw error;
    const out = {};
    data.forEach(d => { if (d.signedUrl && !d.error) out[d.path] = d.signedUrl; });
    return out;
  }

  async removeFiles(paths) {
    if (!paths.length) return;
    const { error } = await this.sb.storage.from('files').remove(paths);
    if (error) throw error;
  }

  subscribe(cb, onStatus) {
    if (this.channel) this.sb.removeChannel(this.channel);
    this.channel = this.sb
      .channel('studio-db')
      .on('postgres_changes', { event: '*', schema: 'public' }, p => cb(p.table, p.eventType, p.new, p.old))
      .subscribe(status => onStatus && onStatus(status));
  }

  unsubscribe() {
    if (this.channel) this.sb.removeChannel(this.channel);
    this.channel = null;
  }
}

function appUrl() {
  return location.origin + location.pathname;
}

// ---------------------------------------------------------------------
// Local (demo) — mirrors the database defaults and activity log
// ---------------------------------------------------------------------

const DEMO_KEY = 'studio-demo:v1';
const DEMO_USER = { id: '00000000-0000-4000-8000-000000000001', email: 'you@demo.local' };

const DEFAULTS = {
  companies: () => ({ color: '#64748b', sort_order: 0 }),
  clients: () => ({ email: '', phone: '', website: '', address: '', notes: '' }),
  contacts: () => ({ role: '', email: '', phone: '', notes: '' }),
  projects: () => ({ description: '', stage: 'brief', status: 'active', currency: 'EUR', lead_id: null, client_id: null, start_date: null, due_date: null, sort_order: 0 }),
  tasks: () => ({ notes: '', stage: 'brief', done: false, priority: 'medium', assignee_id: null, due_date: null, completed_at: null, sort_order: 0 }),
  comments: () => ({ task_id: null, mentions: [], author_id: DEMO_USER.id }),
  deliverables: () => ({ description: '', max_rounds: 3, status: 'in_progress', due_date: null, sort_order: 0 }),
  feedback_rounds: () => ({ sent_date: null, received_date: null, status: 'awaiting', feedback: '' }),
  attachments: () => ({ task_id: null, round_id: null, mime: '', size: 0 }),
  quotes: () => ({ number: '', title: '', issue_date: null, valid_until: null, status: 'draft', notes: '' }),
  quote_items: () => ({ quantity: 1, unit_price: 0, sort_order: 0 }),
  costs: () => ({ category: 'other', vendor: '', amount: 0, paid: false }),
  invoices: () => ({ number: '', title: '', issue_date: null, due_date: null, amount: 0, status: 'draft', paid_date: null, notes: '' }),
  team_members: () => ({}),
  profiles: () => ({ full_name: '', color: '#64748b' }),
};

export class LocalBackend {
  constructor() {
    this.mode = 'demo';
    this.listeners = [];
    this.db = this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(DEMO_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* start fresh */ }
    const now = new Date().toISOString();
    return {
      companies: [
        { id: 'byzantivm', name: 'Byzantivm', color: '#7c3aed', sort_order: 0, updated_at: now },
        { id: 'demya', name: 'Demya', color: '#0d9488', sort_order: 1, updated_at: now },
      ],
      profiles: [{ ...DEMO_USER, full_name: 'You', color: '#2563eb', created_at: now, updated_at: now }],
      team_members: [{ email: DEMO_USER.email, added_at: now }],
      clients: [], contacts: [], projects: [], tasks: [], comments: [], activity: [],
      deliverables: [], feedback_rounds: [], attachments: [], quotes: [], quote_items: [], costs: [], invoices: [],
    };
  }

  persist() {
    try { localStorage.setItem(DEMO_KEY, JSON.stringify(this.db)); } catch (e) { /* storage full / blocked */ }
  }

  reset() {
    try { localStorage.removeItem(DEMO_KEY); } catch (e) { /* ignore */ }
    this.db = this.load();
  }

  async getUser() { return DEMO_USER; }
  onAuthChange() {}
  async signOut() {}
  async isTeamMember() { return true; }
  async updatePassword() {}

  async selectAll(table, { order, limit } = {}) {
    let rows = (this.db[table] || []).map(r => ({ ...r }));
    if (order) rows.sort((a, b) => (a[order.column] < b[order.column] ? -1 : 1) * (order.ascending ? 1 : -1));
    if (limit) rows = rows.slice(0, limit);
    return rows;
  }

  async insert(table, row) {
    const now = new Date().toISOString();
    const full = {
      ...(DEFAULTS[table] ? DEFAULTS[table]() : {}),
      ...(table === 'team_members' ? { added_at: now } : { id: uuid(), created_at: now, created_by: DEMO_USER.id }),
      ...row,
      updated_at: now,
    };
    (this.db[table] ||= []).push(full);
    this.log(table, 'created', full);
    this.persist();
    return { ...full };
  }

  async update(table, id, patch) {
    const key = keyOf(table);
    const row = (this.db[table] || []).find(r => r[key] === id);
    if (!row) throw new Error('Not found');
    const prev = { ...row };
    Object.assign(row, patch, { updated_at: new Date().toISOString() });
    const changed = Object.keys(patch).filter(k => k !== 'sort_order' && JSON.stringify(prev[k]) !== JSON.stringify(row[k]));
    if (changed.length) {
      let action = 'updated';
      if (table === 'tasks' && changed.includes('done') && changed.every(k => k === 'done' || k === 'completed_at')) action = row.done ? 'completed' : 'reopened';
      else if (changed.includes('stage')) action = 'moved';
      this.log(table, action, row, { changed, stage: row.stage, from_stage: prev.stage, status: row.status });
    }
    this.persist();
    return { ...row };
  }

  async remove(table, id) {
    const key = keyOf(table);
    const row = (this.db[table] || []).find(r => r[key] === id);
    const drop = (t, rowId) => {
      this.db[t] = (this.db[t] || []).filter(r => r.id !== rowId);
      // Mirror the database's ON DELETE CASCADE / SET NULL rules.
      for (const [child, fk, rule] of RELATIONS[t] || []) {
        for (const c of (this.db[child] || []).filter(r => r[fk] === rowId)) {
          if (rule === 'cascade') { drop(child, c.id); if (child === 'attachments') this.deleteBlob(c.path); }
          else c[fk] = null;
        }
      }
    };
    if (key === 'id') drop(table, id);
    else this.db[table] = (this.db[table] || []).filter(r => r[key] !== id);
    if (row) this.log(table, 'deleted', row);
    this.persist();
  }

  // ---------- Files (kept in IndexedDB on this device) ----------

  idb() {
    this._idb ||= new Promise((resolve, reject) => {
      const req = indexedDB.open('studio-demo-files', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('files');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this._idb;
  }

  async idbRun(mode, fn) {
    const db = await this.idb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('files', mode);
      const req = fn(tx.objectStore('files'));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
    });
  }

  async uploadFile(path, blob) { await this.idbRun('readwrite', s => s.put(blob, path)); }

  async signedUrls(paths) {
    const out = {};
    for (const path of paths) {
      const blob = await this.idbRun('readonly', s => s.get(path));
      if (blob) out[path] = URL.createObjectURL(blob);
    }
    return out;
  }

  async removeFiles(paths) { for (const p of paths) await this.deleteBlob(p); }

  deleteBlob(path) { return this.idbRun('readwrite', s => s.delete(path)).catch(() => {}); }

  log(table, action, row, details = {}) {
    if (!['clients', 'projects', 'tasks', 'comments', 'deliverables', 'feedback_rounds', 'attachments', 'quotes', 'costs', 'invoices'].includes(table)) return;
    const entry = {
      id: this.db.activity.length + 1,
      at: new Date().toISOString(),
      actor_id: DEMO_USER.id,
      entity: table,
      entity_id: row.id,
      project_id: table === 'projects' ? row.id
        : table === 'feedback_rounds' ? (this.db.deliverables.find(d => d.id === row.deliverable_id) || {}).project_id || null
        : row.project_id || null,
      action,
      summary: row.name || row.title || row.number || (row.body || '').slice(0, 140) || (row.round_no ? `Round ${row.round_no}` : '') || row.description || '',
      details,
    };
    this.db.activity.push(entry);
    // Behave like the live database: announce new activity entries.
    if (this.listener) setTimeout(() => this.listener('activity', 'INSERT', { ...entry }, {}));
  }

  subscribe(cb) { this.listener = cb; }
  unsubscribe() { this.listener = null; }
}

export { DEMO_USER };
