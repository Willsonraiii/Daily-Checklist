import { supabase } from '../supabaseClient';

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
export function writeCloud(path: 'records' | 'attendance', value: unknown) {
  void supabase
    .from(TABLE)
    .upsert({ key: path, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
    .then(() => undefined);
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
  const tick = async () => {
    if (stop) return;
    const data = await readAll();
    if (!stop && data) cb(data);
  };
  void tick();
  const id = window.setInterval(tick, 4000);
  return () => {
    stop = true;
    window.clearInterval(id);
  };
}

export const SETUP_SQL = `-- see secure_daily_check.sql for the full, current migration`;
