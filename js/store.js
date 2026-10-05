// In-memory copy of the team's data. Changes are applied optimistically
// (the screen updates at once), then saved; on failure they are rolled back.
// Live updates from teammates arrive through applyRemote().
import { keyOf, RELATIONS } from './backend.js';
import { uuid, toast, daysUntil, priorityRank } from './lib.js';

// Projects/tasks saved before the order workflow (migration 005) used design stages; show them on the new ones.
const OLD_STAGES = { brief: 'inquiry', concept: 'costing', design: 'drawings', client_review: 'approval', revisions: 'drawings' };
const normalize = (table, row) =>
  (table === 'projects' || table === 'tasks') && row && OLD_STAGES[row.stage] ? { ...row, stage: OLD_STAGES[row.stage] } : row;

const CORE = ['companies', 'profiles', 'team_members', 'clients', 'contacts', 'projects', 'tasks', 'comments'];
const TABLES = ['companies', 'profiles', 'team_members', 'clients', 'contacts', 'projects', 'tasks', 'comments',
  'deliverables', 'feedback_rounds', 'attachments', 'quotes', 'quote_items', 'costs', 'invoices', 'items', 'shipments',
  'social_posts', 'social_contacts'];

export const store = {
  backend: null,
  user: null,
  data: { ...Object.fromEntries(TABLES.map(t => [t, new Map()])), activity: new Map() },
  activityLoaded: false,
  listeners: new Set(),
  loaded: false,

  missing: new Set(), // tables the database doesn't have yet (a migration hasn't been run)
  fileSections: true,  // attachments have kind/item_id (migration 006)

  async loadAll() {
    const [results, fileSections] = await Promise.all([
      Promise.all(TABLES.map(t => this.backend.selectAll(t).catch(err => {
        if (CORE.includes(t)) throw err;
        console.warn(`Table ${t} not available yet`, err);
        this.missing.add(t);
        return [];
      }))),
      this.backend.hasColumn('attachments', 'kind').catch(() => false),
    ]);
    this.fileSections = fileSections;
    TABLES.forEach((t, i) => {
      const m = new Map();
      results[i].forEach(r => m.set(r[keyOf(t)], normalize(t, r)));
      this.data[t] = m;
    });
    this.loaded = true;
    if (this.activityLoaded) this.loadActivity().catch(() => {});
    this.emit();
  },

  clear() {
    TABLES.forEach(t => { this.data[t] = new Map(); });
    this.data.activity = new Map();
    this.activityLoaded = false;
    this.loaded = false;
  },

  // The activity log is large, so it is loaded only when needed (latest 300 entries);
  // after that, new entries arrive through live updates.
  loadActivity() {
    if (this._activityLoading) return this._activityLoading;
    this._activityLoading = this.backend.selectAll('activity', { order: { column: 'at', ascending: false }, limit: 300 })
      .then(rows => {
        this.data.activity = new Map(rows.map(r => [r.id, r]));
        this.activityLoaded = true;
        this._activityLoading = null;
        this.emit();
      })
      .catch(err => {
        console.warn('Could not load activity', err);
        setTimeout(() => { this._activityLoading = null; }, 30000); // wait before trying again
        throw err;
      });
    return this._activityLoading;
  },

  // ---------- Reading ----------

  all(table) { return Array.from(this.data[table].values()); },
  get(table, id) { return id == null ? null : this.data[table].get(id) || null; },

  // ---------- Change notifications (batched to one render per frame) ----------

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  emit() {
    if (this._pending) return;
    this._pending = true;
    requestAnimationFrame(() => {
      this._pending = false;
      this.listeners.forEach(fn => fn());
    });
  },

  // ---------- Writing ----------

  async insert(table, row) {
    const key = keyOf(table);
    if (key === 'id' && !row.id) row = { id: uuid(), ...row };
    const now = new Date().toISOString();
    const optimistic = { created_at: now, updated_at: now, ...row };
    this.data[table].set(row[key], optimistic);
    this.emit();
    try {
      const saved = await this.backend.insert(table, row);
      this.data[table].set(saved[key], { ...this.data[table].get(saved[key]), ...saved });
      this.emit();
      return saved;
    } catch (err) {
      this.data[table].delete(row[key]);
      this.emit();
      fail(err);
      throw err;
    }
  },

  async update(table, id, patch) {
    const before = this.get(table, id);
    if (!before) return;
    this.data[table].set(id, { ...before, ...patch });
    this.emit();
    try {
      const saved = await this.backend.update(table, id, patch);
      // Local state wins (it may hold newer edits made while saving); the server fills in the rest.
      this.data[table].set(id, { ...saved, ...this.get(table, id), updated_at: saved.updated_at });
      this.emit();
      return saved;
    } catch (err) {
      this.data[table].set(id, before);
      this.emit();
      fail(err);
      throw err;
    }
  },

  async remove(table, id) {
    const before = this.get(table, id);
    if (!before) return;
    const snapshot = this.cascade(table, id);
    this.emit();
    try {
      await this.backend.remove(table, id);
    } catch (err) {
      snapshot.restore();
      this.emit();
      fail(err);
      throw err;
    }
  },

  // Remove a row and (locally) everything the database would cascade.
  cascade(table, id) {
    const removed = [];
    const nulled = [];
    const drop = (t, k) => {
      const r = this.get(t, k);
      if (!r) return;
      removed.push([t, r]);
      this.data[t].delete(k);
      for (const [child, fk, rule] of RELATIONS[t] || []) {
        this.all(child).filter(c => c[fk] === k).forEach(c => {
          if (rule === 'cascade') drop(child, c.id);
          else { nulled.push([child, c]); this.data[child].set(c.id, { ...c, [fk]: null }); }
        });
      }
    };
    drop(table, id);
    return {
      restore: () => {
        removed.forEach(([t, r]) => this.data[t].set(r[keyOf(t)], r));
        nulled.forEach(([t, r]) => this.data[t].set(r.id, r));
      },
    };
  },

  applyRemote(table, type, row, old) {
    if (!this.data[table]) return;
    const key = keyOf(table);
    if (type === 'DELETE') {
      const id = old && old[key];
      if (id != null && this.data[table].has(id)) { this.cascade(table, id); this.emit(); }
      return;
    }
    if (!row || row[key] == null) return;
    const current = this.data[table].get(row[key]);
    // Ignore stale echoes older than what we already have.
    if (current && current.updated_at && row.updated_at && row.updated_at < current.updated_at) return;
    this.data[table].set(row[key], normalize(table, { ...current, ...row }));
    this.emit();
  },
};

function fail(err) {
  console.error(err);
  const msg = err && err.message ? err.message : String(err);
  toast(/fetch|network/i.test(msg) ? 'No connection — change not saved' : `Couldn't save: ${msg}`);
}

// ---------- Derived data helpers used across screens ----------

export const companies = () => store.all('companies').sort((a, b) => a.sort_order - b.sort_order);
export const profiles = () => store.all('profiles').filter(p => store.data.team_members.has(p.email)).sort((a, b) => (a.full_name || a.email).localeCompare(b.full_name || b.email));
export const me = () => store.get('profiles', store.user && store.user.id);
export const personName = id => { const p = store.get('profiles', id); return p ? p.full_name || p.email : ''; };

export const tasksOf = projectId => store.all('tasks').filter(t => t.project_id === projectId);
export const projectsOfClient = clientId => store.all('projects').filter(p => p.client_id === clientId);
export const contactsOf = clientId => store.all('contacts').filter(c => c.client_id === clientId).sort((a, b) => a.name.localeCompare(b.name));
export const commentsOf = taskId => store.all('comments').filter(c => c.task_id === taskId).sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
export const commentCount = taskId => { let n = 0; store.data.comments.forEach(c => { if (c.task_id === taskId) n++; }); return n; };

export const deliverablesOf = projectId => store.all('deliverables').filter(d => d.project_id === projectId).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || (a.created_at < b.created_at ? -1 : 1));
export const roundsOf = deliverableId => store.all('feedback_rounds').filter(r => r.deliverable_id === deliverableId).sort((a, b) => a.round_no - b.round_no);
export const attachmentsWhere = (field, id) => store.all('attachments').filter(a => a[field] === id).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

export const productsOf = projectId => store.all('items').filter(i => i.project_id === projectId).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || (a.created_at < b.created_at ? -1 : 1));
export const shipmentsOf = projectId => store.all('shipments').filter(s => s.project_id === projectId).sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
export const drawingOf = itemId => store.all('deliverables').find(d => d.item_id === itemId) || null;

export const isOverdue = t => !t.done && t.due_date && daysUntil(t.due_date) < 0;
export const isLive = p => p.status === 'active' || p.status === 'on_hold';

export function progress(projectId) {
  const ts = tasksOf(projectId);
  const done = ts.filter(t => t.done).length;
  return { total: ts.length, done, pct: ts.length ? Math.round((done / ts.length) * 100) : 0 };
}

export function byDueThenPriority(a, b) {
  const da = a.due_date || '9999-12-31';
  const db = b.due_date || '9999-12-31';
  if (da !== db) return da < db ? -1 : 1;
  return priorityRank(a.priority) - priorityRank(b.priority);
}

export function nextSortOrder(rows) {
  return rows.length ? Math.max(...rows.map(r => r.sort_order || 0)) + 1 : 0;
}

