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

  /* App version. Bump this on any deploy that changes model.js, AND in the
     `?v=` on index.html's <script src="model.js?v=...">. Those two are the
     same number on purpose: the query string is what makes the browser fetch
     a matching model.js instead of reusing a cached one, and index.html
     compares them at boot so a missed bump surfaces instead of white-screening.
     See README "Releasing". */
  const VERSION = '1.0.2';

  const SPLITS = ['push', 'pull', 'legs'];
  const VARIANTS = ['A', 'B'];
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

  function assertVariant(variant) {
    if (variant !== undefined && !VARIANTS.includes(variant)) {
      throw new Error('invalid variant: ' + variant);
    }
  }

  function rosterKey(split, variant) {
    assertSplit(split);
    assertVariant(variant);
    return variant === undefined ? split : `${split}:${variant}`;
  }

  function assertRosterKey(key) {
    const parts = typeof key === 'string' ? key.split(':') : [];
    if (parts.length > 2 || rosterKey(parts[0], parts[1]) !== key) {
      throw new Error('invalid roster key: ' + key);
    }
  }

  function splitLabel(split, variant) {
    // Display restored history without requiring this version to know its labels.
    const name = typeof split === 'string' ? split : '';
    const label = name.charAt(0).toUpperCase() + name.slice(1);
    return VARIANTS.includes(variant) ? `${label} ${variant}` : label;
  }

  /* Narrow eligible history before choosing the latest, so legacy history
     beats a newer other-variant workout. No variant keeps the old lookup. */
  function preferVariant(sessions, variant) {
    assertVariant(variant);
    if (variant === undefined) return sessions;
    const same = sessions.filter(s => s.variant === variant);
    if (same.length) return same;
    const legacy = sessions.filter(s => s.variant === undefined);
    return legacy.length ? legacy : sessions;
  }

  function createVariantPref(storage) {
    const VKEY = 'workout-variants-v1';
    const data = { push: false, pull: false, legs: false };
    try {
      const parsed = JSON.parse(storage.getItem(VKEY));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) &&
          Object.entries(parsed).every(([split, enabled]) =>
            SPLITS.includes(split) && typeof enabled === 'boolean')) {
        Object.assign(data, parsed);
      }
    } catch {}
    return {
      enabled(split) { assertSplit(split); return data[split]; },
      set(split, enabled) {
        assertSplit(split);
        data[split] = Boolean(enabled);
        storage.setItem(VKEY, JSON.stringify(data));
      },
    };
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

      startSession(split, variant) {
        assertSplit(split);
        assertVariant(variant);
        const session = { id: uid(), date: Date.now(), split, entries: [] };
        if (variant !== undefined) session.variant = variant;
        return session;
      },

      /* Most recent FINISHED session (from `this.sessions`) that logged
         `exercise`, excluding a session id (the in-progress one, which
         isn't in `this.sessions` yet anyway — belt-and-suspenders). */
      lastSessionFor(exercise, excludeId, variant) {
        const matches = this.sessions
          .filter(s => s.id !== excludeId)
          .filter(s => s.entries.some(en => en.exercise === exercise));
        return preferVariant(matches, variant).sort((a, b) => b.date - a.date)[0] || null;
      },

      /* Sets logged for `exercise` in the most recent past session that has it. */
      lastSetsFor(exercise, excludeId, variant) {
        const s = this.lastSessionFor(exercise, excludeId, variant);
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
        const prevSets = this.lastSetsFor(exercise, session.id, session.variant);
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
      lastSessionForSplit(split, variant) {
        return preferVariant(this.sessions.filter(s => s.split === split), variant)
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

  /* ---- Units (kg/lbs) ----
     Weights are ALWAYS stored canonically in POUNDS. A single global unit
     preference controls display only; conversion happens at exactly two
     boundaries — canonical->display when reading, display->canonical when
     logging/editing. This keeps existing (lbs) history untouched forever and
     makes the toggle a pure re-render.

     Precision: canonical lbs are kept to 0.1; display values snap to 0.5
     (real plate granularity in either unit). Verified drift-free on the
     round-trip that matters — 45.0 kg -> 99.2 lbs -> 45.0 kg. */
  const LBS_PER_KG = 2.2046226218;
  const roundTo = (v, step) => Math.round(v / step) * step;

  function toDisplayWeight(lbs, unit) {
    const v = Math.max(0, Number(lbs) || 0);
    return roundTo(unit === 'kg' ? v / LBS_PER_KG : v, 0.5);
  }
  /* Inverse of toDisplayWeight: a value the user typed/nudged in `unit` back
     to canonical pounds (0.1 precision). logSet/updateSet clamp on top. */
  function toCanonicalWeight(val, unit) {
    const v = Math.max(0, Number(val) || 0);
    return roundTo(unit === 'kg' ? v * LBS_PER_KG : v, 0.1);
  }
  /* Bare number string in the display unit (no unit suffix), trailing zeros
     dropped — String() already does this since values snap to 0.5. */
  function fmtWeight(lbs, unit) { return String(toDisplayWeight(lbs, unit)); }
  const UNIT_LABEL = { lbs: 'lbs', kg: 'kg' };

  /* Persisted global unit preference. Defaults to 'lbs' (the canonical /
     legacy unit) and only ever stores one of the two known values. */
  function createUnitPref(storage) {
    const UKEY = 'workout-unit-v1';
    return {
      get() { return storage.getItem(UKEY) === 'kg' ? 'kg' : 'lbs'; },
      set(u) { storage.setItem(UKEY, u === 'kg' ? 'kg' : 'lbs'); return this.get(); },
    };
  }

  /* ---- In-progress session persistence ----
     The active session used to live only in memory until Finish Workout, so
     closing the app — or just forgetting to tap Finish, which is the norm —
     lost the entire workout. It's now mirrored here on every render. Stores
     the literal string "null" when there's nothing active, so any {getItem,
     setItem} shim works (no removeItem needed). */
  function createActiveSession(storage) {
    const ASKEY = 'workout-active-v1';
    return {
      get() {
        try { return JSON.parse(storage.getItem(ASKEY) || 'null'); } catch { return null; }
      },
      set(session) { storage.setItem(ASKEY, JSON.stringify(session || null)); },
    };
  }

  /* What to do on boot with the persisted in-progress session:
       'resume' — started today; drop straight back into it mid-workout.
       'finish' — started on an earlier day with sets logged; Finish was never
                  tapped, so file it into history rather than lose it.
       'drop'   — nothing there, malformed, or abandoned with no sets logged.
     Day boundary rather than an elapsed-time gap: `date` is the START time, and
     a workout spanning midnight still belongs to the day it started. */
  function resumeOrFinish(saved, now) {
    if (!saved || typeof saved !== 'object') return 'drop';
    if (!SPLITS.includes(saved.split) || !Array.isArray(saved.entries)) return 'drop';
    if (saved.variant !== undefined && !VARIANTS.includes(saved.variant)) return 'drop';
    if (typeof saved.date !== 'number') return 'drop';
    if (localDateStr(saved.date) === localDateStr(now)) return 'resume';
    return saved.entries.some(e => e && e.sets && e.sets.length) ? 'finish' : 'drop';
  }

  /* ---- Roster: the persistent, ordered, per-split/variant exercise list ----
     This is the SOURCE OF TRUTH for which exercises show up in a session and
     in what order — deliberately independent of what actually got logged, so
     an exercise you skip (log nothing for) still appears next time with its
     last-known weight (read back via lastSetsFor). It also powers reordering.

     Seeded once per split (see init) from the last finished session's exercise
     order, or SEED_EXERCISES when there's no history yet — so the switch to a
     roster is visually seamless. After that first seed it's user-owned:
     add/remove/move are explicit and persisted; seed exercises are no longer
     "protected" (you can remove or reorder any of them). */
  function createRoster(storage) {
    const RKEY = 'workout-roster-v1';
    let data = {};
    try { data = JSON.parse(storage.getItem(RKEY) || '{}') || {}; } catch { data = {}; }
    const persist = () => storage.setItem(RKEY, JSON.stringify(data));
    const norm = n => String(n).trim();
    const idx = (split, name) =>
      data[split].findIndex(e => e.toLowerCase() === String(name).toLowerCase());
    return {
      has(split) { assertRosterKey(split); return Array.isArray(data[split]); },
      get(split) { assertRosterKey(split); return Array.isArray(data[split]) ? data[split].slice() : []; },
      /* Idempotent: seeds the split's list from `names` (deduped, trimmed,
         case-insensitive) only if it hasn't been initialized yet. Returns the
         current list either way. */
      init(split, names) {
        assertRosterKey(split);
        if (Array.isArray(data[split])) return this.get(split);
        const seen = new Set(); const out = [];
        (names || []).forEach(n => {
          const nm = norm(n), k = nm.toLowerCase();
          if (nm && !seen.has(k)) { seen.add(k); out.push(nm); }
        });
        data[split] = out; persist();
        return out.slice();
      },
      add(split, name) {
        assertRosterKey(split);
        const nm = norm(name);
        if (!nm) return null;
        if (!Array.isArray(data[split])) data[split] = [];
        if (idx(split, nm) >= 0) return null; // no case-insensitive duplicates
        data[split].push(nm); persist();
        return nm;
      },
      remove(split, name) {
        assertRosterKey(split);
        if (!Array.isArray(data[split])) return false;
        const before = data[split].length;
        data[split] = data[split].filter(e => e.toLowerCase() !== String(name).toLowerCase());
        if (data[split].length === before) return false;
        persist();
        return true;
      },
      /* Swaps `name` with its neighbor in the given direction (dir < 0 = up/
         earlier, dir > 0 = down/later). Returns false at the list edges or if
         the name isn't present. */
      move(split, name, dir) {
        assertRosterKey(split);
        if (!Array.isArray(data[split])) return false;
        const i = idx(split, name);
        if (i < 0) return false;
        const j = i + (dir < 0 ? -1 : 1);
        if (j < 0 || j >= data[split].length) return false;
        const arr = data[split];
        [arr[i], arr[j]] = [arr[j], arr[i]];
        persist();
        return true;
      },
    };
  }

  /* Read-only seed for both workout initialization and History's picker.
     The store prefers same-variant, then legacy, then any session. Insert
     the curated plain roster after same-variant history, even if it is empty. */
  function rosterSeedFor(store, roster, split, variant, fallbackList) {
    assertSplit(split);
    assertVariant(variant);
    const last = store.lastSessionForSplit(split, variant);
    if (variant !== undefined && (!last || last.variant !== variant) && roster.has(split)) {
      return roster.get(split);
    }
    return last ? last.entries.map(e => e.exercise) : fallbackList.slice();
  }

  function sortSessionsDesc(sessions) {
    return sessions.slice().sort((a, b) => b.date - a.date);
  }

  function formatSets(sets) {
    return sets.map(s => `${s.weight}×${s.reps}`).join(', ');
  }

  /* Unit-aware counterpart to formatSets, for anything shown to the user. */
  function formatSetsInUnit(sets, unit) {
    return sets.map(s => `${fmtWeight(s.weight, unit)}×${s.reps}`).join(', ');
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
  function toMarkdown(sessions, unit) {
    const u = unit === 'kg' ? 'kg' : 'lbs';
    const sorted = sessions.slice().sort((a, b) => a.date - b.date);
    return sorted.map(s => {
      const label = splitLabel(s.split, s.variant);
      const lines = s.entries.map(e => `- ${e.exercise}: ${formatSetsInUnit(e.sets, u)}`);
      return `## ${localDateStr(s.date)} — ${label} (${UNIT_LABEL[u]})\n${lines.join('\n')}`;
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
      typeof s.date === 'number' && typeof s.split === 'string' && Array.isArray(s.entries) &&
      (s.variant === undefined || VARIANTS.includes(s.variant));
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

  /* CSV exports can quote delimiters and newlines. Detect the delimiter only
     outside quotes in the header, then read the file one character at a time. */
  function csvDelimiter(text) {
    const counts = { ',': 0, ';': 0, '\t': 0 };
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') {
        if (quoted && text[i + 1] === '"') i++;
        else quoted = !quoted;
      } else if (!quoted) {
        if (c === '\r' || c === '\n') break;
        if (c in counts) counts[c]++;
      }
    }
    return Object.keys(counts).reduce((best, c) => counts[c] > counts[best] ? c : best, ',');
  }

  function parseCSV(text) {
    text = String(text).replace(/^\uFEFF/, '');
    const delimiter = csvDelimiter(text);
    const rows = [];
    let row = [], field = '', rowStart = 0;
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else quoted = false;
        } else field += c;
      } else if (c === '"' && field === '') {
        quoted = true;
      } else if (c === delimiter) {
        row.push(field); field = '';
      } else if (c === '\r' || c === '\n') {
        row.push(field); rows.push(row);
        row = []; field = '';
        if (c === '\r' && text[i + 1] === '\n') i++;
        rowStart = i + 1;
      } else field += c;
    }
    if (quoted) throw new Error('Invalid CSV: unterminated quoted field.');
    if (rowStart < text.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function guessSplit(title) {
    const names = String(title).toLowerCase();
    const matches = [];
    if (/\bpush\b/.test(names)) matches.push('push');
    if (/\bpull\b/.test(names)) matches.push('pull');
    if (/\blegs?\b/.test(names)) matches.push('legs');
    return matches.length === 1 ? matches[0] : null;
  }

  /* Export timestamps describe local clock time. Explicit parsing avoids
     locale-dependent Date.parse and rejects calendar overflow (e.g. 31 Feb). */
  function csvStartTime(text) {
    let y, m, d, h, min, sec;
    let parts = text.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (parts) {
      [, y, m, d, h, min, sec] = parts;
    } else {
      parts = text.trim().match(/^(\d{1,2})\s+([a-z]{3})\s+(\d{4}),\s*(\d{1,2}):(\d{2})(?::(\d{2}))?$/i);
      if (!parts) return null;
      [, d, m, y, h, min, sec] = parts;
      m = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
        .indexOf(m.toLowerCase()) + 1;
    }
    [y, m, d, h, min, sec] = [y, m, d, h, min, sec || 0].map(Number);
    if (m < 1 || m > 12 || d < 1 || d > 31 || h > 23 || min > 59 || sec > 59) return null;
    const date = new Date(y, m - 1, d, h, min);
    // The numeric Date constructor treats years 0–99 as 1900–1999.
    if (y < 100) date.setFullYear(y, m - 1, d);
    if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
    return date.getTime();
  }

  function importWorkoutCSV(text, opts = {}) {
    const rows = parseCSV(text);
    const decimalComma = csvDelimiter(String(text)) !== ',';
    const number = value => Number(decimalComma ? String(value ?? '').replace(',', '.') : value);
    const header = (rows.shift() || []).map(c => c.trim().toLowerCase());
    const has = names => names.every(name => header.includes(name));
    const hevyWeight = header.findIndex(c => ['weight_kg', 'weight_lbs', 'weight_lb'].includes(c));
    const strongWeight = header.findIndex(c => c.startsWith('weight'));
    let format, titleCol, dateCol, exerciseCol, repsCol, weightCol, sourceUnit, unitFromHeader;
    if (has(['title', 'start_time', 'exercise_title', 'set_type', 'reps']) && hevyWeight >= 0) {
      format = 'hevy';
      titleCol = header.indexOf('title'); dateCol = header.indexOf('start_time');
      exerciseCol = header.indexOf('exercise_title'); repsCol = header.indexOf('reps');
      weightCol = hevyWeight; sourceUnit = header[weightCol] === 'weight_kg' ? 'kg' : 'lbs';
      unitFromHeader = true;
    } else if (has(['date', 'exercise name', 'reps']) && strongWeight >= 0) {
      format = 'strong';
      titleCol = header.indexOf('workout name'); dateCol = header.indexOf('date');
      exerciseCol = header.indexOf('exercise name'); repsCol = header.indexOf('reps');
      weightCol = strongWeight;
      unitFromHeader = /\((kg|lbs?)\)$/.test(header[weightCol]);
      sourceUnit = /\(kg\)$/.test(header[weightCol]) ? 'kg'
        : /\(lbs?\)$/.test(header[weightCol]) ? 'lbs' : opts.unit === 'kg' ? 'kg' : 'lbs';
    } else {
      throw new Error('Unrecognized CSV layout. Please export a workout CSV from Hevy or Strong.');
    }

    const workouts = new Map();
    for (const row of rows) {
      if (row.every(c => !c.trim())) continue;
      const title = row[titleCol] || '', start = row[dateCol] || '';
      const key = JSON.stringify([title, start]);
      if (!workouts.has(key)) workouts.set(key, { title, start, rows: [] });
      workouts.get(key).rows.push(row);
    }
    const sessions = [];
    let unmatched = 0, skippedSets = 0;
    for (const workout of workouts.values()) {
      const split = guessSplit(workout.title) || (SPLITS.includes(opts.fallbackSplit) ? opts.fallbackSplit : null);
      if (!split) { unmatched++; continue; }
      const date = csvStartTime(workout.start);
      if (date === null) { skippedSets += workout.rows.length; continue; }
      const entries = new Map();
      for (const row of workout.rows) {
        const exercise = row[exerciseCol] || '';
        if (exercise.trim() && !entries.has(exercise)) entries.set(exercise, { exercise, sets: [] });
        const rawReps = number(row[repsCol]);
        const reps = Math.min(MAX_REPS, Math.max(0, Math.round(rawReps)));
        const weight = number(row[weightCol] || '');
        const warmup = format === 'hevy' && (row[header.indexOf('set_type')] || '').trim().toLowerCase() === 'warmup';
        if (warmup || !exercise.trim() || !Number.isFinite(rawReps) || reps <= 0 || !Number.isFinite(weight) || weight < 0) {
          skippedSets++; continue;
        }
        entries.get(exercise).sets.push({ weight: Math.min(MAX_WEIGHT, toCanonicalWeight(weight, sourceUnit)), reps });
      }
      const validEntries = [...entries.values()].filter(entry => entry.sets.length);
      if (validEntries.length) {
        // A source-app rename or a different fallback split is still the same
        // workout. Preserve the full start time, including any seconds.
        const id = `${format}-${encodeURIComponent(workout.start)}`;
        sessions.push({ id, date, split, entries: validEntries });
      }
    }
    return { format, sessions, unmatched, skippedSets, unitFromHeader };
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

  /* ---- Barbell helpers: numbers stay in the caller's unit. ---- */
  const DEFAULT_PLATES = { lbs: [45, 35, 25, 10, 5, 2.5], kg: [25, 20, 15, 10, 5, 2.5, 1.25] };
  const DEFAULT_BAR = { lbs: 45, kg: 20 };

  /* Pair weights in hundredths avoid fractional drift. Reachability lets us
     backtrack past a heavy plate whose remainder cannot be loaded. */
  function plateLoads(plates, limit) {
    const sizes = [...new Set(plates.filter(p => Number.isFinite(p) && p > 0)
      .map(p => Math.round(p * 100) * 2).filter(p => p > 0))].sort((a, b) => b - a);
    const loads = new Uint8Array(limit + 1);
    loads[0] = 1;
    for (let w = 1; w <= limit; w++) {
      loads[w] = sizes.some(p => p <= w && loads[w - p]) ? 1 : 0;
    }
    return { sizes, loads };
  }

  function platesPerSide(total, bar, plates) {
    if (!Number.isFinite(total) || !Number.isFinite(bar) || total < bar) return null;
    let remaining = Math.round(total * 100) - Math.round(bar * 100);
    const { sizes, loads } = plateLoads(plates, remaining);
    if (!loads[remaining]) return null;
    const out = [];
    while (remaining > 0) {
      const p = sizes.find(p => p <= remaining && loads[remaining - p]);
      out.push(p / 200); remaining -= p;
    }
    return out;
  }

  function nearestLoadable(total, bar, plates) {
    if (!Number.isFinite(total)) return { below: null, above: null };
    const base = Math.round(bar * 100), raw = total * 100 - base;
    const target = Math.abs(raw - Math.round(raw)) < 1e-8 ? Math.round(raw) : raw;
    if (total <= bar) return { below: total < bar ? null : bar, above: bar };
    const smallest = Math.min(...plates.filter(p => Number.isFinite(p) && p > 0)
      .map(p => Math.round(p * 100) * 2).filter(p => p > 0));
    if (!Number.isFinite(smallest)) return { below: bar, above: null };
    // Multiples of the smallest pair give a finite upper bound, even for odd inventories.
    const limit = Math.ceil(target / smallest) * smallest;
    const { loads } = plateLoads(plates, limit);
    let below = Math.floor(target), above = Math.ceil(target);
    while (!loads[below]) below--;
    while (!loads[above]) above++;
    return { below: (base + below) / 100, above: (base + above) / 100 };
  }

  function createPlatePref(storage) {
    const PKEY = 'workout-plates-v1';
    let data = {};
    try {
      const parsed = JSON.parse(storage.getItem(PKEY));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed;
    } catch {}
    const validPlates = plates => Array.isArray(plates) && plates.length > 0 &&
      plates.every(p => Number.isFinite(p) && p > 0);
    const sorted = plates => [...new Set(plates)].sort((a, b) => b - a);
    return {
      get(unit) {
        const pref = data[unit] || {};
        return {
          bar: Number.isFinite(pref.bar) && pref.bar > 0 ? pref.bar : DEFAULT_BAR[unit],
          plates: validPlates(pref.plates) ? sorted(pref.plates) : DEFAULT_PLATES[unit].slice(),
        };
      },
      set(unit, bar, plates) {
        if (!['lbs', 'kg'].includes(unit) || !Number.isFinite(bar) || bar <= 0 || !validPlates(plates)) return false;
        data[unit] = { bar, plates: sorted(plates) };
        storage.setItem(PKEY, JSON.stringify(data));
        return true;
      },
    };
  }

  function createBarbellPref(storage) {
    const BKEY = 'workout-barbell-v1';
    let names = new Set();
    try {
      const parsed = JSON.parse(storage.getItem(BKEY));
      if (Array.isArray(parsed)) names = new Set(parsed.filter(n => typeof n === 'string').map(exerciseKey));
    } catch {}
    return {
      is(name) { return names.has(exerciseKey(name)); },
      set(name, enabled) {
        const key = exerciseKey(name);
        if (enabled) names.add(key); else names.delete(key);
        storage.setItem(BKEY, JSON.stringify([...names]));
      },
    };
  }

  function exerciseKey(name) { return String(name).trim().toLowerCase().replace(/\s+/g, ' '); }

  function e1rm(weight, reps) {
    if (!Number.isFinite(weight) || !Number.isFinite(reps) || weight <= 0 || reps < 1 || reps > 20) return null;
    // Decimal half steps can land just below .5 in binary floating point.
    return Math.round((reps === 1 ? weight : weight * (1 + reps / 30)) * 10 + 1e-9) / 10;
  }

  function warmupSets(working, opts) {
    if (!Number.isFinite(working) || working <= 0) return [];
    const out = [], barbell = opts.bar != null;
    if (barbell && opts.bar < working) out.push({ weight: opts.bar, reps: 10 });
    if (!barbell && (!Number.isFinite(opts.step) || opts.step <= 0)) return [];
    const candidates = barbell ? [[0.4, 5], [0.6, 3], [0.8, 2]] : [[0.5, 8], [0.75, 4]];
    for (const [ratio, reps] of candidates) {
      const weight = barbell ? nearestLoadable(working * ratio, opts.bar, opts.plates).below
        : Math.floor(working * ratio / opts.step) * opts.step;
      const previous = out.length ? out[out.length - 1].weight : (barbell ? opts.bar : 0);
      if (weight != null && weight > previous && weight < working) out.push({ weight, reps });
    }
    return out;
  }

  // Restored backups may contain entries without a valid sets array.
  function entrySets(entry) { return Array.isArray(entry.sets) ? entry.sets : []; }

  function sessionVolume(session) {
    return session.entries.reduce((sum, entry) =>
      sum + entrySets(entry).reduce((n, set) => n + set.weight * set.reps, 0), 0);
  }

  function weekStart(ts) {
    const d = new Date(ts);
    d.setDate(d.getDate() - (d.getDay() + 6) % 7);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function weeklyVolume(sessions) {
    if (!sessions.length) return [];
    const volumes = new Map();
    for (const session of sessions) {
      const week = weekStart(session.date);
      volumes.set(week, (volumes.get(week) || 0) + sessionVolume(session));
    }
    const weeks = [...volumes.keys()].sort((a, b) => a - b), out = [];
    const d = new Date(weeks[0]), last = weeks[weeks.length - 1];
    while (d.getTime() <= last) {
      const week = d.getTime();
      out.push({ weekStart: week, volume: volumes.get(week) || 0 });
      // Recompute midnight so a DST gap's shifted hour cannot carry forward.
      d.setTime(weekStart(d.setDate(d.getDate() + 7)));
    }
    return out;
  }

  function activityByDay(sessions) {
    const counts = {};
    for (const session of sessions) {
      const day = localDateStr(session.date);
      counts[day] = (counts[day] || 0) + 1;
    }
    return counts;
  }

  function plateMilestones(weight, unit = 'lbs') {
    return (unit === 'kg' ? [60, 100, 140, 180] : [135, 225, 315, 405]).filter(w => weight >= w).length;
  }

  function bigThreeTotal(sessions, isBarbell) {
    const out = { squat: null, bench: null, deadlift: null, total: null };
    for (const session of sessions) {
      for (const entry of session.entries) {
        const key = exerciseKey(entry.exercise);
        const lift = key === 'bench press' ? 'bench' : key;
        if (!['squat', 'bench press', 'deadlift'].includes(key) || !isBarbell(entry.exercise)) continue;
        for (const set of entrySets(entry)) {
          if (out[lift] === null || set.weight > out[lift]) out[lift] = set.weight;
        }
      }
    }
    if ([out.squat, out.bench, out.deadlift].every(w => w !== null)) out.total = out.squat + out.bench + out.deadlift;
    return out;
  }

  function exerciseHistory(sessions, name) {
    const key = exerciseKey(name), out = [];
    for (const session of sessions.slice().sort((a, b) => a.date - b.date)) {
      const entries = session.entries.filter(entry => exerciseKey(entry.exercise) === key);
      if (!entries.length) continue;
      const sets = entries.flatMap(entrySets);
      let bestE1rm = null, topWeight = 0, bestReps = 0;
      for (const set of sets) {
        const estimate = e1rm(set.weight, set.reps);
        if (estimate !== null && (bestE1rm === null || estimate > bestE1rm)) bestE1rm = estimate;
        topWeight = Math.max(topWeight, set.weight);
        bestReps = Math.max(bestReps, set.reps);
      }
      out.push({ sessionId: session.id, date: session.date, sets, bestE1rm, topWeight, bestReps,
        volume: sessionVolume({ entries }) });
    }
    return out;
  }

  function repPRs(sessions, name) {
    const prs = {};
    for (const row of exerciseHistory(sessions, name)) {
      for (const set of row.sets) {
        if (set.weight > 0 && (!prs[set.reps] || set.weight > prs[set.reps].weight)) {
          prs[set.reps] = { weight: set.weight, date: row.date };
        }
      }
    }
    return prs;
  }

  function isNewPR(sessions, name, set) {
    const estimate = e1rm(set.weight, set.reps);
    if (estimate === null) return false;
    const prior = exerciseHistory(sessions, name).map(row => row.bestE1rm).filter(n => n !== null);
    return prior.length > 0 && estimate > Math.max(...prior);
  }

  return { VERSION, SPLITS, VARIANTS, splitLabel, rosterKey, rosterSeedFor, createVariantPref,
           SEED_EXERCISES, createStore, createExercises, createRoster,
           createActiveSession, resumeOrFinish,
           createUnitPref, toDisplayWeight, toCanonicalWeight, fmtWeight, formatSetsInUnit,
           LBS_PER_KG, sortSessionsDesc,
           formatSets, localDateStr, sessionsAfter, toMarkdown, createExportTracker,
           exportReminderDue, toJSON, fromJSON, mergeSessions,
           parseCSV, guessSplit, importWorkoutCSV,
           hexToRgb, rgbToHex, derivePreset, hsvToRgb, rgbToHsv, KEY, CUSTOM_KEY,
           MAX_WEIGHT, MAX_REPS,
           DEFAULT_PLATES, DEFAULT_BAR, platesPerSide, nearestLoadable, createPlatePref, createBarbellPref,
           exerciseKey, e1rm, warmupSets, sessionVolume, weekStart, weeklyVolume, activityByDay,
           plateMilestones, bigThreeTotal, exerciseHistory, repPRs, isNewPR };
});
