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
When finishing a work session in this repo:
1. Update `TODO.md` (mark done items, add new ones).
2. Update the "Current Status" section below.
3. Commit changes if user asks.

### Current Status
Last worked on: 2026-08-25 — added realtime sync, offline queue,
PIN sign-in, light theme, insights pane and styled confirm dialogs
(commit 3bbcea4). Working tree clean at that point.
