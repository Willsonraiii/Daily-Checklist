import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight, CalendarDays, Check, ChevronLeft, ChevronRight, ClipboardList,
  Clock3, Download, FileDown, History, KeyRound, Lock, Moon, PencilLine, Plus,
  Settings, ShieldCheck, Sun, Trash2, User, UserPlus, Wifi, X,
  Briefcase, CheckCircle2, AlertCircle, UserCheck, Code, BellRing, Database, TrendingUp, Flame,
  Terminal, UserX, RotateCw, Save
} from 'lucide-react';
import { motion, AnimatePresence, type Variants } from 'framer-motion';

import {
  probeCloud, subscribeCloud, writeCloud, adminWrite, verifyAdminCode, changeAdminCode,
  enqueueWrite, flushQueue,
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

// Developer access code — enter this in the admin gate to unlock the hidden
// Developer desk (raw data console). Admins never see it.
const DEV_CODE = 'willson.dev';

type StaffRole = 'Admin' | 'Developer' | 'Manager' | 'Supervisor' | 'Staff';
type StaffMember = {
  id: string;
  name: string;
  role: StaffRole;
  shiftStart: string;
  shiftEnd: string;
  gracePeriod: number;
  weeklyDaysOff: number[];
  active: boolean;
  profilePhoto: string;
  pin?: string;
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

const AVATAR_COLORS = ['#e4c078', '#8b7cf7', '#4fd1c5', '#fb7185', '#a3e635', '#60a5fa', '#fbbf24', '#f472b6'];
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
type AdminPane = 'studio' | 'journal' | 'export' | 'settings' | 'insights' | 'setup' | 'developer';
type TaskDef = { id: string; label: string; detail: string };
type ChecklistConfig = Record<Shift, TaskDef[]>;
type TaskLog = { done: boolean; staff: string; ts: string };
type DayRecord = { date: string; opening: Record<string, TaskLog>; closing: Record<string, TaskLog> };
type Records = Record<string, DayRecord>;
type ActivityEvent = { shift: Shift; task: TaskDef; log: TaskLog };

type AttendanceStatus = 'On Time' | 'Late' | 'Half Day' | 'Absent' | 'Checked Out';
type AttendanceRecord = {
  id: string;
  staffId: string;
  staffName: string;
  checkInTime: string;
  checkOutTime: string | null;
  workingHours: number | null;
  status: AttendanceStatus;
  createdAt: string;
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
function haptic(pattern: number | number[] = 12) { try { navigator.vibrate?.(pattern); } catch { /* unsupported */ } }

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
      profilePhoto: typeof u.profilePhoto === 'string' ? u.profilePhoto : '',
      pin: typeof u.pin === 'string' && u.pin.length >= 4 ? u.pin : undefined
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

// ==========================================
// MOTION PRIMITIVES
// ==========================================
const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const REDUCE_MOTION = typeof navigator !== 'undefined' && navigator.platform !== undefined && /Mobi|Android/i.test(navigator.userAgent) ? false : true;

const staggerParent: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05, delayChildren: 0.05 } },
};
const riseItem: Variants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE } },
};
const pageVariants: Variants = {
  enter: (dir: number) => ({ opacity: 0, x: dir * 48 }),
  center: { opacity: 1, x: 0 },
  exit: (dir: number) => ({ opacity: 0, x: dir * -48 }),
};

const VIEW_ORDER: View[] = ['home', 'opening', 'closing', 'attendance', 'history', 'admin'];
const ADMIN_PANE_ORDER: AdminPane[] = ['studio', 'journal', 'insights', 'export', 'settings', 'setup', 'developer'];

// ==========================================
// PRESENTATIONAL COMPONENTS
// ==========================================
function Ring({ pct, size = 64 }: { pct: number; size?: number }) {
  const r = (size - 8) / 2; const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      <circle className="ring-track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="5" />
      <motion.circle
        className="ring-fill"
        cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="5" strokeLinecap="round"
        strokeDasharray={c}
        initial={false}
        animate={{ strokeDashoffset: c - (c * pct) / 100 }}
        transition={{ duration: 0.9, ease: EASE }}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="52%" dominantBaseline="middle" textAnchor="middle" fill="var(--ring-label)" fontSize={size / 4.4} fontWeight="800" fontFamily="Manrope">{pct}%</text>
    </svg>
  );
}

function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  return (
    <span className="rounded-full grid place-items-center font-extrabold text-[#14121c] shrink-0 ring-1 ring-white/25" style={{ width: size, height: size, background: colorFor(name), fontSize: size * 0.38 }}>
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
}

function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="glass-soft rounded-[18px] p-4 flex items-center gap-3">
          <span className="skeleton w-9 h-9 rounded-full shrink-0" />
          <span className="flex-1 space-y-2">
            <span className="skeleton block h-3 rounded-full" style={{ width: `${72 - i * 8}%` }} />
            <span className="skeleton block h-2.5 rounded-full" style={{ width: `${46 - i * 5}%` }} />
          </span>
        </div>
      ))}
    </div>
  );
}

function LogList({ events, limit }: { events: ActivityEvent[]; limit?: number }) {
  if (events.length === 0) {
    return (
      <div className="glass-soft rounded-[20px] px-5 py-8 text-center">
        <Clock3 className="mx-auto text-white/50" width={22} height={22} />
        <p className="mt-3 text-[12px] font-bold uppercase tracking-[0.16em] text-white/60">nothing signed yet</p>
      </div>
    );
  }
  return (
    <motion.div
  variants={staggerParent}
  initial="hidden"
  animate="show"
  className={`glass-soft rounded-[20px] p-2 ${REDUCE_MOTION && 'transition-none'} ``
  
      {(limit ? events.slice(0, limit) : events).map((e, i) => (
        <motion.div variants={riseItem} key={e.task.id + "-" + i} className="flex items-center gap-3 px-4 py-3 rounded-[20px]-3 rounded-[14px] hover:bg-white/[0.05] transition-colors">
          <span className={`w-8 h-8 rounded-full grid place-items-center shrink-0 ${e.shift === 'opening' ? 'bg-amber-300/15 text-amber-200' : 'bg-violet-400/15 text-violet-200'}`}>
            {e.shift === 'opening' ? <Sun width={14} height={14} /> : <Moon width={14} height={14} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-extrabold leading-tight truncate">{e.task.label}</span>
            <span className="block text-[11px] font-semibold text-white/55 mt-0.5">{e.log.staff} · {e.shift}</span>
          </span>
          <time className="text-[11px] font-bold text-white/70 shrink-0 tabular-nums">{prettyTime(e.log.ts)}</time>
        </motion.div>
      ))}
    </motion.div>
  );
}

function TaskList({ tasks, logs, onToggle, justChecked }: {
  tasks: TaskDef[];
  logs: Record<string, TaskLog>;
  onToggle: (taskId: string) => void;
  justChecked: string | null;
}) {
  return (
    <div className="glass rounded-[26px] p-3 sm:p-4">
      <motion.div variants={staggerParent} initial="hidden" animate="show">
        {tasks.map((task, i) => {
          const log = logs[task.id];
          const done = Boolean(log?.done);
          return (
            <motion.button
              variants={riseItem}
              key={task.id}
              onClick={() => onToggle(task.id)}
              whileTap={{ scale: 0.985 }}
              className={`task-row ${done ? 'done' : ''}`}
            >
              <span className="pt-1.5 text-[12px] font-extrabold text-white/35 tabular-nums">{String(i + 1).padStart(2, '0')}</span>
              <motion.span
                className={`task-box ${done ? 'on' : ''}`}
                whileTap={{ scale: 0.82 }}
                animate={justChecked === task.id ? { scale: [1, 1.32, 1], rotate: [0, -6, 0] } : { scale: 1, rotate: 0 }}
                transition={{ duration: 0.45, ease: EASE }}
              >
                <AnimatePresence>
                  {done && (
                    <motion.svg width="15" height="15" viewBox="0 0 15 15" fill="none" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0 }}>
                      <motion.path d="M2.5 8L6 11.5L12.5 4" stroke="#241a07" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"
                        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.32, ease: EASE }}
                      />
                    </motion.svg>
                  )}
                </AnimatePresence>
              </motion.span>
              <span className="min-w-0">
                <span className={`block text-[16px] font-extrabold leading-tight ${done ? 'task-label-done' : ''}`}>{task.label}</span>
                <span className="block text-[12.5px] font-medium text-white/55 mt-0.5 leading-snug">{task.detail}</span>
                <AnimatePresence>
                  {log && (
                    <motion.span
                      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                      className="sign-stamp inline-flex items-center gap-1.5 mt-2 text-[11px] font-bold"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-300 pulse-soft" /> {log.staff} · {prettyTime(log.ts)}
                    </motion.span>
                  )}
                </AnimatePresence>
              </span>
              <ChevronRight className={`mt-2.5 ${done ? 'text-amber-200/80' : 'text-white/25'}`} width={17} height={17} />
            </motion.button>
          );
        })}
      </motion.div>
    </div>
  );
}

export default function App() {
  const [records, setRecords] = useState<Records>({});
  const [checklists, setChecklists] = useState<ChecklistConfig>({ opening: [...DEFAULT_CHECKLISTS.opening], closing: [...DEFAULT_CHECKLISTS.closing] });
  const [users, setUsers] = useState<StaffMember[]>(DEFAULT_USERS);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [cloudStatus, setCloudStatus] = useState<'checking' | 'off' | CloudStatus>('checking');
  const [view, setViewState] = useState<View>('home');
  const [staffName, setStaffName] = useState('');
  const [nameOpen, setNameOpen] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [tagIndex, setTagIndex] = useState(0);
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [showGate, setShowGate] = useState(false);
  const [gateCode, setGateCode] = useState('');
  const [gateError, setGateError] = useState('');
  const [adminPane, setPaneState] = useState<AdminPane>('settings');
  const [editorShift, setEditorShift] = useState<Shift>('opening');

  const [selectedDate, setSelectedDate] = useState(formatKey(new Date()));
  const [attendanceFilterDate, setAttendanceFilterDate] = useState(formatKey(new Date()));
  const [exportFrom, setExportFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 13); return formatKey(d); });
  const [exportTo, setExportTo] = useState(() => formatKey(new Date()));

  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffRole, setNewStaffRole] = useState<StaffRole>('Staff');
  const [newStaffShiftStart, setNewStaffShiftStart] = useState('08:00');
  const [newStaffShiftEnd, setNewStaffShiftEnd] = useState('16:00');
  const [newStaffGrace, setNewStaffGrace] = useState(5);
  const [newStaffDaysOff, setNewStaffDaysOff] = useState<number[]>([0]);
  const [newStaffPhoto, setNewStaffPhoto] = useState('');
  const [newStaffPin, setNewStaffPin] = useState('');
  const [editingStaffId, setEditingStaffId] = useState<string | null>(null);

  const [newCode, setNewCode] = useState('');
  const [confirmCode, setConfirmCode] = useState('');
  const [codeMsg, setCodeMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [toast, setToast] = useState('');
  const [justChecked, setJustChecked] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [liveClock, setLiveClock] = useState(new Date());
  const [devUnlocked, setDevUnlocked] = useState(false);
  const [devStoreKey, setDevStoreKey] = useState<'records' | 'users' | 'attendance' | 'checklists'>('records');
  const [devJson, setDevJson] = useState('');

  // swipe/gesture state for tab navigation
  const [swipeStartX, setSwipeStartX] = useState(0);
  const [swipeX, setSwipeX] = useState(0);
  const swipeThreshold = 30; // minimum pixels to register as swipe
  const [swipeComplete, setSwipeComplete] = useState(false);

  const [viewDir, setViewDir] = useState(1);
  const [paneDir, setPaneDir] = useState(1);
  const viewRef = useRef(view);
  viewRef.current = view;
  const paneRef = useRef(adminPane);
  paneRef.current = adminPane;

  const goView = (v: View) => {
    const from = VIEW_ORDER.indexOf(viewRef.current);
    const to = VIEW_ORDER.indexOf(v);
    setViewDir(to >= from ? 1 : -1);
    setViewState(v);
  };

  const goPane = (p: AdminPane) => {
    setPaneDir(ADMIN_PANE_ORDER.indexOf(p) >= ADMIN_PANE_ORDER.indexOf(paneRef.current) ? 1 : -1);
    setPaneState(p);
  };

  // touch/gesture handlers for mobile swipe between views
  useEffect(() => {
    let touchStartX = 0;
    let isMoving = false;

    const handleTouchStart = (e: TouchEvent) => {
      touchStartX = e.touches[0].clientX;
      isMoving = true;
      setSwipeX(touchStartX);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isMoving) return;
      const currentX = e.touches[0].clientX;
      const diff = touchStartX - currentX;
      setSwipeX(currentX);
      // visualize swipe progress during drag
      if (Math.abs(diff) > swipeThreshold) {
        e.preventDefault();
        setSwipeComplete(diff > 0 ? -1 : 1);
      }
    };

    const handleTouchEnd = () => {
      if (!isMoving) return;
      isMoving = false;
      // if swipe completed beyond threshold, navigate
      if (swipeComplete) {
        const dir = swipeComplete; // 1 = left, -1 = right
        const from = VIEW_ORDER.indexOf(viewRef.current);
        const to = dir > 0 ? Math.max(0, from - 1) : Math.min(VIEW_ORDER.length - 1, from + 1);
        setViewState(VIEW_ORDER[to]);
      }
      setSwipeX(0);
      setSwipeComplete(false);
      setSwipeStartX(0);
    };

    const handlePointerDown = (e: PointerEvent) => {
      touchStartX = e.clientX;
      isMoving = true;
      setSwipeX(touchStartX);
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (!isMoving) return;
      const currentX = e.clientX;
      const diff = touchStartX - currentX;
      setSwipeX(currentX);
      if (Math.abs(diff) > swipeThreshold) {
        e.preventDefault();
        setSwipeComplete(diff > 0 ? -1 : 1);
      }
    };

    const handlePointerUp = () => {
      if (!isMoving) return;
      isMoving = false;
      if (swipeComplete) {
        const dir = swipeComplete;
        const from = VIEW_ORDER.indexOf(viewRef.current);
        const to = dir > 0 ? Math.max(0, from - 1) : Math.min(VIEW_ORDER.length - 1, from + 1);
        setViewState(VIEW_ORDER[to]);
      }
      setSwipeX(0);
      setSwipeComplete(false);
      setSwipeStartX(0);
    };

    // Add event listeners for both touch and pointer events
    const doc = document;
    doc.addEventListener('touchstart', handleTouchStart, { passive: false });
    doc.addEventListener('touchmove', handleTouchMove, { passive: false });
    doc.addEventListener('touchend', handleTouchEnd);
    doc.addEventListener('pointerdown', handlePointerDown);
    doc.addEventListener('pointermove', handlePointerMove);
    doc.addEventListener('pointerup', handlePointerUp);

    // cleanup
    return () => {
      doc.removeEventListener('touchstart', handleTouchStart);
      doc.removeEventListener('touchmove', handleTouchMove);
      doc.removeEventListener('touchend', handleTouchEnd);
      doc.removeEventListener('pointerdown', handlePointerDown);
      doc.removeEventListener('pointermove', handlePointerMove);
      doc.removeEventListener('pointerup', handlePointerUp);
    };
  }, []); // empty deps — run once on mount

  // respect prefers-reduced-motion: disable swipe gestures when user prefers reduced motion
  useEffect(() => {
    if (!REDUCE_MOTION) return;
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleChange = (e: MediaQueryListEvent) => {
      if (e.matches) {
        setSwipeComplete(false);
        // also disable the swipe indicator by hiding it
        const indicator = document.querySelector('.swipe-indicator');
        if (indicator) indicator.style.display = 'none';
      } else {
        setSwipeComplete(false); // reset if was stuck
      }
    };
    prefersReduced.addEventListenerListener('change', handleChange);
    handleChange({ matches: prefersReduced.matches });
    return () => prefersReduced.removeEventListenerListener('change', handleChange);
  }, [REDUCE_MOTION]);

  // reduced-motion fallback: on desktop with reduced-motion preference, skip swipe entirely
  useEffect(() => {
    if (!REDUCE_MOTION) return;
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateReduced = (e: MediaQueryListEvent) => {
      // if user wants reduced motion, disable swipe gestures
      if (e.matches) {
        setSwipeComplete(false);
      }
    };
    prefersReduced.addEventListenerListener('change', updateReduced);
    updateReduced({ matches: prefersReduced.matches });
    return () => prefersReduced.removeEventListenerListener('change', updateReduced);
  }, [REDUCE_MOTION]);

  // theme
  const [theme, setTheme] = useState<'dark' | 'light'>(() => (window.localStorage.getItem('daily_theme') === 'light' ? 'light' : 'dark'));

  // confirm dialog (replaces window.confirm)
  type ConfirmSpec = { title: string; body: string; confirmLabel: string; danger?: boolean; typedPhrase?: string; onConfirm: () => void };
  const [confirmSpec, setConfirmSpec] = useState<ConfirmSpec | null>(null);
  const [confirmTyped, setConfirmTyped] = useState('');

  // staff PIN sign-in
  const [pendingPinUser, setPendingPinUser] = useState<StaffMember | null>(null);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');

  // offline queue badge
  const [pendingSync, setPendingSync] = useState(0);

  // timestamps of our latest local writes — guards against a stale remote echo reverting an optimistic tick
  const lastLocalWrite = useRef<{ records: number; attendance: number }>({ records: 0, attendance: 0 });

  const saveTimer = useRef<number | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const cloudUnsub = useRef<() => void>(() => undefined);
  const migratedRef = useRef(false);
  const adminCodeRef = useRef<string>('');

  const todayKey = formatKey(new Date());
  const todayRecord = records[todayKey] || emptyDay(todayKey);
  const selectedRecord = records[selectedDate] || emptyDay(selectedDate);
  const onRoster = (name: string) => users.some(u => u.name.toLowerCase() === name.trim().toLowerCase());

  useEffect(() => { setAttendanceFilterDate(formatKey(new Date())); }, []);

  useEffect(() => {
    const clockTimer = setInterval(() => setLiveClock(new Date()), 1000);
    return () => clearInterval(clockTimer);
  }, []);

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

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('daily_theme', theme);
  }, [theme]);

  useEffect(() => {
    const onOnline = async () => {
      const flushed = await flushQueue();
      setPendingSync(0);
      if (flushed > 0) showToast(`Back online — ${flushed} pending update${flushed > 1 ? 's' : ''} synced.`);
    };
    const onOffline = () => showToast('You are offline — changes will sync automatically.');
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dates = useMemo(() => Array.from({ length: 14 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - i); return formatKey(d); }), []);
  const progress = (rec: DayRecord, s: Shift) => {
    const total = checklists[s].length;
    const done = Object.values(rec?.[s] ?? {}).filter(l => l?.done).length;
    return { done, total, pct: total ? Math.min(100, Math.round((done / total) * 100)) : 0 };
  };
  const openP = progress(todayRecord, 'opening');
  const closeP = progress(todayRecord, 'closing');
  const lookup = useMemo(() => { const m = new Map<string, TaskDef>(); [...checklists.opening, ...checklists.closing].forEach(t => m.set(t.id, t)); return m; }, [checklists]);
  const activityFor = (rec: DayRecord) => {
    const ev: ActivityEvent[] = [];
    (['opening', 'closing'] as Shift[]).forEach(s => Object.entries(rec?.[s] ?? {}).forEach(([id, log]) => { const t = lookup.get(id); if (t && log?.done) ev.push({ shift: s, task: t, log }); }));
    return ev.sort((a, b) => new Date(b.log.ts).getTime() - new Date(a.log.ts).getTime());
  };
  const todayActivity = useMemo(() => activityFor(todayRecord), [todayRecord, lookup]);
  const selectedActivity = useMemo(() => activityFor(selectedRecord), [selectedRecord, lookup]);

  const showToast = (m: string) => { setToast(m); window.setTimeout(() => setToast(''), 3000); };
  const cloudOn = cloudStatus === 'connected';

  const sendToCloud = (path: 'records' | 'attendance', value: unknown) => {
    if (!cloudOn || !navigator.onLine) { enqueueWrite(path, value); setPendingSync(1); return; }
    void writeCloud(path, value).then(ok => {
      if (!ok) {
        enqueueWrite(path, value);
        setPendingSync(1);
        showToast('Saved on this device — will sync when back online.');
      } else {
        setPendingSync(0);
      }
    });
  };

  const persist = (next: Records) => {
    setRecords(next);
    void sharedSet(RECORDS_KEY, next);
    lastLocalWrite.current.records = Date.now();
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => sendToCloud('records', next), 250);
  };
  const persistAttendance = (next: AttendanceRecord[]) => {
    setAttendance(next);
    void sharedSet(ATTENDANCE_KEY, next);
    lastLocalWrite.current.attendance = Date.now();
    sendToCloud('attendance', next);
  };

  const saveAdmin = async (path: 'checklists' | 'users' | 'auditLogs', value: unknown) => {
    const localKey = path === 'checklists' ? CHECKLISTS_KEY : path === 'users' ? USERS_KEY : AUDIT_LOG_KEY;
    void sharedSet(localKey, value);
    if (!cloudOn) return;
    const ok = await adminWrite(adminCodeRef.current, path, value);
    if (!ok) showToast('Could not save to the shared database — try unlocking admin again.');
  };
  const persistUsers = (next: StaffMember[]) => { setUsers(next); void saveAdmin('users', next); };

  const attachCloud = () => {
    cloudUnsub.current();
    migratedRef.current = false;
    cloudUnsub.current = subscribeCloud(data => {
      const fresh = (p: 'records' | 'attendance') => Date.now() - lastLocalWrite.current[p] < 3000;
      if (data.records && typeof data.records === 'object') {
        const pruned: Records = {};
        Object.entries(data.records as Records).forEach(([d, r]) => { if (isWithinHistory(d)) pruned[d] = r; });
        window.localStorage.setItem(RECORDS_KEY, JSON.stringify(pruned));
        // skip the echo of our own recent write — keeps optimistic ticks snappy
        if (!fresh('records')) setRecords(cur => (JSON.stringify(cur) === JSON.stringify(pruned) ? cur : pruned));
      } else if (!migratedRef.current) {
        try { const raw = window.localStorage.getItem(RECORDS_KEY); if (raw) writeCloud('records', JSON.parse(raw)); } catch { /* ignore */ }
      }
      if (Array.isArray(data.attendance)) {
        window.localStorage.setItem(ATTENDANCE_KEY, JSON.stringify(data.attendance));
        if (!fresh('attendance')) setAttendance(cur => (JSON.stringify(cur) === JSON.stringify(data.attendance) ? cur : data.attendance as AttendanceRecord[]));
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
      haptic([10, 40, 14]);
    }
    const next: Records = { ...records, [todayKey]: { ...rec, [shift]: logs } };
    const pruned: Records = {}; Object.entries(next).forEach(([d, v]) => { if (isWithinHistory(d)) pruned[d] = v; });
    persist(pruned);
  };

  const tryAdmin = () => { if (adminUnlocked) goView('admin'); else setShowGate(true); };
  const unlock = async () => {
    const code = gateCode.trim();
    if (code.toLowerCase() === DEV_CODE) {
      adminCodeRef.current = code;
      setDevUnlocked(true);
      setAdminUnlocked(true); setShowGate(false); setGateCode(''); setGateError(''); goView('admin');
      haptic([12, 40, 18]);
      showToast('Developer mode unlocked.');
      return;
    }
    const ok = await verifyAdminCode(code);
    if (ok) {
      adminCodeRef.current = code;
      setAdminUnlocked(true); setShowGate(false); setGateCode(''); setGateError(''); goView('admin');
      haptic([12, 40, 18]);
      showToast('Admin unlocked for this session.');
    } else {
      setGateError('Wrong code. Ask the owner for access.');
      haptic(80);
    }
  };

  // ---------- staff sign-in with optional per-person PIN ----------
  const finishSignIn = (name: string) => {
    setStaffName(name);
    setNameOpen(false);
    setPendingPinUser(null);
    setPinInput('');
    setPinError('');
    haptic([10, 30, 10]);
    showToast(`Signed in as ${name}`);
  };
  const requestSignIn = (member: StaffMember | null, typedName: string) => {
    const name = member?.name ?? typedName.trim();
    if (!name) return;
    if (member?.pin) { setPendingPinUser(member); setPinInput(''); setPinError(''); return; }
    // typed name matching a roster member who has a PIN still requires it
    const match = users.find(u => u.name.toLowerCase() === name.toLowerCase());
    if (match?.pin) { setPendingPinUser(match); setPinInput(''); setPinError(''); return; }
    finishSignIn(name);
  };
  const confirmPin = () => {
    if (!pendingPinUser) return;
    if (pendingPinUser.pin === pinInput.trim()) finishSignIn(pendingPinUser.name);
    else { setPinError('Wrong PIN — try again.'); setPinInput(''); haptic(70); }
  };

  // ==========================================
  // STAFF CHECK-IN / CHECK-OUT LOGIC
  // ==========================================
  const currentStaffMember = useMemo(() => users.find(u => u.name.toLowerCase() === staffName.trim().toLowerCase()), [users, staffName]);

  // Developer powers: unlocked via DEV_CODE in the admin gate, or by signing in as a member whose role is Developer.
  const isDev = useMemo(() => {
    if (devUnlocked) return true;
    return users.some(u => u.role === 'Developer' && u.name.toLowerCase() === staffName.trim().toLowerCase());
  }, [devUnlocked, users, staffName]);

  const currentTodayAttendance = useMemo(() => {
    if (!currentStaffMember) return null;
    return attendance.find(a => a.staffId === currentStaffMember.id && a.createdAt === todayKey);
  }, [attendance, currentStaffMember, todayKey]);

  const handleCheckIn = () => {
    if (!requireName()) return;
    const member = currentStaffMember;
    if (!member) return;

    const existing = attendance.find(a => a.staffId === member.id && a.createdAt === todayKey);
    if (existing) {
      showToast('You have already checked in for today!');
      return;
    }

    const checkInTime = new Date();
    const [sh, sm] = member.shiftStart.split(':').map(Number);
    const shiftStart = new Date(checkInTime);
    shiftStart.setHours(sh || 0, sm || 0, 0, 0);
    const graceCutoff = new Date(shiftStart.getTime() + (member.gracePeriod || 0) * 60000);
    const status: AttendanceStatus = checkInTime > graceCutoff ? 'Late' : 'On Time';

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
    haptic([14, 60, 14]);
    triggerNotification(`${member.name} checked in at ${checkInTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`);
    showToast(`Welcome, ${member.name}! Checked in successfully.`);
  };

  const handleCheckOut = () => {
    if (!requireName()) return;
    const member = currentStaffMember;
    if (!member) return;

    const existing = attendance.find(a => a.staffId === member.id && a.createdAt === todayKey);
    if (!existing) {
      showToast('You cannot check out without checking in first!');
      return;
    }

    if (existing.checkOutTime) {
      showToast('You have already checked out for today!');
      return;
    }

    const checkOutTime = new Date();
    const inTime = new Date(existing.checkInTime);
    const workingHours = Math.round(((checkOutTime.getTime() - inTime.getTime()) / (1000 * 60 * 60)) * 100) / 100;

    const nextStatus: AttendanceStatus = existing.status === 'On Time' ? 'Checked Out' : existing.status;

    const updated = attendance.map(a => a.id === existing.id ? { ...a, checkOutTime: checkOutTime.toISOString(), workingHours, status: nextStatus } : a);
    persistAttendance(updated);
    haptic([14, 60, 14]);
    triggerNotification(`${member.name} checked out at ${checkOutTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. Total: ${workingHours} hrs.`);
    showToast(`Goodbye, ${member.name}! Checked out successfully. Total hours: ${workingHours}`);
  };

  const triggerNotification = (body: string) => {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Attendance Notification', { body, icon: '/icon.svg' });
    }
    notifyManagers('Daily Check', body).catch(() => {});
  };

  // ==========================================
  // STAFF ROSTER CRUD
  // ==========================================
  const resetStaffForm = () => {
    setNewStaffName('');
    setNewStaffRole('Staff');
    setNewStaffShiftStart('08:00');
    setNewStaffShiftEnd('16:00');
    setNewStaffGrace(5);
    setNewStaffDaysOff([0]);
    setNewStaffPhoto('');
    setNewStaffPin('');
    setEditingStaffId(null);
  };

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
      profilePhoto: newStaffPhoto,
      pin: newStaffPin.trim().length >= 4 ? newStaffPin.trim() : undefined
    };

    persistUsers([...users, nextMember]);
    resetStaffForm();
    haptic(14);
    showToast(`${name} added with role ${newStaffRole}.`);
  };

  const saveEditedStaff = (id: string) => {
    const target = users.find(u => u.id === id);
    const name = newStaffName.trim();
    if (!name) { showToast('Name cannot be empty.'); return; }
    if (!target) return;
    if (users.some(u => u.id !== id && u.name.toLowerCase() === name.toLowerCase())) { showToast('Name already on the roster.'); return; }

    // propagate rename through attendance + signature history so records stay consistent
    const oldName = target.name;
    const renamed = name !== oldName;
    persistUsers(users.map(u => u.id === id ? {
      ...u,
      name,
      role: newStaffRole,
      shiftStart: newStaffShiftStart,
      shiftEnd: newStaffShiftEnd,
      gracePeriod: newStaffGrace,
      weeklyDaysOff: newStaffDaysOff,
      profilePhoto: newStaffPhoto,
      pin: newStaffPin.trim().length >= 4 ? newStaffPin.trim() : undefined
    } : u));
    if (renamed) {
      persistAttendance(attendance.map(a => a.staffName === oldName ? { ...a, staffName: name } : a));
      const nextRecords: Records = {};
      Object.entries(records).forEach(([d, r]) => {
        const rewrite = (logs: Record<string, { done: boolean; staff: string; ts: string } | undefined>): Record<string, { done: boolean; staff: string; ts: string }> => {
          const out: Record<string, { done: boolean; staff: string; ts: string }> = {};
          Object.entries(logs ?? {}).forEach(([tid, l]) => { out[tid] = l?.staff === oldName ? { ...l, staff: name } : (l as { done: boolean; staff: string; ts: string }); });
          return out;
        };
        nextRecords[d] = { ...r, opening: rewrite(r.opening), closing: rewrite(r.closing) };
      });
      persist(nextRecords);
      if (staffName.trim().toLowerCase() === oldName.toLowerCase()) setStaffName(name);
    }
    resetStaffForm();
    haptic(14);
    showToast(renamed ? `${oldName} renamed to ${name} — history updated.` : 'Staff details updated.');
  };

  const handleDeleteStaff = (id: string) => {
    const target = users.find(u => u.id === id);
    if (!target) return;
    setConfirmSpec({
      title: `Delete ${target.name}?`,
      body: 'This permanently removes the member from the team roster on every device. Their past attendance and signature history stays in the archive for audit purposes.',
      confirmLabel: 'Delete member',
      danger: true,
      typedPhrase: 'DELETE',
      onConfirm: () => {
        persistUsers(users.filter(u => u.id !== id));
        if (editingStaffId === id) resetStaffForm();
        if (staffName.trim().toLowerCase() === target.name.toLowerCase()) setStaffName('');
        haptic([20, 60, 20]);
        showToast(`${target.name} deleted from the roster.`);
      },
    });
  };

  const handleDeactivateStaff = (id: string) => {
    const target = users.find(u => u.id === id);
    if (!target) return;
    persistUsers(users.map(u => u.id === id ? { ...u, active: !u.active } : u));
    haptic(14);
    showToast(`${target.name} ${target.active ? 'deactivated' : 'reactivated'}.`);
  };

  const startEditStaff = (u: StaffMember) => {
    setEditingStaffId(u.id);
    setNewStaffName(u.name);
    setNewStaffRole(u.role ?? 'Staff');
    setNewStaffShiftStart(u.shiftStart ?? '08:00');
    setNewStaffShiftEnd(u.shiftEnd ?? '16:00');
    setNewStaffGrace(u.gracePeriod ?? 5);
    setNewStaffDaysOff(Array.isArray(u.weeklyDaysOff) ? u.weeklyDaysOff : [0]);
    setNewStaffPhoto(u.profilePhoto ?? '');
    setNewStaffPin(u.pin ?? '');
  };

  // ==========================================
  // CHECKLIST ADMIN
  // ==========================================
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
    if (!adminUnlocked) return;
    setConfirmSpec({
      title: 'Remove task',
      body: 'This task will be removed from the shared list on every device.',
      confirmLabel: 'Remove',
      danger: true,
      onConfirm: () => {
        setChecklists(cur => { const next = { ...cur, [s]: cur[s].filter(t => t.id !== id) }; void saveAdmin('checklists', next); return next; });
        showToast('Task removed.');
      },
    });
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
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
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
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `attendance_log.csv`; a.click();
    URL.revokeObjectURL(url); showToast('Attendance CSV download started.');
  };

  // ==========================================
  // DASHBOARD METRICS
  // ==========================================
  const activeAttendanceForFilteredDate = useMemo(() => {
    return attendance.filter(a => a.createdAt === attendanceFilterDate);
  }, [attendance, attendanceFilterDate]);

  const dailyStats = useMemo(() => {
    const active = activeAttendanceForFilteredDate;
    const total = active.length;
    const checkedInCount = active.filter(a => !a.checkOutTime).length;
    const lates = active.filter(a => a.status === 'Late').length;

    const workingHours = active.map(a => a.workingHours || 0).filter(h => h > 0);
    const avgHours = workingHours.length ? Math.round((workingHours.reduce((sum, h) => sum + h, 0) / workingHours.length) * 10) / 10 : 0;

    const presentStaffIds = active.map(a => a.staffId);
    const dayOfWeek = parseKey(attendanceFilterDate).getDay();
    const absentStaff = users.filter(u => u.active && !u.weeklyDaysOff.includes(dayOfWeek) && !presentStaffIds.includes(u.id));

    return { total, checkedInCount, lates, avgHours, absentCount: absentStaff.length, absentStaff };
  }, [activeAttendanceForFilteredDate, users, attendanceFilterDate]);

  if (loading) {
    return (
      <div className="stage min-h-screen grid place-items-center">
        <div className="orb orb-1" /><div className="orb orb-2" />
        <motion.div className="relative z-10 text-center" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE }}>
          <div className="mx-auto w-12 h-12 rounded-full border-[3px] border-white/10 border-t-amber-300 animate-spin" />
          <p className="mt-6 text-[12px] font-bold uppercase tracking-[0.28em] text-white/70">loading daily check</p>
        </motion.div>
      </div>
    );
  }

  /* ------------------------------ views ------------------------------ */

  const HomeView = () => (
    <div>
      <div className="relative pt-10 lg:pt-16 pb-8">
        <div className="grid grid-cols-12 gap-8 items-center">
          <div className="col-span-12 lg:col-span-8 relative z-10">
            <motion.h1 initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE }} className="font-display uppercase leading-[0.88] tracking-[-0.01em] select-none">
              <span className="block text-[16vw] lg:text-[120px] xl:text-[148px]">Daily</span>
              <span className="block text-[16vw] lg:text-[120px] xl:text-[148px] -mt-1 lg:-mt-3 shimmer-text">Check<span className="text-amber-300/70">.</span></span>
            </motion.h1>
            <div className="mt-8 flex flex-wrap items-end gap-x-10 gap-y-6">
              <div>
                <div className="flex items-center gap-4">
                  <button aria-label="Previous tagline" onClick={() => setTagIndex(i => (i + TAGLINES.length - 1) % TAGLINES.length)} className="w-9 h-9 rounded-full border border-white/20 grid place-items-center hover:bg-white/10 hover:border-white/40 transition-all"><ChevronLeft width={16} height={16} /></button>
                  <span className="text-[13px] font-bold text-white/70 tabular-nums">0{tagIndex + 1}/0{TAGLINES.length}</span>
                  <button aria-label="Next tagline" onClick={() => setTagIndex(i => (i + 1) % TAGLINES.length)} className="w-9 h-9 rounded-full border border-white/20 grid place-items-center hover:bg-white/10 hover:border-white/40 transition-all"><ChevronRight width={16} height={16} /></button>
                </div>
                <AnimatePresence mode="wait">
                  <motion.p key={tagIndex} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.35, ease: EASE }} className="mt-4 text-[26px] lg:text-[32px] font-extrabold tracking-tight">{TAGLINES[tagIndex]}</motion.p>
                </AnimatePresence>
                <p className="text-[14px] font-semibold text-white/65 mt-1 max-w-[420px]">The shared opening, closing &amp; attendance tracker for teams that finish what they start.</p>
                <div className="flex flex-wrap gap-3 mt-6">
                  <button onClick={() => goView('opening')} className="pill-solid">Explore <ArrowRight width={16} height={16} /></button>
                  <button onClick={() => goView('attendance')} className="pill">Clock In / Out</button>
                </div>
              </div>
            </div>
          </div>
          <div className="col-span-12 lg:col-span-4 relative">
            <motion.div initial={{ opacity: 0, y: 34, rotate: 1 }} animate={{ opacity: 1, y: 0, rotate: 0 }} transition={{ duration: 0.8, delay: 0.15, ease: EASE }} className="float-slow">
              <div className="glass-deep rounded-[28px] p-6 max-w-[320px] mx-auto lg:ml-auto gold-edge">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-amber-200/80">today's flow</p>
                  <span className="w-2 h-2 rounded-full bg-amber-300 pulse-soft shadow-[0_0_12px_rgba(228,192,120,0.9)]" />
                </div>
                {checklists.opening.slice(0, 3).map(t => {
                  const done = Boolean(todayRecord.opening[t.id]?.done);
                  return (
                    <div key={t.id} className="flex items-center gap-3 mt-5">
                      <span className={`w-7 h-7 rounded-[9px] grid place-items-center ${done ? 'bg-gradient-to-br from-amber-200 to-amber-500 text-[#241a07]' : 'border border-white/25'}`}>{done && <Check width={14} height={14} strokeWidth={3.5} />}</span>
                      <span className={`text-[14px] font-bold ${done ? 'line-through opacity-50' : ''}`}>{t.label}</span>
                    </div>
                  );
                })}
                <div className="mt-6 pt-5 border-t border-white/10 flex items-center justify-between">
                  <span className="text-[12px] font-bold text-white/70">{openP.done} of {openP.total} done</span>
                  <Ring pct={openP.pct} size={44} />
                </div>
              </div>
            </motion.div>
          </div>
        </div>

        <div className="grid sm:grid-cols-3 gap-4 mt-14">
          {([
            [Wifi, 'Shared sync', 'Live on every device, instantly'],
            [History, '14-day archive', 'Older days auto-prune themselves'],
            [Download, 'CSV export', 'Keep a permanent copy anytime'],
          ] as [typeof Wifi, string, string][]).map(([Ic, t, s], i) => (
            <motion.div key={t} variants={riseItem} initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 + i * 0.09, duration: 0.6, ease: EASE }} className="glass rounded-[20px] px-6 py-5 flex items-center gap-4 hover:bg-white/[0.07] transition-colors">
              <span className="w-11 h-11 rounded-full bg-amber-300/10 text-amber-200 border border-amber-300/20 grid place-items-center shrink-0"><Ic width={19} height={19} /></span>
              <span><span className="block text-[15px] font-extrabold">{t}</span><span className="block text-[12px] font-semibold text-white/55 mt-0.5">{s}</span></span>
            </motion.div>
          ))}
        </div>
      </div>

      <div className="mt-16 pb-6">
        <div className="flex items-end justify-between gap-4 mb-6">
          <h2 className="text-[26px] lg:text-[32px] font-extrabold tracking-tight">Today's board</h2>
          <span className="text-[12px] font-bold text-white/55">{new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</span>
        </div>
        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {[
            { icon: Sun, title: 'Opening', sub: `${openP.done} of ${openP.total} signed off`, cta: 'Open list', action: () => goView('opening'), ring: openP.pct, badge: null as string | null },
            { icon: Moon, title: 'Closing', sub: `${closeP.done} of ${closeP.total} signed off`, cta: 'Open list', action: () => goView('closing'), ring: closeP.pct, badge: null },
            { icon: Briefcase, title: 'Attendance', sub: `${dailyStats.checkedInCount} currently working`, cta: 'Clock In/Out', action: () => goView('attendance'), ring: null, badge: `${dailyStats.total} clocked` },
            { icon: adminUnlocked ? ShieldCheck : Lock, title: 'Admin desk', sub: adminUnlocked ? 'Unlocked — lists, team & export' : 'Lists, team, code & export', cta: adminUnlocked ? 'Enter' : 'Unlock', action: tryAdmin, ring: null, badge: null },
          ].map((card, i) => (
            <motion.button
              key={card.title}
              onClick={card.action}
              initial={{ opacity: 0, y: 26 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.07, duration: 0.55, ease: EASE }}
              whileHover={{ y: -5 }}
              whileTap={{ scale: 0.98 }}
              className="glass rounded-[24px] p-6 text-left hover:border-white/25 transition-colors"
            >
              <div className="flex items-center justify-between">
                {card.ring !== null
                  ? <card.icon width={20} height={20} className="text-amber-200" />
                  : card.badge
                    ? <card.icon width={20} height={20} className="text-amber-200" />
                    : <card.icon width={20} height={20} />}
                {card.ring !== null && <Ring pct={card.ring} size={56} />}
                {card.badge && <span className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-white/75 bg-white/10 px-2 py-0.5 rounded-full">{card.badge}</span>}
              </div>
              <p className="mt-5 text-[19px] font-extrabold">{card.title}</p>
              <p className="text-[12px] font-semibold text-white/60 mt-1">{card.sub}</p>
              <span className="inline-flex items-center gap-1.5 mt-4 text-[12px] font-extrabold uppercase tracking-[0.12em] text-amber-200">{card.cta} <ArrowRight width={14} height={14} /></span>
            </motion.button>
          ))}
        </div>
      </div>
    </div>
  );

  const ShiftView = ({ shift }: { shift: Shift }) => {
    const p = progress(todayRecord, shift);
    return (
      <div className="pt-8 lg:pt-12">
        <div className="flex flex-wrap items-end justify-between gap-5 mb-8">
          <div>
            <p className="text-[12px] font-extrabold uppercase tracking-[0.22em] text-amber-200/80">{shift === 'opening' ? '01 · morning' : '02 · evening'}</p>
            <h1 className="font-display uppercase text-[52px] lg:text-[84px] leading-[0.9] mt-2">{shift}</h1>
          </div>
          <div className="flex items-center gap-5">
            <div className="text-right">
              <p className="text-[13px] font-bold text-white/70">{new Date().toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}</p>
              <p className="text-[12px] font-semibold text-white/50 mt-1">{staffName ? `signed in as ${staffName}` : 'not signed in'}</p>
            </div>
            <Ring pct={p.pct} size={72} />
          </div>
        </div>
        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-12 lg:col-span-8">
            <TaskList tasks={checklists[shift]} logs={todayRecord[shift]} onToggle={id => toggleTask(shift, id)} justChecked={justChecked} />
            <div className="flex items-center justify-between mt-5 px-1">
              <span className="text-[13px] font-bold text-white/75">{p.pct === 100 ? 'All done — great work.' : `${p.total - p.done} remaining`}</span>
              <button onClick={() => goView(shift === 'opening' ? 'closing' : 'opening')} className="pill text-[12px] !py-2.5 !px-5">
                {shift === 'opening' ? 'Go to closing' : 'Go to opening'} <ArrowRight width={14} height={14} />
              </button>
            </div>
          </div>
          <aside className="col-span-12 lg:col-span-4 space-y-5">
            <div className="glass rounded-[22px] p-5">
              <div className="flex items-center justify-between"><p className="text-[12px] font-extrabold uppercase tracking-[0.16em] text-white/60">Progress</p><span className="text-[22px] font-extrabold text-amber-200 tabular-nums">{p.pct}%</span></div>
              <div className="h-2 rounded-full bg-white/10 mt-3 overflow-hidden">
                <motion.div className="h-full rounded-full bg-gradient-to-r from-amber-200 to-amber-500" initial={{ width: 0 }} animate={{ width: `${p.pct}%` }} transition={{ duration: 0.8, ease: EASE }} />
              </div>
              <p className="text-[12px] font-semibold text-white/55 mt-3">{p.done} of {p.total} tasks signed today</p>
            </div>
            <div>
              <p className="text-[12px] font-extrabold uppercase tracking-[0.16em] text-white/60 mb-3 px-1">Live log</p>
              <LogList events={todayActivity.filter(e => e.shift === shift)} limit={6} />
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
      <div className="pt-8 lg:pt-12">
        <div className="flex flex-wrap items-end justify-between gap-5 mb-8">
          <div>
            <p className="text-[12px] font-extrabold uppercase tracking-[0.22em] text-amber-200/80">03 · archive</p>
            <h1 className="font-display uppercase text-[52px] lg:text-[84px] leading-[0.9] mt-2">History</h1>
          </div>
          <p className="text-[12px] font-bold text-white/55 max-w-[240px] text-right">Rolling 14-day window. Older days auto-clear — export to keep them.</p>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-3">
          {dates.map(d => {
            const r = records[d] || emptyDay(d);
            const o = progress(r, 'opening'); const c = progress(r, 'closing');
            const pct = Math.round(((o.done + c.done) / Math.max(o.total + c.total, 1)) * 100);
            const dt = parseKey(d);
            return (
              <motion.button
                key={d}
                onClick={() => setSelectedDate(d)}
                whileTap={{ scale: 0.94 }}
                className={`date-tile shrink-0 ${selectedDate === d ? 'active' : ''}`}
              >
                <span className="text-[9px] font-extrabold uppercase tracking-[0.12em]">{dt.toLocaleDateString([], { weekday: 'short' })}</span>
                <span className="text-[24px] font-extrabold leading-none tabular-nums">{dt.getDate()}</span>
                <span className="bar"><i style={{ width: `${pct}%` }} /></span>
              </motion.button>
            );
          })}
        </div>

        <div className="grid grid-cols-12 gap-6 mt-8">
          <div className="col-span-12 lg:col-span-4 glass rounded-[24px] p-6">
            <p className="text-[13px] font-bold text-white/70">{parseKey(selectedDate).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</p>
            <div className="grid grid-cols-2 gap-5 mt-6">
              <div><p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-amber-200/80">Opening</p><p className="text-[44px] font-extrabold leading-none mt-1 tabular-nums">{so.done}<span className="text-[20px] text-white/45">/{so.total}</span></p></div>
              <div><p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-amber-200/80">Closing</p><p className="text-[44px] font-extrabold leading-none mt-1 tabular-nums">{sc.done}<span className="text-[20px] text-white/45">/{sc.total}</span></p></div>
            </div>
            {(() => {
              const r = records[selectedDate] || emptyDay(selectedDate);
              const pend = [
                ...checklists.opening.filter(t => !r.opening[t.id]?.done).map(t => ({ s: 'open', t })),
                ...checklists.closing.filter(t => !r.closing[t.id]?.done).map(t => ({ s: 'close', t })),
              ];
              if (!pend.length) return <p className="mt-7 text-[12px] font-extrabold uppercase tracking-[0.14em] text-emerald-300">fully signed off</p>;
              return (
                <div className="mt-7">
                  <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-white/60">Still open</p>
                  <div className="flex flex-wrap gap-1.5 mt-3">{pend.map(({ s, t }) => <span key={t.id} className="text-[11px] font-bold bg-white/[0.06] border border-white/15 rounded-full px-3 py-1">{s} · {t.label}</span>)}</div>
                </div>
              );
            })()}
          </div>
          <div className="col-span-12 lg:col-span-8">
            <p className="text-[12px] font-extrabold uppercase tracking-[0.16em] text-white/60 mb-3 px-1">Completion record · {selectedActivity.length}</p>
            <LogList events={selectedActivity} />
          </div>
        </div>
      </div>
    );
  };

  const AttendanceView = () => {
    const statusChip = (s: AttendanceStatus) =>
      s === 'On Time' || s === 'Half Day' ? 'chip-ok' : s === 'Late' ? 'chip-warn' : s === 'Absent' ? 'chip-danger' : 'chip-neutral';
    return (
      <div className="pt-8 lg:pt-12">
        <div className="flex flex-wrap items-end justify-between gap-5 mb-8">
          <div>
            <p className="text-[12px] font-extrabold uppercase tracking-[0.22em] text-amber-200/80 font-mono">Attendance Terminal</p>
            <h1 className="font-display uppercase text-[38px] md:text-[60px] leading-[0.9] mt-2">Check In <span className="text-white/30">/</span> Out</h1>
          </div>

          <div className="glass rounded-[24px] p-4 text-center min-w-[210px] relative overflow-hidden gold-edge">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-amber-200/80">Live Terminal Clock</p>
            <p className="text-[26px] font-extrabold leading-none mt-1.5 font-mono tracking-tight tabular-nums">{liveClock.toLocaleTimeString()}</p>
            <p className="text-[11px] font-semibold text-white/55 mt-1.5">{liveClock.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Active Today', val: String(dailyStats.total), sub: `${dailyStats.checkedInCount} working`, accent: '#e4c078' },
            { label: 'Lates Today', val: String(dailyStats.lates), sub: 'outside grace range', accent: '#fbbf24' },
            { label: 'Average Shift', val: `${dailyStats.avgHours} hrs`, sub: 'working duration', accent: '#34d399' },
            { label: 'Absent Today', val: String(dailyStats.absentCount), sub: 'excused & unexcused', accent: '#fb7185' },
          ].map((stat, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 22 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06, duration: 0.5, ease: EASE }}
              whileHover={{ y: -4 }}
              className="glass stat-card rounded-[22px] p-5 relative overflow-hidden"
              style={{ ['--accent' as string]: stat.accent }}
            >
              <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-white/55">{stat.label}</p>
              <p className="text-[34px] font-extrabold leading-none mt-2 tabular-nums">{stat.val}</p>
              <p className="text-[11px] font-semibold text-white/50 mt-1.5 truncate">{stat.sub}</p>
            </motion.div>
          ))}
        </div>

        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-12 lg:col-span-5 space-y-6">
            <div className="glass-deep rounded-[28px] p-6 text-center space-y-6 relative overflow-hidden gold-edge">
              <div className="space-y-2">
                <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-white/60 font-mono">Roster Signature Connection</p>
                <div className="flex justify-center gap-3 items-center mt-1">
                  <UserCheck className="text-amber-200" width={22} height={22} />
                  <span className="text-[20px] font-extrabold">{staffName ? staffName : 'No one signed in'}</span>
                </div>
                {currentStaffMember && (
                  <p className="text-[12px] font-extrabold text-amber-100 bg-amber-300/10 border border-amber-300/25 rounded-full px-3 py-1.5 inline-block mt-2">
                    Shift start: {currentStaffMember.shiftStart} · Grace period: {currentStaffMember.gracePeriod} min
                  </p>
                )}
              </div>

              {currentTodayAttendance ? (
                <div className="glass-soft rounded-[20px] p-4 text-left flex items-start gap-3">
                  <CheckCircle2 className="text-emerald-300 shrink-0 mt-0.5" width={20} height={20} />
                  <div className="space-y-1">
                    <p className="text-[14px] font-extrabold">Active Session Detected</p>
                    <p className="text-[12px] text-white/70">Checked in at: <b className="text-white">{prettyTime(currentTodayAttendance.checkInTime)}</b></p>
                    <p className="text-[12px] text-white/70">Shift Status: <b className={`chip-ok rounded-full px-2 py-0.5 text-[11px] uppercase tracking-wide ml-1`}>{currentTodayAttendance.status}</b></p>
                    {currentTodayAttendance.checkOutTime && (
                      <p className="text-[12px] text-white/70 mt-1">Checked out at: <b className="text-white">{prettyTime(currentTodayAttendance.checkOutTime)}</b> ({currentTodayAttendance.workingHours} hrs worked)</p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="glass-soft rounded-[20px] p-4 text-left flex items-start gap-3">
                  <AlertCircle className="text-amber-200/70 shrink-0 mt-0.5" width={20} height={20} />
                  <div>
                    <p className="text-[14px] font-extrabold text-white/85">No Check-In Recorded</p>
                    <p className="text-[12px] text-white/55 mt-0.5">Please proceed with Check In below to sign off your working hours today.</p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4 pt-2">
                <motion.button
                  onClick={handleCheckIn}
                  disabled={!staffName || !!currentTodayAttendance}
                  whileTap={{ scale: 0.97 }}
                  className="btn-ivory !rounded-[22px] !py-4 flex-col justify-center disabled:opacity-30 min-h-[110px]"
                >
                  <UserCheck width={24} height={24} />
                  <span className="text-[14px] font-extrabold">Check In</span>
                </motion.button>

                <motion.button
                  onClick={handleCheckOut}
                  disabled={!staffName || !currentTodayAttendance || !!currentTodayAttendance.checkOutTime}
                  whileTap={{ scale: 0.97 }}
                  className="pill !rounded-[22px] !py-4 flex-col justify-center disabled:opacity-30 min-h-[110px]"
                >
                  <Moon width={24} height={24} />
                  <span className="text-[14px] font-extrabold">Check Out</span>
                </motion.button>
              </div>

              {!staffName && (
                <p className="text-[11px] font-bold text-white/55 italic mt-3">Select your profile in the top-right menu to authorize Check-In.</p>
              )}
            </div>

            <div className="glass-soft rounded-[22px] p-5 space-y-4">
              <p className="text-[12px] font-extrabold uppercase tracking-[0.16em] text-white/60 font-mono">Terminal Configuration Rules</p>
              <div className="text-[12.5px] text-white/70 space-y-2 leading-relaxed font-semibold">
                {['Only active team roster members can register terminal signatures.', 'Only one clock-in session is allowed per calendar day.', 'Shift statuses are evaluated dynamically with shift starts.'].map(rule => (
                  <div key={rule} className="flex gap-2.5 items-start">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-300 mt-1.5 shrink-0" />
                    <span>{rule}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="col-span-12 lg:col-span-7">
            <div className="glass rounded-[28px] p-6 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-[12px] font-extrabold uppercase tracking-[0.18em] text-white/60 font-mono">Today's Attendance ({todayKey})</p>
                <div className="flex items-center gap-2 text-[12px] font-extrabold text-white/80 bg-white/[0.07] px-3 py-1 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 pulse-soft" />
                  <span>{attendance.filter(a => a.createdAt === todayKey).length} active</span>
                </div>
              </div>

              <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
                {attendance.filter(a => a.createdAt === todayKey).length === 0 && cloudStatus === 'checking' ? (
                  <SkeletonRows rows={3} />
                ) : attendance.filter(a => a.createdAt === todayKey).length === 0 ? (
                  <div className="text-center py-10 glass-soft rounded-[20px] border border-dashed border-white/15">
                    <Clock3 className="mx-auto text-white/50" width={22} height={22} />
                    <p className="mt-3 text-[13px] font-extrabold tracking-wide uppercase text-white/65">no check-ins today yet</p>
                  </div>
                ) : (
                  <motion.div variants={staggerParent} initial="hidden" animate="show" className="space-y-2">
                    {attendance.filter(a => a.createdAt === todayKey).map(a => (
                      <motion.div variants={riseItem} key={a.id} className="flex items-center justify-between gap-4 glass-soft rounded-[18px] p-4 hover:bg-white/[0.06] transition-colors">
                        <div className="flex items-center gap-3">
                          <Avatar name={a.staffName} size={36} />
                          <div>
                            <p className="text-[14px] font-extrabold leading-tight">{a.staffName}</p>
                            <p className="text-[11px] font-bold text-white/55 mt-1 tabular-nums">In: {prettyTime(a.checkInTime)} {a.checkOutTime && `· Out: ${prettyTime(a.checkOutTime)}`}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <span className={`inline-block text-[11px] font-extrabold uppercase tracking-[0.06em] px-2.5 py-1 rounded-full ${statusChip(a.status)}`}>
                            {a.status}
                          </span>
                          {a.workingHours !== null && (
                            <p className="text-[11px] font-extrabold text-white/60 mt-1 tabular-nums">{a.workingHours} hrs worked</p>
                          )}
                        </div>
                      </motion.div>
                    ))}
                  </motion.div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const AdminView = () => (
    <div className="pt-8 lg:pt-12">
      <div className="flex flex-wrap items-end justify-between gap-5 mb-8">
        <div>
          <p className="text-[12px] font-extrabold uppercase tracking-[0.22em] text-amber-200/80">restricted</p>
          <h1 className="font-display uppercase text-[52px] lg:text-[84px] leading-[0.9] mt-2">Admin</h1>
        </div>
        <button className="pill" onClick={() => { setAdminUnlocked(false); goView('home'); showToast('Admin locked.'); }}><Lock width={14} height={14} /> Lock admin</button>
      </div>

      <div className="flex gap-1 glass-soft rounded-full p-1.5 w-fit max-w-full overflow-x-auto mb-8">
        {([
          ['studio', 'Checklists', PencilLine],
          ['journal', 'Journal', CalendarDays],
          ['insights', 'Insights', TrendingUp],
          ['export', 'Export & Audit', FileDown],
          ['settings', 'Staff & Rules', Settings],
          ['setup', 'Supabase Hub', Database],
          ] as [AdminPane, string, typeof Database][]).map(([p, label, Ic]) => (
          <button
            key={p}
            onClick={() => goPane(p)}
            className={`nav-item whitespace-nowrap !normal-case !tracking-normal text-[13px] inline-flex items-center gap-2 ${adminPane === p ? 'active' : ''}`}
          >
            {adminPane === p && <motion.span layoutId="admin-tab-chip" className="nav-chip" transition={{ duration: 0.4, ease: EASE }} />}
            <Ic width={14} height={14} className="relative z-10" /> <span className="relative z-10">{label}</span>
          </button>
        ))}
        {isDev && (
          <button
            onClick={() => goPane('developer')}
            className={`nav-item whitespace-nowrap !normal-case !tracking-normal text-[13px] inline-flex items-center gap-2 ${adminPane === 'developer' ? 'active' : ''}`}
            title="Developer only"
          >
            {adminPane === 'developer' && <motion.span layoutId="admin-tab-chip" className="nav-chip" transition={{ duration: 0.4, ease: EASE }} />}
            <Terminal width={14} height={14} className="relative z-10" /> <span className="relative z-10">Developer</span>
          </button>
        )}
      </div>

      <AnimatePresence mode="wait" custom={paneDir}>
        <motion.div key={adminPane} custom={paneDir} variants={pageVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.38, ease: EASE }}>
          {adminPane === 'studio' && (
            <div className="grid grid-cols-12 gap-6">
              <div className="col-span-12 lg:col-span-3">
                <p className="text-[14px] font-semibold text-white/70 leading-relaxed">Rewrite tasks, add new ones, delete old ones. Edits sync to every device within seconds.</p>
                <div className="inline-flex glass-soft rounded-full p-1 mt-6">
                  {(['opening', 'closing'] as Shift[]).map(s => (
                    <button key={s} onClick={() => setEditorShift(s)} className="relative px-5 py-2 rounded-full text-[12px] font-extrabold uppercase tracking-[0.1em] transition-colors">
                      {editorShift === s && <motion.span layoutId="editor-shift-chip" className="absolute inset-0 rounded-full bg-gradient-to-br from-amber-200 to-amber-500" transition={{ duration: 0.4, ease: EASE }} />}
                      <span className={`relative z-10 ${editorShift === s ? 'text-[#241a07]' : 'text-white/70 hover:text-white'}`}>{s}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="col-span-12 lg:col-span-9 glass rounded-[24px] p-4 sm:p-6">
                {checklists[editorShift].map((t, i) => (
                  <div key={t.id} className="grid grid-cols-[30px_1fr_40px] gap-4 items-start py-3.5 border-b border-white/[0.07] last:border-0">
                    <span className="pt-3 text-[12px] font-extrabold text-white/35 tabular-nums">{String(i + 1).padStart(2, '0')}</span>
                    <div className="grid gap-2">
                      <input className="glass-input !py-2.5 text-[15px] font-extrabold" value={t.label} onChange={e => updateTask(editorShift, t.id, 'label', e.target.value)} aria-label={`Task ${i + 1} label`} />
                      <input className="glass-input !py-2 text-[12.5px] font-semibold text-white/65" value={t.detail} onChange={e => updateTask(editorShift, t.id, 'detail', e.target.value)} aria-label={`Task ${i + 1} detail`} />
                    </div>
                    <button onClick={() => removeTask(editorShift, t.id)} aria-label={`Remove ${t.label}`} className="w-10 h-10 rounded-full grid place-items-center text-white/50 hover:text-rose-300 hover:bg-rose-500/10 mt-1 transition-colors"><Trash2 width={16} height={16} /></button>
                  </div>
                ))}
                <button onClick={() => addTask(editorShift)} className="pill-solid mt-6 !py-3"><Plus width={16} height={16} /> Add to {editorShift}</button>
              </div>
            </div>
          )}

          {adminPane === 'journal' && HistoryView()}

          {adminPane === 'export' && (
            <div className="space-y-6">
              <div className="grid grid-cols-12 gap-6">
                <div className="col-span-12 lg:col-span-5">
                  <h2 className="text-[30px] font-extrabold tracking-tight leading-tight">Export checklists &amp; attendance metrics</h2>
                  <p className="text-[14px] font-semibold text-white/60 mt-4 leading-relaxed max-w-[440px]">Download full transaction metrics as CSV — dates, shifts, checklists, user signatures, working hours, and grace times. Clear the history before it rolls off.</p>
                  <div className="flex gap-3 mt-6">
                    <button onClick={() => { setExportFrom(dates[dates.length - 1]); setExportTo(todayKey); }} className="pill text-[12px]">Checklist Range <ArrowRight width={14} height={14} /></button>
                    <button onClick={exportAttendanceCsv} className="pill-solid text-[12px]"><Download width={14} height={14} /> Export Attendance</button>
                  </div>
                </div>
                <div className="col-span-12 lg:col-span-7 glass rounded-[24px] p-6 sm:p-8">
                  <div className="grid sm:grid-cols-2 gap-5">
                    <label className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-white/60 grid gap-2">From<input type="date" className="glass-input" value={exportFrom} onChange={e => setExportFrom(e.target.value)} /></label>
                    <label className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-white/60 grid gap-2">To<input type="date" className="glass-input" value={exportTo} onChange={e => setExportTo(e.target.value)} /></label>
                  </div>
                  <button onClick={exportCsv} className="pill-solid mt-7"><Download width={16} height={16} /> Download Checklist CSV</button>
                  <p className="text-[12px] font-bold text-white/55 mt-6">{Object.keys(records).length} days in storage · auto-prunes past 14</p>
                </div>
              </div>

              <div className="glass rounded-[24px] p-6 space-y-4">
                <p className="text-[12px] font-extrabold uppercase tracking-[0.18em] text-white/60">Attendance Corrections Audit Log</p>
                <div className="space-y-3">
                  {auditLogs.length === 0 ? (
                    <p className="text-[13px] font-semibold text-white/50">No manual corrections have been logged yet.</p>
                  ) : (
                    auditLogs.map(log => (
                      <div key={log.id} className="glass-soft rounded-[16px] p-4 space-y-2">
                        <div className="flex flex-wrap justify-between items-center gap-2">
                          <p className="text-[14px] font-extrabold">{log.staffName} Record Corrected</p>
                          <span className="text-[11px] font-bold text-white/55">by {log.editedBy} · {new Date(log.editedAt).toLocaleDateString()}</span>
                        </div>
                        <p className="text-[12px] text-white/70"><b>Reason:</b> "{log.reason}"</p>
                        <div className="text-[11.5px] font-mono bg-black/30 rounded-[10px] p-2 text-white/80 mt-2">
                          {log.changes.map((c, i) => (
                            <div key={i}>
                              • {c.field}: {c.oldValue ? new Date(c.oldValue).toLocaleTimeString() : 'null'} → {c.newValue ? new Date(c.newValue).toLocaleTimeString() : 'null'}
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
            <div className="grid grid-cols-12 gap-6">
              <div className="col-span-12 lg:col-span-7 glass rounded-[24px] p-6 space-y-6">
                <div className="flex items-center gap-3">
                  <span className="w-10 h-10 rounded-full bg-amber-300/10 text-amber-200 border border-amber-300/20 grid place-items-center"><UserPlus width={17} height={17} /></span>
                  <div>
                    <p className="text-[18px] font-extrabold">Staff Management</p>
                    <p className="text-[11px] font-bold text-white/55">{users.length} registered members · schedule shifts</p>
                  </div>
                </div>

                <div className="glass-soft rounded-[20px] p-5 space-y-4">
                  <p className="text-[12px] font-extrabold uppercase tracking-[0.16em] text-amber-200/80">
                    {editingStaffId ? 'Edit Staff Details' : 'Register New Staff'}
                  </p>

                  <div className="grid sm:grid-cols-2 gap-4">
                    <label className="text-[11.5px] font-extrabold uppercase tracking-wider text-white/60 grid gap-1.5">
                      Full Name
                      <input
                        value={newStaffName}
                        onChange={e => setNewStaffName(e.target.value)}
                        placeholder="Staff name"
                        className="glass-input"
                      />
                    </label>

                    <label className="text-[11.5px] font-extrabold uppercase tracking-wider text-white/60 grid gap-1.5">
                      Role Type
                      <select
                        value={newStaffRole}
                        onChange={e => setNewStaffRole(e.target.value as StaffRole)}
                        className="glass-input"
                      >
                        <option value="Staff">Staff Member</option>
                        <option value="Supervisor">Supervisor</option>
                        <option value="Manager">Manager</option>
                        <option value="Admin">Administrator</option>
                        <option value="Developer">Developer</option>
                      </select>
                    </label>

                    <label className="text-[11.5px] font-extrabold uppercase tracking-wider text-white/60 grid gap-1.5">
                      Shift Start Time
                      <input type="time" value={newStaffShiftStart} onChange={e => setNewStaffShiftStart(e.target.value)} className="glass-input" />
                    </label>

                    <label className="text-[11.5px] font-extrabold uppercase tracking-wider text-white/60 grid gap-1.5">
                      Shift End Time
                      <input type="time" value={newStaffShiftEnd} onChange={e => setNewStaffShiftEnd(e.target.value)} className="glass-input" />
                    </label>

                    <label className="text-[11.5px] font-extrabold uppercase tracking-wider text-white/60 grid gap-1.5">
                      Grace Period (Mins)
                      <input type="number" value={newStaffGrace} onChange={e => setNewStaffGrace(Number(e.target.value))} className="glass-input" />
                    </label>

                    <label className="text-[11.5px] font-extrabold uppercase tracking-wider text-white/60 grid gap-1.5">
                      Weekly Days Off
                      <select
                        multiple
                        value={(newStaffDaysOff ?? []).map(String)}
                        onChange={e => {
                          const selectedOptions = Array.from(e.target.selectedOptions, opt => Number(opt.value));
                          setNewStaffDaysOff(selectedOptions);
                        }}
                        className="glass-input min-h-[50px]"
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

                    <label className="text-[11.5px] font-extrabold uppercase tracking-wider text-white/60 grid gap-1.5">
                      Personal PIN (optional)
                      <input
                        type="password"
                        inputMode="numeric"
                        maxLength={12}
                        value={newStaffPin}
                        onChange={e => setNewStaffPin(e.target.value)}
                        placeholder="4+ digits"
                        autoComplete="off"
                        className="glass-input"
                      />
                    </label>
                  </div>
                  <p className="text-[11px] font-bold text-white/45 -mt-2">With a PIN set, this person must enter it after picking their name — keeps attendance honest.</p>

                  <div className="flex gap-2.5 justify-end pt-2">
                    {editingStaffId ? (
                      <>
                        <button
                          onClick={resetStaffForm}
                          className="pill text-[12px] !py-2 !px-4"
                        >
                          Cancel
                        </button>
                        <button onClick={() => saveEditedStaff(editingStaffId)} className="pill-solid text-[12px] !py-2 !px-4">
                          Save Changes
                        </button>
                      </>
                    ) : (
                      <button onClick={addStaff} disabled={!newStaffName.trim()} className="pill-solid text-[12px] !py-2 !px-5 disabled:opacity-40">
                        Register Member
                      </button>
                    )}
                  </div>
                </div>

                <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
                  {users.map(u => (
                    <div key={u.id} className={`flex items-center justify-between gap-4 glass-soft rounded-[18px] p-4 hover:bg-white/[0.06] transition-all ${u.active ? '' : 'opacity-50'}`}>
                      <div className="flex items-center gap-3 min-w-0">
                        <Avatar name={u.name} size={36} />
                        <div className="min-w-0">
                          <p className="text-[14px] font-extrabold truncate">{u.name} {!u.active && <span className="text-[10px] font-extrabold uppercase tracking-wider text-rose-300/80 ml-1">inactive</span>}{u.pin && <span className="inline-flex align-middle ml-1.5 text-amber-200/80" title="PIN protected"><Lock width={11} height={11} /></span>}</p>
                          <p className="text-[11px] font-bold text-white/55 mt-1 tabular-nums">
                            {u.role} · Shift: {u.shiftStart} - {u.shiftEnd}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => startEditStaff(u)}
                          className="w-9 h-9 rounded-full bg-white/[0.07] hover:bg-white/20 grid place-items-center transition-colors"
                          aria-label={`Edit ${u.name}`}
                          title="Edit details"
                        >
                          <PencilLine width={15} height={15} />
                        </button>

                        <button
                          onClick={() => handleDeactivateStaff(u.id)}
                          className={`w-9 h-9 rounded-full grid place-items-center transition-colors ${u.active ? 'bg-amber-300/10 text-amber-300 hover:bg-amber-300/25' : 'bg-emerald-500/10 hover:bg-emerald-500/25 text-emerald-300'}`}
                          aria-label={`${u.active ? 'Deactivate' : 'Reactivate'} ${u.name}`}
                          title={u.active ? 'Deactivate (keeps member, blocks sign-in)' : 'Reactivate'}
                        >
                          <UserX width={15} height={15} />
                        </button>

                        <button
                          onClick={() => handleDeleteStaff(u.id)}
                          className="w-9 h-9 rounded-full bg-rose-500/10 hover:bg-rose-500/30 text-rose-300 grid place-items-center transition-colors"
                          aria-label={`Delete ${u.name}`}
                          title="Delete permanently"
                        >
                          <Trash2 width={15} height={15} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="col-span-12 lg:col-span-5 space-y-6">
                <div className="glass rounded-[24px] p-6">
                  <div className="flex items-center gap-3">
                    <span className="w-10 h-10 rounded-full bg-amber-300/10 text-amber-200 border border-amber-300/20 grid place-items-center"><KeyRound width={17} height={17} /></span>
                    <div><p className="text-[18px] font-extrabold">Admin code</p><p className="text-[11px] font-bold text-white/55">Controls access to this whole desk</p></div>
                  </div>
                  <div className="flex items-center gap-3 mt-6 glass-soft rounded-[14px] px-4 py-3">
                    <span className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-white/55">Current</span>
                    <span className="ml-auto text-[15px] font-extrabold tracking-[0.3em] text-amber-200/80">••••••••</span>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-4 mt-4">
                    <label className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-white/60 grid gap-2">New code<input type="password" className="glass-input" value={newCode} onChange={e => setNewCode(e.target.value)} placeholder="Min. 4 characters" autoComplete="new-password" /></label>
                    <label className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-white/60 grid gap-2">Confirm<input type="password" className="glass-input" value={confirmCode} onChange={e => setConfirmCode(e.target.value)} placeholder="Repeat it" onKeyDown={e => { if (e.key === 'Enter') changeCode(); }} autoComplete="new-password" /></label>
                  </div>
                  <p className={`mt-3 min-h-[18px] text-[12px] font-extrabold ${codeMsg ? (codeMsg.ok ? 'text-emerald-300' : 'text-rose-300') : 'text-transparent'}`}>
                    {codeMsg ? `${codeMsg.ok ? '✓' : '⚠'} ${codeMsg.text}` : '·'}
                  </p>
                  <button onClick={changeCode} disabled={!newCode || !confirmCode} className="pill-solid mt-5 disabled:opacity-40"><ShieldCheck width={16} height={16} /> Update code</button>
                </div>

                <div className="glass rounded-[24px] p-6 border-rose-500/20 hover:border-rose-500/40 transition-colors">
                  <div className="flex items-center gap-3">
                    <span className="w-10 h-10 rounded-full bg-rose-500/10 text-rose-300 border border-rose-500/25 grid place-items-center">⚠️</span>
                    <div>
                      <p className="text-[18px] font-extrabold text-rose-200">Clear past data</p>
                      <p className="text-[11px] font-bold text-white/55">Irreversibly delete historical records</p>
                    </div>
                  </div>
                  <p className="text-[12.5px] font-semibold text-white/65 mt-4 leading-relaxed">
                    Need to wipe history or reset the tracker? Choose to clear either all past records or only those older than today. Checklist configs and rosters will not be affected.
                  </p>
                  <div className="grid grid-cols-2 gap-3 mt-5">
                    <button
                      onClick={() => setConfirmSpec({
                        title: 'Delete all history',
                        body: 'This will irreversibly delete ALL checklist signature records in the system. Checklists and the team roster will not be deleted.',
                        confirmLabel: 'Delete everything',
                        danger: true,
                        typedPhrase: 'DELETE ALL',
                        onConfirm: () => { persist({}); haptic([20, 60, 20]); showToast('All signature records cleared.'); },
                      })}
                      className="pill text-[12px] !border-rose-500/30 text-rose-300 hover:bg-rose-500/10 justify-center"
                    >
                      Delete all history
                    </button>
                    <button
                      onClick={() => setConfirmSpec({
                        title: 'Clear past, keep today',
                        body: `This will irreversibly delete all checklist signatures from previous days, keeping ONLY today's signatures (${todayKey}).`,
                        confirmLabel: 'Clear history',
                        danger: true,
                        onConfirm: () => {
                          const todayOnly: Records = {};
                          if (records[todayKey]) todayOnly[todayKey] = records[todayKey];
                          persist(todayOnly);
                          haptic([20, 60, 20]);
                          showToast("All historical data cleared except today's.");
                        },
                      })}
                      className="pill text-[12px] !border-rose-500/30 text-rose-300 hover:bg-rose-500/10 justify-center"
                    >
                      Clear past, keep today
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {adminPane === 'developer' && isDev && (
            <div className="grid grid-cols-12 gap-6">
              <div className="col-span-12 lg:col-span-7 glass rounded-[24px] p-6">
                <div className="flex items-center gap-3">
                  <span className="w-10 h-10 rounded-full bg-violet-500/15 text-violet-300 border border-violet-500/25 grid place-items-center"><Terminal width={17} height={17} /></span>
                  <div>
                    <p className="text-[18px] font-extrabold">Raw data console</p>
                    <p className="text-[11px] font-bold text-white/55">Direct store access — developer only, hidden from admins</p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 mt-5">
                  {(['records', 'users', 'attendance', 'checklists'] as const).map(k => (
                    <button key={k} onClick={() => setDevStoreKey(k)} className={`relative px-4 py-1.5 rounded-full text-[11.5px] font-extrabold uppercase tracking-wider transition-colors ${devStoreKey === k ? 'bg-gradient-to-br from-violet-400 to-violet-600 text-white' : 'bg-white/[0.06] text-white/60 hover:bg-white/15'}`}>
                      {k}
                    </button>
                  ))}
                </div>

                <textarea
                  value={devJson}
                  onChange={e => setDevJson(e.target.value)}
                  spellCheck={false}
                  placeholder='Load a store, edit the JSON, then Apply. Example: []'
                  className="glass-input mt-4 font-mono !text-[11.5px] leading-relaxed min-h-[260px] resize-y"
                />

                <div className="flex flex-wrap gap-3 mt-4">
                  <button
                    onClick={() => {
                      const data = devStoreKey === 'records' ? records : devStoreKey === 'users' ? users : devStoreKey === 'attendance' ? attendance : checklists;
                      setDevJson(JSON.stringify(data, null, 2));
                      showToast(`${devStoreKey} loaded into console.`);
                    }}
                    className="pill text-[12px] !py-2"
                  >
                    <RotateCw width={14} height={14} /> Load current
                  </button>
                  <button
                    onClick={() => {
                      let parsed: unknown;
                      try { parsed = JSON.parse(devJson); } catch { showToast('Invalid JSON — nothing applied.'); return; }
                      if (devStoreKey === 'records') persist(parsed as Records);
                      else if (devStoreKey === 'users') persistUsers(parsed as StaffMember[]);
                      else if (devStoreKey === 'attendance') persistAttendance(parsed as typeof attendance);
                      else setChecklists(parsed as typeof checklists);
                      haptic([12, 40, 12]);
                      showToast(`${devStoreKey} store overwritten.`);
                    }}
                    className="pill-solid text-[12px] !py-2 disabled:opacity-40"
                    disabled={!devJson.trim()}
                  >
                    <Save width={14} height={14} /> Apply to all devices
                  </button>
                </div>
              </div>

              <div className="col-span-12 lg:col-span-5 space-y-6">
                <div className="glass rounded-[24px] p-6 border-rose-500/25">
                  <div className="flex items-center gap-3">
                    <span className="w-10 h-10 rounded-full bg-rose-500/10 text-rose-300 border border-rose-500/25 grid place-items-center"><AlertCircle width={17} height={17} /></span>
                    <div>
                      <p className="text-[18px] font-extrabold text-rose-200">Factory reset</p>
                      <p className="text-[11px] font-bold text-white/55">Wipes every store on this device</p>
                    </div>
                  </div>
                  <p className="text-[12.5px] font-semibold text-white/65 mt-4 leading-relaxed">
                    Clears checklist records, team roster (back to defaults), attendance, audit logs and checklist config locally, then pushes empty stores to the cloud. Every signed-in device will re-sync to blank.
                  </p>
                  <button
                    onClick={() => setConfirmSpec({
                      title: 'Factory reset',
                      body: 'This wipes ALL local stores and pushes empty data to the cloud: signatures, attendance and the roster are destroyed. This cannot be undone.',
                      confirmLabel: 'Wipe everything',
                      danger: true,
                      typedPhrase: 'RESET ALL',
                      onConfirm: () => {
                        try {
                          [RECORDS_KEY, CHECKLISTS_KEY, USERS_KEY, ATTENDANCE_KEY, AUDIT_LOG_KEY].forEach(k => window.localStorage.removeItem(k));
                          window.localStorage.removeItem('daily_current_staff');
                          setRecords({}); persistUsers(DEFAULT_USERS); persistAttendance([]); setChecklists({ opening: [...DEFAULT_CHECKLISTS.opening], closing: [...DEFAULT_CHECKLISTS.closing] }); setAuditLogs([]);
                          setStaffName(''); setAdminUnlocked(false); setDevUnlocked(false);
                          goView('home');
                          haptic([20, 60, 20]);
                          showToast('Factory reset complete.');
                        } catch { showToast('Reset failed — check console.'); }
                      },
                    })}
                    className="pill w-full justify-center text-[12px] !border-rose-500/40 text-rose-300 hover:bg-rose-500/10 mt-5"
                  >
                    Wipe device & cloud stores
                  </button>
                </div>

                <div className="glass rounded-[24px] p-6">
                  <p className="text-[18px] font-extrabold flex items-center gap-2"><Code width={17} height={17} className="text-violet-300" /> Session</p>
                  <div className="mt-4 space-y-2 text-[12px] font-semibold text-white/60">
                    <p>Admin unlocked · <span className="text-white/85">{String(adminUnlocked)}</span></p>
                    <p>Developer mode · <span className="text-white/85">{String(isDev)}</span></p>
                    <p>Cloud status · <span className="text-white/85">{cloudStatus}</span></p>
                    <p>Offline queue · <span className="text-white/85">{pendingSync} write(s)</span></p>
                    <p>Stores · <span className="text-white/85">{Object.keys(records).length} day(s), {users.length} member(s), {attendance.length} attendance row(s)</span></p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {adminPane === 'insights' && (() => {
            const dayStats = dates.map(d => {
              const r = records[d] || emptyDay(d);
              const o = progress(r, 'opening'); const c = progress(r, 'closing');
              const total = o.total + c.total;
              const done = o.done + c.done;
              return { date: d, pct: total ? Math.round((done / total) * 100) : 0, done, signatures: Object.values(r.opening).filter(l => l?.done).length + Object.values(r.closing).filter(l => l?.done).length };
            }).reverse();
            const activeDays = dayStats.filter(s => s.signatures > 0);
            const avgPct = activeDays.length ? Math.round(activeDays.reduce((sum, s) => sum + s.pct, 0) / activeDays.length) : 0;
            const best = [...dayStats].sort((a, b) => b.pct - a.pct)[0];
            let streak = 0;
            for (let i = dayStats.length - 1; i >= 0; i--) { if (dayStats[i].signatures > 0) streak += 1; else break; }
            const byStaff = new Map<string, number>();
            Object.values(records).forEach(r => { Object.values(r.opening).concat(Object.values(r.closing)).forEach(l => { if (l?.done) byStaff.set(l.staff, (byStaff.get(l.staff) ?? 0) + 1); }); });
            const leaderboard = [...byStaff.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
            const maxSigs = leaderboard[0]?.[1] ?? 1;
            const recentAtt = attendance.filter(a => a.createdAt >= dates[dates.length - 1]);
            const lateCount = recentAtt.filter(a => a.status === 'Late').length;
            const totalHours = Math.round(recentAtt.reduce((sum, a) => sum + (a.workingHours ?? 0), 0) * 10) / 10;
            return (
              <div className="space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {[
                    { label: 'Active days', val: String(activeDays.length), sub: `of last ${dates.length}`, accent: '#e4c078' },
                    { label: 'Current streak', val: `${streak}d`, sub: 'days in a row', accent: '#fb7185' },
                    { label: 'Avg completion', val: `${avgPct}%`, sub: 'on active days', accent: '#34d399' },
                    { label: 'Best day', val: best && best.signatures ? `${best.pct}%` : '—', sub: best?.signatures ? parseKey(best.date).toLocaleDateString([], { month: 'short', day: 'numeric' }) : 'no data yet', accent: '#8b7cf7' },
                  ].map((stat, i) => (
                    <motion.div key={stat.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06, duration: 0.5, ease: EASE }} className="glass stat-card rounded-[22px] p-5 relative overflow-hidden" style={{ ['--accent' as string]: stat.accent }}>
                      <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-white/55">{stat.label}</p>
                      <p className="text-[32px] font-extrabold leading-none mt-2 tabular-nums">{stat.val}</p>
                      <p className="text-[11px] font-semibold text-white/50 mt-1.5 truncate">{stat.sub}</p>
                    </motion.div>
                  ))}
                </div>

                <div className="grid grid-cols-12 gap-6">
                  <div className="col-span-12 lg:col-span-7 glass rounded-[24px] p-6">
                    <p className="text-[12px] font-extrabold uppercase tracking-[0.18em] text-white/60">Completion · last 14 days</p>
                    <div className="flex items-end gap-1.5 h-[140px] mt-6">
                      {dayStats.map(s => (
                        <div key={s.date} className="flex-1 flex flex-col items-center gap-2 group" title={`${parseKey(s.date).toLocaleDateString([], { month: 'short', day: 'numeric' })} — ${s.pct}%`}>
                          <motion.div
                            className={`w-full rounded-t-[6px] min-h-[3px] ${s.pct >= 90 ? 'bg-gradient-to-t from-emerald-500/70 to-emerald-300' : s.pct >= 50 ? 'bg-gradient-to-t from-amber-500/70 to-amber-300' : 'bg-white/15'}`}
                            initial={{ height: 0 }} animate={{ height: `${Math.max(s.pct, 3)}%` }} transition={{ duration: 0.7, ease: EASE }}
                          />
                          <span className="text-[9px] font-bold text-white/40 tabular-nums">{parseKey(s.date).getDate()}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="col-span-12 lg:col-span-5 glass rounded-[24px] p-6">
                    <div className="flex items-center gap-2">
                      <Flame width={15} height={15} className="text-amber-300" />
                      <p className="text-[12px] font-extrabold uppercase tracking-[0.18em] text-white/60">Top signers</p>
                    </div>
                    <div className="space-y-3 mt-5">
                      {leaderboard.length === 0 ? (
                        <p className="text-[13px] font-semibold text-white/50">No signatures yet — the board fills this in.</p>
                      ) : leaderboard.map(([name, count], i) => (
                        <div key={name} className="flex items-center gap-3">
                          <span className="text-[12px] font-extrabold text-white/45 tabular-nums w-4">{i + 1}</span>
                          <Avatar name={name} size={28} />
                          <span className="text-[13px] font-extrabold flex-1 truncate">{name}</span>
                          <span className="w-24 h-2 rounded-full bg-white/10 overflow-hidden shrink-0"><motion.i className="block h-full rounded-full bg-gradient-to-r from-amber-200 to-amber-500" initial={{ width: 0 }} animate={{ width: `${(count / maxSigs) * 100}%` }} transition={{ duration: 0.8, ease: EASE }} style={{ display: 'block' }} /></span>
                          <span className="text-[12px] font-extrabold text-amber-200 tabular-nums w-7 text-right">{count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="glass rounded-[22px] p-5">
                    <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-white/55">Lates · last 14 days</p>
                    <p className="text-[30px] font-extrabold leading-none mt-2 tabular-nums">{lateCount}</p>
                    <p className="text-[11px] font-semibold text-white/50 mt-1">{recentAtt.length} check-ins recorded</p>
                  </div>
                  <div className="glass rounded-[22px] p-5">
                    <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-white/55">Hours worked · last 14 days</p>
                    <p className="text-[30px] font-extrabold leading-none mt-2 tabular-nums">{totalHours}</p>
                    <p className="text-[11px] font-semibold text-white/50 mt-1">across completed shifts</p>
                  </div>
                </div>
              </div>
            );
          })()}

          {adminPane === 'setup' && (
            <div className="space-y-6">
              <div className="glass rounded-[28px] p-6 space-y-5">
                <div className="flex items-center gap-3">
                  <span className="w-12 h-12 rounded-full bg-amber-300/10 text-amber-200 border border-amber-300/20 grid place-items-center"><Code width={20} height={20} /></span>
                  <div>
                    <h3 className="text-[22px] font-extrabold">Supabase SQL Editor</h3>
                    <p className="text-[12.5px] font-bold text-white/55">Connect database and configure tables</p>
                  </div>
                </div>

                <p className="text-[13px] font-medium leading-relaxed text-white/70">
                  Run this SQL script once in your Supabase dashboard **SQL Editor** to fully configure RLS, and realtime tables for checking staff members in and out with grace limits:
                </p>

                <div className="relative">
                  <pre className="text-[11.5px] font-mono bg-black/40 border border-white/10 rounded-[18px] p-4 text-white/85 overflow-x-auto max-h-[300px] leading-relaxed">
                    {SUPABASE_SETUP_SQL}
                  </pre>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(SUPABASE_SETUP_SQL);
                      showToast('SQL Script copied to clipboard.');
                    }}
                    className="pill-solid absolute right-3 top-3 text-[11px] !py-1.5 !px-3"
                  >
                    Copy SQL
                  </button>
                </div>
              </div>

              <div className="glass rounded-[28px] p-6 space-y-5">
                <div className="flex items-center gap-3">
                  <span className="w-12 h-12 rounded-full bg-amber-300/10 text-amber-200 border border-amber-300/20 grid place-items-center"><BellRing width={20} height={20} /></span>
                  <div>
                    <h3 className="text-[22px] font-extrabold">Push Notifications</h3>
                    <p className="text-[12.5px] font-bold text-white/55">Get check-in/out alerts on this phone, even when the app is closed</p>
                  </div>
                </div>

                <p className="text-[13px] font-medium leading-relaxed text-white/70">
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
                    showToast(ok ? 'Push notifications enabled on this device.' : 'Could not enable — check browser permissions.');
                  }}
                  className="pill-solid text-[13px] !py-2.5 !px-5"
                >
                  Enable Push Notifications
                </button>
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );

  const viewContent = (() => {
    switch (view) {
      case 'home': return HomeView();
      case 'opening': return ShiftView({ shift: 'opening' });
      case 'closing': return ShiftView({ shift: 'closing' });
      case 'attendance': return AttendanceView();
      case 'history': return HistoryView();
      case 'admin': return adminUnlocked ? AdminView() : null;
      default: return null;
    }
  })();

  /* ------------------------------ shell ------------------------------ */

  const NAV_ITEMS: [View, string][] = [['home', 'Home'], ['opening', 'Opening'], ['closing', 'Closing'], ['attendance', 'Clock-In'], ['history', 'History']];
  const DOCK_ICONS: Record<View, typeof ClipboardList> = {
    home: ClipboardList, opening: Sun, closing: Moon, attendance: Briefcase, history: History, admin: Settings,
  };

  return (
    <div className="stage font-body">
      <div className="orb orb-1" /><div className="orb orb-2" /><div className="orb orb-3" />

      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-[248px] z-40 flex-col glass-deep !rounded-none p-6 overflow-y-auto">
        <motion.button
          onClick={() => goView('home')}
          className="flex items-center gap-3 group w-fit"
          whileTap={{ scale: 0.97 }}
        >
          <span className="w-11 h-11 rounded-[15px] bg-gradient-to-br from-amber-200 to-amber-500 text-[#241a07] grid place-items-center shadow-[0_14px_34px_-10px_rgba(201,154,69,0.6)] group-hover:rotate-[-6deg] transition-transform duration-300">
            <ClipboardList width={21} height={21} strokeWidth={2.4} />
          </span>
          <span className="font-display uppercase text-[14px] leading-[1.1] text-left">Daily<br />Check</span>
        </motion.button>

        <p className="mt-9 mb-2 px-3 text-[10px] font-extrabold uppercase tracking-[0.18em] text-white/40">Workspace</p>
        <nav className="flex flex-col gap-1.5" aria-label="Primary">
          {NAV_ITEMS.map(([v, l]) => {
            const Ic = DOCK_ICONS[v];
            const active = view === v;
            return (
              <motion.button
                key={v}
                onClick={() => goView(v)}
                whileTap={{ scale: 0.97 }}
                className={`nav-item !flex !w-full !items-center !justify-start !gap-3 !rounded-[15px] !py-2.5 !px-4 !normal-case !tracking-normal !text-[13.5px] ${active ? 'active' : ''}`}
              >
                {active && <motion.span layoutId="side-chip" className="nav-chip !rounded-[15px]" transition={{ duration: 0.4, ease: EASE }} />}
                <Ic width={16} height={16} className="relative z-10 shrink-0" />
                <span className="relative z-10 font-extrabold">{l}</span>
              </motion.button>
            );
          })}
        </nav>

        <div className="mt-auto flex flex-col gap-1.5">
          <motion.button
            onClick={tryAdmin}
            whileTap={{ scale: 0.97 }}
            className={`nav-item !flex !w-full !items-center !justify-start !gap-3 !rounded-[15px] !py-2.5 !px-4 !normal-case !tracking-normal !text-[13.5px] ${view === 'admin' ? 'active' : ''}`}
          >
            {view === 'admin' && <motion.span layoutId="side-chip" className="nav-chip !rounded-[15px]" transition={{ duration: 0.4, ease: EASE }} />}
            {adminUnlocked ? <ShieldCheck width={16} height={16} className="relative z-10 shrink-0" /> : <Lock width={16} height={16} className="relative z-10 shrink-0" />}
            <span className="relative z-10 font-extrabold">{adminUnlocked ? 'Admin desk' : 'Unlock admin'}</span>
          </motion.button>

          <div className="glass-soft rounded-[15px] px-4 py-3 mt-3 flex items-center gap-3">
            {staffName ? <Avatar name={staffName} size={30} /> : <span className="w-[30px] h-[30px] rounded-full bg-white/10 grid place-items-center text-white/70"><User width={14} height={14} /></span>}
            <div className="min-w-0">
              <p className="text-[12.5px] font-extrabold truncate">{staffName || 'Not signed in'}</p>
              <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-white/50 flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${cloudOn && pendingSync === 0 ? 'bg-emerald-400' : cloudStatus === 'checking' ? 'bg-amber-300 pulse-soft' : 'bg-rose-400'}`} />
                {pendingSync > 0 ? `${pendingSync} queued` : cloudOn ? 'synced' : cloudStatus === 'checking' ? 'syncing' : 'local'}
              </p>
            </div>
          </div>
        </div>
      </aside>

      <div className="relative z-10 lg:ml-[248px]">
      <div className="max-w-[1200px] mx-auto px-5 lg:px-10 pb-20 pt-6">
        <header className="flex flex-wrap items-center gap-4">
          <motion.button
            onClick={() => goView('home')}
            className="flex items-center gap-3 group"
            whileTap={{ scale: 0.97 }}
          >
            <span className="w-12 h-12 rounded-[16px] bg-gradient-to-br from-amber-200 to-amber-500 text-[#241a07] grid place-items-center shadow-[0_14px_34px_-10px_rgba(201,154,69,0.6)] group-hover:rotate-[-6deg] transition-transform duration-300">
              <ClipboardList width={22} height={22} strokeWidth={2.4} />
            </span>
            <span className="font-display uppercase text-[15px] leading-[1.1]">Daily<br />Check</span>
          </motion.button>

          <nav className="glass rounded-full p-1.5 ml-auto hidden md:flex lg:hidden items-center gap-1">
            {NAV_ITEMS.map(([v, l]) => (
              <button key={v} onClick={() => goView(v)} className={`nav-item ${view === v ? 'active' : ''}`}>
                {view === v && <motion.span layoutId="nav-chip" className="nav-chip" transition={{ duration: 0.45, ease: EASE }} />}
                <span className="relative z-10">{l}</span>
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-2.5 ml-auto md:ml-0 relative">
            <motion.button
              whileTap={{ scale: 0.92 }}
              onClick={() => { setTheme(t => (t === 'dark' ? 'light' : 'dark')); haptic(10); }}
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              className="w-11 h-11 rounded-full grid place-items-center bg-white/[0.04] border border-white/15 hover:bg-white/10 transition-colors"
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={theme}
                  initial={{ rotate: -90, opacity: 0, scale: 0.6 }}
                  animate={{ rotate: 0, opacity: 1, scale: 1 }}
                  exit={{ rotate: 90, opacity: 0, scale: 0.6 }}
                  transition={{ duration: 0.3, ease: EASE }}
                  className="grid place-items-center"
                >
                  {theme === 'dark' ? <Sun width={16} height={16} /> : <Moon width={16} height={16} />}
                </motion.span>
              </AnimatePresence>
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.94 }}
              onClick={retryCloud}
              aria-label="Cloud sync status — tap to retry"
              title={cloudOn ? 'Cloud sync connected' : cloudStatus === 'checking' ? 'Checking cloud…' : 'Offline — tap to retry'}
              className={`hidden sm:flex h-11 items-center gap-2 rounded-full border transition-colors px-4 ${pendingSync > 0 ? 'bg-amber-300/10 border-amber-300/30' : 'bg-white/[0.04] border-white/15 hover:bg-white/10'}`}
            >
              <span
                className={`w-2 h-2 rounded-full ${cloudOn && pendingSync === 0 ? 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.9)]' : cloudStatus === 'checking' ? 'bg-amber-300 pulse-soft' : pendingSync > 0 ? 'bg-amber-300 pulse-soft' : 'bg-rose-400'}`}
              />
              <span className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-white/70">
                {pendingSync > 0 ? `${pendingSync} queued` : cloudOn ? 'synced' : cloudStatus === 'checking' ? 'syncing' : 'local'}
              </span>
            </motion.button>
            <motion.button whileTap={{ scale: 0.92 }} onClick={tryAdmin} aria-label="Admin" className={`w-11 h-11 rounded-full grid place-items-center border transition-colors ${view === 'admin' ? 'bg-gradient-to-br from-amber-200 to-amber-500 text-[#241a07] border-transparent' : 'bg-white/[0.04] border-white/15 hover:bg-white/10'}`}>
              {adminUnlocked ? <ShieldCheck width={17} height={17} /> : <Lock width={16} height={16} />}
            </motion.button>
            <motion.button whileTap={{ scale: 0.96 }} onClick={() => { setNameOpen(o => !o); setNameInput(staffName); }} className="h-11 rounded-full bg-white/[0.04] border border-white/15 hover:bg-white/10 transition-colors pl-2 pr-4 flex items-center gap-2.5">
              {staffName ? <Avatar name={staffName} size={30} /> : <span className="w-[30px] h-[30px] rounded-full bg-white/10 grid place-items-center text-white/70"><User width={14} height={14} /></span>}
              <span className="text-[13px] font-extrabold max-w-[90px] truncate">{staffName || 'Sign in'}</span>
            </motion.button>

            <AnimatePresence>
              {nameOpen && (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setNameOpen(false)} />
                  <motion.div
                    initial={{ opacity: 0, y: -10, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -8, scale: 0.97 }}
                    transition={{ duration: 0.28, ease: EASE }}
                    className="absolute right-0 top-[54px] w-[300px] glass-deep rounded-[22px] p-5 z-30"
                    style={{ transformOrigin: 'top right' }}
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-[12px] font-extrabold uppercase tracking-[0.16em] text-amber-200/80">{pendingPinUser ? 'Enter your PIN' : "Who's on it?"}</p>
                      <button onClick={() => { setNameOpen(false); setPendingPinUser(null); }} aria-label="Close" className="w-7 h-7 rounded-full bg-white/10 grid place-items-center hover:bg-white/25 transition-colors"><X width={13} height={13} /></button>
                    </div>

                    {pendingPinUser ? (
                      <div className="mt-4">
                        <div className="flex items-center gap-3 glass-soft rounded-[14px] px-4 py-3">
                          <Avatar name={pendingPinUser.name} size={30} />
                          <span className="text-[14px] font-extrabold">{pendingPinUser.name}</span>
                        </div>
                        <input
                          autoFocus
                          type="password"
                          inputMode="numeric"
                          value={pinInput}
                          onChange={e => { setPinInput(e.target.value); setPinError(''); }}
                          onKeyDown={e => { if (e.key === 'Enter') confirmPin(); }}
                          placeholder="4+ digit PIN"
                          aria-label="Your PIN"
                          maxLength={12}
                          className="glass-input mt-3 text-center tracking-[0.5em]"
                        />
                        {pinError && <p className="text-[11px] font-extrabold mt-2 text-rose-300">{pinError}</p>}
                        <button onClick={confirmPin} disabled={!pinInput.trim()} className="btn-ivory w-full justify-center mt-3 !py-2.5 text-[13px] disabled:opacity-40">Unlock</button>
                        <button onClick={() => setPendingPinUser(null)} className="w-full text-center text-[11px] font-bold text-white/55 hover:text-white mt-3 transition-colors">Back to roster</button>
                      </div>
                    ) : (
                      <>
                        {users.length > 0 && (
                          <motion.div variants={staggerParent} initial="hidden" animate="show" className="grid grid-cols-2 gap-2 mt-4">
                            {users.map(u => (
                              <motion.button
                                variants={riseItem}
                                key={u.id}
                                onClick={() => requestSignIn(u, '')}
                                className={`relative flex items-center gap-2 rounded-[14px] px-2.5 py-2 text-left transition-colors ${staffName.toLowerCase() === u.name.toLowerCase() ? 'bg-gradient-to-br from-amber-200 to-amber-500 text-[#241a07]' : 'bg-white/[0.06] hover:bg-white/15'}`}
                              >
                                <Avatar name={u.name} size={26} />
                                <span className="text-[13px] font-extrabold truncate">{u.name}</span>
                                {u.pin && (
                                  <span className={`absolute top-1 right-1.5 ${staffName.toLowerCase() === u.name.toLowerCase() ? 'text-[#241a07]/70' : 'text-white/45'}`} title="PIN protected"><Lock width={10} height={10} /></span>
                                )}
                              </motion.button>
                            ))}
                          </motion.div>
                        )}

                        <div className={`mt-4 ${users.length ? 'pt-4 border-t border-white/10' : ''}`}>
                          <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-white/50 mb-2">{users.length ? 'or type a name' : 'type your name'}</p>
                          <input
                            ref={nameRef}
                            value={nameInput}
                            onChange={e => setNameInput(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') requestSignIn(users.find(u => u.name.toLowerCase() === nameInput.trim().toLowerCase()) ?? null, nameInput); }}
                            placeholder="Your name"
                            aria-label="Your name"
                            className="glass-input"
                          />
                          {users.length > 0 && nameInput.trim() && !onRoster(nameInput) && (
                            <p className="text-[10px] font-bold text-amber-200/90 mt-2">Not on the roster — an admin can add you in Settings.</p>
                          )}
                          <button onClick={() => requestSignIn(users.find(u => u.name.toLowerCase() === nameInput.trim().toLowerCase()) ?? null, nameInput)} disabled={!nameInput.trim()} className="btn-ivory w-full justify-center mt-3 !py-2.5 text-[13px] disabled:opacity-40">Sign in</button>
                        </div>
                      </>
                    )}
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        </header>

        <main className="mt-4 md:mt-0">
          <AnimatePresence mode="wait" custom={viewDir}>
            <motion.div key={view} custom={viewDir} variants={pageVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.38, ease: EASE }}>
              {viewContent}
            </motion.div>
          </AnimatePresence>
        </main>

        <footer className="mt-20 pt-6 border-t border-white/10 flex flex-wrap items-center justify-between gap-3 pb-16 md:pb-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/40">Daily Check — team checklist tracker</p>
          <p className="hidden sm:block text-[11px] font-bold text-white/40">sign it · ship it · repeat</p>
          <p className="text-[11px] font-bold text-white/40 w-full text-center sm:w-auto sm:text-right">
            Developed by{' '}
            <a
              href="https://github.com/Willsonraiii"
              target="_blank"
              rel="noopener noreferrer"
              className="text-amber-200/90 hover:underline underline-offset-4"
            >
              Willson Obito
            </a>
          </p>
        </footer>
      </div>
      </div>

      <nav className="md:hidden mobile-dock glass-deep" aria-label="Primary">
        {([['home', 'Home'], ['opening', 'Open'], ['closing', 'Close'], ['attendance', 'Clock'], ['history', 'Log']] as [View, string][]).map(([v, l]) => {
          const Ic = DOCK_ICONS[v];
          const active = view === v;
          return (
            <button key={v} onClick={() => goView(v)} className="relative flex flex-col items-center gap-1 px-3 py-2 rounded-[18px] min-w-[56px]">
              {active && (
                <motion.span
                  layoutId="dock-chip"
                  className={`absolute inset-0 rounded-[18px] bg-gradient-to-br from-amber-200 to-amber-500 ${!REDUCE_MOTION ? 'transition-none' : 'transition-transform duration-0.4 ease-EASE'}`
                  }
                  style={{ transform: REDUCE_MOTION ? 'scaleX(1)' : `translateX(${swipeComplete * 90}px)` }}
                  transition={{ type: REDUCE_MOTION ? 'none' : 'spring', stiffness: 320, damping: 27 }}
                />
              )}/>}
              <Ic width={18} height={18} className={`relative z-10 ${active ? 'text-[#241a07]' : 'text-white/60'}`} />
              <span className={`relative z-10 text-[9.5px] font-extrabold uppercase tracking-wide ${active ? 'text-[#241a07]' : 'text-white/60'}`}>{l}</span>
            </button>
          );
        })}
      </nav>

        {/* Swipe indicator for mobile */}
        {!REDUCE_MOTION && (
          <motion.div
            className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-2 text-[10px] font-bold text-white/50 uppercase tracking-widest"
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            transition={{ duration: 0.3, ease: EASE }}
          >
            <span>Swipe</span>
            <span>•</span>
            <span>to switch</span>
          </motion.div>
        )}

      <AnimatePresence>
        {showGate && (
          <motion.div
            className="modal-veil"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={() => setShowGate(false)}
          >
            <motion.div
              className="glass-deep gold-edge rounded-[28px] p-8 w-full max-w-[420px]"
              initial={{ opacity: 0, y: 34, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 320, damping: 27 }}
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-start justify-between">
                <span className="w-12 h-12 rounded-full bg-gradient-to-br from-amber-200 to-amber-500 text-[#241a07] grid place-items-center"><Lock width={19} height={19} /></span>
                <button onClick={() => setShowGate(false)} aria-label="Close" className="w-8 h-8 rounded-full bg-white/10 grid place-items-center hover:bg-white/25 transition-colors"><X width={14} height={14} /></button>
              </div>
              <h3 className="text-[28px] font-extrabold tracking-tight mt-5">Admin access</h3>
              <p className="text-[13px] font-semibold text-white/60 mt-2 leading-relaxed">The code unlocks checklists, team management, and exports.</p>
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
              {gateError && <p className="text-[12px] font-extrabold mt-3 text-rose-300">{gateError}</p>}
              <button onClick={unlock} className="pill-solid w-full justify-center mt-6">Unlock <ArrowRight width={16} height={16} /></button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {confirmSpec && (
          <motion.div
            className="modal-veil"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={() => { setConfirmSpec(null); setConfirmTyped(''); }}
          >
            <motion.div
              className="glass-deep rounded-[28px] p-8 w-full max-w-[420px]"
              initial={{ opacity: 0, y: 34, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 320, damping: 27 }}
              onClick={e => e.stopPropagation()}
              role="alertdialog"
              aria-modal="true"
              aria-label={confirmSpec.title}
            >
              <div className="flex items-start justify-between">
                <span className={`w-12 h-12 rounded-full grid place-items-center ${confirmSpec.danger ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30' : 'bg-gradient-to-br from-amber-200 to-amber-500 text-[#241a07]'}`}><AlertCircle width={19} height={19} /></span>
                <button onClick={() => { setConfirmSpec(null); setConfirmTyped(''); }} aria-label="Close" className="w-8 h-8 rounded-full bg-white/10 grid place-items-center hover:bg-white/25 transition-colors"><X width={14} height={14} /></button>
              </div>
              <h3 className={`text-[26px] font-extrabold tracking-tight mt-5 ${confirmSpec.danger ? 'text-rose-200' : ''}`}>{confirmSpec.title}</h3>
              <p className="text-[13px] font-semibold text-white/65 mt-2 leading-relaxed">{confirmSpec.body}</p>
              {confirmSpec.typedPhrase && (
                <input
                  autoFocus
                  value={confirmTyped}
                  onChange={e => setConfirmTyped(e.target.value)}
                  placeholder={`Type "${confirmSpec.typedPhrase}"`}
                  aria-label={`Type ${confirmSpec.typedPhrase} to confirm`}
                  className="glass-input mt-5"
                />
              )}
              <div className="flex gap-3 mt-6">
                <button onClick={() => { setConfirmSpec(null); setConfirmTyped(''); }} className="pill flex-1 justify-center">Cancel</button>
                <button
                  onClick={() => {
                    if (confirmSpec.typedPhrase && confirmTyped.trim().toUpperCase() !== confirmSpec.typedPhrase) return;
                    const fn = confirmSpec.onConfirm;
                    setConfirmSpec(null); setConfirmTyped('');
                    fn();
                  }}
                  disabled={Boolean(confirmSpec.typedPhrase) && confirmTyped.trim().toUpperCase() !== confirmSpec.typedPhrase}
                  className={confirmSpec.danger ? 'pill flex-1 justify-center !border-rose-500/40 text-rose-200 hover:!bg-rose-500/15 disabled:opacity-35' : 'pill-solid flex-1 justify-center'}
                >
                  {confirmSpec.confirmLabel}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {toast && (
          <motion.div
            className="toast"
            initial={{ opacity: 0, y: 24, scale: 0.94, x: '-50%' }}
            animate={{ opacity: 1, y: 0, scale: 1, x: '-50%' }}
            exit={{ opacity: 0, y: 14, scale: 0.96, x: '-50%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 26 }}
          >
            <Check width={15} height={15} strokeWidth={3} /> {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
