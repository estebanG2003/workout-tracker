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

## Deliberately out of scope (v1)

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
node test-model.js
```

Deterministic, dependency-free tests for the data model (146 checks: set logging, the "last time" plan/actual lookup including within-session progression, the persistent per-split roster (seed/add/remove/reorder), kg↔lbs conversion and round-trip stability, custom exercises, persistence, markdown export formatting, the export-tracker's "only what's new" logic, the reused color-theme math).

**UI integration test** (`test-ui.html`, 107 checks) drives the real app through real DOM events — start a workout, expand an exercise, nudge *and manually type* weight/reps, log sets, verify the persistent roster (skip-for-today returns next session; reorder and permanent removal persist), toggle kg/lbs and confirm weights convert, add an exercise, finish, verify history, export (intercepted via a `window.__exportHook` test seam instead of triggering a real download) and confirm a second export with nothing new correctly no-ops, edit/delete logged sets, and exercise the settings sheet (theme color + dark mode). Run it by serving the folder and opening `test-ui.html` in a browser, or headless:

```bash
# with the static server running on :8731
chrome --headless=new --dump-dom http://localhost:8731/test-ui.html
```

## Files

| File | Purpose |
|---|---|
| `index.html` | The app: markup, styles, and view layer (all inline) |
| `model.js` | Core data model — runs in the browser **and** under Node for tests |
| `sw.js` | Service worker (offline + installable) |
| `manifest.webmanifest` | PWA manifest |
| `icons/` | App icons + `make_icons.py` to regenerate them |
| `test-model.js` | Node tests for `model.js` |
| `test-ui.html` | Headless-Chrome-drivable end-to-end UI test |

## Design spec

Full design rationale and the answers behind each scope decision (why weight×reps but no sets-count limit, why standalone instead of notes-app-integrated, why quick-tap reps instead of a number field) live in `docs/superpowers/specs/2026-07-18-workout-tracker-design.md`.
