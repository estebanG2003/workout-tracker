# Workout

A small, personal, mobile-first push/pull/legs workout tracker PWA. No framework, no build step, no backend — plain HTML/CSS/JS with `localStorage` for persistence. Same architecture as the [Grocery List](../Grocery%20List) app.

## How it works

- **Start a workout** — pick Push, Pull, or Legs.
- Each exercise shows **"Last time"** — the sets you logged for it in the most recent past session — so you always know the plan going in.
- Tap an exercise to log a set: **+2.5 / +5 / +10** weight nudges and a reps stepper, both pre-filled from last time (or from the set you just logged this session, once you've logged one). Tap **Log Set** to record it; log as many sets as you did.
- **Add exercise** lets you log something outside the seeded list — it's remembered for that split going forward.
- **Finish Workout** saves the session. **History** shows every past session, expandable to the full set-by-set detail — the same data "Last time" reads from.

## Deliberately out of scope (v1)

- No vault / `Life/Health.md` integration — standalone only. Update Health.md by hand if you want a summary there.
- No rest timers, RPE/RIR, or auto progression suggestions.
- No editing/deleting a set once logged.
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

Deterministic, dependency-free tests for the data model (43 checks: set logging, the "last time" plan/actual lookup including within-session progression, custom exercises, persistence, the reused color-theme math).

**UI integration test** (`test-ui.html`) drives the real app through real DOM events — start a workout, expand an exercise, nudge weight/reps, log sets, add a custom exercise, finish, verify history, start a second session and confirm "Last time" reads back correctly, and exercise the settings sheet (theme color + dark mode). Run it by serving the folder and opening `test-ui.html` in a browser, or headless:

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

Full design rationale and the answers behind each scope decision (why weight×reps but no sets-count limit, why standalone instead of Health.md-integrated, why quick-tap reps instead of a number field) live in `docs/superpowers/specs/2026-07-18-workout-tracker-design.md`.
