import { supabase, SUPABASE_URL, SUPABASE_KEY } from '../supabaseClient';

export type CloudPath = 'records' | 'checklists' | 'users' | 'attendance' | 'auditLogs';
export type CloudData = Record<CloudPath, unknown>;
export type CloudStatus = 'connected' | 'needs-setup' | 'error';

const TABLE = 'daily_check_kv';

export async function probeCloud(): Promise<CloudStatus> {
  try {
    const { error } = await supabase.from(TABLE).select('key').limit(1);
    if (!error) return 'connected';
    const msg = `${error.message ?? ''} ${error.code ?? ''}`.toLowerCase();
    if (msg.includes('does not exist') || msg.includes('schema cache') || msg.includes('42p01') || msg.includes('pgrst205')) {
      return 'needs-setup';
    }
    return 'error';
  } catch {
    return 'error';
  }
}

export async function readAll(): Promise<CloudData | null> {
  const { data, error } = await supabase.from(TABLE).select('key, value');
  if (error || !data) return null;
  const out: CloudData = { records: null, checklists: null, users: null, attendance: null, auditLogs: null };
  for (const row of data as { key: string; value: unknown }[]) {
    if (row.key in out) (out as Record<string, unknown>)[row.key] = row.value;
  }
  return out;
}

// 'records' and 'attendance' are allowed through direct writes (see RLS policy) —
// these are what staff hit day-to-day (ticking tasks, clocking in/out), no login needed.
export async function writeCloud(path: 'records' | 'attendance', value: unknown): Promise<boolean> {
  try {
    const { error } = await supabase
      .from(TABLE)
      .upsert({ key: path, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    return !error;
  } catch {
    return false;
  }
}

// ---------- offline queue ----------
// When a write fails (offline, flaky network) it lands here and is retried
// automatically when connectivity returns. Last value per path wins.
// Admin-gated paths (checklists/users/auditLogs) are queued too; they only
// flush while an admin session is active (see flushQueue's adminCode param).
const QUEUE_KEY = 'daily_check_sync_queue';

type QueueItem = { path: CloudPath; value: unknown };

function readQueue(): QueueItem[] {
  try {
    const raw = window.localStorage.getItem(QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function enqueueWrite(path: CloudPath, value: unknown) {
  const q = readQueue().filter(item => item.path !== path);
  q.push({ path, value });
  try { window.localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch { /* storage full */ }
}

export function queuedCount(): number {
  return readQueue().length;
}

export async function flushQueue(adminCode?: string): Promise<number> {
  const q = readQueue();
  if (!q.length || !(await probeCloudOnce())) return 0;
  let flushed = 0;
  let networkDown = false;
  const remaining: QueueItem[] = [];
  // Staff writes flush first — a rejected admin code must never block them.
  const ordered = [
    ...q.filter(item => item.path === 'records' || item.path === 'attendance'),
    ...q.filter(item => item.path !== 'records' && item.path !== 'attendance'),
  ];
  for (const item of ordered) {
    if (networkDown) { remaining.push(item); continue; }
    let ok = false;
    if (item.path === 'records' || item.path === 'attendance') {
      ok = await writeCloud(item.path, item.value);
      if (!ok) networkDown = true;
    } else if (adminCode) {
      const res = await adminWrite(adminCode, item.path, item.value);
      if (res === 'ok') ok = true;
      else if (res === 'offline') networkDown = true;
      // 'wrong' → stays queued; it may flush after a fresh admin unlock
    }
    if (ok) flushed += 1;
    else remaining.push(item);
  }
  try {
    if (remaining.length) window.localStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
    else window.localStorage.removeItem(QUEUE_KEY);
  } catch { /* ignore */ }
  return flushed;
}

async function probeCloudOnce(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?select=key&limit=1`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
      signal: controller.signal,
    });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

// ---------- admin code (server-verified, offline-tolerant) ----------
// The real check always runs server-side via Postgres functions. But when the
// device is offline the RPC simply can't be reached — that used to surface as
// "wrong code". Now: (1) results are tri-state so the UI can tell "wrong code"
// apart from "no connection", and (2) after a successful online verification we
// remember a SHA-256 hash of the code on this device, enough to re-unlock
// offline without ever storing the code itself.
export type AdminCodeResult = 'ok' | 'wrong' | 'offline';

const ADMIN_HASH_KEY = 'daily_check_admin_code_hash';

function isNetworkError(err: unknown): boolean {
  if (!err) return false;
  const e = err as { message?: string; cause?: { name?: string; message?: string } };
  const msg = `${e.message ?? ''} ${e.cause?.name ?? ''} ${e.cause?.message ?? ''}`.toLowerCase();
  return msg.includes('fetch') || msg.includes('network') || msg.includes('failed')
    || msg.includes('timeout') || msg.includes('aborted') || msg.includes('load failed');
}

async function sha256Hex(text: string): Promise<string | null> {
  try {
    if (!('subtle' in crypto)) return null;
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
  } catch { return null; }
}

// Called after every successful ONLINE verification (and after a code change)
// so the same code keeps working on this device while offline.
export async function rememberAdminCode(code: string): Promise<void> {
  const hash = await sha256Hex(code);
  if (hash) { try { window.localStorage.setItem(ADMIN_HASH_KEY, hash); } catch { /* storage full */ } }
}

// Offline fallback: compare against the locally cached hash. Only codes that
// were verified online on this device before will match.
export async function verifyAdminCodeCached(code: string): Promise<boolean> {
  try {
    const stored = window.localStorage.getItem(ADMIN_HASH_KEY);
    if (!stored) return false;
    const hash = await sha256Hex(code);
    return Boolean(hash) && hash === stored;
  } catch { return false; }
}

// Admin-gated write: the Postgres function re-checks the code server-side
// before touching checklists/users/auditLogs. The code never gets stored or synced anywhere.
export async function adminWrite(code: string, path: 'checklists' | 'users' | 'auditLogs', value: unknown): Promise<AdminCodeResult> {
  if (!navigator.onLine) return 'offline';
  try {
    const { data, error } = await supabase.rpc('admin_write', { p_code: code, p_key: path, p_value: value });
    if (error) return isNetworkError(error) ? 'offline' : 'wrong';
    return data ? 'ok' : 'wrong';
  } catch (err) {
    return isNetworkError(err) ? 'offline' : 'wrong';
  }
}

// Verify a code without ever fetching the stored hash/value to the client.
export async function verifyAdminCode(code: string): Promise<AdminCodeResult> {
  if (!navigator.onLine) return 'offline';
  try {
    const { data, error } = await supabase.rpc('verify_admin_code', { code });
    if (error) return isNetworkError(error) ? 'offline' : 'wrong';
    return data ? 'ok' : 'wrong';
  } catch (err) {
    return isNetworkError(err) ? 'offline' : 'wrong';
  }
}

export async function changeAdminCode(oldCode: string, newCode: string): Promise<AdminCodeResult> {
  if (!navigator.onLine) return 'offline';
  try {
    const { data, error } = await supabase.rpc('change_admin_code', { old_code: oldCode, new_code: newCode });
    if (error) return isNetworkError(error) ? 'offline' : 'wrong';
    return data ? 'ok' : 'wrong';
  } catch (err) {
    return isNetworkError(err) ? 'offline' : 'wrong';
  }
}

export function subscribeCloud(cb: (data: CloudData) => void): () => void {
  let stop = false;
  let fetchTimer = 0;
  let realtimeUp = false;

  const fetch = async () => {
    if (stop) return;
    const data = await readAll();
    if (!stop && data) cb(data);
  };

  // Coalesce bursts of changes into a single refetch.
  const scheduleFetch = () => {
    window.clearTimeout(fetchTimer);
    fetchTimer = window.setTimeout(fetch, 250);
  };

  // Safety net: slow poll catches anything realtime drops
  // (e.g. table not yet in the supabase_realtime publication).
  const poll = () => {
    if (realtimeUp) return;
    void fetch();
  };
  void fetch();
  const pollId = window.setInterval(poll, 30000);

  const channel = supabase
    .channel('daily_check_kv_changes')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: TABLE },
      scheduleFetch,
    )
    .subscribe(status => {
      realtimeUp = status === 'SUBSCRIBED';
    });

  return () => {
    stop = true;
    window.clearTimeout(fetchTimer);
    window.clearInterval(pollId);
    void supabase.removeChannel(channel);
  };
}

export const SETUP_SQL = `-- see secure_daily_check.sql for the full, current migration
-- enable instant sync (required for realtime updates):
ALTER PUBLICATION supabase_realtime ADD TABLE public.daily_check_kv;`;
