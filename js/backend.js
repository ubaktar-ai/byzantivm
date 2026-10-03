// Two interchangeable backends with the same interface:
//  - SupabaseBackend: the real shared database (team logins, live updates)
//  - LocalBackend: demo mode, data saved only on this device
import { uuid } from './lib.js';

export const keyOf = table => (table === 'team_members' ? 'email' : 'id');

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
  projects: () => ({ description: '', stage: 'brief', status: 'active', currency: 'TRY', lead_id: null, client_id: null, start_date: null, due_date: null, sort_order: 0 }),
  tasks: () => ({ notes: '', stage: 'brief', done: false, priority: 'medium', assignee_id: null, due_date: null, completed_at: null, sort_order: 0 }),
  comments: () => ({ task_id: null, mentions: [], author_id: DEMO_USER.id }),
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
    this.db[table] = (this.db[table] || []).filter(r => r[key] !== id);
    // Mirror the database's ON DELETE CASCADE / SET NULL rules.
    if (table === 'projects') {
      const taskIds = new Set(this.db.tasks.filter(t => t.project_id === id).map(t => t.id));
      this.db.tasks = this.db.tasks.filter(t => t.project_id !== id);
      this.db.comments = this.db.comments.filter(c => c.project_id !== id && !taskIds.has(c.task_id));
    } else if (table === 'tasks') {
      this.db.comments = this.db.comments.filter(c => c.task_id !== id);
    } else if (table === 'clients') {
      this.db.contacts = this.db.contacts.filter(c => c.client_id !== id);
      this.db.projects.forEach(p => { if (p.client_id === id) p.client_id = null; });
    }
    if (row) this.log(table, 'deleted', row);
    this.persist();
  }

  log(table, action, row, details = {}) {
    if (!['clients', 'projects', 'tasks', 'comments'].includes(table)) return;
    this.db.activity.push({
      id: this.db.activity.length + 1,
      at: new Date().toISOString(),
      actor_id: DEMO_USER.id,
      entity: table,
      entity_id: row.id,
      project_id: table === 'projects' ? row.id : row.project_id || null,
      action,
      summary: row.name || row.title || (row.body || '').slice(0, 140) || '',
      details,
    });
  }

  subscribe() {}
  unsubscribe() {}
}

export { DEMO_USER };
