/* ============================================================
   Workout Tracker — data model (environment-agnostic).

   This file is the CORE LOGIC, deliberately separated from the
   view (index.html) and from any storage backend. It runs both
   in the browser and under Node (see test-model.js).

   Plan/actual mechanic: there is no separate "planned" store.
   The "plan" shown to the user is simply the most recent past
   session's sets for that exercise, read back at render time.
   Logging a set writes the ACTUAL performance to the in-progress
   session; nothing is written until Finish Workout.
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; // Node
  else root.WorkoutModel = api;                                          // browser
})(typeof self !== 'undefined' ? self : this, function () {

  const SPLITS = ['push', 'pull', 'legs'];

  const SEED_EXERCISES = {
    push: ['Bench Press', 'Overhead Press', 'Incline Press', 'Triceps Pushdown', 'Dips'],
    pull: ['Pull-ups', 'Barbell Row', 'Lat Pulldown', 'Face Pull', 'Bicep Curl'],
    legs: ['Squat', 'RDL', 'Leg Press', 'Hip Thrust', 'Leg Curl'],
  };

  const KEY = 'workout-app-v1';
  const CUSTOM_KEY = 'workout-custom-exercises-v1';
  const uid = () =>
    (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);

  function assertSplit(split) {
    if (!SPLITS.includes(split)) throw new Error('invalid split: ' + split);
  }

  /* createStore(storage): storage is any {getItem, setItem} (localStorage in
     the browser, an in-memory shim in tests). Kept injectable so the model is
     testable without a DOM. Holds only FINISHED sessions; the in-progress
     session is a plain object the view keeps in memory until Finish. */
  function createStore(storage) {
    const store = {
      sessions: [],
      load() {
        try {
          const raw = storage.getItem(KEY);
          this.sessions = raw ? JSON.parse(raw) : [];
        } catch { this.sessions = []; }
        return this;
      },
      save() { storage.setItem(KEY, JSON.stringify(this.sessions)); return this; },

      startSession(split) {
        assertSplit(split);
        return { id: uid(), date: Date.now(), split, entries: [] };
      },

      /* Most recent FINISHED session (from `this.sessions`) that logged
         `exercise`, excluding a session id (the in-progress one, which
         isn't in `this.sessions` yet anyway — belt-and-suspenders). */
      lastSessionFor(exercise, excludeId) {
        const matches = this.sessions
          .filter(s => s.id !== excludeId)
          .filter(s => s.entries.some(en => en.exercise === exercise))
          .sort((a, b) => b.date - a.date);
        return matches[0] || null;
      },

      /* Sets logged for `exercise` in the most recent past session that has it. */
      lastSetsFor(exercise, excludeId) {
        const s = this.lastSessionFor(exercise, excludeId);
        if (!s) return [];
        const entry = s.entries.find(en => en.exercise === exercise);
        return entry ? entry.sets : [];
      },

      /* Weight/reps to prefill the quick-add controls with: this session's
         own last logged set for the exercise if one exists yet, else last
         time's first set, else a zeroed baseline (no previous data). */
      defaultsFor(session, exercise) {
        const entry = session.entries.find(en => en.exercise === exercise);
        if (entry && entry.sets.length) {
          const last = entry.sets[entry.sets.length - 1];
          return { weight: last.weight, reps: last.reps };
        }
        const prevSets = this.lastSetsFor(exercise, session.id);
        if (prevSets.length) return { weight: prevSets[0].weight, reps: prevSets[0].reps };
        return { weight: 0, reps: 0 };
      },

      /* Appends a set to `session` (mutates it in place; not persisted until
         finishSession). weight >= 0 is valid (0 = bodyweight, e.g. Pull-ups /
         Dips with no added load) — only a non-positive rep count is rejected,
         since a set with zero reps didn't happen. Returns the set object on
         success, null if rejected. */
      logSet(session, exercise, weight, reps) {
        const w = Math.max(0, Number(weight) || 0);
        const r = Math.max(0, Math.round(Number(reps) || 0));
        if (r <= 0) return null;
        let entry = session.entries.find(en => en.exercise === exercise);
        if (!entry) { entry = { exercise, sets: [] }; session.entries.push(entry); }
        const set = { weight: w, reps: r };
        entry.sets.push(set);
        return set;
      },

      totalSets(session) {
        return session.entries.reduce((n, en) => n + en.sets.length, 0);
      },

      finishSession(session) {
        this.sessions.push(session);
        this.save();
        return session;
      },
    };
    return store;
  }

  /* createExercises(storage): seeded exercise list per split, plus any
     custom exercises added on the fly (persisted separately from sessions
     so a custom exercise survives even if you never log a set for it). */
  function createExercises(storage) {
    let custom = {};
    try { custom = JSON.parse(storage.getItem(CUSTOM_KEY) || '{}') || {}; } catch { custom = {}; }
    SPLITS.forEach(s => { if (!Array.isArray(custom[s])) custom[s] = []; });
    return {
      forSplit(split) {
        assertSplit(split);
        return SEED_EXERCISES[split].concat(custom[split]);
      },
      addCustom(split, name) {
        assertSplit(split);
        const nm = String(name).trim();
        if (!nm) return null;
        const exists = this.forSplit(split).some(e => e.toLowerCase() === nm.toLowerCase());
        if (exists) return null; // no duplicates, case-insensitive
        custom[split].push(nm);
        storage.setItem(CUSTOM_KEY, JSON.stringify(custom));
        return nm;
      },
    };
  }

  function sortSessionsDesc(sessions) {
    return sessions.slice().sort((a, b) => b.date - a.date);
  }

  function formatSets(sets) {
    return sets.map(s => `${s.weight}×${s.reps}`).join(', ');
  }

  const pad2 = n => String(n).padStart(2, '0');
  /* Local (not UTC) Y-M-D — a session's `date` is a local Date.now() timestamp,
     so formatting via toISOString (UTC) could shift it to the wrong calendar
     day near midnight. Matches a "## YYYY-MM-DD — Label" note convention. */
  function localDateStr(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  /* Sessions with date strictly after `ts` (0 if omitted -> everything). Used
     for "export only what's new since last export". */
  function sessionsAfter(sessions, ts) {
    return sessions.filter(s => s.date > (ts || 0));
  }

  /* Markdown export — a paste-ready block per session, oldest first (a
     natural chronological log to append). Entries only exist for exercises
     that actually had a set logged, so nothing "empty" shows up. */
  function toMarkdown(sessions) {
    const sorted = sessions.slice().sort((a, b) => a.date - b.date);
    return sorted.map(s => {
      const label = s.split.charAt(0).toUpperCase() + s.split.slice(1);
      const lines = s.entries.map(e => `- ${e.exercise}: ${formatSets(e.sets)}`);
      return `## ${localDateStr(s.date)} — ${label}\n${lines.join('\n')}`;
    }).join('\n\n') + (sorted.length ? '\n' : '');
  }

  /* Tracks the timestamp of the last successful export, so re-exporting only
     picks up sessions finished since then — no manual dedup of duplicates. */
  function createExportTracker(storage) {
    const EKEY = 'workout-last-export-v1';
    return {
      get() { const v = storage.getItem(EKEY); return v ? Number(v) : 0; },
      set(ts) { storage.setItem(EKEY, String(ts)); },
    };
  }

  /* ---- Color helpers for the custom (RGB) theme presets ----
     Reused verbatim from the Grocery List app's model.js — same theme
     system (settings sheet, swatches, HSV picker), same math. */
  const clamp255 = n => { n = Math.round(n); return n < 0 ? 0 : n > 255 ? 255 : n; };
  function hexToRgb(hex) {
    const h = String(hex).replace('#', '');
    const s = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
    const n = parseInt(s, 16) || 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(x => clamp255(x).toString(16).padStart(2, '0')).join('');
  }
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

  function hsvToRgb(h, s, v) {
    h = ((h % 360) + 360) % 360;
    const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
    let r, g, b;
    if (h < 60)       [r, g, b] = [c, x, 0];
    else if (h < 120) [r, g, b] = [x, c, 0];
    else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c];
    else if (h < 300) [r, g, b] = [x, 0, c];
    else              [r, g, b] = [c, 0, x];
    return [clamp255((r + m) * 255), clamp255((g + m) * 255), clamp255((b + m) * 255)];
  }
  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d !== 0) {
      if (max === r) h = 60 * ((((g - b) / d) % 6 + 6) % 6);
      else if (max === g) h = 60 * ((b - r) / d + 2);
      else h = 60 * ((r - g) / d + 4);
    }
    return [h, max === 0 ? 0 : d / max, max];
  }
  function derivePreset(r, g, b) {
    const accent = rgbToHex(r, g, b);
    return {
      light: [accent, rgbToHex(...mix([r, g, b], [255, 255, 255], 0.85))],  // toward white
      dark:  [accent, rgbToHex(...mix([r, g, b], [15, 18, 22], 0.80))],     // toward dark bg
    };
  }

  return { SPLITS, SEED_EXERCISES, createStore, createExercises, sortSessionsDesc,
           formatSets, localDateStr, sessionsAfter, toMarkdown, createExportTracker,
           hexToRgb, rgbToHex, derivePreset, hsvToRgb, rgbToHsv, KEY, CUSTOM_KEY };
});
