# Workout Tracker — Design Spec

_Status: approved 2026-07-18. Source: `Claude Requests.md` → Health / Training todo (captured 2026-07-15), refined via brainstorm same day._

## Purpose

Esteban currently plans each exercise's weight/reps for a session based on what he did last time, then logs what he actually did — on paper or from memory. This app replaces that with a quick-add mobile tool: shows last time's performance per exercise as the reference, lets him log actual sets (weight × reps) with fast tap controls, no typing mid-workout.

**Explicit scope cap (his words):** "a really quick and simple app, not a whole project." Not a WAT project. No backend, no accounts, no vault integration.

## Architecture

Standalone static PWA, following the same proven pattern as `Agentic Workflows/Grocery List/`:

- No framework, no build step — plain HTML/CSS/JS
- `model.js` — pure data logic, runs in browser and under Node (unit-testable in isolation)
- `index.html` — markup/styles/view, all inline
- `sw.js` + `manifest.webmanifest` + `icons/` — installable, offline-capable PWA
- `localStorage` for persistence
- Own git repo at `Agentic Workflows/Workout Tracker/`, independent of the vault

**Explicitly not built:** vault/Health.md integration. Standalone only, per his answer during brainstorming — he updates Health.md by hand if he ever wants a summary there. This is a deliberate deferral, not an oversight, matching the same "seam for later, not built now" pattern Grocery List used for its meal-plan integration.

## Data Model

```
Session:        { id, date, split, entries: [ExerciseEntry] }
ExerciseEntry:  { exercise, sets: [{ weight, reps }] }
```

- `split` — one of `push` / `pull` / `legs`.
- No separate "history" store. "Last time" for a given exercise is derived by scanning sessions for the most recent one that included it — same idea as Grocery List's history recall, but computed from sessions directly since a session log already *is* the history.
- Seeded exercise list per split (editable/extendable with custom entries):
  - **Push:** Bench Press, Overhead Press, Incline Press, Triceps Pushdown, Dips
  - **Pull:** Pull-ups, Barbell Row, Lat Pulldown, Face Pull, Bicep Curl
  - **Legs:** Squat, RDL, Leg Press, Hip Thrust, Leg Curl
  - (Matches the current push/pull/legs split in `Life/Health.md`.)

## Screens / Flow

1. **Home** — "Start Workout" → choose Push / Pull / Legs.
2. **Active session** — list of that split's exercises (seeded + any custom added previously). Tap an exercise to expand it:
   - Reference line: `Last time: 135×8, 135×8, 130×6` (from the most recent past session with that exercise; "No previous data" if none).
   - Weight control: current value + **+2.5 / +5 / +10** nudge buttons. Defaults to the last set's weight (this session's own last set for that exercise if one exists yet, else last time's first set).
   - Reps control: quick-tap stepper (+1/−1), defaulting the same way.
   - **Log Set** button appends `{weight, reps}` to that exercise's set list for today; running `Today: 135×8` display updates live.
   - Repeat per set, move between exercises freely, any order.
   - Option to add a custom exercise not in the seeded list (added to that split's list going forward).
   - **Finish Workout** saves the session to `localStorage` and returns home.
3. **History** — flat list of past sessions (date + split), each expandable to full set-by-set detail. This is not just a nice-to-have view — it's the same data source the "Last time" reference reads from.

## Visual Style & Settings

Reuse Grocery List's look and feel directly rather than inventing a new one — same simple, mobile-first, no-framework aesthetic (system font stack, card-style rows, big tappable buttons, safe-area insets for notched phones, subtle haptic tick on log via `navigator.vibrate` where supported).

**Settings sheet** (gear icon, same as Grocery List):
- **Theme color** picker — same set of preset accent colors (+ custom RGB picker) as Grocery List, reusing its `hexToRgb`/`rgbToHex`/`derivePreset`/`hsvToRgb`/`rgbToHsv` color-math helpers from `model.js` as-is.
- **Appearance** — System / Light / Dark toggle, same mechanism (`prefers-color-scheme` default, explicit override persisted to `localStorage`).

No new settings beyond theme + appearance — no unit toggles (lbs assumed, matching `Life/Health.md`), no account/export settings, keeping the "quick and simple" scope intact.

## Error Handling

- No previous session for an exercise → reference line reads "No previous data," weight/reps controls default to a sane floor (e.g. empty/0, first log establishes the baseline).
- Empty/zero weight or reps on Log Set → button stays disabled or the entry is a no-op; sets require a positive weight and rep count.
- `localStorage` unavailable or corrupted JSON → model falls back to an empty session list rather than throwing (same defensive pattern as Grocery List's `model.js`).
- Finishing a workout with zero logged sets → still saves (an empty/aborted session is valid history, not an error) but flagged with a lightweight confirm ("Finish with no sets logged?") to avoid accidental empty saves.

## Testing

- `test-model.js` (Node, dependency-free) — covers: adding sets, "last time" lookup across sessions (including the no-previous-data case), session save/finish, corrupted-storage fallback. Same style as Grocery List's `test-model.js`.
- Real UI verified end-to-end in headless Chrome (dispatched DOM events) before calling the build done — start a session, log sets across exercises, finish, confirm history reflects it and "last time" correctly reads back on a new session. No Playwright, per existing project convention.

## Out of Scope (v1)

- Vault/Health.md integration (deferred, see Architecture)
- Rest timers, RPE/RIR tracking, progression suggestions/auto-increment logic
- Multi-user, cloud sync, auth
- Editing/deleting a set after logging (can be added later if it turns out to matter in real use)
