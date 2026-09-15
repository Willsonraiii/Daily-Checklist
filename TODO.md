# TODO

## In Progress
(none — pick from Backlog)

## Backlog
- [ ] Add a test setup (e.g., Vitest) — currently no tests exist
- [ ] Review offline queue edge cases (conflict resolution when syncing after long offline period)
- [ ] Verify push notifications on iOS/Android after latest changes
- [ ] User to review new light theme on phone; fix any remaining washed-out spots
- [ ] User to review menu drawer + hide-menu on phone/desktop; tweak animation/positioning if needed

## Done
- [x] Nepali ⇄ English date & time pill in header (Bikram Sambat + Nepal Time via nepali-date-converter; tap to switch, persisted) — attendance terminal clock follows it too (2026-09-15)
- [x] Auto theme: follows day (06:00–18:00) / night; tap cycles auto → dark → light → auto with manual override (2026-09-15)
- [x] Offline admin unlock: correct code no longer reads as "wrong code" offline — tri-state RPC results, cached SHA-256 code hash lets trusted devices re-unlock offline (2026-09-15)
- [x] Admin writes now queue while offline and auto-sync when back online in an unlocked session (2026-09-15)
- [x] Menu drawer: hide-menu toggle on sidebar / pill nav / mobile dock, hamburger opens slide-in drawer (2026-09-15)
- [x] Light theme fixes: full alpha remaps, accent contrast, mobile blur reduction, press feedback (2026-08-25)
- [x] Realtime sync + offline queue
- [x] PIN sign-in
- [x] Light + premium dark theme with framer-motion animations
- [x] Insights pane
- [x] Styled confirm dialogs
