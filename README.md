# Workout

A small, personal, mobile-first push/pull/legs workout tracker PWA. No framework, no build step, no backend — plain HTML/CSS/JS with `localStorage` for persistence. Same architecture as the [Grocery List](../Grocery%20List) app.

**Live:** https://estebang2003.github.io/workout-tracker/ — open on your phone, Share → *Add to Home Screen* to install.

## How it works

- **Start a workout** — pick Push, Pull, or Legs.
- Each split has a **persistent exercise list** (the roster) — every exercise stays on the list whether or not you logged it, so skipping one for a day doesn't drop it; it's back next time with its last-known weight. Each exercise shows **"Last time"** — the sets you logged for it in the most recent past session it appeared in.
- Tap an exercise to log a set: **+2.5 / +5 / +10** weight nudges *or type the weight directly*, plus a reps stepper — both pre-filled from last time (or from the set you just logged this session). Tap **Log Set** to record it; log as many sets as you did.
- **Units** — a **kg/lbs** toggle in Settings flips every weight in the app instantly. Weights are stored canonically (in pounds) either way, so switching never loses or drifts your data.
- **✕ on an exercise** skips it for *today only* (it returns next session). **Edit list** turns on ↑/↓ reordering and permanent removal of exercises from the roster. **Add exercise** appends a new one, remembered for that split going forward.
- **Finish Workout** saves the session. **History** shows every past session, expandable to the full set-by-set detail — the same data "Last time" reads from. Logged sets can be edited or deleted from both the active session and History.
- **Export** (top of History) downloads a `workout-export-YYYY-MM-DD.md` file — ready-to-paste markdown, one `## date — Split` block per session with exercises as bullets. Only exports sessions logged since your last export (tracked separately from the sessions themselves), so repeated exports never duplicate — paste-append the file's contents into whatever notes app or log you're keeping. Says "No new sessions to export" if you export twice with nothing new in between.

### Added in v2

- **Barbell lifts** — mark an exercise as *Barbell* and it shows the plates to load per side for the weight you're entering (`Per side: 45 + 10`), or the nearest loadable weights if that number can't be built. Bar weight and plate sizes are set in Settings, per unit. Off by default, since most machine and dumbbell work has no plates.
- **Warm-up sets** — a suggested ramp for the weight you're about to lift (bar, 40/60/80% for barbell lifts; 50/75% otherwise), rounded down to something you can actually load.
- **PRs** — a logged set that beats every earlier estimated 1-rep max (Epley) for that exercise gets a **PR** badge.
- **Progress** (from Home) — a 16-week activity heatmap, weekly volume, plate milestones and a big-three total for barbell lifts, and a per-exercise chart of estimated 1RM (best reps for bodyweight work) with a rep-range PR table. Exercise names that differ only in capitalisation are counted together.
- **Volume** — total weight × reps on every History card.
- **Import from Hevy or Strong** — reads their CSV exports in Settings. Workouts whose name doesn't say push, pull or legs get a split you choose (or are skipped); re-importing the same file adds nothing twice.

## Deliberately out of scope

- No *automatic* integration with any notes app — export is a manual download-then-paste step, by design (kept the app standalone, no external write access).
- No rest timers, RPE/RIR, or auto progression suggestions.
- No accounts, no cloud sync — one device, `localStorage` only.

## Run it locally

```bash
python -m http.server 8731
```

Then open `http://localhost:8731`. A service worker + `localhost` secure context means the PWA install prompt works here too.

> Installing to a phone home screen requires HTTPS (or `localhost`). To use it on your phone, host the folder on any static HTTPS host (GitHub Pages, Netlify, Vercel) and open that URL on the phone → Share → *Add to Home Screen*.

## Tests

```bash
node test-model.js && node test-analytics.js && node test-import.js
node run-ui-tests.js
```

All dependency-free. The `test-*.js` files test `model.js` under Node:

| File | Covers |
|---|---|
| `test-model.js` | set logging, "last time", the per-split roster, kg↔lbs round-trips, persistence, markdown export, backup/restore, the version lockstep |
| `test-analytics.js` | plate math and inventory, est. 1RM, warm-ups, volume, activity, milestones, exercise history and rep PRs |
| `test-import.js` | CSV parsing and the Hevy / Strong importers |

`run-ui-tests.js` serves the folder and runs every `test-ui*.html` page in headless Chrome (or Edge), each in a fresh profile, driving the real app through real DOM events. It exits non-zero on any failure. Set `CHROME=<path>` if neither browser is in its default location.

## Releasing

The version shows in the bottom-left corner of the app, so you can tell at a
glance whether a phone has the current build.

**Bump it in two places, in the same commit:**

1. `VERSION` in `model.js`
2. the `?v=` on `<script src="model.js?v=...">` in `index.html`

They are one number in two files on purpose. `index.html` and `model.js` are
cached independently by the browser (`max-age=600` on GitHub Pages), so without
the query string a fresh `index.html` can pair with a **stale** `model.js` — and
since the view calls into the model immediately, that throws before anything
renders. The result is a blank white page with no clue why. Making the version
part of `model.js`'s URL means new HTML always fetches matching JS.

`node test-model.js` fails if the two numbers drift apart, and `index.html` has a
boot-time gate that shows a "Reload needed" screen instead of a blank page if a
mismatch ever reaches a device anyway. Logged workouts are in `localStorage` and
are never at risk from this.

> Hit for real on 2026-08-12: `v1.0.0` is the first release with the lockstep.

## Files

| File | Purpose |
|---|---|
| `index.html` | The app: markup, styles, and view layer (all inline) |
| `model.js` | Core data model — runs in the browser **and** under Node for tests |
| `sw.js` | Service worker (offline + installable) |
| `manifest.webmanifest` | PWA manifest |
| `icons/` | App icons + `make_icons.py` to regenerate them |
| `test-*.js` | Node tests for `model.js` (see Tests) |
| `test-ui*.html` | End-to-end UI test pages, run by `run-ui-tests.js` |
| `run-ui-tests.js` | Headless runner for the UI test pages |
| `docs/feature-harvest.md` | The v2 feature list, harvested from other open-source lifting apps |

## Design spec

Full design rationale and the answers behind each scope decision (why weight×reps but no sets-count limit, why standalone instead of notes-app-integrated, why quick-tap reps instead of a number field) live in `docs/superpowers/specs/2026-07-18-workout-tracker-design.md`.
