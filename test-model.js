/* Deterministic tests for the workout tracker data model.
   Run: node test-model.js    (no dependencies) */
const { SPLITS, SEED_EXERCISES, createStore, createExercises, sortSessionsDesc,
        formatSets, localDateStr, sessionsAfter, toMarkdown, createExportTracker,
        hexToRgb, rgbToHex, derivePreset, hsvToRgb, rgbToHsv,
        exportReminderDue, toJSON, fromJSON, mergeSessions,
        MAX_WEIGHT, MAX_REPS } = require('./model.js');

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ FAIL: ' + msg); }
}

function memStorage() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) };
}

console.log('startSession');
{
  const s = createStore(memStorage()).load();
  const session = s.startSession('push');
  ok(session.split === 'push' && Array.isArray(session.entries) && session.entries.length === 0, 'new session has split + empty entries');
  ok(typeof session.id === 'string' && session.id.length > 0, 'session has an id');
  let threw = false;
  try { s.startSession('cardio'); } catch { threw = true; }
  ok(threw, 'invalid split throws');
}

console.log('logSet');
{
  const s = createStore(memStorage()).load();
  const session = s.startSession('push');
  const set = s.logSet(session, 'Bench Press', 135, 8);
  ok(set.weight === 135 && set.reps === 8, 'logSet returns the set');
  ok(session.entries.length === 1 && session.entries[0].exercise === 'Bench Press', 'entry created for new exercise');
  s.logSet(session, 'Bench Press', 135, 7);
  ok(session.entries[0].sets.length === 2, 'second set appends to same entry, not a new one');
  ok(s.totalSets(session) === 2, 'totalSets counts across entries');
  ok(s.logSet(session, 'Bench Press', 135, 0) === null, 'zero reps rejected');
  ok(s.logSet(session, 'Bench Press', 135, -3) === null, 'negative reps rejected');
  ok(session.entries[0].sets.length === 2, 'rejected sets are not appended');
  const bw = s.logSet(session, 'Pull-ups', 0, 12);
  ok(bw.weight === 0 && bw.reps === 12, 'zero weight is ACCEPTED (bodyweight exercises like Pull-ups/Dips)');
}

console.log('defaultsFor — no previous data');
{
  const s = createStore(memStorage()).load();
  const session = s.startSession('legs');
  const d = s.defaultsFor(session, 'Squat');
  ok(d.weight === 0 && d.reps === 0, 'defaults to zeroed baseline when nothing logged anywhere');
}

console.log('defaultsFor — reads last FINISHED session');
{
  const storage = memStorage();
  const s = createStore(storage).load();
  const first = s.startSession('legs');
  s.logSet(first, 'Squat', 135, 8);
  s.logSet(first, 'Squat', 140, 6);
  s.finishSession(first);

  const second = s.startSession('legs');
  const d = s.defaultsFor(second, 'Squat');
  ok(d.weight === 135 && d.reps === 8, 'defaults to FIRST set of last finished session (the plan reference), not the last set');
}

console.log('defaultsFor — within-session progression overrides last-time');
{
  const storage = memStorage();
  const s = createStore(storage).load();
  const first = s.startSession('legs');
  s.logSet(first, 'Squat', 135, 8);
  s.finishSession(first);

  const second = s.startSession('legs');
  ok(s.defaultsFor(second, 'Squat').weight === 135, 'starts from last time before any set logged this session');
  s.logSet(second, 'Squat', 140, 8);
  const d = s.defaultsFor(second, 'Squat');
  ok(d.weight === 140 && d.reps === 8, 'once a set is logged THIS session, defaults follow that instead of last time');
}

console.log('lastSetsFor / lastSessionFor');
{
  const storage = memStorage();
  const s = createStore(storage).load();
  ok(s.lastSetsFor('Bench Press').length === 0, 'no sessions yet -> empty array, not a throw');

  const older = s.startSession('push');
  older.date = 1000;
  s.logSet(older, 'Bench Press', 100, 10);
  s.finishSession(older);

  const newer = s.startSession('push');
  newer.date = 2000;
  s.logSet(newer, 'Bench Press', 110, 8);
  s.finishSession(newer);

  const last = s.lastSetsFor('Bench Press');
  ok(last.length === 1 && last[0].weight === 110, 'lastSetsFor picks the most recent session by date, not insertion order');
}

console.log('finishSession / persistence round-trip');
{
  const storage = memStorage();
  const s1 = createStore(storage).load();
  const session = s1.startSession('pull');
  s1.logSet(session, 'Pull-ups', 0, 10); // bodyweight
  s1.logSet(session, 'Barbell Row', 95, 10);
  s1.finishSession(session);
  ok(s1.sessions.length === 1, 'finishSession adds to store.sessions');
  ok(s1.sessions[0].entries.length === 2, 'both the bodyweight and weighted entries persisted');

  // simulate a fresh page load against the same storage
  const s2 = createStore(storage).load();
  ok(s2.sessions.length === 1, 'sessions persisted across reload');
  ok(s2.sessions[0].entries.find(e => e.exercise === 'Pull-ups').sets[0].weight === 0, 'bodyweight (weight 0) entry persisted correctly');
  ok(s2.sessions[0].entries.find(e => e.exercise === 'Barbell Row').sets[0].weight === 95, 'weighted entry data persisted');
}

console.log('sortSessionsDesc');
{
  const a = { id: 'a', date: 100 }, b = { id: 'b', date: 300 }, c = { id: 'c', date: 200 };
  const sorted = sortSessionsDesc([a, b, c]).map(s => s.id);
  ok(JSON.stringify(sorted) === JSON.stringify(['b', 'c', 'a']), 'sorts newest first -> ' + sorted.join(','));
}

console.log('createExercises — seeded lists');
{
  SPLITS.forEach(split => {
    const ex = createExercises(memStorage());
    ok(JSON.stringify(ex.forSplit(split)) === JSON.stringify(SEED_EXERCISES[split]), `${split} seed list matches SEED_EXERCISES before any custom add`);
  });
  let threw = false;
  try { createExercises(memStorage()).forSplit('cardio'); } catch { threw = true; }
  ok(threw, 'forSplit rejects an invalid split');
}

console.log('createExercises — addCustom');
{
  const storage = memStorage();
  const ex = createExercises(storage);
  const added = ex.addCustom('push', 'Cable Fly');
  ok(added === 'Cable Fly', 'addCustom returns the trimmed name');
  ok(ex.forSplit('push').includes('Cable Fly'), 'custom exercise appended to that split\'s list');
  ok(ex.forSplit('pull').includes('Cable Fly') === false, 'custom exercise does not leak into other splits');
  ok(ex.addCustom('push', 'cable fly') === null, 'duplicate add (case-insensitive) is rejected');
  ok(ex.addCustom('push', '   ') === null, 'blank name is rejected');
  ok(ex.forSplit('push').length === SEED_EXERCISES.push.length + 1, 'no duplicate actually got appended');

  // persists across a fresh load
  const ex2 = createExercises(storage);
  ok(ex2.forSplit('push').includes('Cable Fly'), 'custom exercise persists across reload');
}

console.log('formatSets');
{
  ok(formatSets([{ weight: 135, reps: 8 }]) === '135×8', 'single set formats as weight×reps');
  ok(formatSets([{ weight: 135, reps: 8 }, { weight: 130, reps: 6 }]) === '135×8, 130×6', 'multiple sets comma-joined');
  ok(formatSets([]) === '', 'empty sets -> empty string');
  ok(formatSets([{ weight: 0, reps: 12 }]) === '0×12', 'bodyweight (0 weight) formats correctly');
}

console.log('localDateStr');
{
  // Construct via local Date components so the test is timezone-independent.
  const ts = new Date(2026, 6, 8, 23, 30).getTime(); // July 8 2026, 11:30pm local
  ok(localDateStr(ts) === '2026-07-08', 'formats as YYYY-MM-DD in local time, got ' + localDateStr(ts));
  const ts2 = new Date(2026, 0, 1, 0, 5).getTime(); // Jan 1 2026, just after midnight
  ok(localDateStr(ts2) === '2026-01-01', 'pads single-digit month/day, got ' + localDateStr(ts2));
}

console.log('sessionsAfter');
{
  const a = { id: 'a', date: 100 }, b = { id: 'b', date: 200 }, c = { id: 'c', date: 300 };
  const sessions = [a, b, c];
  ok(sessionsAfter(sessions, 150).map(s => s.id).join(',') === 'b,c', 'returns sessions strictly after ts');
  ok(sessionsAfter(sessions, 300).length === 0, 'nothing after the newest session\'s own date');
  ok(sessionsAfter(sessions).length === 3, 'no ts (undefined) -> everything, treated as since epoch');
  ok(sessionsAfter(sessions, 0).length === 3, 'ts=0 -> everything');
}

console.log('toMarkdown');
{
  ok(toMarkdown([]) === '', 'no sessions -> empty string');
  const s1 = { id: 's1', date: new Date(2026, 6, 18, 8, 0).getTime(), split: 'push',
    entries: [{ exercise: 'Bench Press', sets: [{ weight: 135, reps: 8 }, { weight: 135, reps: 7 }] },
              { exercise: 'Dips', sets: [{ weight: 0, reps: 12 }] }] };
  const md1 = toMarkdown([s1]);
  ok(md1 === '## 2026-07-18 — Push\n- Bench Press: 135×8, 135×7\n- Dips: 0×12\n', 'single-session markdown matches exactly, got:\n' + md1);

  const s2 = { id: 's2', date: new Date(2026, 6, 19, 8, 0).getTime(), split: 'legs',
    entries: [{ exercise: 'Squat', sets: [{ weight: 185, reps: 5 }] }] };
  const md2 = toMarkdown([s2, s1]);   // pass in reverse order — function must sort
  ok(md2.indexOf('2026-07-18') < md2.indexOf('2026-07-19'), 'multiple sessions ordered oldest-first regardless of input order');
  ok(md2 === md1 + '\n' + '## 2026-07-19 — Legs\n- Squat: 185×5\n', 'two-session markdown blocks separated by a blank line, got:\n' + md2);

  const noEntries = { id: 's3', date: Date.now(), split: 'pull', entries: [] };
  ok(toMarkdown([noEntries]) === '## ' + localDateStr(noEntries.date) + ' — Pull\n\n', 'a session with zero entries still emits its header, no dangling bullets');
}

console.log('createExportTracker');
{
  const storage = memStorage();
  const t = createExportTracker(storage);
  ok(t.get() === 0, 'defaults to 0 (epoch) when nothing exported yet');
  t.set(1234567);
  ok(t.get() === 1234567, 'set/get round-trips');
  const t2 = createExportTracker(storage);   // fresh instance, same storage
  ok(t2.get() === 1234567, 'persists across a fresh load from the same storage');
}

console.log('color helpers (custom RGB theme) — same math as Grocery List');
{
  ok(rgbToHex(255, 0, 0) === '#ff0000', 'rgbToHex red');
  ok(hexToRgb('#00ff00').join(',') === '0,255,0', 'hexToRgb green');
  ok(hexToRgb('#fff').join(',') === '255,255,255', 'hexToRgb 3-digit shorthand');
  const p = derivePreset(59, 130, 246);
  ok(p.light[0] === '#3b82f6' && p.dark[0] === '#3b82f6', 'derivePreset keeps the chosen accent in both modes');
  ok(rgbToHex(...hexToRgb('#abcdef')) === '#abcdef', 'hex -> rgb -> hex round-trips');
}

console.log('HSV <-> RGB (color picker)');
{
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  ok(eq(hsvToRgb(0, 1, 1), [255, 0, 0]), 'hsv red -> rgb');
  ok(eq(hsvToRgb(120, 1, 1), [0, 255, 0]), 'hsv green -> rgb');
  const [h, s, v] = rgbToHsv(255, 0, 0);
  ok(Math.round(h) === 0 && s === 1 && v === 1, 'rgbToHsv red -> h0 s1 v1');
  const rt = (r, g, b) => { const [H, S, V] = rgbToHsv(r, g, b); return hsvToRgb(H, S, V); };
  ok(eq(rt(59, 130, 246), [59, 130, 246]), 'round-trip #3b82f6');
}

console.log('store.lastSessionForSplit');
{
  const storage = memStorage();
  const s = createStore(storage).load();
  ok(s.lastSessionForSplit('push') === null, 'no sessions yet -> null, not a throw');

  const olderPull = s.startSession('pull'); olderPull.date = 1000;
  s.logSet(olderPull, 'Lever Row', 45, 10);
  s.finishSession(olderPull);

  const push1 = s.startSession('push'); push1.date = 1500;
  s.logSet(push1, 'Bench Press', 100, 8);
  s.finishSession(push1);

  const newerPull = s.startSession('pull'); newerPull.date = 2000;
  s.logSet(newerPull, 'Lever Row', 65, 10);
  s.logSet(newerPull, 'Shrugs', 65, 10);
  s.finishSession(newerPull);

  const last = s.lastSessionForSplit('pull');
  ok(last.id === newerPull.id, 'returns the most recent session matching the split, ignoring other splits and older sessions of the same split');
  ok(last.entries.map(e => e.exercise).join(',') === 'Lever Row,Shrugs', 'carries the exercise list + order from that session\'s entries');
  ok(s.lastSessionForSplit('legs') === null, 'a split with zero sessions still returns null');

  // Tied dates can happen with fabricated/imported timestamps (or two
  // sessions finished in the same millisecond) — the LAST-inserted one
  // (i.e. the actually-most-recent one) must win, not the first.
  const storage2 = memStorage();
  const s2 = createStore(storage2).load();
  const tiedA = s2.startSession('push'); tiedA.date = 5000;
  s2.logSet(tiedA, 'Bench Press', 100, 8);
  s2.finishSession(tiedA);
  const tiedB = s2.startSession('push'); tiedB.date = 5000; // identical timestamp, inserted second
  s2.logSet(tiedB, 'Overhead Press', 80, 8);
  s2.finishSession(tiedB);
  ok(s2.lastSessionForSplit('push').id === tiedB.id, 'on a tied date, the LAST-inserted (truly most recent) session wins, not the first');
}

console.log('deleteSet');
{
  const s = createStore(memStorage()).load();
  const session = s.startSession('push');
  s.logSet(session, 'Bench Press', 135, 8);
  s.logSet(session, 'Bench Press', 135, 7);
  s.logSet(session, 'Dips', 0, 12);
  ok(s.deleteSet(session, 'Bench Press', 0) === true, 'deleteSet returns true on success');
  ok(session.entries.find(e => e.exercise === 'Bench Press').sets.length === 1, 'first set removed, one remains');
  ok(session.entries.find(e => e.exercise === 'Bench Press').sets[0].reps === 7, 'remaining set is the correct one (index 0 removed, not last)');
  ok(s.deleteSet(session, 'Bench Press', 0) === true, 'deleting the last remaining set succeeds');
  ok(!session.entries.some(e => e.exercise === 'Bench Press'), 'entry removed entirely once its sets are empty');
  ok(session.entries.some(e => e.exercise === 'Dips'), 'unrelated entry (Dips) untouched');
  ok(s.deleteSet(session, 'Squat', 0) === false, 'deleteSet on an exercise with no entry returns false');
  ok(s.deleteSet(session, 'Dips', 5) === false, 'deleteSet with an out-of-range index returns false');
}

console.log('updateSet');
{
  const s = createStore(memStorage()).load();
  const session = s.startSession('legs');
  s.logSet(session, 'Squat', 135, 8);
  const updated = s.updateSet(session, 'Squat', 0, 145, 6);
  ok(updated.weight === 145 && updated.reps === 6, 'updateSet returns the updated set');
  ok(session.entries[0].sets[0].weight === 145 && session.entries[0].sets[0].reps === 6, 'the set in place was mutated');
  ok(s.updateSet(session, 'Squat', 0, 145, 0) === null, 'updateSet rejects zero reps, same rule as logSet');
  ok(session.entries[0].sets[0].reps === 6, 'rejected update leaves the original set untouched');
  ok(s.updateSet(session, 'Squat', 9, 100, 5) === null, 'updateSet with an out-of-range index returns null');
  ok(s.updateSet(session, 'Bench Press', 0, 100, 5) === null, 'updateSet on a nonexistent exercise entry returns null');
  const clamped = s.updateSet(session, 'Squat', 0, MAX_WEIGHT + 500, MAX_REPS + 500);
  ok(clamped.weight === MAX_WEIGHT && clamped.reps === MAX_REPS, 'updateSet clamps weight/reps to sane maximums, got ' + JSON.stringify(clamped));
}

console.log('logSet clamps to sane maximums');
{
  const s = createStore(memStorage()).load();
  const session = s.startSession('push');
  const set = s.logSet(session, 'Bench Press', MAX_WEIGHT + 1000, MAX_REPS + 1000);
  ok(set.weight === MAX_WEIGHT && set.reps === MAX_REPS, 'logSet clamps runaway weight/reps values, got ' + JSON.stringify(set));
}

console.log('store.sessionById / store.deleteSession');
{
  const storage = memStorage();
  const s = createStore(storage).load();
  const a = s.startSession('push'); a.date = 100; s.logSet(a, 'Bench Press', 100, 8); s.finishSession(a);
  const b = s.startSession('pull'); b.date = 200; s.logSet(b, 'Pull-ups', 0, 10); s.finishSession(b);

  ok(s.sessionById(a.id).id === a.id, 'sessionById finds the right session');
  ok(s.sessionById('nope') === null, 'sessionById returns null for an unknown id');

  ok(s.deleteSession(a.id) === true, 'deleteSession returns true on success');
  ok(s.sessions.length === 1 && s.sessions[0].id === b.id, 'only the targeted session was removed');
  ok(s.deleteSession('nope') === false, 'deleteSession on an unknown id returns false');

  // persists
  const s2 = createStore(storage).load();
  ok(s2.sessions.length === 1, 'session deletion persisted across reload');
}

console.log('createExercises — removeCustom');
{
  const storage = memStorage();
  const ex = createExercises(storage);
  ex.addCustom('push', 'Cable Fly');
  ok(ex.forSplit('push').includes('Cable Fly'), 'sanity: Cable Fly was added');
  ok(ex.removeCustom('push', 'Cable Fly') === true, 'removeCustom returns true on success');
  ok(!ex.forSplit('push').includes('Cable Fly'), 'Cable Fly no longer in the split list');
  ok(ex.removeCustom('push', 'Bench Press') === false, 'removeCustom refuses to remove a seed exercise');
  ok(ex.forSplit('push').includes('Bench Press'), 'seed exercise Bench Press untouched');
  ok(ex.removeCustom('push', 'Nonexistent') === false, 'removeCustom on an unknown name returns false');

  const ex2 = createExercises(storage);
  ok(!ex2.forSplit('push').includes('Cable Fly'), 'removal persists across reload');
}

console.log('exportReminderDue');
{
  const DAY = 24 * 60 * 60 * 1000;
  ok(exportReminderDue([], 0, Date.now()) === false, 'no sessions at all -> never due');
  const few = [{ id: 'a', date: 1000 }, { id: 'b', date: 2000 }];
  ok(exportReminderDue(few, 0, 1000) === false, 'a couple pending sessions, freshly started -> not due yet');
  ok(exportReminderDue(few, 0, 15 * DAY) === true, 'never exported and oldest pending session is 15 days old -> due');
  const many = Array.from({ length: 8 }, (_, i) => ({ id: 'x' + i, date: i + 1 }));
  ok(exportReminderDue(many, 0, 5) === true, '8+ pending sessions is due regardless of age');
  ok(exportReminderDue(few, 500, 500 + 10 * DAY) === false, 'exported recently, only 10 days since last export -> not due');
  ok(exportReminderDue(few, 500, 500 + 20 * DAY) === true, '20 days since last export with pending sessions -> due');
  ok(exportReminderDue(few, 5000, 6000) === false, 'everything already exported (lastExportTs after all session dates) -> not due');
}

console.log('toJSON / fromJSON / mergeSessions (backup + restore)');
{
  const s1 = { id: 's1', date: 100, split: 'push', entries: [{ exercise: 'Bench Press', sets: [{ weight: 135, reps: 8 }] }] };
  const s2 = { id: 's2', date: 200, split: 'legs', entries: [{ exercise: 'Squat', sets: [{ weight: 185, reps: 5 }] }] };
  const json = toJSON([s1, s2]);
  ok(typeof json === 'string' && json.includes('Bench Press'), 'toJSON produces a JSON string containing session data');

  const parsed = fromJSON(json);
  ok(Array.isArray(parsed) && parsed.length === 2, 'fromJSON round-trips back to an array of the same sessions');
  ok(parsed[0].id === 's1' && parsed[1].id === 's2', 'session identity preserved through round-trip');

  let threw = false;
  try { fromJSON('not valid json{{'); } catch { threw = true; }
  ok(threw, 'fromJSON throws on invalid JSON');

  threw = false;
  try { fromJSON('{"not":"an array"}'); } catch { threw = true; }
  ok(threw, 'fromJSON throws when the parsed value is not an array of session-shaped objects');

  threw = false;
  try { fromJSON('[{"id":"x"}]'); } catch { threw = true; }
  ok(threw, 'fromJSON throws when an entry is missing required session fields');

  const merged = mergeSessions([s1], [s1, s2]);
  ok(merged.length === 2, 'mergeSessions dedupes by id — s1 already present is not duplicated');
  ok(merged.some(s => s.id === 's1') && merged.some(s => s.id === 's2'), 'merged set contains both sessions');
}

console.log('\n' + (fail === 0 ? '✅ ALL PASS' : '❌ FAILURES') + `  (${pass} passed, ${fail} failed)`);
process.exit(fail === 0 ? 0 : 1);
