import { supabase } from '../supabaseClient';

export type CloudPath = 'records' | 'checklists' | 'users' | 'adminCode';
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
  const out: CloudData = { records: null, checklists: null, users: null, adminCode: null };
  for (const row of data as { key: string; value: unknown }[]) {
    if (row.key in out) (out as Record<string, unknown>)[row.key] = row.value;
  }
  return out;
}

export function writeCloud(path: CloudPath, value: unknown) {
  void supabase
    .from(TABLE)
    .upsert({ key: path, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
    .then(() => undefined);
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

export const SETUP_SQL = `-- Run once in Supabase: SQL Editor → New query → paste → Run
create table if not exists public.daily_check_kv (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.daily_check_kv enable row level security;

create policy "team read"   on public.daily_check_kv for select using (true);
create policy "team insert" on public.daily_check_kv for insert with check (true);
create policy "team update" on public.daily_check_kv for update using (true) with check (true);
create policy "team delete" on public.daily_check_kv for delete using (true);`;
