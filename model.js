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
  /* Sanity clamps, not realism limits — a guard against a runaway nudge/stepper
     tap-storm or bad input, not a claim about what's humanly liftable. */
  const MAX_WEIGHT = 2000;
  const MAX_REPS = 200;

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
        const w = Math.min(MAX_WEIGHT, Math.max(0, Number(weight) || 0));
        const r = Math.min(MAX_REPS, Math.max(0, Math.round(Number(reps) || 0)));
        if (r <= 0) return null;
        let entry = session.entries.find(en => en.exercise === exercise);
        if (!entry) { entry = { exercise, sets: [] }; session.entries.push(entry); }
        const set = { weight: w, reps: r };
        entry.sets.push(set);
        return set;
      },

      /* Removes set at `index` from `exercise`'s entry in `session` (in place).
         Drops the entry entirely once its last set is removed, so an exercise
         with no sets doesn't linger as an empty entry. Works on any session
         object — active (unsaved) or one pulled from store.sessions (caller
         must call store.save() afterward for the latter). */
      deleteSet(session, exercise, index) {
        const entry = session.entries.find(en => en.exercise === exercise);
        if (!entry || index < 0 || index >= entry.sets.length) return false;
        entry.sets.splice(index, 1);
        if (entry.sets.length === 0) {
          session.entries = session.entries.filter(en => en !== entry);
        }
        return true;
      },

      /* Same rejection/clamp rules as logSet (reps must be > 0). Mutates the
         set in place; caller saves if the session is already persisted. */
      updateSet(session, exercise, index, weight, reps) {
        const entry = session.entries.find(en => en.exercise === exercise);
        if (!entry || index < 0 || index >= entry.sets.length) return null;
        const w = Math.min(MAX_WEIGHT, Math.max(0, Number(weight) || 0));
        const r = Math.min(MAX_REPS, Math.max(0, Math.round(Number(reps) || 0)));
        if (r <= 0) return null;
        const set = entry.sets[index];
        set.weight = w; set.reps = r;
        return set;
      },

      totalSets(session) {
        return session.entries.reduce((n, en) => n + en.sets.length, 0);
      },

      sessionById(id) {
        return this.sessions.find(s => s.id === id) || null;
      },

      /* Most recent FINISHED session matching `split` — used to carry an
         entire split's exercise list + order forward from last time, not
         just per-exercise weight/rep defaults. Ties (identical timestamps —
         can happen with fabricated/imported dates) resolve to whichever
         sorts LAST in `this.sessions`, since that array is always appended
         in true chronological order: `>=` keeps replacing "latest so far"
         through a tie instead of stopping at the first match. */
      lastSessionForSplit(split) {
        return this.sessions
          .filter(s => s.split === split)
          .reduce((latest, s) => (!latest || s.date >= latest.date ? s : latest), null);
      },

      deleteSession(id) {
        const before = this.sessions.length;
        this.sessions = this.sessions.filter(s => s.id !== id);
        if (this.sessions.length === before) return false;
        this.save();
        return true;
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
      /* Only ever removes a CUSTOM exercise — seed exercises are fixed and
         always return false, since removing them would break the split's
         baseline list for everyone, not just undo a typo. Past logged
         entries for the removed name are untouched (history is immutable
         here); it just disappears from future pick lists. */
      removeCustom(split, name) {
        assertSplit(split);
        const before = custom[split].length;
        custom[split] = custom[split].filter(e => e.toLowerCase() !== String(name).toLowerCase());
        if (custom[split].length === before) return false;
        storage.setItem(CUSTOM_KEY, JSON.stringify(custom));
        return true;
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

  /* True once unexported data is either piling up (8+ sessions) or aging
     (14+ days since the reference point) — local-only storage is the app's
     single point of failure, so the History screen nudges toward exporting
     before that becomes a real loss instead of staying silent forever. */
  function exportReminderDue(sessions, lastExportTs, now) {
    const pending = sessionsAfter(sessions, lastExportTs);
    if (!pending.length) return false;
    if (pending.length >= 8) return true;
    const oldestPending = Math.min(...pending.map(s => s.date));
    const reference = lastExportTs || oldestPending;
    return (now - reference) >= 14 * 24 * 60 * 60 * 1000;
  }

  /* ---- JSON backup/restore — a round-trippable counterpart to the
     human-readable markdown export (which can't be re-imported). ---- */
  function toJSON(sessions) {
    return JSON.stringify(sessions, null, 2);
  }

  function isSessionShaped(s) {
    return s && typeof s === 'object' && typeof s.id === 'string' &&
      typeof s.date === 'number' && typeof s.split === 'string' && Array.isArray(s.entries);
  }

  function fromJSON(text) {
    const parsed = JSON.parse(text); // throws on invalid JSON, by design
    if (!Array.isArray(parsed) || !parsed.every(isSessionShaped)) {
      throw new Error('Not a valid workout backup: expected an array of sessions.');
    }
    return parsed;
  }

  /* Union of `existing` and `imported`, deduped by session id (existing
     wins on conflict) — restoring a backup adds what's missing without
     clobbering or duplicating sessions already on this device. */
  function mergeSessions(existing, imported) {
    const seen = new Set(existing.map(s => s.id));
    return existing.concat(imported.filter(s => !seen.has(s.id)));
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
           exportReminderDue, toJSON, fromJSON, mergeSessions,
           hexToRgb, rgbToHex, derivePreset, hsvToRgb, rgbToHsv, KEY, CUSTOM_KEY,
           MAX_WEIGHT, MAX_REPS };
});
