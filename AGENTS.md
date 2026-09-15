# Daily-Checklist

PWA-style daily checklist app. Single-file Vite build (vite-plugin-singlefile).

## Tech Stack
- React 19 + TypeScript + Vite 7
- Tailwind CSS v4 (via @tailwindcss/vite), framer-motion animations, lucide-react icons
- Supabase (@supabase/supabase-js) for cloud sync + push notifications
- clsx + tailwind-merge (see src/utils/cn.ts)

## Commands
- Dev server: `npm run dev`
- Production build: `npm run build`
- Preview build: `npm run preview`
- No test framework configured yet.

## Architecture
- `src/App.tsx` — main app (UI, state, realtime sync, offline queue, PIN sign-in, insights pane)
- `src/lib/cloud.ts` — Supabase cloud sync logic
- `src/lib/push.ts` — push notification handling
- `src/supabaseClient.ts` — Supabase client init
- `public/sw.js` — service worker
- `.github/` — deployment workflow

## Features Already Done
- Realtime sync + offline queue
- PIN sign-in
- Light/dark themes (premium dark theme + framer-motion animations)
- Insights pane
- Styled confirm dialogs
- Push notifications via Supabase

## Conventions
- Commit messages: short imperative summary of the change.

## Session Continuity Protocol
IMPORTANT: NEVER push to GitHub unless the user explicitly says "push" in that
session. After making changes: build locally (`npm run build`) or start
`npm run dev` for preview, and let the user review first.

When finishing a work session in this repo:
1. Update `TODO.md` (mark done items, add new ones).
2. Update the "Current Status" section below.
3. Commit/push ONLY if user asked.

### Current Status
Last worked on: 2026-09-15 — added header date/time pill (Nepali ⇄ English,
between theme toggle and cloud pill): BS date + Nepal Time (UTC+5:45) in
Devanagari via `nepali-date-converter` npm pkg, or English A.D./local; tap to
switch, persisted (`daily_datetime_mode`), attendance clock follows it.
Theme is now 3-mode: auto (06:00–18:00 local = light, else dark) / dark /
light, cycled on tap, persisted (`daily_theme_mode`; `daily_theme` still holds
the effective theme for back-compat). Earlier this session: offline admin
unlock fix (tri-state RPC + cached SHA-256 code hash, admin writes join the
offline queue) and hide-menu/drawer mode (`daily_menu_hidden`,
`.mobile-dock.dock-hidden` CSS). Vite dev allows proxied hosts. Deploy:
GitHub Actions on push to main → Pages.
