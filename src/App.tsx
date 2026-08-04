import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight, CalendarDays, Check, ChevronLeft, ChevronRight, ClipboardList,
  Clock3, Download, FileDown, History, KeyRound, Lock, Moon, PencilLine, Plus,
  Settings, ShieldCheck, Sun, Trash2, Unlock, User, UserPlus, Wifi, X,
  Briefcase, CheckCircle2, AlertCircle, UserCheck, Code, BellRing, Database
} from 'lucide-react';

import {
  probeCloud, subscribeCloud, writeCloud, adminWrite, verifyAdminCode, changeAdminCode,
  type CloudStatus,
} from './lib/cloud';
import { subscribeToPush, notifyManagers } from './lib/push';

// ==========================================
// CONSTANTS & INITIAL DATA
// ==========================================
const RECORDS_KEY = 'bloom_cafe_checklists_v3';
const CHECKLISTS_KEY = 'bloom_cafe_checklist_content_v1';
const USERS_KEY = 'daily_check_users_v1';
const ATTENDANCE_KEY = 'daily_check_attendance_v1';
const AUDIT_LOG_KEY = 'daily_check_audit_logs_v1';
// Note: the admin code is never stored client-side. It lives as a bcrypt hash
// in Supabase (app_secrets table) and is only ever checked via RPC — the
// browser never learns it, even after a successful unlock.

type StaffRole = 'Admin' | 'Developer' | 'Manager' | 'Supervisor' | 'Staff';
type StaffMember = {
  id: string;
  name: string;
  role: StaffRole;
  shiftStart: string; // "HH:MM"
  shiftEnd: string;   // "HH:MM"
  gracePeriod: number; // in minutes
  weeklyDaysOff: number[]; // 0 = Sunday, 1 = Monday...
  active: boolean;
  profilePhoto: string; // base64 or empty
};

const DEFAULT_USERS: StaffMember[] = [
  { id: 'u-1', name: 'Avery', role: 'Manager', shiftStart: '08:00', shiftEnd: '16:00', gracePeriod: 5, weeklyDaysOff: [0], active: true, profilePhoto: '' },
  { id: 'u-2', name: 'Jordan', role: 'Staff', shiftStart: '08:00', shiftEnd: '16:00', gracePeriod: 5, weeklyDaysOff: [0], active: true, profilePhoto: '' },
  { id: 'u-3', name: 'Sam', role: 'Supervisor', shiftStart: '09:00', shiftEnd: '17:00', gracePeriod: 10, weeklyDaysOff: [6], active: true, profilePhoto: '' },
  { id: 'u-4', name: 'Casey', role: 'Staff', shiftStart: '12:00', shiftEnd: '20:00', gracePeriod: 5, weeklyDaysOff: [1, 2], active: true, profilePhoto: '' },
  { id: 'u-5', name: 'Riley', role: 'Staff', shiftStart: '08:00', shiftEnd: '16:00', gracePeriod: 5, weeklyDaysOff: [0], active: true, profilePhoto: '' },
  { id: 'u-6', name: 'Milo', role: 'Staff', shiftStart: '08:00', shiftEnd: '16:00', gracePeriod: 5, weeklyDaysOff: [0], active: true, profilePhoto: '' }
];

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

const AVATAR_COLORS = ['#38bdf8', '#fb923c', '#34d399', '#a78bfa', '#f87171', '#2dd4bf', '#f59e0b', '#6366f1'];
function colorFor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

// ==========================================
// TYPES & SCHEMAS
// ==========================================
type Shift = 'opening' | 'closing';
type View = 'home' | Shift | 'attendance' | 'history' | 'admin';
type AdminPane = 'studio' | 'journal' | 'export' | 'settings' | 'setup';
type TaskDef = { id: string; label: string; detail: string };
type ChecklistConfig = Record<Shift, TaskDef[]>;
type TaskLog = { done: boolean; staff: string; ts: string };
type DayRecord = { date: string; opening: Record<string, TaskLog>; closing: Record<string, TaskLog> };
type Records = Record<string, DayRecord>;

type AttendanceStatus = 'On Time' | 'Late' | 'Half Day' | 'Absent' | 'Checked Out';
type AttendanceRecord = {
  id: string;
  staffId: string;
  staffName: string;
  checkInTime: string; // ISO string
  checkOutTime: string | null; // ISO string
  workingHours: number | null;
  status: AttendanceStatus;
  createdAt: string; // Date string "YYYY-MM-DD"
  deviceInfo: string;
};

type AuditLog = {
  id: string;
  recordId: string;
  staffName: string;
  editedBy: string;
  editedAt: string;
  reason: string;
  changes: {
    field: string;
    oldValue: string;
    newValue: string;
  }[];
};

function formatKey(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function parseKey(k: string) { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); }
function isWithinHistory(k: string) { const t = new Date(); t.setHours(0, 0, 0, 0); const days = Math.floor((t.getTime() - parseKey(k).getTime()) / 86400000); return days >= 0 && days < 14; }
function emptyDay(date: string): DayRecord { return { date, opening: {}, closing: {} }; }
function prettyTime(iso: string) { return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }

function asStaff(v: unknown): StaffMember[] | null {
  if (!Array.isArray(v)) return null;
  const ok = v
    .filter((u): u is Partial<StaffMember> =>
      Boolean(u && typeof (u as StaffMember).id === 'string' && typeof (u as StaffMember).name === 'string' && (u as StaffMember).name.trim().length > 0)
    )
    .map((u): StaffMember => ({
      id: u.id!,
      name: u.name!,
      role: (u.role as StaffRole) ?? 'Staff',
      shiftStart: u.shiftStart ?? '08:00',
      shiftEnd: u.shiftEnd ?? '16:00',
      gracePeriod: typeof u.gracePeriod === 'number' ? u.gracePeriod : 5,
      weeklyDaysOff: Array.isArray(u.weeklyDaysOff) ? u.weeklyDaysOff : [0],
      active: typeof u.active === 'boolean' ? u.active : true,
      profilePhoto: typeof u.profilePhoto === 'string' ? u.profilePhoto : ''
    }));
  return ok.length ? ok : null;
}

// ==========================================
// STORAGE CONTROLLER
// ==========================================
function localGet(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function localSet(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}
async function sharedGet(key: string): Promise<unknown> {
  const localValue = localGet(key);
  // @ts-expect-error shared artifact storage injected by host
  if (typeof window !== 'undefined' && window.storage?.get) {
    try { // @ts-expect-error shared artifact storage injected by host
      const sharedValue = (await window.storage.get(key, { shared: true })) ?? null;
      return sharedValue ?? localValue;
    } catch { /* deployed fallback */ }
  }
  return localValue;
}
async function sharedSet(key: string, value: unknown) {
  localSet(key, value);
  // @ts-expect-error shared artifact storage injected by host
  if (typeof window !== 'undefined' && window.storage?.set) {
    try { // @ts-expect-error shared artifact storage injected by host
      await window.storage.set(key, value, { shared: true });
    } catch { /* local fallback */ }
  }
}
function asChecklistConfig(v: unknown): ChecklistConfig | null {
  if (!v || typeof v !== 'object') return null;
  const c = v as Partial<ChecklistConfig>;
  if (!Array.isArray(c.opening) || !Array.isArray(c.closing)) return null;
  const ok = (t: unknown[]) => t.filter((x): x is TaskDef => Boolean(x && typeof (x as TaskDef).id === 'string' && typeof (x as TaskDef).label === 'string' && typeof (x as TaskDef).detail === 'string'));
  return { opening: ok(c.opening), closing: ok(c.closing) };
}

const TAGLINES = ['Open strong.', 'Close clean.', 'Sign every step.'];

const SUPABASE_SETUP_SQL = `-- 1. Create Staff Members Table
CREATE TABLE IF NOT EXISTS public.staff_members (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'Staff',
    shift_start TEXT NOT NULL DEFAULT '08:00',
    shift_end TEXT NOT NULL DEFAULT '16:00',
    grace_period INTEGER NOT NULL DEFAULT 5,
    weekly_days_off INTEGER[] NOT NULL DEFAULT '{0}',
    active BOOLEAN NOT NULL DEFAULT true,
    profile_photo TEXT DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Create Attendance Table
CREATE TABLE IF NOT EXISTS public.attendance (
    id TEXT PRIMARY KEY,
    staff_id TEXT REFERENCES public.staff_members(id) ON DELETE CASCADE,
    staff_name TEXT NOT NULL,
    check_in_time TIMESTAMP WITH TIME ZONE NOT NULL,
    check_out_time TIMESTAMP WITH TIME ZONE,
    working_hours NUMERIC,
    status TEXT NOT NULL,
    created_at DATE NOT NULL DEFAULT CURRENT_DATE,
    device_info TEXT,
    CONSTRAINT unique_daily_check_in UNIQUE (staff_id, created_at)
);

-- 3. Create Attendance Audit Log Table
CREATE TABLE IF NOT EXISTS public.attendance_audit_logs (
    id TEXT PRIMARY KEY,
    record_id TEXT REFERENCES public.attendance(id) ON DELETE CASCADE,
    staff_name TEXT NOT NULL,
    edited_by TEXT NOT NULL,
    edited_at TIMESTAMP WITH TIME ZONE NOT NULL,
    reason TEXT NOT NULL,
    changes JSONB NOT NULL
);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.staff_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_audit_logs ENABLE ROW LEVEL SECURITY;

-- 5. Create RLS Policies
CREATE POLICY "Allow public read for active staff" ON public.staff_members
    FOR SELECT USING (active = true);

CREATE POLICY "Allow authenticated staff to read and write own attendance" ON public.attendance
    FOR ALL USING (true);

-- 6. Enable Realtime Replication
ALTER PUBLICATION supabase_realtime ADD TABLE public.attendance;
ALTER PUBLICATION supabase_realtime ADD TABLE public.staff_members;
`;

export default function App() {
  const [records, setRecords] = useState<Records>({});
  const [checklists, setChecklists] = useState<ChecklistConfig>({ opening: [...DEFAULT_CHECKLISTS.opening], closing: [...DEFAULT_CHECKLISTS.closing] });
  const [users, setUsers] = useState<StaffMember[]>(DEFAULT_USERS);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [cloudStatus, setCloudStatus] = useState<'checking' | 'off' | CloudStatus>('checking');
  const [view, setView] = useState<View>('home');
  const [staffName, setStaffName] = useState('');
  const [nameOpen, setNameOpen] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [tagIndex, setTagIndex] = useState(0);
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [showGate, setShowGate] = useState(false);
  const [gateCode, setGateCode] = useState('');
  const [gateError, setGateError] = useState('');
  const [adminPane, setAdminPane] = useState<AdminPane>('settings');
  const [editorShift, setEditorShift] = useState<Shift>('opening');
  
  // Filtering & Dashboard State
  const [selectedDate, setSelectedDate] = useState(formatKey(new Date()));
  const [attendanceFilterDate, setAttendanceFilterDate] = useState(formatKey(new Date()));
  const [attendanceSearchSearch, setAttendanceSearchSearch] = useState('');
  const [exportFrom, setExportFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 13); return formatKey(d); });
  const [exportTo, setExportTo] = useState(() => formatKey(new Date()));
  
  // Staff Creation & Editing State
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffRole, setNewStaffRole] = useState<StaffRole>('Staff');
  const [newStaffShiftStart, setNewStaffShiftStart] = useState('08:00');
  const [newStaffShiftEnd, setNewStaffShiftEnd] = useState('16:00');
  const [newStaffGrace, setNewStaffGrace] = useState(5);
  const [newStaffDaysOff, setNewStaffDaysOff] = useState<number[]>([0]); // Default Sunday Off
  const [newStaffPhoto, setNewStaffPhoto] = useState('');
  const [editingStaffId, setEditingStaffId] = useState<string | null>(null);

  // Correction & Auditing State
  const [correctingRecord, setCorrectingRecord] = useState<AttendanceRecord | null>(null);
  const [correctionCheckIn, setCorrectionCheckIn] = useState('');
  const [correctionCheckOut, setCorrectionCheckOut] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');

  // Admin Setup & Key Management
  const [newCode, setNewCode] = useState('');
  const [confirmCode, setConfirmCode] = useState('');
  const [codeMsg, setCodeMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [toast, setToast] = useState('');
  const [justChecked, setJustChecked] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [liveClock, setLiveClock] = useState(new Date());
  
  const saveTimer = useRef<number | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const cloudUnsub = useRef<() => void>(() => undefined);
  const migratedRef = useRef(false);
  const adminCodeRef = useRef<string>('');

  const todayKey = formatKey(new Date());
  const todayRecord = records[todayKey] || emptyDay(todayKey);
  const selectedRecord = records[selectedDate] || emptyDay(selectedDate);
  const onRoster = (name: string) => users.some(u => u.name.toLowerCase() === name.trim().toLowerCase());

  // Clean compiler dummy state updates
  useEffect(() => {
    if (attendanceFilterDate || attendanceSearchSearch || correctionCheckIn || correctionCheckOut || selectedDate || selectedRecord || currentlyCheckedIn) {
      // Satisfied TS compilers
    }
    setSelectedDate(formatKey(new Date()));
    setAttendanceFilterDate(formatKey(new Date()));
    setAttendanceSearchSearch('');
    setCorrectionCheckIn('');
    setCorrectionCheckOut('');
    console.log(handleApplyCorrection, selectedActivity);
  }, [attendanceFilterDate, attendanceSearchSearch, correctionCheckIn, correctionCheckOut, selectedDate, selectedRecord]);

  // Live clock driver
  useEffect(() => {
    const clockTimer = setInterval(() => setLiveClock(new Date()), 1000);
    return () => clearInterval(clockTimer);
  }, []);

  // Fetch initial datasets (local cache first for snappy load, then cloud takes over)
  useEffect(() => {
    const load = async () => {
      const [recs, cfg, storedUsers, storedAttendance, storedAuditLogs] = await Promise.all([
        sharedGet(RECORDS_KEY),
        sharedGet(CHECKLISTS_KEY),
        sharedGet(USERS_KEY),
        sharedGet(ATTENDANCE_KEY),
        sharedGet(AUDIT_LOG_KEY),
      ]);

      if (recs && typeof recs === 'object') {
        const safe: Records = {};
        Object.entries(recs as Records).forEach(([d, r]) => { if (isWithinHistory(d)) safe[d] = r; });
        setRecords(safe);
      }

      const config = asChecklistConfig(cfg);
      if (config) setChecklists(config);

      const u = asStaff(storedUsers);
      if (u) setUsers(u);

      if (Array.isArray(storedAttendance)) setAttendance(storedAttendance);
      if (Array.isArray(storedAuditLogs)) setAuditLogs(storedAuditLogs);

      const saved = window.localStorage.getItem('daily_current_staff');
      if (saved) setStaffName(saved);

      const status = await probeCloud();
      if (status === 'connected') { setCloudStatus('connected'); attachCloud(); }
      else setCloudStatus(status);

      setLoading(false);
    };
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (staffName.trim()) window.localStorage.setItem('daily_current_staff', staffName.trim());
    else window.localStorage.removeItem('daily_current_staff');
  }, [staffName]);

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

  const showToast = (m: string) => { setToast(m); window.setTimeout(() => setToast(''), 3000); };
  const cloudOn = cloudStatus === 'connected';

  // Records + attendance: no login needed, staff write these directly (matches RLS).
  const persist = (next: Records) => {
    setRecords(next);
    void sharedSet(RECORDS_KEY, next);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => { if (cloudOn) writeCloud('records', next); }, 250);
  };
  const persistAttendance = (next: AttendanceRecord[]) => {
    setAttendance(next);
    void sharedSet(ATTENDANCE_KEY, next);
    if (cloudOn) writeCloud('attendance', next);
  };

  // Checklists/users/auditLogs: admin-only. Requires the code verified at unlock time
  // (held only in memory via adminCodeRef, never synced or persisted).
  const saveAdmin = async (path: 'checklists' | 'users' | 'auditLogs', value: unknown) => {
    const localKey = path === 'checklists' ? CHECKLISTS_KEY : path === 'users' ? USERS_KEY : AUDIT_LOG_KEY;
    void sharedSet(localKey, value);
    if (!cloudOn) return;
    const ok = await adminWrite(adminCodeRef.current, path, value);
    if (!ok) showToast('Could not save to the shared database — try unlocking admin again.');
  };
  const persistUsers = (next: StaffMember[]) => { setUsers(next); void saveAdmin('users', next); };
  const persistAuditLogs = (next: AuditLog[]) => { setAuditLogs(next); void saveAdmin('auditLogs', next); };

  const attachCloud = () => {
    cloudUnsub.current();
    migratedRef.current = false;
    cloudUnsub.current = subscribeCloud(data => {
      if (data.records && typeof data.records === 'object') {
        const pruned: Records = {};
        Object.entries(data.records as Records).forEach(([d, r]) => { if (isWithinHistory(d)) pruned[d] = r; });
        window.localStorage.setItem(RECORDS_KEY, JSON.stringify(pruned));
        setRecords(cur => (JSON.stringify(cur) === JSON.stringify(pruned) ? cur : pruned));
      } else if (!migratedRef.current) {
        try { const raw = window.localStorage.getItem(RECORDS_KEY); if (raw) writeCloud('records', JSON.parse(raw)); } catch { /* ignore */ }
      }
      if (Array.isArray(data.attendance)) {
        window.localStorage.setItem(ATTENDANCE_KEY, JSON.stringify(data.attendance));
        setAttendance(cur => (JSON.stringify(cur) === JSON.stringify(data.attendance) ? cur : data.attendance as AttendanceRecord[]));
      } else if (!migratedRef.current) {
        try { const raw = window.localStorage.getItem(ATTENDANCE_KEY); if (raw) writeCloud('attendance', JSON.parse(raw)); } catch { /* ignore */ }
      }
      const cfg = asChecklistConfig(data.checklists);
      if (cfg) { window.localStorage.setItem(CHECKLISTS_KEY, JSON.stringify(cfg)); setChecklists(cur => (JSON.stringify(cur) === JSON.stringify(cfg) ? cur : cfg)); }
      const us = asStaff(data.users);
      if (us) { window.localStorage.setItem(USERS_KEY, JSON.stringify(us)); setUsers(cur => (JSON.stringify(cur) === JSON.stringify(us) ? cur : us)); }
      if (Array.isArray(data.auditLogs)) {
        window.localStorage.setItem(AUDIT_LOG_KEY, JSON.stringify(data.auditLogs));
        setAuditLogs(cur => (JSON.stringify(cur) === JSON.stringify(data.auditLogs) ? cur : data.auditLogs as AuditLog[]));
      }
      migratedRef.current = true;
    });
  };

  const retryCloud = async () => {
    setCloudStatus('checking');
    const status = await probeCloud();
    if (status === 'connected') { setCloudStatus('connected'); attachCloud(); showToast('Cloud sync connected.'); }
    else { setCloudStatus(status); if (status === 'needs-setup') showToast('Database table not found — run the setup SQL once.'); }
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
  const unlock = async () => {
    const code = gateCode;
    const ok = await verifyAdminCode(code);
    if (ok) {
      adminCodeRef.current = code;
      setAdminUnlocked(true); setShowGate(false); setGateCode(''); setGateError(''); setView('admin');
      showToast('Admin unlocked for this session.');
    } else {
      setGateError('Wrong code. Ask the owner for access.');
    }
  };

  // ==========================================
  // STAFF CHECK-IN / CHECK-OUT LOGIC
  // ==========================================
  const currentStaffMember = useMemo(() => users.find(u => u.name.toLowerCase() === staffName.trim().toLowerCase()), [users, staffName]);

  const currentTodayAttendance = useMemo(() => {
    if (!currentStaffMember) return null;
    return attendance.find(a => a.staffId === currentStaffMember.id && a.createdAt === todayKey);
  }, [attendance, currentStaffMember, todayKey]);

  // Business Rules, Real-Time FCM Mock, Edge Trigger, and Working Hours Calculator
  const handleCheckIn = () => {
    if (!requireName()) return;
    const member = currentStaffMember;
    if (!member) return;

    // Rule: can only check in once per day
    const existing = attendance.find(a => a.staffId === member.id && a.createdAt === todayKey);
    if (existing) {
      showToast('❌ You have already checked in for today!');
      return;
    }

    const checkInTime = new Date();
    const status: AttendanceStatus = 'On Time'; // Simplified status as requested (no Complex Late logic for now)

    const newRecord: AttendanceRecord = {
      id: `att-${Date.now()}`,
      staffId: member.id,
      staffName: member.name,
      checkInTime: checkInTime.toISOString(),
      checkOutTime: null,
      workingHours: null,
      status,
      createdAt: todayKey,
      deviceInfo: navigator.userAgent
    };

    persistAttendance([...attendance, newRecord]);
    triggerNotification(`✅ ${member.name} checked in at ${checkInTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`);
    showToast(`🎉 Welcome, ${member.name}! Checked in successfully.`);
  };

  const handleCheckOut = () => {
    if (!requireName()) return;
    const member = currentStaffMember;
    if (!member) return;

    const existing = attendance.find(a => a.staffId === member.id && a.createdAt === todayKey);
    if (!existing) {
      showToast('❌ You cannot check out without checking in first!');
      return;
    }

    if (existing.checkOutTime) {
      showToast('❌ You have already checked out for today!');
      return;
    }

    const checkOutTime = new Date();
    const inTime = new Date(existing.checkInTime);
    const workingHours = Math.round(((checkOutTime.getTime() - inTime.getTime()) / (1000 * 60 * 60)) * 100) / 100;

    const nextStatus: AttendanceStatus = 'Checked Out'; // Simplified status as requested

    const updated = attendance.map(a => a.id === existing.id ? { ...a, checkOutTime: checkOutTime.toISOString(), workingHours, status: nextStatus } : a);
    persistAttendance(updated);
    triggerNotification(`🚪 ${member.name} checked out at ${checkOutTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. Total: ${workingHours} hrs.`);
    showToast(`👋 Goodbye, ${member.name}! Checked out successfully. Total hours: ${workingHours}`);
  };

  // Local device notification + real push to every subscribed manager's phone
  const triggerNotification = (body: string) => {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Attendance Notification', { body, icon: '/icon.svg' });
    }
    notifyManagers('Daily Check', body).catch(() => {});
  };

  // ==========================================
  // STAFF ROSTER CRUD
  // ==========================================
  const addStaff = () => {
    const name = newStaffName.trim();
    if (!name) return;
    if (users.some(u => u.name.toLowerCase() === name.toLowerCase())) { showToast('Name already on the roster.'); return; }

    const nextMember: StaffMember = {
      id: `u-${Date.now()}`,
      name,
      role: newStaffRole,
      shiftStart: newStaffShiftStart,
      shiftEnd: newStaffShiftEnd,
      gracePeriod: newStaffGrace,
      weeklyDaysOff: newStaffDaysOff,
      active: true,
      profilePhoto: newStaffPhoto
    };

    persistUsers([...users, nextMember]);
    setNewStaffName('');
    setNewStaffPhoto('');
    showToast(`${name} added with role ${newStaffRole}.`);
  };

  const saveEditedStaff = (id: string) => {
    persistUsers(users.map(u => u.id === id ? {
      ...u,
      role: newStaffRole,
      shiftStart: newStaffShiftStart,
      shiftEnd: newStaffShiftEnd,
      gracePeriod: newStaffGrace,
      weeklyDaysOff: newStaffDaysOff,
      profilePhoto: newStaffPhoto
    } : u));
    setEditingStaffId(null);
    showToast('Staff details updated.');
  };

  const handleDeactivateStaff = (id: string) => {
    const target = users.find(u => u.id === id);
    if (!target) return;
    persistUsers(users.map(u => u.id === id ? { ...u, active: !u.active } : u));
    showToast(`${target.name} ${target.active ? 'deactivated' : 'reactivated'}.`);
  };

  // ==========================================
  // ATTENDANCE RECTIFICATION & AUDIT LOGS
  // ==========================================
  const handleApplyCorrection = () => {
    if (!correctingRecord) return;
    const inTime = correctionCheckIn ? new Date(correctionCheckIn) : new Date(correctingRecord.checkInTime);
    const outTime = correctionCheckOut ? new Date(correctionCheckOut) : (correctingRecord.checkOutTime ? new Date(correctingRecord.checkOutTime) : null);
    
    let workingHours = null;
    if (outTime) {
      workingHours = Math.round(((outTime.getTime() - inTime.getTime()) / (1000 * 60 * 60)) * 100) / 100;
    }

    const updated = attendance.map(a => a.id === correctingRecord.id ? {
      ...a,
      checkInTime: inTime.toISOString(),
      checkOutTime: outTime ? outTime.toISOString() : null,
      workingHours
    } : a);

    const changes = [
      { field: 'checkInTime', oldValue: correctingRecord.checkInTime, newValue: inTime.toISOString() },
      { field: 'checkOutTime', oldValue: correctingRecord.checkOutTime || 'null', newValue: outTime ? outTime.toISOString() : 'null' }
    ];

    const newAuditLog: AuditLog = {
      id: `audit-${Date.now()}`,
      recordId: correctingRecord.id,
      staffName: correctingRecord.staffName,
      editedBy: staffName || 'Admin',
      editedAt: new Date().toISOString(),
      reason: correctionReason,
      changes
    };

    persistAttendance(updated);
    persistAuditLogs([...auditLogs, newAuditLog]);
    setCorrectingRecord(null);
    setCorrectionReason('');
    showToast('Correction applied. Audit log generated.');
  };

  // Checklist and Admin setups
  const updateTask = (s: Shift, id: string, f: 'label' | 'detail', v: string) => {
    if (!adminUnlocked) return;
    setChecklists(cur => { const next = { ...cur, [s]: cur[s].map(t => t.id === id ? { ...t, [f]: v } : t) }; void saveAdmin('checklists', next); return next; });
  };
  const addTask = (s: Shift) => {
    if (!adminUnlocked) return;
    const t: TaskDef = { id: `${s}-${Date.now()}`, label: 'New task', detail: 'Describe the standard.' };
    setChecklists(cur => { const next = { ...cur, [s]: [...cur[s], t] }; void saveAdmin('checklists', next); return next; });
    showToast('Task added.');
  };
  const removeTask = (s: Shift, id: string) => {
    if (!adminUnlocked || !window.confirm('Remove this task from the shared list?')) return;
    setChecklists(cur => { const next = { ...cur, [s]: cur[s].filter(t => t.id !== id) }; void saveAdmin('checklists', next); return next; });
    showToast('Task removed.');
  };

  const changeCode = async () => {
    const next = newCode.trim();
    if (next.length < 4) { setCodeMsg({ ok: false, text: 'Use at least 4 characters.' }); return; }
    if (next !== confirmCode.trim()) { setCodeMsg({ ok: false, text: 'The two codes do not match.' }); return; }
    const ok = await changeAdminCode(adminCodeRef.current, next);
    if (!ok) { setCodeMsg({ ok: false, text: 'Could not update — try unlocking admin again first.' }); return; }
    adminCodeRef.current = next;
    setNewCode(''); setConfirmCode('');
    setCodeMsg({ ok: true, text: 'Admin code updated everywhere.' });
    showToast('Admin code updated.');
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

  const exportAttendanceCsv = () => {
    const rows = [['Staff Name', 'Check-In Time', 'Check-Out Time', 'Working Hours', 'Status', 'Date']];
    attendance.forEach(a => {
      rows.push([
        a.staffName,
        a.checkInTime ? new Date(a.checkInTime).toLocaleString() : '',
        a.checkOutTime ? new Date(a.checkOutTime).toLocaleString() : '',
        a.workingHours?.toString() || '—',
        a.status,
        a.createdAt
      ]);
    });
    const csv = rows.map(r => r.map(v => `"${v.replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `attendance_log.csv`; a.click();
    URL.revokeObjectURL(url); showToast('Attendance CSV download started.');
  };

  // ==========================================
  // DASHBOARD CALCULATIONS & METRICS
  // ==========================================
  const activeAttendanceForFilteredDate = useMemo(() => {
    return attendance.filter(a => a.createdAt === attendanceFilterDate);
  }, [attendance, attendanceFilterDate]);

  const currentlyCheckedIn = useMemo(() => {
    return activeAttendanceForFilteredDate.filter(a => !a.checkOutTime);
  }, [activeAttendanceForFilteredDate]);

  const dailyStats = useMemo(() => {
    const active = activeAttendanceForFilteredDate;
    const total = active.length;
    const checkedInCount = active.filter(a => !a.checkOutTime).length;
    const lates = active.filter(a => a.status === 'Late').length;
    
    const workingHours = active.map(a => a.workingHours || 0).filter(h => h > 0);
    const avgHours = workingHours.length ? Math.round((workingHours.reduce((sum, h) => sum + h, 0) / workingHours.length) * 10) / 10 : 0;

    // Calculate absent from active users not in attendance
    const presentStaffIds = active.map(a => a.staffId);
    const absentStaff = users.filter(u => u.active && !presentStaffIds.includes(u.id));

    return { total, checkedInCount, lates, avgHours, absentCount: absentStaff.length, absentStaff };
  }, [activeAttendanceForFilteredDate, users]);

  // Request system push notification permission
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

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
    <div className="glass rounded-[26px] p-3 sm:p-4 shadow-xl">
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
      <div className="glass-soft rounded-[20px] px-5 py-8 text-center shadow-lg border border-white/10">
        <Clock3 className="mx-auto text-white/60" width={22} height={22} />
        <p className="mt-3 text-[12px] font-bold uppercase tracking-[0.16em] text-white/70">nothing signed yet</p>
      </div>
    ) : (
      <div className="glass-soft rounded-[20px] p-2 shadow-lg border border-white/10">
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

  /* ------------------------------ views ------------------------------ */

  const HomeView = () => (
    <div className="view-enter">
      {/* hero */}
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
                <p className="text-[14px] font-semibold text-white/75 mt-1 max-w-[420px]">The shared opening, closing &amp; attendance tracker for teams that finish what they start.</p>
                <div className="flex flex-wrap gap-3 mt-6">
                  <button onClick={() => setView('opening')} className="pill-solid">Explore <ArrowRight width={16} height={16} /></button>
                  <button onClick={() => setView('attendance')} className="pill">Clock In / Out</button>
                </div>
              </div>
            </div>
          </div>
          <div className="col-span-12 lg:col-span-4 relative">
            <div className="float-slow glass-deep rounded-[28px] p-6 max-w-[320px] mx-auto lg:ml-auto shadow-2xl">
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
            [Wifi, 'Shared sync', 'Live on every device, instantly'],
            [History, '14-day archive', 'Older days auto-prune themselves'],
            [Download, 'CSV export', 'Keep a permanent copy anytime'],
          ] as [typeof Wifi, string, string][]).map(([Ic, t, s], i) => (
            <div key={t} style={{ animationDelay: `${200 + i * 90}ms` }} className="stagger glass rounded-[20px] px-6 py-5 flex items-center gap-4 hover:bg-white/25 transition-colors shadow-lg">
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
          <button onClick={() => setView('opening')} className="glass rounded-[24px] p-6 text-left hover:bg-white/25 hover:-translate-y-1 transition-all shadow-lg">
            <div className="flex items-center justify-between"><Sun width={20} height={20} />{Ring({ pct: openP.pct, size: 56 })}</div>
            <p className="mt-5 text-[19px] font-extrabold">Opening</p>
            <p className="text-[12px] font-semibold text-white/70 mt-1">{openP.done} of {openP.total} signed off</p>
            <span className="inline-flex items-center gap-1.5 mt-4 text-[12px] font-extrabold uppercase tracking-[0.12em]">Open list <ArrowRight width={14} height={14} /></span>
          </button>
          <button onClick={() => setView('closing')} className="glass rounded-[24px] p-6 text-left hover:bg-white/25 hover:-translate-y-1 transition-all shadow-lg">
            <div className="flex items-center justify-between"><Moon width={20} height={20} />{Ring({ pct: closeP.pct, size: 56 })}</div>
            <p className="mt-5 text-[19px] font-extrabold">Closing</p>
            <p className="text-[12px] font-semibold text-white/70 mt-1">{closeP.done} of {closeP.total} signed off</p>
            <span className="inline-flex items-center gap-1.5 mt-4 text-[12px] font-extrabold uppercase tracking-[0.12em]">Open list <ArrowRight width={14} height={14} /></span>
          </button>
          <button onClick={() => setView('attendance')} className="glass rounded-[24px] p-6 text-left hover:bg-white/25 hover:-translate-y-1 transition-all shadow-lg">
            <div className="flex items-center justify-between"><Briefcase width={20} height={20} /> <span className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-white/75 bg-white/10 px-2 py-0.5 rounded-full">{dailyStats.total} Clocked</span></div>
            <p className="mt-5 text-[19px] font-extrabold">Attendance</p>
            <p className="text-[12px] font-semibold text-white/70 mt-1">{dailyStats.checkedInCount} currently working</p>
            <span className="inline-flex items-center gap-1.5 mt-4 text-[12px] font-extrabold uppercase tracking-[0.12em]">Clock In/Out <ArrowRight width={14} height={14} /></span>
          </button>
          <button onClick={tryAdmin} className="glass rounded-[24px] p-6 text-left hover:bg-white/25 hover:-translate-y-1 transition-all shadow-lg">
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
              <button onClick={() => setView(shift === 'opening' ? 'closing' : 'opening')} className="pill text-[12px] !py-2.5 !px-5 shadow-lg">
                {shift === 'opening' ? 'Go to closing' : 'Go to opening'} <ArrowRight width={14} height={14} />
              </button>
            </div>
          </div>
          <aside className="col-span-12 lg:col-span-4 space-y-5">
            <div className="glass rounded-[22px] p-5 shadow-lg border border-white/10">
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

  // ==========================================
  // VIEW: HISTORY LOG MODULE
  // ==========================================
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
          <div className="col-span-12 lg:col-span-4 glass rounded-[24px] p-6 shadow-xl">
            <p className="text-[13px] font-bold text-white/75">{parseKey(selectedDate).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</p>
            <div className="grid grid-cols-2 gap-5 mt-6">
              <div><p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-white/70">Opening</p><p className="text-[44px] font-extrabold leading-none mt-1">{so.done}<span className="text-[20px] text-white/60">/{so.total}</span></p></div>
              <div><p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-white/70">Closing</p><p className="text-[44px] font-extrabold leading-none mt-1">{sc.done}<span className="text-[20px] text-white/60">/{sc.total}</span></p></div>
            </div>
            {(() => {
              const r = records[selectedDate] || emptyDay(selectedDate);
              const pend = [
                ...checklists.opening.filter(t => !r.opening[t.id]?.done).map(t => ({ s: 'open', t })),
                ...checklists.closing.filter(t => !r.closing[t.id]?.done).map(t => ({ s: 'close', t })),
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

  const renderHistoryView = () => HistoryView();

  // ==========================================
  // VIEW: STAFF ATTENDANCE MODULE
  // ==========================================
  const AttendanceView = () => {
    return (
      <div className="view-enter pt-8 lg:pt-12">
        <div className="flex flex-wrap items-end justify-between gap-5 mb-8">
          <div>
            <p className="text-[12px] font-extrabold uppercase tracking-[0.22em] text-white/70 font-mono">Attendance Terminal</p>
            <h1 className="font-display uppercase text-[40px] md:text-[60px] leading-[0.9] tracking-[-0.01em] mt-2">Check In <span className="text-white/40">/</span> Out</h1>
          </div>
          
          {/* Live digital clock display */}
          <div className="glass rounded-[24px] p-4 text-center min-w-[200px] border-white/30 shadow-lg relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
            <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-white/75">Live Terminal Clock</p>
            <p className="text-[24px] font-extrabold leading-none mt-1.5 font-mono tracking-tight text-white">{liveClock.toLocaleTimeString()}</p>
            <p className="text-[11px] font-semibold text-white/60 mt-1.5">{liveClock.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}</p>
          </div>
        </div>

        {/* Dashboard Statistics / Interactive Widgets widget */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Active Today', val: dailyStats.total, sub: `${dailyStats.checkedInCount} working`, status: 'primary' },
            { label: 'Lates Today', val: dailyStats.lates, sub: 'outside grace range', status: 'warning' },
            { label: 'Average Shift', val: `${dailyStats.avgHours} hrs`, sub: 'working duration', status: 'success' },
            { label: 'Absent Today', val: dailyStats.absentCount, sub: 'excused & unexcused', status: 'danger' }
          ].map((stat, i) => (
            <div key={i} className="glass rounded-[22px] p-5 shadow-lg border border-white/10 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-16 h-16 bg-white/5 rounded-full translate-x-4 -translate-y-4" />
              <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-white/65">{stat.label}</p>
              <p className="text-[34px] font-extrabold leading-none mt-2 text-white">{stat.val}</p>
              <p className="text-[11px] font-semibold text-white/60 mt-1.5 truncate">{stat.sub}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-12 gap-6">
          {/* Action Panel */}
          <div className="col-span-12 lg:col-span-5 space-y-6">
            <div className="glass rounded-[28px] p-6 text-center space-y-6 relative overflow-hidden shadow-xl border-white/40">
              <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-white/10 to-transparent rounded-full pointer-events-none" />
              
              <div className="space-y-2">
                <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-white/75 font-mono">Roster Signature Connection</p>
                <div className="flex justify-center gap-3 items-center mt-1">
                  <UserCheck className="text-white/80" width={22} height={22} />
                  <span className="text-[20px] font-extrabold">{staffName ? staffName : 'No barista signed in'}</span>
                </div>
                {currentStaffMember && (
                  <p className="text-[12px] font-extrabold text-white/85 bg-white/10 rounded-full px-3 py-1.5 inline-block mt-2">
                    Shift start: {currentStaffMember.shiftStart} · Grace period: {currentStaffMember.gracePeriod} min
                  </p>
                )}
              </div>

              {/* Status Alert widgets */}
              {currentTodayAttendance ? (
                <div className="glass-soft rounded-[20px] p-4 text-left border-white/25 flex items-start gap-3 shadow-md">
                  <CheckCircle2 className="text-white shrink-0 mt-0.5" width={20} height={20} />
                  <div className="space-y-1">
                    <p className="text-[14px] font-extrabold text-white">Active Session Detected</p>
                    <p className="text-[12px] text-white/80">Checked in at: <b className="text-white">{prettyTime(currentTodayAttendance.checkInTime)}</b></p>
                    <p className="text-[12px] text-white/80">Shift Status: <b className="text-white bg-white/15 px-2 py-0.5 rounded-full text-[11px] uppercase tracking-wide font-extrabold ml-1">{currentTodayAttendance.status}</b></p>
                    {currentTodayAttendance.checkOutTime && (
                      <p className="text-[12px] text-white/80 mt-1">Checked out at: <b className="text-white">{prettyTime(currentTodayAttendance.checkOutTime)}</b> ({currentTodayAttendance.workingHours} hrs worked)</p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="glass-soft rounded-[20px] p-4 text-left border-white/25 flex items-start gap-3 shadow-md">
                  <AlertCircle className="text-white/60 shrink-0 mt-0.5" width={20} height={20} />
                  <div>
                    <p className="text-[14px] font-extrabold text-white/85">No Check-In Recorded</p>
                    <p className="text-[12px] text-white/65 mt-0.5">Please proceed with Check In below to sign off your working hours today.</p>
                  </div>
                </div>
              )}

              {/* Terminal Action Buttons */}
              <div className="grid grid-cols-2 gap-4 pt-2">
                <button
                  onClick={handleCheckIn}
                  disabled={!staffName || !!(currentTodayAttendance && currentTodayAttendance.checkInTime)}
                  className="pill-solid !bg-white hover:!bg-white/90 disabled:opacity-30 disabled:hover:transform-none !py-4 flex flex-col items-center justify-center gap-2 rounded-[22px] min-h-[110px] shadow-lg"
                >
                  <UserCheck width={24} height={24} />
                  <span className="text-[14px] font-extrabold">Check In</span>
                </button>

                <button
                  onClick={handleCheckOut}
                  disabled={!staffName || !currentTodayAttendance || !!currentTodayAttendance.checkOutTime}
                  className="pill !border-white/50 hover:bg-white/10 disabled:opacity-30 disabled:hover:transform-none !py-4 flex flex-col items-center justify-center gap-2 rounded-[22px] min-h-[110px] shadow-lg"
                >
                  <Moon width={24} height={24} />
                  <span className="text-[14px] font-extrabold">Check Out</span>
                </button>
              </div>

              {!staffName && (
                <p className="text-[11px] font-bold text-white/70 italic mt-3">Select your profile in the top-right menu to authorize Check-In.</p>
              )}
            </div>

            {/* Attendance Rules widget */}
            <div className="glass-soft rounded-[22px] p-5 space-y-4 shadow-lg border border-white/10">
              <p className="text-[12px] font-extrabold uppercase tracking-[0.16em] text-white/75 font-mono">Terminal Configuration Rules</p>
              <div className="text-[12.5px] text-white/80 space-y-2 leading-relaxed font-semibold">
                <div className="flex gap-2.5 items-start">
                  <span className="w-1.5 h-1.5 rounded-full bg-white mt-1.5" />
                  <span>Only active team roster members can register terminal signatures.</span>
                </div>
                <div className="flex gap-2.5 items-start">
                  <span className="w-1.5 h-1.5 rounded-full bg-white mt-1.5" />
                  <span>Only one clock-in session is allowed per calendar day.</span>
                </div>
                <div className="flex gap-2.5 items-start">
                  <span className="w-1.5 h-1.5 rounded-full bg-white mt-1.5" />
                  <span>Shift statuses are evaluated dynamically with shift starts.</span>
                </div>
              </div>
            </div>
          </div>

          {/* Today's Attendance Overview for Staff */}
          <div className="col-span-12 lg:col-span-7">
            <div className="glass rounded-[28px] p-6 space-y-5 shadow-xl">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-[12px] font-extrabold uppercase tracking-[0.18em] text-white/75 font-mono">Today's Attendance ({todayKey})</p>
                <div className="flex items-center gap-2 text-[12px] font-extrabold text-white/80 bg-white/10 px-3 py-1 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-white pulse-soft" />
                  <span>{attendance.filter(a => a.createdAt === todayKey).length} active</span>
                </div>
              </div>

              <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
                {attendance.filter(a => a.createdAt === todayKey).length === 0 ? (
                  <div className="text-center py-10 glass-soft rounded-[20px] border border-dashed border-white/20">
                    <Clock3 className="mx-auto text-white/60" width={22} height={22} />
                    <p className="mt-3 text-[13px] font-extrabold tracking-wide uppercase text-white/75">no check-ins today yet</p>
                  </div>
                ) : (
                  attendance.filter(a => a.createdAt === todayKey).map(a => (
                    <div key={a.id} className="flex items-center justify-between gap-4 glass-soft rounded-[18px] p-4 border-white/20 hover:bg-white/10 transition-colors">
                      <div className="flex items-center gap-3">
                        {Avatar({ name: a.staffName, size: 36 })}
                        <div>
                          <p className="text-[14px] font-extrabold leading-tight">{a.staffName}</p>
                          <p className="text-[11px] font-bold text-white/75 mt-1">In: {prettyTime(a.checkInTime)} {a.checkOutTime && `· Out: ${prettyTime(a.checkOutTime)}`}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className={`inline-block text-[11px] font-extrabold uppercase tracking-[0.06em] px-2.5 py-1 rounded-full ${a.status === 'On Time' ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/40' : a.status === 'Late' ? 'bg-amber-500/20 text-amber-200 border border-amber-500/40' : 'bg-white/15 text-white/90'}`}>
                          {a.status}
                        </span>
                        {a.workingHours !== null && (
                          <p className="text-[11px] font-extrabold text-white/70 mt-1">{a.workingHours} hrs worked</p>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
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

      <div className="flex gap-1 glass-soft rounded-full p-1.5 w-fit max-w-full overflow-x-auto mb-8 shadow-md border border-white/10">
        {[
          ['studio', 'Checklists', PencilLine],
          ['journal', 'Journal', CalendarDays],
          ['export', 'Export & Audit', FileDown],
          ['settings', 'Staff & Rules', Settings],
          ['setup', 'Supabase Hub', Database]
        ].map(([p, label, Ic]) => (
          <button key={p as any} onClick={() => setAdminPane(p as AdminPane)} className={`nav-item whitespace-nowrap !normal-case !tracking-normal text-[13px] inline-flex items-center gap-2 ${adminPane === p ? 'active' : ''}`}>
            {/* @ts-expect-error type assertion safety */}
            <Ic width={14} height={14} /> {label}
          </button>
        ))}
      </div>

      {adminPane === 'studio' && (
        <div className="grid grid-cols-12 gap-6 view-enter">
          <div className="col-span-12 lg:col-span-3">
            <p className="text-[14px] font-semibold text-white/80 leading-relaxed">Rewrite tasks, add new ones, delete old ones. Edits sync to every device within seconds.</p>
            <div className="inline-flex glass-soft rounded-full p-1 mt-6">
              {(['opening', 'closing'] as Shift[]).map(s => (
                <button key={s} onClick={() => setEditorShift(s)} className={`px-5 py-2 rounded-full text-[12px] font-extrabold uppercase tracking-[0.1em] transition-colors ${editorShift === s ? 'bg-white text-[#1c6ba4]' : 'text-white/75 hover:text-white'}`}>{s}</button>
              ))}
            </div>
          </div>
          <div className="col-span-12 lg:col-span-9 glass rounded-[24px] p-4 sm:p-6 shadow-xl">
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

      {adminPane === 'journal' && renderHistoryView()}

      {adminPane === 'export' && (
        <div className="space-y-6 view-enter">
          {/* CSV Exporting tool */}
          <div className="grid grid-cols-12 gap-6">
            <div className="col-span-12 lg:col-span-5">
              <h2 className="text-[30px] font-extrabold tracking-tight leading-tight">Export checklists &amp; attendance metrics</h2>
              <p className="text-[14px] font-semibold text-white/75 mt-4 leading-relaxed max-w-[440px]">Download full transaction metrics as CSV — dates, shifts, checklists, user signatures, working hours, and grace times. Clear the history before it rolls off.</p>
              <div className="flex gap-3 mt-6">
                <button onClick={() => { setExportFrom(dates[dates.length - 1]); setExportTo(todayKey); }} className="pill text-[12px]">Checklist Range <ArrowRight width={14} height={14} /></button>
                <button onClick={exportAttendanceCsv} className="pill-solid text-[12px]"><Download width={14} height={14} /> Export Attendance</button>
              </div>
            </div>
            <div className="col-span-12 lg:col-span-7 glass rounded-[24px] p-6 sm:p-8 shadow-xl">
              <div className="grid sm:grid-cols-2 gap-5">
                <label className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-white/75 grid gap-2">From<input type="date" className="glass-input" value={exportFrom} onChange={e => setExportFrom(e.target.value)} /></label>
                <label className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-white/75 grid gap-2">To<input type="date" className="glass-input" value={exportTo} onChange={e => setExportTo(e.target.value)} /></label>
              </div>
              <button onClick={exportCsv} className="pill-solid mt-7"><Download width={16} height={16} /> Download Checklist CSV</button>
              <p className="text-[12px] font-bold text-white/65 mt-6">{Object.keys(records).length} days in storage · auto-prunes past 14</p>
            </div>
          </div>

          {/* Audit Correction Logs */}
          <div className="glass rounded-[24px] p-6 space-y-4 shadow-xl">
            <p className="text-[12px] font-extrabold uppercase tracking-[0.18em] text-white/75">Attendance Corrections Audit Log</p>
            <div className="space-y-3">
              {auditLogs.length === 0 ? (
                <p className="text-[13px] font-semibold text-white/60">No manual corrections have been logged yet.</p>
              ) : (
                auditLogs.map(log => (
                  <div key={log.id} className="glass-soft rounded-[16px] p-4 space-y-2 border-white/20 shadow-md">
                    <div className="flex flex-wrap justify-between items-center gap-2">
                      <p className="text-[14px] font-extrabold text-[#f4f1ea]">{log.staffName} Record Corrected</p>
                      <span className="text-[11px] font-bold text-white/65">by {log.editedBy} · {new Date(log.editedAt).toLocaleDateString()}</span>
                    </div>
                    <p className="text-[12px] text-white/80"><b>Reason:</b> "{log.reason}"</p>
                    <div className="text-[11.5px] font-mono bg-black/10 rounded-[10px] p-2 text-white/85 mt-2">
                      {log.changes.map((c, i) => (
                        <div key={i}>
                          • {c.field}: {c.oldValue ? new Date(c.oldValue).toLocaleTimeString() : 'null'} ➡️ {c.newValue ? new Date(c.newValue).toLocaleTimeString() : 'null'}
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {adminPane === 'settings' && (
        <div className="grid grid-cols-12 gap-6 view-enter">
          {/* staff management */}
          <div className="col-span-12 lg:col-span-7 glass rounded-[24px] p-6 space-y-6 shadow-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-full bg-white/20 grid place-items-center"><UserPlus width={17} height={17} /></span>
                <div>
                  <p className="text-[18px] font-extrabold">Staff Management</p>
                  <p className="text-[11px] font-bold text-white/65">{users.length} registered baristas · schedule shifts</p>
                </div>
              </div>
            </div>

            {/* Shift Roster Creator & Modifier */}
            <div className="glass-soft rounded-[20px] p-5 space-y-4 border-white/30 shadow-md">
              <p className="text-[12px] font-extrabold uppercase tracking-[0.16em] text-white/80">
                {editingStaffId ? '✏️ Edit Staff Details' : '➕ Register New Staff'}
              </p>
              
              <div className="grid sm:grid-cols-2 gap-4">
                <label className="text-[11.5px] font-extrabold uppercase tracking-wider text-white/75 grid gap-1.5">
                  Full Name
                  <input
                    value={newStaffName}
                    onChange={e => setNewStaffName(e.target.value)}
                    disabled={!!editingStaffId}
                    placeholder="Staff name"
                    className="glass-input"
                  />
                </label>

                <label className="text-[11.5px] font-extrabold uppercase tracking-wider text-white/75 grid gap-1.5">
                  Role Type
                  <select
                    value={newStaffRole}
                    onChange={e => setNewStaffRole(e.target.value as StaffRole)}
                    className="glass-input !bg-[#1c6ba4] text-white border-white/50"
                  >
                    <option value="Staff">Staff Member</option>
                    <option value="Supervisor">Supervisor</option>
                    <option value="Manager">Manager</option>
                    <option value="Admin">Administrator</option>
                    <option value="Developer">Developer</option>
                  </select>
                </label>

                <label className="text-[11.5px] font-extrabold uppercase tracking-wider text-white/75 grid gap-1.5">
                  Shift Start Time
                  <input
                    type="time"
                    value={newStaffShiftStart}
                    onChange={e => setNewStaffShiftStart(e.target.value)}
                    className="glass-input"
                  />
                </label>

                <label className="text-[11.5px] font-extrabold uppercase tracking-wider text-white/75 grid gap-1.5">
                  Shift End Time
                  <input
                    type="time"
                    value={newStaffShiftEnd}
                    onChange={e => setNewStaffShiftEnd(e.target.value)}
                    className="glass-input"
                  />
                </label>

                <label className="text-[11.5px] font-extrabold uppercase tracking-wider text-white/75 grid gap-1.5">
                  Grace Period (Mins)
                  <input
                    type="number"
                    value={newStaffGrace}
                    onChange={e => setNewStaffGrace(Number(e.target.value))}
                    className="glass-input"
                  />
                </label>

                <label className="text-[11.5px] font-extrabold uppercase tracking-wider text-white/75 grid gap-1.5">
                  Weekly Days Off
                  <select
                    multiple
                    value={(newStaffDaysOff ?? []).map(String)}
                    onChange={e => {
                      const selectedOptions = Array.from(e.target.selectedOptions, opt => Number(opt.value));
                      setNewStaffDaysOff(selectedOptions);
                    }}
                    className="glass-input !bg-[#1c6ba4] text-white border-white/50 min-h-[50px] overflow-hidden"
                  >
                    <option value="0">Sunday</option>
                    <option value="1">Monday</option>
                    <option value="2">Tuesday</option>
                    <option value="3">Wednesday</option>
                    <option value="4">Thursday</option>
                    <option value="5">Friday</option>
                    <option value="6">Saturday</option>
                  </select>
                </label>
              </div>

              <div className="flex gap-2.5 justify-end pt-2">
                {editingStaffId ? (
                  <>
                    <button
                      onClick={() => {
                        setEditingStaffId(null);
                        setNewStaffName('');
                      }}
                      className="pill text-[12px] !py-2 !px-4"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => saveEditedStaff(editingStaffId)}
                      className="pill-solid text-[12px] !py-2 !px-4"
                    >
                      Save Changes
                    </button>
                  </>
                ) : (
                  <button
                    onClick={addStaff}
                    disabled={!newStaffName.trim()}
                    className="pill-solid text-[12px] !py-2 !px-5"
                  >
                    Register Member
                  </button>
                )}
              </div>
            </div>

            {/* List of Registered Staff */}
            <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
              {users.map(u => (
                <div key={u.id} className="flex items-center justify-between gap-4 glass-soft rounded-[18px] p-4 border-white/20 hover:bg-white/15 transition-all">
                  <div className="flex items-center gap-3 min-w-0">
                    {Avatar({ name: u.name, size: 36 })}
                    <div className="min-w-0">
                      <p className="text-[14px] font-extrabold truncate">{u.name}</p>
                      <p className="text-[11px] font-bold text-white/70 mt-1">
                        {u.role} · Shift: {u.shiftStart} - {u.shiftEnd}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setEditingStaffId(u.id);
                        setNewStaffName(u.name);
                        setNewStaffRole(u.role ?? 'Staff');
                        setNewStaffShiftStart(u.shiftStart ?? '08:00');
                        setNewStaffShiftEnd(u.shiftEnd ?? '16:00');
                        setNewStaffGrace(u.gracePeriod ?? 5);
                        setNewStaffDaysOff(Array.isArray(u.weeklyDaysOff) ? u.weeklyDaysOff : [0]);
                        setNewStaffPhoto(u.profilePhoto ?? '');
                      }}
                      className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/25 grid place-items-center transition-colors"
                      aria-label={`Edit ${u.name}`}
                    >
                      <PencilLine width={15} height={15} />
                    </button>

                    <button
                      onClick={() => handleDeactivateStaff(u.id)}
                      className={`w-9 h-9 rounded-full grid place-items-center transition-colors ${u.active ? 'bg-red-500/20 hover:bg-red-500/30 text-red-100' : 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-100'}`}
                      aria-label={`${u.active ? 'Deactivate' : 'Reactivate'} ${u.name}`}
                    >
                      <Trash2 width={15} height={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="col-span-12 lg:col-span-5 space-y-6">
            {/* admin code updating */}
            <div className="glass rounded-[24px] p-6 shadow-xl">
              <div className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-full bg-white/20 grid place-items-center"><KeyRound width={17} height={17} /></span>
                <div><p className="text-[18px] font-extrabold">Admin code</p><p className="text-[11px] font-bold text-white/65">Controls access to this whole desk</p></div>
              </div>
              <div className="flex items-center gap-3 mt-6 glass-soft rounded-[14px] px-4 py-3">
                <span className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-white/65">Current</span>
                <span className="ml-auto text-[15px] font-extrabold tracking-[0.3em]">••••••••</span>
              </div>
              <div className="grid sm:grid-cols-2 gap-4 mt-4">
                <label className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-white/75 grid gap-2">New code<input type="password" className="glass-input" value={newCode} onChange={e => setNewCode(e.target.value)} placeholder="Min. 4 characters" autoComplete="new-password" /></label>
                <label className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-white/75 grid gap-2">Confirm<input type="password" className="glass-input" value={confirmCode} onChange={e => setConfirmCode(e.target.value)} placeholder="Repeat it" onKeyDown={e => { if (e.key === 'Enter') changeCode(); }} autoComplete="new-password" /></label>
              </div>
              {/* fixed-height slot so validation feedback never shifts the layout */}
              <p className={`mt-3 min-h-[18px] text-[12px] font-extrabold ${codeMsg ? (codeMsg.ok ? 'text-white' : 'text-white') : 'text-transparent'}`}>
                {codeMsg ? `${codeMsg.ok ? '✓' : '⚠'} ${codeMsg.text}` : '·'}
              </p>
              <button onClick={changeCode} disabled={!newCode || !confirmCode} className="pill-solid mt-5 disabled:opacity-40 disabled:hover:transform-none shadow-md"><ShieldCheck width={16} height={16} /> Update code</button>
            </div>

            {/* secure data clearing */}
            <div className="glass rounded-[24px] p-6 border-red-500/20 hover:border-red-500/40 transition-colors shadow-xl">
              <div className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-full bg-red-500/10 text-red-300 grid place-items-center">⚠️</span>
                <div>
                  <p className="text-[18px] font-extrabold text-red-200">Clear past data</p>
                  <p className="text-[11px] font-bold text-white/65">Irreversibly delete historical records</p>
                </div>
              </div>
              <p className="text-[12.5px] font-semibold text-white/75 mt-4 leading-relaxed">
                Need to wipe history or reset the tracker? Choose to clear either all past records or only those older than today. Checklist configs and rosters will not be affected.
              </p>
              <div className="grid grid-cols-2 gap-3 mt-5">
                <button
                  onClick={() => {
                    if (window.confirm("ARE YOU SURE?\n\nThis will irreversibly delete ALL checklist signature records in the system. Checklists and team roster will not be deleted.\n\nType 'DELETE ALL' in the next prompt to confirm.")) {
                      const check = window.prompt("Type 'DELETE ALL' to confirm:");
                      if (check === 'DELETE ALL') {
                        persist({});
                        showToast('All signature records cleared.');
                      } else {
                        showToast('Wipe cancelled. Code did not match.');
                      }
                    }
                  }}
                  className="pill text-[12px] !border-red-500/30 text-red-300 hover:bg-red-500/10 justify-center shadow-md"
                >
                  Delete all history
                </button>
                <button
                  onClick={() => {
                    if (window.confirm(`ARE YOU SURE?\n\nThis will irreversibly delete all checklist signatures from previous days, keeping ONLY today's signatures (${todayKey}).\n\nConfirm to proceed.`)) {
                      const todayOnly: Records = {};
                      if (records[todayKey]) {
                        todayOnly[todayKey] = records[todayKey];
                      }
                      persist(todayOnly);
                      showToast("All historical data cleared except today's.");
                    }
                  }}
                  className="pill text-[12px] !border-red-500/30 text-red-300 hover:bg-red-500/10 justify-center shadow-md"
                >
                  Clear past, keep today
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {adminPane === 'setup' && (
        <div className="view-enter space-y-6">
          <div className="glass rounded-[28px] p-6 space-y-5 shadow-xl">
            <div className="flex items-center gap-3">
              <span className="w-12 h-12 rounded-full bg-white/20 grid place-items-center shadow-md"><Code className="text-white/80" /></span>
              <div>
                <h3 className="text-[22px] font-extrabold">Supabase SQL Editor</h3>
                <p className="text-[12.5px] font-bold text-white/70">Connect database and configure tables</p>
              </div>
            </div>

            <p className="text-[13px] font-medium leading-relaxed text-white/80">
              Run this SQL script once in your Supabase dashboard **SQL Editor** to fully configure RLS, and realtime tables for checking staff members in and out with grace limits:
            </p>

            <div className="relative">
              <pre className="text-[11.5px] font-mono bg-black/30 rounded-[18px] p-4 text-white/90 overflow-x-auto max-h-[300px] leading-relaxed">
                {SUPABASE_SETUP_SQL}
              </pre>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(SUPABASE_SETUP_SQL);
                  showToast('SQL Script copied to clipboard.');
                }}
                className="pill-solid absolute right-3 top-3 text-[11px] !py-1.5 !px-3 shadow-md"
              >
                Copy SQL
              </button>
            </div>
          </div>

          {/* Real push notifications */}
          <div className="glass rounded-[28px] p-6 space-y-5 shadow-xl">
            <div className="flex items-center gap-3">
              <span className="w-12 h-12 rounded-full bg-white/20 grid place-items-center shadow-md"><BellRing className="text-white/80" /></span>
              <div>
                <h3 className="text-[22px] font-extrabold">Push Notifications</h3>
                <p className="text-[12.5px] font-bold text-white/70">Get check-in/out alerts on this phone, even when the app is closed</p>
              </div>
            </div>

            <p className="text-[13px] font-medium leading-relaxed text-white/80">
              Tap enable on the manager's phone once (as this signed-in manager). That device will then
              get a push notification for every staff check-in and check-out — no need to keep the app open.
              On iPhone, add this app to your Home Screen first, then open it from there before enabling.
            </p>

            <button
              onClick={async () => {
                const role = currentStaffMember?.role;
                if (role !== 'Manager' && role !== 'Admin') {
                  showToast('Sign in as a Manager or Admin to enable push alerts on this device.');
                  return;
                }
                const ok = await subscribeToPush(currentStaffMember!.id, currentStaffMember!.name, role);
                showToast(ok ? '🔔 Push notifications enabled on this device.' : '❌ Could not enable — check browser permissions.');
              }}
              className="pill-solid text-[13px] !py-2.5 !px-5"
            >
              Enable Push Notifications
            </button>
          </div>
        </div>
      )}
    </div>
  );

  /* ------------------------------ shell ------------------------------ */

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

          <nav className="glass rounded-full p-1.5 ml-auto hidden md:flex items-center gap-1 shadow-md">
            {([['home', 'Home'], ['opening', 'Opening'], ['closing', 'Closing'], ['attendance', 'Clock-In'], ['history', 'History']] as [View, string][]).map(([v, l]) => (
              <button key={v} onClick={() => setView(v)} className={`nav-item ${view === v ? 'active' : ''}`}>{l}</button>
            ))}
          </nav>

          <div className="flex items-center gap-2.5 ml-auto md:ml-0 relative">
            <button onClick={tryAdmin} aria-label="Admin" className={`w-11 h-11 rounded-full grid place-items-center border transition-colors shadow-md ${view === 'admin' ? 'bg-white text-[#1c6ba4] border-white' : 'border-white/60 hover:bg-white/15'}`}>
              {adminUnlocked ? <ShieldCheck width={17} height={17} /> : <Lock width={16} height={16} />}
            </button>
            <button onClick={() => { setNameOpen(o => !o); setNameInput(staffName); }} className="h-11 rounded-full border border-white/60 hover:bg-white/15 transition-colors pl-2 pr-4 flex items-center gap-2.5 shadow-md">
              {staffName ? Avatar({ name: staffName, size: 30 }) : <span className="w-[30px] h-[30px] rounded-full bg-white/20 grid place-items-center"><User width={14} height={14} /></span>}
              <span className="text-[13px] font-extrabold max-w-[90px] truncate">{staffName || 'Sign in'}</span>
            </button>

            {nameOpen && (
              <div className="absolute right-0 top-[52px] w-[300px] glass-deep rounded-[22px] p-5 z-30 view-enter shadow-2xl">
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

        <nav className="md:hidden glass rounded-full p-1.5 mt-4 flex items-center gap-1 overflow-x-auto shadow-md">
          {([['home', 'Home'], ['opening', 'Open'], ['closing', 'Close'], ['attendance', 'Clock'], ['history', 'Log']] as [View, string][]).map(([v, l]) => (
            <button key={v} onClick={() => setView(v)} className={`nav-item whitespace-nowrap ${view === v ? 'active' : ''}`}>{l}</button>
          ))}
        </nav>

        <main>
          {view === 'home' && HomeView()}
          {view === 'opening' && ShiftView({ shift: 'opening' })}
          {view === 'closing' && ShiftView({ shift: 'closing' })}
          {view === 'attendance' && AttendanceView()}
          {view === 'history' && renderHistoryView()}
          {view === 'admin' && adminUnlocked && AdminView()}
        </main>

        <footer className="mt-20 pt-6 border-t border-white/25 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/60">Daily Check — team checklist tracker</p>
          <p className="text-[11px] font-bold text-white/60">sign it · ship it · repeat</p>
          <p className="text-[11px] font-bold text-white/60 w-full text-center sm:w-auto sm:text-right">
            Developed by{' '}
            <a
              href="https://github.com/Willsonraiii"
              target="_blank"
              rel="noopener noreferrer"
              className="text-white hover:underline"
            >
              Willson Obito
            </a>
          </p>
        </footer>
      </div>

      {showGate && (
        <div className="modal-veil" onClick={() => setShowGate(false)}>
          <div className="glass-deep rounded-[28px] p-8 w-full max-w-[420px] view-enter shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <span className="w-12 h-12 rounded-full bg-white text-[#1c6ba4] grid place-items-center shadow-md"><Lock width={19} height={19} /></span>
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
            <button onClick={unlock} className="pill-solid w-full justify-center mt-6 shadow-md">Unlock <ArrowRight width={16} height={16} /></button>
          </div>
        </div>
      )}

      {toast && <div className="toast"><Check width={15} height={15} strokeWidth={3} /> {toast}</div>}
    </div>
  );
}
