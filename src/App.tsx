import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight, CalendarDays, Check, ChevronLeft, ChevronRight, ClipboardList,
  Clock3, Cloud, CloudOff, Copy, Database, Download, FileDown, History, KeyRound,
  Lock, Moon, PencilLine, Plus, RefreshCw, Settings, ShieldCheck, Sun, Trash2,
  Unlock, User, UserPlus, Wifi, X,
} from 'lucide-react';
import {
  probeCloud, SETUP_SQL, subscribeCloud, writeCloud, type CloudPath, type CloudStatus,
} from './lib/cloud';

const DEFAULT_CHECKLISTS = {
  opening: [
    { id: 'open-1', label: 'Unlock and disarm alarm', detail: 'Front and back doors, then disarm the system.' },
    { id: 'open-2', label: 'Turn on lights', detail: 'All zones, window display, signage.' },
    { id: 'open-3', label: 'Power on primary equipment', detail: 'Boot sequence, purge, confirm readiness.' },
    { id: 'open-4', label: 'Check perishable stock', detail: 'Verify counts and flag anything short.' },
    { id: 'open-5', label: 'Prepare display case', detail: 'Rotate, label, set tools in place.' },
    { id: 'open-6', label: 'Set up point of sale', detail: 'Float, tablet, reader, and receipts.' },
    { id: 'open-7', label: 'Wipe tables and seating', detail: 'Indoor sets plus outdoor area.' },
    { id: 'open-8', label: 'Restock consumables', detail: 'Cups, lids, sleeves, napkins, straws.' },
    { id: 'open-9', label: 'Check restroom supplies', detail: 'Soap, paper, liner, quick sink wipe.' },
    { id: 'open-10', label: 'Start ambience and signage', detail: 'Playlist on, open sign out, board updated.' },
  ],
  closing: [
    { id: 'close-1', label: 'Wipe down primary equipment', detail: 'All contact surfaces, trays, exterior.' },
    { id: 'close-2', label: 'Run cleaning cycles', detail: 'Full detergent cycle, then clean rinse.' },
    { id: 'close-3', label: 'Clean and reset tools', detail: 'Purge, brush, lock dials for tomorrow.' },
    { id: 'close-4', label: 'Sanitize counters and tables', detail: 'Every surface customers touched.' },
    { id: 'close-5', label: 'Sweep and mop floors', detail: 'Work area first, then public floor.' },
    { id: 'close-6', label: 'Empty all bins', detail: 'Replace liners in every station.' },
    { id: 'close-7', label: 'Prep restock list', detail: 'Note everything needed for tomorrow.' },
    { id: 'close-8', label: 'Count register and cash', detail: 'Drop, report, secure in safe.' },
    { id: 'close-9', label: 'Power down equipment', detail: 'Everything except essential overnight.' },
    { id: 'close-10', label: 'Lock up and set alarm', detail: 'Back door first, then front, arm system.' },
  ],
} as const;

const DEFAULT_CODE = 'DAILY-ADMIN';
const DEFAULT_USERS: TeamUser[] = ['Avery', 'Jordan', 'Sam', 'Casey', 'Riley', 'Milo'].map((name, i) => ({ id: `u-${i + 1}`, name, added: new Date().toISOString() }));

const RECORDS_KEY = 'bloom_cafe_checklists_v3';
const CHECKLISTS_KEY = 'bloom_cafe_checklist_content_v1';
const USERS_KEY = 'daily_check_users_v1';
const CODE_KEY = 'daily_check_admin_code_v1';

const AVATAR_COLORS = ['#0b7fc4', '#e07a1f', '#0f9d6e', '#7c5cd6', '#d64550', '#0e9aa7', '#c2571b', '#4f63d2'];
function colorFor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

type Shift = 'opening' | 'closing';
type View = 'home' | Shift | 'history' | 'admin';
type AdminPane = 'studio' | 'journal' | 'export' | 'settings';
type TaskDef = { id: string; label: string; detail: string };
type ChecklistConfig = Record<Shift, TaskDef[]>;
type TaskLog = { done: boolean; staff: string; ts: string };
type DayRecord = { date: string; opening: Record<string, TaskLog>; closing: Record<string, TaskLog> };
type Records = Record<string, DayRecord>;
type TeamUser = { id: string; name: string; added: string };

function formatKey(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function parseKey(k: string) { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); }
function isWithinHistory(k: string) { const t = new Date(); t.setHours(0, 0, 0, 0); const days = Math.floor((t.getTime() - parseKey(k).getTime()) / 86400000); return days >= 0 && days < 14; }
function emptyDay(date: string): DayRecord { return { date, opening: {}, closing: {} }; }
function prettyTime(iso: string) { return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
function asUsers(v: unknown): TeamUser[] | null {
  if (!Array.isArray(v)) return null;
  const ok = v.filter((u): u is TeamUser => Boolean(u && typeof (u as TeamUser).id === 'string' && typeof (u as TeamUser).name === 'string' && (u as TeamUser).name.trim().length > 0));
  return ok.length ? ok : null;
}

async function sharedGet(key: string): Promise<unknown> {
  // @ts-expect-error shared artifact storage injected by host
  if (typeof window !== 'undefined' && window.storage?.get) {
    try { // @ts-expect-error shared artifact storage injected by host
      return (await window.storage.get(key, { shared: true })) ?? null;
    } catch { /* preview fallback */ }
  }
  try { const r = window.localStorage.getItem(key); return r ? JSON.parse(r) : null; } catch { return null; }
}
async function sharedSet(key: string, value: unknown) {
  // @ts-expect-error shared artifact storage injected by host
  if (typeof window !== 'undefined' && window.storage?.set) {
    try { // @ts-expect-error shared artifact storage injected by host
      await window.storage.set(key, value, { shared: true }); return;
    } catch { /* preview fallback */ }
  }
  window.localStorage.setItem(key, JSON.stringify(value));
}
function asChecklistConfig(v: unknown): ChecklistConfig | null {
  if (!v || typeof v !== 'object') return null;
  const c = v as Partial<ChecklistConfig>;
  if (!Array.isArray(c.opening) || !Array.isArray(c.closing)) return null;
  const ok = (t: unknown[]) => t.filter((x): x is TaskDef => Boolean(x && typeof (x as TaskDef).id === 'string' && typeof (x as TaskDef).label === 'string' && typeof (x as TaskDef).detail === 'string'));
  return { opening: ok(c.opening), closing: ok(c.closing) };
}

const TAGLINES = ['Open strong.', 'Close clean.', 'Sign every step.'];

export default function App() {
  const [records, setRecords] = useState<Records>(() => {
    try {
      const raw = window.localStorage.getItem(RECORDS_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as Records;
      const safe: Records = {};
      Object.entries(parsed).forEach(([d, r]) => { if (isWithinHistory(d)) safe[d] = r; });
      return safe;
    } catch { return {}; }
  });

  const [checklists, setChecklists] = useState<ChecklistConfig>(() => {
    try {
      const raw = window.localStorage.getItem(CHECKLISTS_KEY);
      const cfg = asChecklistConfig(raw ? JSON.parse(raw) : null);
      return cfg || { opening: [...DEFAULT_CHECKLISTS.opening], closing: [...DEFAULT_CHECKLISTS.closing] };
    } catch { return { opening: [...DEFAULT_CHECKLISTS.opening], closing: [...DEFAULT_CHECKLISTS.closing] }; }
  });

  const [users, setUsers] = useState<TeamUser[]>(() => {
    try {
      const raw = window.localStorage.getItem(USERS_KEY);
      const u = asUsers(raw ? JSON.parse(raw) : null);
      return u || DEFAULT_USERS;
    } catch { return DEFAULT_USERS; }
  });

  const [adminCode, setAdminCode] = useState(() => {
    try { return window.localStorage.getItem(CODE_KEY) || DEFAULT_CODE; } catch { return DEFAULT_CODE; }
  });

  const [view, setView] = useState<View>('home');
  const [staffName, setStaffName] = useState(() => window.localStorage.getItem('daily_current_staff') || '');
  const [nameOpen, setNameOpen] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [tagIndex, setTagIndex] = useState(0);
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [showGate, setShowGate] = useState(false);
  const [gateCode, setGateCode] = useState('');
  const [gateError, setGateError] = useState('');
  const [adminPane, setAdminPane] = useState<AdminPane>('studio');
  const [editorShift, setEditorShift] = useState<Shift>('opening');
  const [selectedDate, setSelectedDate] = useState(formatKey(new Date()));
  const [exportFrom, setExportFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 13); return formatKey(d); });
  const [exportTo, setExportTo] = useState(() => formatKey(new Date()));
  const [newUserName, setNewUserName] = useState('');
  const [newCode, setNewCode] = useState('');
  const [confirmCode, setConfirmCode] = useState('');
  const [codeMsg, setCodeMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [cloudStatus, setCloudStatus] = useState<'checking' | 'off' | CloudStatus>('checking');
  const [toast, setToast] = useState('');
  const [justChecked, setJustChecked] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const saveTimer = useRef<number | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const cloudUnsub = useRef<() => void>(() => undefined);
  const migratedRef = useRef(false);

  const todayKey = formatKey(new Date());
  const todayRecord = records[todayKey] || emptyDay(todayKey);
  const selectedRecord = records[selectedDate] || emptyDay(selectedDate);
  const onRoster = (name: string) => users.some(u => u.name.toLowerCase() === name.trim().toLowerCase());
  const cloudOn = cloudStatus === 'connected';

  const CLOUD_PATHS: Record<string, CloudPath> = { [RECORDS_KEY]: 'records', [CHECKLISTS_KEY]: 'checklists', [USERS_KEY]: 'users', [CODE_KEY]: 'adminCode' };
  const save = (key: string, value: unknown) => { void sharedSet(key, value); if (cloudOn) writeCloud(CLOUD_PATHS[key], value); };
  const persist = (next: Records) => { setRecords(next); if (saveTimer.current) window.clearTimeout(saveTimer.current); saveTimer.current = window.setTimeout(() => save(RECORDS_KEY, next), 250); };
  const persistUsers = (next: TeamUser[]) => { setUsers(next); save(USERS_KEY, next); };

  const attachCloud = () => {
    cloudUnsub.current();
    migratedRef.current = false;
    cloudUnsub.current = subscribeCloud(data => {
      const seed = (key: string, cloudVal: unknown) => {
        if (cloudVal == null && !migratedRef.current) {
          try { const raw = window.localStorage.getItem(key); if (raw) writeCloud(CLOUD_PATHS[key], JSON.parse(raw)); } catch { /* ignore */ }
        }
      };
      if (data.records && typeof data.records === 'object') {
        const pruned: Records = {};
        Object.entries(data.records as Records).forEach(([d, r]) => { if (isWithinHistory(d)) pruned[d] = r; });
        window.localStorage.setItem(RECORDS_KEY, JSON.stringify(pruned));
        setRecords(cur => (JSON.stringify(cur) === JSON.stringify(pruned) ? cur : pruned));
      } else seed(RECORDS_KEY, data.records);
      const cfg = asChecklistConfig(data.checklists);
      if (cfg) { window.localStorage.setItem(CHECKLISTS_KEY, JSON.stringify(cfg)); setChecklists(cur => (JSON.stringify(cur) === JSON.stringify(cfg) ? cur : cfg)); }
      else seed(CHECKLISTS_KEY, data.checklists);
      const us = asUsers(data.users);
      if (us) { window.localStorage.setItem(USERS_KEY, JSON.stringify(us)); setUsers(cur => (JSON.stringify(cur) === JSON.stringify(us) ? cur : us)); }
      else seed(USERS_KEY, data.users);
      if (typeof data.adminCode === 'string' && data.adminCode.trim()) setAdminCode(data.adminCode.trim());
      else seed(CODE_KEY, data.adminCode);
      migratedRef.current = true;
    });
  };

  useEffect(() => {
    const load = async () => {
      const [recs, cfg, storedUsers, storedCode] = await Promise.all([
        sharedGet(RECORDS_KEY), sharedGet(CHECKLISTS_KEY), sharedGet(USERS_KEY), sharedGet(CODE_KEY),
      ]);
      if (recs && typeof recs === 'object') {
        const safe: Records = {};
        Object.entries(recs as Records).forEach(([d, r]) => { if (isWithinHistory(d)) safe[d] = r; });
        setRecords(safe);
        if (Object.keys(safe).length !== Object.keys(recs as Records).length) await sharedSet(RECORDS_KEY, safe);
      }
      const config = asChecklistConfig(cfg);
      if (config) setChecklists(config);
      const u = asUsers(storedUsers);
      if (u) setUsers(u);
      else await sharedSet(USERS_KEY, DEFAULT_USERS);
      if (typeof storedCode === 'string' && storedCode.trim()) setAdminCode(storedCode.trim());
      const saved = window.localStorage.getItem('daily_current_staff');
      if (saved) setStaffName(saved);

      const status = await probeCloud();
      if (status === 'connected') { setCloudStatus('connected'); attachCloud(); }
      else setCloudStatus(status);
      setLoading(false);
    };
    void load();
    const tick = window.setInterval(async () => {
      const [nr, nc, nu, ncode] = await Promise.all([
        sharedGet(RECORDS_KEY), sharedGet(CHECKLISTS_KEY), sharedGet(USERS_KEY), sharedGet(CODE_KEY),
      ]);
      if (nr && typeof nr === 'object') {
        const pruned: Records = {};
        Object.entries(nr as Records).forEach(([d, r]) => { if (isWithinHistory(d)) pruned[d] = r; });
        setRecords(cur => JSON.stringify(cur) === JSON.stringify(pruned) ? cur : pruned);
      }
      const config = asChecklistConfig(nc);
      if (config) setChecklists(cur => JSON.stringify(cur) === JSON.stringify(config) ? cur : config);
      const u = asUsers(nu);
      if (u) setUsers(cur => JSON.stringify(cur) === JSON.stringify(u) ? cur : u);
      if (typeof ncode === 'string' && ncode.trim()) setAdminCode(c => (c === ncode.trim() ? c : ncode.trim()));
    }, 4000);
    return () => { window.clearInterval(tick); cloudUnsub.current(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (staffName.trim()) window.localStorage.setItem('daily_current_staff', staffName.trim()); }, [staffName]);

  const dates = useMemo(() => Array.from({ length: 14 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - i); return formatKey(d); }), []);
  const progress = (rec: DayRecord, s: Shift) => {
    const total = checklists[s].length;
    const done = Object.values(rec[s]).filter(l => l.done).length;
    return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
  };
  const openP = progress(todayRecord, 'opening');
  const closeP = progress(todayRecord, 'closing');
  const lookup = useMemo(() => { const m = new Map<string, TaskDef>(); [...checklists.opening, ...checklists.closing].forEach(t => m.set(t.id, t)); return m; }, [checklists]);
  const activityFor = (rec: DayRecord) => {
    const ev: { shift: Shift; task: TaskDef; log: TaskLog }[] = [];
    (['opening', 'closing'] as Shift[]).forEach(s => Object.entries(rec[s]).forEach(([id, log]) => { const t = lookup.get(id); if (t && log.done) ev.push({ shift: s, task: t, log }); }));
    return ev.sort((a, b) => new Date(b.log.ts).getTime() - new Date(a.log.ts).getTime());
  };
  const todayActivity = useMemo(() => activityFor(todayRecord), [todayRecord, lookup]);
  const selectedActivity = useMemo(() => activityFor(selectedRecord), [selectedRecord, lookup]);

  const showToast = (m: string) => { setToast(m); window.setTimeout(() => setToast(''), 2600); };

  const retryCloud = async () => {
    setCloudStatus('checking');
    const status = await probeCloud();
    if (status === 'connected') { setCloudStatus('connected'); attachCloud(); showToast('Cloud sync connected.'); }
    else { setCloudStatus(status); if (status === 'needs-setup') showToast('Table not found — run the SQL once in Supabase.'); }
  };
  const goLocal = () => {
    cloudUnsub.current();
    setCloudStatus('off');
    showToast('Cloud sync off — using this device only.');
  };
  const copySql = async () => {
    try { await navigator.clipboard.writeText(SETUP_SQL); showToast('SQL copied — paste it in the Supabase SQL Editor.'); }
    catch { showToast('Copy failed — select the SQL manually.'); }
  };

  const requireName = () => {
    const name = staffName.trim();
    if (!name) { showToast('Sign in first — pick your name.'); setNameOpen(true); nameRef.current?.focus(); return false; }
    if (users.length && !onRoster(name)) { showToast('Not on the team roster — ask an admin to add you.'); setNameOpen(true); return false; }
    return true;
  };
  const toggleTask = (shift: Shift, taskId: string) => {
    if (!requireName()) return;
    const rec = records[todayKey] || emptyDay(todayKey);
    const logs = { ...rec[shift] };
    if (logs[taskId]?.done) { delete logs[taskId]; showToast('Returned to the list.'); }
    else {
      logs[taskId] = { done: true, staff: staffName.trim(), ts: new Date().toISOString() };
      setJustChecked(taskId); window.setTimeout(() => setJustChecked(null), 600);
      if (navigator.vibrate) navigator.vibrate(12);
    }
    const next: Records = { ...records, [todayKey]: { ...rec, [shift]: logs } };
    const pruned: Records = {}; Object.entries(next).forEach(([d, v]) => { if (isWithinHistory(d)) pruned[d] = v; });
    persist(pruned);
  };

  const tryAdmin = () => { if (adminUnlocked) setView('admin'); else setShowGate(true); };
  const unlock = () => {
    if (gateCode === adminCode) { setAdminUnlocked(true); setShowGate(false); setGateCode(''); setGateError(''); setView('admin'); showToast('Admin unlocked for this session.'); }
    else setGateError('Wrong code. Ask the owner for access.');
  };

  const updateTask = (s: Shift, id: string, f: 'label' | 'detail', v: string) => {
    if (!adminUnlocked) return;
    setChecklists(cur => { const next = { ...cur, [s]: cur[s].map(t => t.id === id ? { ...t, [f]: v } : t) }; save(CHECKLISTS_KEY, next); return next; });
  };
  const addTask = (s: Shift) => {
    if (!adminUnlocked) return;
    const t: TaskDef = { id: `${s}-${Date.now()}`, label: 'New task', detail: 'Describe the standard.' };
    setChecklists(cur => { const next = { ...cur, [s]: [...cur[s], t] }; save(CHECKLISTS_KEY, next); return next; });
    showToast('Task added.');
  };
  const removeTask = (s: Shift, id: string) => {
    if (!adminUnlocked || !window.confirm('Remove this task from the shared list?')) return;
    setChecklists(cur => { const next = { ...cur, [s]: cur[s].filter(t => t.id !== id) }; save(CHECKLISTS_KEY, next); return next; });
    showToast('Task removed.');
  };

  const addUser = () => {
    const name = newUserName.trim();
    if (!name) return;
    if (onRoster(name)) { showToast('That name is already on the roster.'); return; }
    persistUsers([...users, { id: `u-${Date.now()}`, name, added: new Date().toISOString() }]);
    setNewUserName('');
    showToast(`${name} added to the team.`);
  };
  const renameUser = (id: string, name: string) => {
    const clean = name.trim();
    if (!clean) return;
    if (users.some(u => u.id !== id && u.name.toLowerCase() === clean.toLowerCase())) { showToast('Another user already has that name.'); return; }
    persistUsers(users.map(u => u.id === id ? { ...u, name: clean } : u));
  };
  const removeUser = (id: string) => {
    const target = users.find(u => u.id === id);
    if (!target || !window.confirm(`Remove ${target.name} from the team roster?`)) return;
    const next = users.filter(u => u.id !== id);
    persistUsers(next);
    if (staffName.trim().toLowerCase() === target.name.toLowerCase()) { setStaffName(''); showToast('You were removed from the roster — signed out.'); }
    else showToast(`${target.name} removed.`);
  };

  const changeCode = () => {
    const next = newCode.trim();
    if (next.length < 4) { setCodeMsg({ ok: false, text: 'Use at least 4 characters.' }); return; }
    if (next !== confirmCode.trim()) { setCodeMsg({ ok: false, text: 'The two codes do not match.' }); return; }
    setAdminCode(next);
    save(CODE_KEY, next);
    setNewCode(''); setConfirmCode('');
    setCodeMsg({ ok: true, text: 'Admin code updated everywhere.' });
    showToast('Admin code updated.');
  };

  const clearAllRecords = () => {
    if (!adminUnlocked) return;
    if (!window.confirm('Are you sure you want to delete all historical logs and records? This cannot be undone.')) return;
    persist({});
    showToast('All past records deleted.');
  };

  const exportCsv = () => {
    const from = parseKey(exportFrom); const to = parseKey(exportTo);
    if (from > to) { showToast('Pick a valid date range.'); return; }
    const rows = [['Date', 'Shift', 'Task', 'Detail', 'Completed', 'Staff', 'Timestamp', 'Local time']];
    Object.keys(records).sort().forEach(date => {
      const day = parseKey(date); if (day < from || day > to) return;
      const rec = records[date];
      (['opening', 'closing'] as Shift[]).forEach(s => checklists[s].forEach(t => {
        const log = rec[s][t.id];
        rows.push([date, s === 'opening' ? 'Opening' : 'Closing', t.label, t.detail, log?.done ? 'Yes' : 'No', log?.staff ?? '', log?.ts ?? '', log?.ts ? new Date(log.ts).toLocaleString() : '']);
      }));
    });
    const csv = rows.map(r => r.map(v => `"${v.replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `daily-check_${exportFrom}_to_${exportTo}.csv`; a.click();
    URL.revokeObjectURL(url); showToast('CSV download started.');
  };

  if (loading) {
    return (
      <div className="stage min-h-screen grid place-items-center">
        <div className="orb orb-1" /><div className="orb orb-2" />
        <div className="text-center view-enter">
          <div className="mx-auto w-11 h-11 rounded-full border-[3px] border-white/30 border-t-white animate-spin" />
          <p className="mt-5 text-[12px] font-bold uppercase tracking-[0.24em] text-white/80">loading daily check</p>
        </div>
      </div>
    );
  }

  const Ring = ({ pct, size = 64 }: { pct: number; size?: number }) => {
    const r = (size - 8) / 2; const c = 2 * Math.PI * r;
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
        <circle className="ring-track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="5" />
        <circle className="ring-fill" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="5" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c - (c * pct) / 100} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        <text x="50%" y="52%" dominantBaseline="middle" textAnchor="middle" fill="#fff" fontSize={size / 4.4} fontWeight="800" fontFamily="Manrope">{pct}%</text>
      </svg>
    );
  };

  const Avatar = ({ name, size = 32 }: { name: string; size?: number }) => (
    <span className="rounded-full grid place-items-center font-extrabold text-white shrink-0" style={{ width: size, height: size, background: colorFor(name), fontSize: size * 0.38 }}>
      {name.slice(0, 2).toUpperCase()}
    </span>
  );

  const TaskRows = ({ shift }: { shift: Shift }) => (
    <div className="glass rounded-[26px] p-3 sm:p-4">
      {checklists[shift].map((task, i) => {
        const log = todayRecord[shift][task.id];
        const done = Boolean(log?.done);
        return (
          <button key={task.id} onClick={() => toggleTask(shift, task.id)} style={{ animationDelay: `${i * 30}ms` }} className={`task-row stagger ${done ? 'done' : ''}`}>
            <span className="pt-1.5 text-[12px] font-extrabold text-white/50">{String(i + 1).padStart(2, '0')}</span>
            <span className={`task-box ${done ? 'on' : ''} ${justChecked === task.id ? 'check-pop' : ''}`}><Check width={15} height={15} strokeWidth={3.5} /></span>
            <span className="min-w-0">
              <span className={`block text-[16px] font-extrabold leading-tight ${done ? 'task-label-done' : ''}`}>{task.label}</span>
              <span className="block text-[12.5px] font-medium text-white/65 mt-0.5 leading-snug">{task.detail}</span>
              {log && <span className="sign-stamp inline-flex items-center gap-1.5 mt-2 text-[11px] font-bold"><span className="w-1.5 h-1.5 rounded-full bg-white pulse-soft" /> {log.staff} · {prettyTime(log.ts)}</span>}
            </span>
            <ChevronRight className={`mt-2.5 ${done ? 'text-white' : 'text-white/40'}`} width={17} height={17} />
          </button>
        );
      })}
    </div>
  );

  const LogList = ({ events, limit }: { events: { shift: Shift; task: TaskDef; log: TaskLog }[]; limit?: number }) =>
    events.length === 0 ? (
      <div className="glass-soft rounded-[20px] px-5 py-8 text-center">
        <Clock3 className="mx-auto text-white/60" width={22} height={22} />
        <p className="mt-3 text-[12px] font-bold uppercase tracking-[0.16em] text-white/70">nothing signed yet</p>
      </div>
    ) : (
      <div className="glass-soft rounded-[20px] p-2">
        {(limit ? events.slice(0, limit) : events).map((e, i) => (
          <div key={`${e.task.id}-${e.log.ts}-${i}`} className="flex items-center gap-3 px-4 py-3 rounded-[14px] hover:bg-white/10 transition-colors">
            <span className="w-8 h-8 rounded-full bg-white/20 grid place-items-center shrink-0">{e.shift === 'opening' ? <Sun width={14} height={14} /> : <Moon width={14} height={14} />}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-extrabold leading-tight truncate">{e.task.label}</span>
              <span className="block text-[11px] font-semibold text-white/65 mt-0.5">{e.log.staff} · {e.shift}</span>
            </span>
            <time className="text-[11px] font-bold text-white/75 shrink-0">{prettyTime(e.log.ts)}</time>
          </div>
        ))}
      </div>
    );

  const HomeView = () => (
    <div className="view-enter">
      <div className="relative pt-10 lg:pt-16 pb-8">
        <div className="grid grid-cols-12 gap-8 items-center">
          <div className="col-span-12 lg:col-span-8 relative z-10">
            <h1 className="font-display uppercase leading-[0.88] tracking-[-0.01em] text-white select-none">
              <span className="block text-[17vw] lg:text-[120px] xl:text-[148px]">Daily</span>
              <span className="block text-[17vw] lg:text-[120px] xl:text-[148px] -mt-1 lg:-mt-3">Check<span className="text-white/40">.</span></span>
            </h1>
            <div className="mt-8 flex flex-wrap items-end gap-x-10 gap-y-6">
              <div>
                <div className="flex items-center gap-4">
                  <button aria-label="Previous tagline" onClick={() => setTagIndex(i => (i + TAGLINES.length - 1) % TAGLINES.length)} className="w-9 h-9 rounded-full border border-white/60 grid place-items-center hover:bg-white/15 transition-colors"><ChevronLeft width={16} height={16} /></button>
                  <span className="text-[13px] font-bold text-white/80 tabular-nums">0{tagIndex + 1}/0{TAGLINES.length}</span>
                  <button aria-label="Next tagline" onClick={() => setTagIndex(i => (i + 1) % TAGLINES.length)} className="w-9 h-9 rounded-full border border-white/60 grid place-items-center hover:bg-white/15 transition-colors"><ChevronRight width={16} height={16} /></button>
                </div>
                <p key={tagIndex} className="tag-swap mt-4 text-[26px] lg:text-[32px] font-extrabold tracking-tight">{TAGLINES[tagIndex]}</p>
                <p className="text-[14px] font-semibold text-white/75 mt-1 max-w-[420px]">The shared opening &amp; closing tracker for teams that finish what they start.</p>
                <div className="flex flex-wrap gap-3 mt-6">
                  <button onClick={() => setView('opening')} className="pill-solid">Explore <ArrowRight width={16} height={16} /></button>
                  <button onClick={() => setView('history')} className="pill">View history</button>
                </div>
              </div>
            </div>
          </div>
          <div className="col-span-12 lg:col-span-4 relative">
            <div className="float-slow glass-deep rounded-[28px] p-6 max-w-[320px] mx-auto lg:ml-auto">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-white/75">today's flow</p>
                <span className="w-2 h-2 rounded-full bg-white pulse-soft" />
              </div>
              {['Unlock and disarm', 'Power on equipment', 'Set up point of sale'].map((t, i) => (
                <div key={t} className="flex items-center gap-3 mt-5">
                  <span className={`w-7 h-7 rounded-[9px] grid place-items-center ${i < 2 ? 'bg-white text-[#1c6ba4]' : 'border-2 border-white/60'}`}>{i < 2 && <Check width={14} height={14} strokeWidth={3.5} />}</span>
                  <span className={`text-[14px] font-bold ${i < 2 ? 'line-through opacity-60' : ''}`}>{t}</span>
                </div>
              ))}
              <div className="mt-6 pt-5 border-t border-white/30 flex items-center justify-between">
                <span className="text-[12px] font-bold text-white/75">2 of 10 done</span>
                {Ring({ pct: 20, size: 44 })}
              </div>
            </div>
          </div>
        </div>

        <div className="grid sm:grid-cols-3 gap-4 mt-14">
          {([
            [cloudOn ? Wifi : CloudOff, 'Shared sync', cloudOn ? 'Live on every device, instantly' : 'This browser only — connect cloud in Admin'],
            [History, '14-day archive', 'Older days auto-prune themselves'],
            [Download, 'CSV export', 'Keep a permanent copy anytime'],
          ] as [typeof Wifi, string, string][]).map(([Ic, t, s], i) => (
            <div key={t} style={{ animationDelay: `${200 + i * 90}ms` }} className="stagger glass rounded-[20px] px-6 py-5 flex items-center gap-4 hover:bg-white/25 transition-colors">
              <span className="w-11 h-11 rounded-full bg-white/20 grid place-items-center shrink-0"><Ic width={19} height={19} /></span>
              <span><span className="block text-[15px] font-extrabold">{t}</span><span className="block text-[12px] font-semibold text-white/70 mt-0.5">{s}</span></span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-16 pb-6">
        <div className="flex items-end justify-between gap-4 mb-6">
          <h2 className="text-[26px] lg:text-[32px] font-extrabold tracking-tight">Today's board</h2>
          <span className="text-[12px] font-bold text-white/70">{new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</span>
        </div>
        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <button onClick={() => setView('opening')} className="glass rounded-[24px] p-6 text-left hover:bg-white/25 hover:-translate-y-1 transition-all">
            <div className="flex items-center justify-between"><Sun width={20} height={20} />{Ring({ pct: openP.pct, size: 56 })}</div>
            <p className="mt-5 text-[19px] font-extrabold">Opening</p>
            <p className="text-[12px] font-semibold text-white/70 mt-1">{openP.done} of {openP.total} signed off</p>
            <span className="inline-flex items-center gap-1.5 mt-4 text-[12px] font-extrabold uppercase tracking-[0.12em]">Open list <ArrowRight width={14} height={14} /></span>
          </button>
          <button onClick={() => setView('closing')} className="glass rounded-[24px] p-6 text-left hover:bg-white/25 hover:-translate-y-1 transition-all">
            <div className="flex items-center justify-between"><Moon width={20} height={20} />{Ring({ pct: closeP.pct, size: 56 })}</div>
            <p className="mt-5 text-[19px] font-extrabold">Closing</p>
            <p className="text-[12px] font-semibold text-white/70 mt-1">{closeP.done} of {closeP.total} signed off</p>
            <span className="inline-flex items-center gap-1.5 mt-4 text-[12px] font-extrabold uppercase tracking-[0.12em]">Open list <ArrowRight width={14} height={14} /></span>
          </button>
          <div className="glass rounded-[24px] p-6">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-white/75">Latest signature</p>
            {todayActivity[0] ? (
              <div className="mt-4">
                <p className="text-[17px] font-extrabold leading-tight">{todayActivity[0].task.label}</p>
                <p className="text-[12px] font-semibold text-white/70 mt-2">{todayActivity[0].log.staff} · {prettyTime(todayActivity[0].log.ts)}</p>
              </div>
            ) : (
              <p className="mt-4 text-[13px] font-semibold text-white/70 leading-relaxed">No signatures yet today. First check-in shows up here live.</p>
            )}
          </div>
          <button onClick={tryAdmin} className="glass rounded-[24px] p-6 text-left hover:bg-white/25 hover:-translate-y-1 transition-all">
            <span className="w-11 h-11 rounded-full bg-white/20 grid place-items-center">{adminUnlocked ? <Unlock width={18} height={18} /> : <Lock width={18} height={18} />}</span>
            <p className="mt-5 text-[19px] font-extrabold">Admin desk</p>
            <p className="text-[12px] font-semibold text-white/70 mt-1">{adminUnlocked ? 'Unlocked — lists, team & export' : 'Lists, team, code & export'}</p>
            <span className="inline-flex items-center gap-1.5 mt-4 text-[12px] font-extrabold uppercase tracking-[0.12em]">{adminUnlocked ? 'Enter' : 'Unlock'} <ArrowRight width={14} height={14} /></span>
          </button>
        </div>
      </div>
    </div>
  );

  const ShiftView = ({ shift }: { shift: Shift }) => {
    const p = progress(todayRecord, shift);
    return (
      <div className="view-enter pt-8 lg:pt-12">
        <div className="flex flex-wrap items-end justify-between gap-5 mb-8">
          <div>
            <p className="text-[12px] font-extrabold uppercase tracking-[0.22em] text-white/70">{shift === 'opening' ? '01 · morning' : '02 · evening'}</p>
            <h1 className="font-display uppercase text-[56px] lg:text-[84px] leading-[0.9] tracking-[-0.01em] mt-2">{shift}</h1>
          </div>
          <div className="flex items-center gap-5">
            <div className="text-right">
              <p className="text-[13px] font-bold text-white/75">{new Date().toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}</p>
              <p className="text-[12px] font-semibold text-white/60 mt-1">{staffName ? `signed in as ${staffName}` : 'not signed in'}</p>
            </div>
            {Ring({ pct: p.pct, size: 72 })}
          </div>
        </div>
        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-12 lg:col-span-8">
            {TaskRows({ shift })}
            <div className="flex items-center justify-between mt-5 px-1">
              <span className="text-[13px] font-bold text-white/80">{p.pct === 100 ? 'All done — great work.' : `${p.total - p.done} remaining`}</span>
              <button onClick={() => setView(shift === 'opening' ? 'closing' : 'opening')} className="pill text-[12px] !py-2.5 !px-5">
                {shift === 'opening' ? 'Go to closing' : 'Go to opening'} <ArrowRight width={14} height={14} />
              </button>
            </div>
          </div>
          <aside className="col-span-12 lg:col-span-4 space-y-5">
            <div className="glass rounded-[22px] p-5">
              <div className="flex items-center justify-between"><p className="text-[12px] font-extrabold uppercase tracking-[0.16em] text-white/75">Progress</p><span className="text-[22px] font-extrabold">{p.pct}%</span></div>
              <div className="h-2 rounded-full bg-white/25 mt-3 overflow-hidden"><div className="h-full bg-white rounded-full transition-all duration-500" style={{ width: `${p.pct}%` }} /></div>
              <p className="text-[12px] font-semibold text-white/65 mt-3">{p.done} of {p.total} tasks signed today</p>
            </div>
            <div>
              <p className="text-[12px] font-extrabold uppercase tracking-[0.16em] text-white/75 mb-3 px-1">Live log</p>
              {LogList({ events: todayActivity.filter(e => e.shift === shift), limit: 6 })}
            </div>
          </aside>
        </div>
      </div>
    );
  };

  const HistoryView = () => {
    const so = progress(selectedRecord, 'opening');
    const sc = progress(selectedRecord, 'closing');
    return (
      <div className="view-enter pt-8 lg:pt-12">
        <div className="flex flex-wrap items-end justify-between gap-5 mb-8">
          <div>
            <p className="text-[12px] font-extrabold uppercase tracking-[0.22em] text-white/70">03 · archive</p>
            <h1 className="font-display uppercase text-[56px] lg:text-[84px] leading-[0.9] tracking-[-0.01em] mt-2">History</h1>
          </div>
          <p className="text-[12px] font-bold text-white/70 max-w-[240px] text-right">Rolling 14-day window. Older days auto-clear — export to keep them.</p>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-3">
          {dates.map(d => {
            const r = records[d] || emptyDay(d);
            const o = progress(r, 'opening'); const c = progress(r, 'closing');
            const pct = Math.round(((o.done + c.done) / Math.max(o.total + c.total, 1)) * 100);
            const dt = parseKey(d);
            return (
              <button key={d} onClick={() => setSelectedDate(d)} className={`date-tile shrink-0 ${selectedDate === d ? 'active' : ''}`}>
                <span className="text-[9px] font-extrabold uppercase tracking-[0.12em]">{dt.toLocaleDateString([], { weekday: 'short' })}</span>
                <span className="text-[24px] font-extrabold leading-none">{dt.getDate()}</span>
                <span className="bar"><i style={{ width: `${pct}%` }} /></span>
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-12 gap-6 mt-8">
          <div className="col-span-12 lg:col-span-4 glass rounded-[24px] p-6">
            <p className="text-[13px] font-bold text-white/75">{parseKey(selectedDate).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</p>
            <div className="grid grid-cols-2 gap-5 mt-6">
              <div><p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-white/70">Opening</p><p className="text-[44px] font-extrabold leading-none mt-1">{so.done}<span className="text-[20px] text-white/60">/{so.total}</span></p></div>
              <div><p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-white/70">Closing</p><p className="text-[44px] font-extrabold leading-none mt-1">{sc.done}<span className="text-[20px] text-white/60">/{sc.total}</span></p></div>
            </div>
            {(() => {
              const pend = [
                ...checklists.opening.filter(t => !selectedRecord.opening[t.id]?.done).map(t => ({ s: 'open', t })),
                ...checklists.closing.filter(t => !selectedRecord.closing[t.id]?.done).map(t => ({ s: 'close', t })),
              ];
              if (!pend.length) return <p className="mt-7 text-[12px] font-extrabold uppercase tracking-[0.14em]">fully signed off</p>;
              return (
                <div className="mt-7">
                  <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-white/70">Still open</p>
                  <div className="flex flex-wrap gap-1.5 mt-3">{pend.map(({ s, t }) => <span key={t.id} className="text-[11px] font-bold bg-white/15 border border-white/30 rounded-full px-3 py-1">{s} · {t.label}</span>)}</div>
                </div>
              );
            })()}
          </div>
          <div className="col-span-12 lg:col-span-8">
            <p className="text-[12px] font-extrabold uppercase tracking-[0.16em] text-white/75 mb-3 px-1">Completion record · {selectedActivity.length}</p>
            {LogList({ events: selectedActivity })}
          </div>
        </div>
      </div>
    );
  };

  const AdminView = () => (
    <div className="view-enter pt-8 lg:pt-12">
      <div className="flex flex-wrap items-end justify-between gap-5 mb-8">
        <div>
          <p className="text-[12px] font-extrabold uppercase tracking-[0.22em] text-white/70">restricted</p>
          <h1 className="font-display uppercase text-[56px] lg:text-[84px] leading-[0.9] tracking-[-0.01em] mt-2">Admin</h1>
        </div>
        <button className="pill" onClick={() => { setAdminUnlocked(false); setView('home'); showToast('Admin locked.'); }}><Lock width={14} height={14} /> Lock admin</button>
      </div>

      <div className="flex gap-1 glass-soft rounded-full p-1.5 w-fit max-w-full overflow-x-auto mb-8">
        {([['studio', 'Checklists', PencilLine], ['journal', 'Journal', CalendarDays], ['export', 'Export', FileDown], ['settings', 'Settings', Settings]] as [AdminPane, string, typeof PencilLine][]).map(([p, label, Ic]) => (
          <button key={p} onClick={() => setAdminPane(p)} className={`nav-item whitespace-nowrap !normal-case !tracking-normal text-[13px] inline-flex items-center gap-2 ${adminPane === p ? 'active' : ''}`}>
            <Ic width={14} height={14} /> {label}
          </button>
        ))}
      </div>

      {adminPane === 'studio' && (
        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-12 lg:col-span-3">
            <p className="text-[14px] font-semibold text-white/80 leading-relaxed">Rewrite tasks, add new ones, delete old ones. Edits sync to every device within seconds.</p>
            <div className="inline-flex glass-soft rounded-full p-1 mt-6">
              {(['opening', 'closing'] as Shift[]).map(s => (
                <button key={s} onClick={() => setEditorShift(s)} className={`px-5 py-2 rounded-full text-[12px] font-extrabold uppercase tracking-[0.1em] transition-colors ${editorShift === s ? 'bg-white text-[#1c6ba4]' : 'text-white/75 hover:text-white'}`}>{s}</button>
              ))}
            </div>
          </div>
          <div className="col-span-12 lg:col-span-9 glass rounded-[24px] p-4 sm:p-6">
            {checklists[editorShift].map((t, i) => (
              <div key={t.id} className="grid grid-cols-[30px_1fr_40px] gap-4 items-start py-3.5 border-b border-white/20 last:border-0">
                <span className="pt-3 text-[12px] font-extrabold text-white/50">{String(i + 1).padStart(2, '0')}</span>
                <div className="grid gap-2">
                  <input className="glass-input !py-2.5 text-[15px] font-extrabold" value={t.label} onChange={e => updateTask(editorShift, t.id, 'label', e.target.value)} aria-label={`Task ${i + 1} label`} />
                  <input className="glass-input !py-2 text-[12.5px] font-semibold text-white/75" value={t.detail} onChange={e => updateTask(editorShift, t.id, 'detail', e.target.value)} aria-label={`Task ${i + 1} detail`} />
                </div>
                <button onClick={() => removeTask(editorShift, t.id)} aria-label={`Remove ${t.label}`} className="w-10 h-10 rounded-full grid place-items-center text-white/60 hover:text-white hover:bg-white/15 mt-1 transition-colors"><Trash2 width={16} height={16} /></button>
              </div>
            ))}
            <button onClick={() => addTask(editorShift)} className="pill-solid mt-6 !py-3"><Plus width={16} height={16} /> Add to {editorShift}</button>
          </div>
        </div>
      )}

      {adminPane === 'journal' && HistoryView()}

      {adminPane === 'export' && (
        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-12 lg:col-span-5 space-y-6">
            <div className="glass rounded-[24px] p-6">
              <h2 className="text-[30px] font-extrabold tracking-tight leading-tight">Keep a permanent copy</h2>
              <p className="text-[14px] font-semibold text-white/75 mt-4 leading-relaxed">Download every signed task in your chosen range as CSV — date, shift, task, staff, and exact timestamps. Run this before older days roll off the archive.</p>
              <button onClick={() => { setExportFrom(dates[dates.length - 1]); setExportTo(todayKey); }} className="pill mt-7 text-[12px]">Use full 14 days <ArrowRight width={14} height={14} /></button>
            </div>
            <div className="glass-soft rounded-[24px] p-6">
              <div className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-full bg-red-500/20 text-red-200 grid place-items-center"><Trash2 width={17} height={17} /></span>
                <div><p className="text-[18px] font-extrabold">Danger zone</p><p className="text-[11px] font-bold text-white/65">Purge historical logs</p></div>
              </div>
              <p className="text-[13px] font-semibold text-white/75 mt-4 leading-relaxed">Permanently delete all past and present completion records from storage and database. (Consider exporting to CSV first!)</p>
              <button onClick={clearAllRecords} className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-red-600 text-white font-extrabold text-[12px] hover:bg-red-500 transition-colors shadow-lg">
                <Trash2 width={14} height={14} /> Delete all records
              </button>
            </div>
          </div>
          <div className="col-span-12 lg:col-span-7 glass rounded-[24px] p-6 sm:p-8">
            <div className="grid sm:grid-cols-2 gap-5">
              <label className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-white/75 grid gap-2">From<input type="date" className="glass-input" value={exportFrom} onChange={e => setExportFrom(e.target.value)} /></label>
              <label className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-white/75 grid gap-2">To<input type="date" className="glass-input" value={exportTo} onChange={e => setExportTo(e.target.value)} /></label>
            </div>
            <button onClick={exportCsv} className="pill-solid mt-7"><Download width={16} height={16} /> Download CSV</button>
            <p className="text-[12px] font-bold text-white/65 mt-6">{Object.keys(records).length} days in storage · auto-prunes past 14</p>
          </div>
        </div>
      )}

      {adminPane === 'settings' && (
        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-12 lg:col-span-6 glass rounded-[24px] p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-full bg-white/20 grid place-items-center"><UserPlus width={17} height={17} /></span>
                <div><p className="text-[18px] font-extrabold">Team roster</p><p className="text-[11px] font-bold text-white/65">{users.length} {users.length === 1 ? 'member' : 'members'} · only they can sign tasks</p></div>
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <input value={newUserName} onChange={e => setNewUserName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addUser(); }} placeholder="Add a team member" aria-label="New team member name" className="glass-input" />
              <button onClick={addUser} disabled={!newUserName.trim()} className="pill-solid shrink-0 disabled:opacity-40 disabled:hover:transform-none"><Plus width={15} height={15} /> Add</button>
            </div>
            <div className="mt-5 space-y-2">
              {users.map(u => (
                <div key={u.id} className="flex items-center gap-3 glass-soft rounded-[16px] px-3 py-2.5 hover:bg-white/15 transition-colors group">
                  {Avatar({ name: u.name, size: 36 })}
                  <input
                    defaultValue={u.name}
                    key={`${u.id}-${u.name}`}
                    onBlur={e => { if (e.target.value.trim() !== u.name) renameUser(u.id, e.target.value); }}
                    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                    aria-label={`Rename ${u.name}`}
                    className="flex-1 min-w-0 bg-transparent text-[15px] font-extrabold placeholder-white/50"
                  />
                  <span className="text-[10px] font-bold text-white/50 hidden sm:block">since {new Date(u.added).toLocaleDateString([], { month: 'short', year: 'numeric' })}</span>
                  <button onClick={() => removeUser(u.id)} aria-label={`Remove ${u.name}`} className="w-9 h-9 rounded-full grid place-items-center text-white/50 hover:text-white hover:bg-white/20 transition-colors"><Trash2 width={15} height={15} /></button>
                </div>
              ))}
              {!users.length && <p className="text-[13px] font-semibold text-white/70 py-6 text-center">Roster is empty — anyone can type a name to sign in.</p>}
            </div>
          </div>

          <div className="col-span-12 lg:col-span-6 space-y-6">
            <div className="glass rounded-[24px] p-6">
              <div className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-full bg-white/20 grid place-items-center"><KeyRound width={17} height={17} /></span>
                <div><p className="text-[18px] font-extrabold">Admin code</p><p className="text-[11px] font-bold text-white/65">Controls access to this whole desk</p></div>
              </div>
              <div className="flex items-center gap-3 mt-6 glass-soft rounded-[14px] px-4 py-3">
                <span className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-white/65">Current</span>
                <span className="ml-auto text-[15px] font-extrabold tracking-[0.3em]">{'•'.repeat(Math.min(adminCode.length, 10))}</span>
              </div>
              <div className="grid sm:grid-cols-2 gap-4 mt-4">
                <label className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-white/75 grid gap-2">New code<input type="password" className="glass-input" value={newCode} onChange={e => setNewCode(e.target.value)} placeholder="Min. 4 characters" autoComplete="new-password" /></label>
                <label className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-white/75 grid gap-2">Confirm<input type="password" className="glass-input" value={confirmCode} onChange={e => setConfirmCode(e.target.value)} placeholder="Repeat it" onKeyDown={e => { if (e.key === 'Enter') changeCode(); }} autoComplete="new-password" /></label>
              </div>
              <p className={`mt-3 min-h-[18px] text-[12px] font-extrabold ${codeMsg ? (codeMsg.ok ? 'text-white' : 'text-white') : 'text-transparent'}`}>
                {codeMsg ? `${codeMsg.ok ? '✓' : '⚠'} ${codeMsg.text}` : '·'}
              </p>
              <button onClick={changeCode} disabled={!newCode || !confirmCode} className="pill-solid mt-5 disabled:opacity-40 disabled:hover:transform-none"><ShieldCheck width={16} height={16} /> Update code</button>
            </div>

            <div className="glass rounded-[24px] p-6">
              <div className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-full bg-white/20 grid place-items-center">{cloudOn ? <Cloud width={17} height={17} /> : <CloudOff width={17} height={17} />}</span>
                <div>
                  <p className="text-[18px] font-extrabold">Cloud sync</p>
                  <p className="text-[11px] font-bold text-white/65">
                    {cloudStatus === 'connected' && 'Connected — every device updates live'}
                    {cloudStatus === 'checking' && 'Checking your Supabase database…'}
                    {cloudStatus === 'needs-setup' && 'Database reachable — one-time table setup needed'}
                    {(cloudStatus === 'error' || cloudStatus === 'off') && 'Off — changes stay in this browser only'}
                  </p>
                </div>
              </div>

              {cloudStatus === 'connected' && (
                <>
                  <div className="flex items-center gap-2.5 mt-5 glass-soft rounded-[14px] px-4 py-3">
                    <span className="w-2 h-2 rounded-full bg-white pulse-soft" />
                    <span className="text-[13px] font-extrabold">Live</span>
                    <span className="ml-auto inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-white/60"><Database width={12} height={12} /> Supabase</span>
                  </div>
                  <p className="text-[12px] font-semibold text-white/70 mt-4 leading-relaxed">Checklists, roster, admin code, and every signed task persist in your database and sync across all devices. Refresh-proof and shared.</p>
                  <button onClick={goLocal} className="pill mt-5 text-[12px]"><CloudOff width={14} height={14} /> Use this device only</button>
                </>
              )}

              {cloudStatus === 'needs-setup' && (
                <>
                  <p className="text-[12.5px] font-semibold text-white/80 leading-relaxed mt-4">Your Supabase project is connected, but the storage table doesn't exist yet. Run this once in the <span className="text-white">SQL Editor</span> and everything becomes permanent and shared.</p>
                  <div className="relative mt-4">
                    <pre className="glass-soft rounded-[14px] p-4 pr-14 text-[10.5px] leading-relaxed font-mono text-white/85 overflow-x-auto whitespace-pre">{SETUP_SQL}</pre>
                    <button onClick={() => void copySql()} aria-label="Copy SQL" className="absolute top-3 right-3 w-9 h-9 rounded-full bg-white text-[#1c6ba4] grid place-items-center hover:rotate-[-6deg] transition-transform"><Copy width={15} height={15} /></button>
                  </div>
                  <button onClick={() => void retryCloud()} className="pill-solid mt-4"><RefreshCw width={15} height={15} /> I ran it — check again</button>
                </>
              )}

              {(cloudStatus === 'error' || cloudStatus === 'off') && (
                <>
                  <p className="text-[12.5px] font-semibold text-white/80 leading-relaxed mt-4">
                    {cloudStatus === 'error'
                      ? "Couldn't reach the database. Check the project URL and publishable key in src/supabaseClient.ts, then retry."
                      : 'Sync is paused on this device. Data still saves to this browser. Turn it back on to share across devices.'}
                  </p>
                  <button onClick={() => void retryCloud()} className="pill-solid mt-5"><RefreshCw width={15} height={15} /> Retry connection</button>
                </>
              )}

              {cloudStatus === 'checking' && (
                <div className="flex items-center gap-3 mt-5 glass-soft rounded-[14px] px-4 py-3">
                  <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  <span className="text-[12px] font-bold text-white/75">Contacting Supabase…</span>
                </div>
              )}
            </div>

            <div className="glass-soft rounded-[24px] p-6">
              <p className="text-[13px] font-semibold text-white/80 leading-relaxed">Without cloud sync, data persists in each browser's own storage only — which is exactly why edits looked like they reverted after deploy. The admin code is a team convenience gate, not server-grade security.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="stage font-body">
      <div className="orb orb-1" /><div className="orb orb-2" /><div className="orb orb-3" />

      <div className="relative z-10 max-w-[1280px] mx-auto px-5 lg:px-8 pb-20">
        <header className="flex flex-wrap items-center gap-4 pt-6">
          <button onClick={() => setView('home')} className="flex items-center gap-3 group">
            <span className="w-12 h-12 rounded-[16px] bg-white text-[#1c6ba4] grid place-items-center shadow-[0_12px_28px_rgba(23,92,148,0.3)] group-hover:rotate-[-6deg] transition-transform">
              <ClipboardList width={22} height={22} strokeWidth={2.4} />
            </span>
            <span className="font-display uppercase text-[15px] leading-[1.1] tracking-tight">Daily<br />Check</span>
          </button>

          <nav className="glass rounded-full p-1.5 ml-auto hidden md:flex items-center gap-1">
            {([['home', 'Home'], ['opening', 'Opening'], ['closing', 'Closing'], ['history', 'History']] as [View, string][]).map(([v, l]) => (
              <button key={v} onClick={() => setView(v)} className={`nav-item ${view === v ? 'active' : ''}`}>{l}</button>
            ))}
          </nav>

          <div className="flex items-center gap-2.5 ml-auto md:ml-0 relative">
            <button onClick={tryAdmin} aria-label="Admin" className={`w-11 h-11 rounded-full grid place-items-center border transition-colors ${view === 'admin' ? 'bg-white text-[#1c6ba4] border-white' : 'border-white/60 hover:bg-white/15'}`}>
              {adminUnlocked ? <ShieldCheck width={17} height={17} /> : <Lock width={16} height={16} />}
            </button>
            <button onClick={() => { setNameOpen(o => !o); setNameInput(staffName); }} className="h-11 rounded-full border border-white/60 hover:bg-white/15 transition-colors pl-2 pr-4 flex items-center gap-2.5">
              {staffName ? Avatar({ name: staffName, size: 30 }) : <span className="w-[30px] h-[30px] rounded-full bg-white/20 grid place-items-center"><User width={14} height={14} /></span>}
              <span className="text-[13px] font-extrabold max-w-[90px] truncate">{staffName || 'Sign in'}</span>
            </button>

            {nameOpen && (
              <div className="absolute right-0 top-[52px] w-[300px] glass-deep rounded-[22px] p-5 z-30 view-enter">
                <div className="flex items-center justify-between">
                  <p className="text-[12px] font-extrabold uppercase tracking-[0.16em] text-white/80">Who's on it?</p>
                  <button onClick={() => setNameOpen(false)} aria-label="Close" className="w-7 h-7 rounded-full bg-white/20 grid place-items-center hover:bg-white/30 transition-colors"><X width={13} height={13} /></button>
                </div>

                {users.length > 0 && (
                  <div className="grid grid-cols-2 gap-2 mt-4">
                    {users.map(u => (
                      <button
                        key={u.id}
                        onClick={() => { setStaffName(u.name); setNameOpen(false); showToast(`Signed in as ${u.name}`); }}
                        className={`flex items-center gap-2 rounded-[14px] px-2.5 py-2 text-left transition-colors ${staffName.toLowerCase() === u.name.toLowerCase() ? 'bg-white text-[#1c6ba4]' : 'bg-white/15 hover:bg-white/25'}`}
                      >
                        {Avatar({ name: u.name, size: 26 })}
                        <span className="text-[13px] font-extrabold truncate">{u.name}</span>
                      </button>
                    ))}
                  </div>
                )}

                <div className={`mt-4 ${users.length ? 'pt-4 border-t border-white/30' : ''}`}>
                  <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-white/60 mb-2">{users.length ? 'or type a name' : 'type your name'}</p>
                  <input
                    ref={nameRef}
                    value={nameInput}
                    onChange={e => setNameInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { setStaffName(nameInput.trim()); setNameOpen(false); } }}
                    placeholder="Your name"
                    aria-label="Your name"
                    className="glass-input"
                  />
                  {users.length > 0 && nameInput.trim() && !onRoster(nameInput) && (
                    <p className="text-[10px] font-bold text-white/80 mt-2">Not on the roster — an admin can add you in Settings.</p>
                  )}
                  <button onClick={() => { if (nameInput.trim()) { setStaffName(nameInput.trim()); setNameOpen(false); } }} className="pill-solid w-full justify-center mt-3 !py-2.5 text-[13px]">Sign in</button>
                </div>
              </div>
            )}
          </div>
        </header>

        <nav className="md:hidden glass rounded-full p-1.5 mt-4 flex items-center gap-1 overflow-x-auto">
          {([['home', 'Home'], ['opening', 'Open'], ['closing', 'Close'], ['history', 'Log']] as [View, string][]).map(([v, l]) => (
            <button key={v} onClick={() => setView(v)} className={`nav-item whitespace-nowrap ${view === v ? 'active' : ''}`}>{l}</button>
          ))}
        </nav>

        <main>
          {view === 'home' && HomeView()}
          {view === 'opening' && ShiftView({ shift: 'opening' })}
          {view === 'closing' && ShiftView({ shift: 'closing' })}
          {view === 'history' && HistoryView()}
          {view === 'admin' && adminUnlocked && AdminView()}
        </main>

        <footer className="mt-20 pt-6 border-t border-white/25 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/60">Daily Check — team checklist tracker</p>
          <p className="text-[11px] font-bold text-white/60">sign it · ship it · repeat</p>
        </footer>
      </div>

      {showGate && (
        <div className="modal-veil" onClick={() => setShowGate(false)}>
          <div className="glass-deep rounded-[28px] p-8 w-full max-w-[420px] view-enter" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <span className="w-12 h-12 rounded-full bg-white text-[#1c6ba4] grid place-items-center"><Lock width={19} height={19} /></span>
              <button onClick={() => setShowGate(false)} aria-label="Close" className="w-8 h-8 rounded-full bg-white/20 grid place-items-center hover:bg-white/30 transition-colors"><X width={14} height={14} /></button>
            </div>
            <h3 className="text-[28px] font-extrabold tracking-tight mt-5">Admin access</h3>
            <p className="text-[13px] font-semibold text-white/75 mt-2 leading-relaxed">The code unlocks checklists, team management, and exports.</p>
            <input
              autoFocus
              type="password"
              value={gateCode}
              onChange={e => { setGateCode(e.target.value); setGateError(''); }}
              onKeyDown={e => { if (e.key === 'Enter') unlock(); }}
              placeholder="Enter admin code"
              aria-label="Admin code"
              className="glass-input mt-6"
            />
            {gateError && <p className="text-[12px] font-extrabold mt-3 text-white">{gateError}</p>}
            <button onClick={unlock} className="pill-solid w-full justify-center mt-6">Unlock <ArrowRight width={16} height={16} /></button>
          </div>
        </div>
      )}

      {toast && <div className="toast"><Check width={15} height={15} strokeWidth={3} /> {toast}</div>}
    </div>
  );
}
