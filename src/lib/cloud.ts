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
const QUEUE_KEY = 'daily_check_sync_queue';

type QueueItem = { path: 'records' | 'attendance'; value: unknown };

function readQueue(): QueueItem[] {
  try {
    const raw = window.localStorage.getItem(QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function enqueueWrite(path: 'records' | 'attendance', value: unknown) {
  const q = readQueue().filter(item => item.path !== path);
  q.push({ path, value });
  try { window.localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch { /* storage full */ }
}

export function queuedCount(): number {
  return readQueue().length;
}

export async function flushQueue(): Promise<number> {
  const q = readQueue();
  if (!q.length || !(await probeCloudOnce())) return 0;
  let flushed = 0;
  const remaining = [...q];
  for (const item of q) {
    const ok = await writeCloud(item.path, item.value);
    if (!ok) break;
    flushed += 1;
    remaining.shift();
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

// Admin-gated write: the Postgres function re-checks the code server-side
// before touching checklists/users/auditLogs. The code never gets stored or synced anywhere.
export async function adminWrite(code: string, path: 'checklists' | 'users' | 'auditLogs', value: unknown): Promise<boolean> {
  const { data, error } = await supabase.rpc('admin_write', { p_code: code, p_key: path, p_value: value });
  if (error) return false;
  return Boolean(data);
}

// Verify a code without ever fetching the stored hash/value to the client.
export async function verifyAdminCode(code: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('verify_admin_code', { code });
  if (error) return false;
  return Boolean(data);
}

export async function changeAdminCode(oldCode: string, newCode: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('change_admin_code', { old_code: oldCode, new_code: newCode });
  if (error) return false;
  return Boolean(data);
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
