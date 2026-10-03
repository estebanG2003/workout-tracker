/* Tests for A/B day variants (feature harvest item 8). Run: node test-variants.js
   A session MAY carry `variant: 'A' | 'B'`. Sessions without one (all history
   logged before this feature) stay valid and act as the fallback. */
const M = require('./model.js');

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ FAIL: ' + msg); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function memStorage() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) };
}
const throws = fn => { try { fn(); return false; } catch { return true; } };

console.log('exports');
['VARIANTS', 'createVariantPref', 'rosterKey', 'splitLabel'].forEach(k => ok(k in M, `model exports ${k}`));

console.log('createVariantPref');
{
  const st = memStorage();
  const vp = M.createVariantPref(st);
  ok(M.SPLITS.every(s => vp.enabled(s) === false), 'A/B days are off for every split by default');
  vp.set('push', true);
  ok(M.createVariantPref(st).enabled('push') === true, 'enabling push persists');
  ok(M.createVariantPref(st).enabled('pull') === false, 'other splits unaffected');
  vp.set('push', false);
  ok(M.createVariantPref(st).enabled('push') === false, 'can be turned off again');
  ok(throws(() => vp.set('cardio', true)), 'unknown split throws');
  st.setItem('workout-variants-v1', '{bad json');
  ok(M.createVariantPref(st).enabled('push') === false, 'corrupt storage -> all off');
}

console.log('splitLabel + rosterKey');
{
  ok(eq(M.VARIANTS, ['A', 'B']), 'VARIANTS is [A, B]');
  ok(M.splitLabel('push') === 'Push' && M.splitLabel('push', 'B') === 'Push B', 'splitLabel with and without a variant');
  ok(M.rosterKey('legs') === 'legs' && M.rosterKey('pull', 'A') === 'pull:A', 'rosterKey: split, or split:variant');
  ok(throws(() => M.rosterKey('push', 'C')) && throws(() => M.rosterKey('cardio', 'A')), 'rosterKey rejects bad split/variant');
}

console.log('startSession with a variant');
{
  const s = M.createStore(memStorage()).load();
  const a = s.startSession('push', 'A');
  ok(a.split === 'push' && a.variant === 'A', 'variant stored on the session');
  const plain = s.startSession('push');
  ok(!('variant' in plain), 'no variant -> no variant key at all (legacy shape unchanged)');
  ok(throws(() => s.startSession('push', 'C')), 'invalid variant throws');
}

console.log('roster per variant');
{
  const r = M.createRoster(memStorage());
  r.init('push:A', ['Bench Press', 'Dips']);
  r.init('push:B', ['Incline Bench Press']);
  ok(eq(r.get('push:A'), ['Bench Press', 'Dips']) && eq(r.get('push:B'), ['Incline Bench Press']), 'A and B keep separate rosters');
  ok(eq(r.get('push'), []), 'the plain split roster is separate too');
  ok(r.add('push:B', 'Dips') === 'Dips' && r.move('push:B', 'Dips', -1) === true, 'add/move work on variant rosters');
  ok(r.remove('push:A', 'Dips') === true && eq(r.get('push:A'), ['Bench Press']), 'remove works on variant rosters');
  ok(throws(() => r.get('push:C')) && throws(() => r.get('cardio')), 'invalid keys still throw');
}

console.log('last time prefers the same variant, falls back to any');
{
  const s = M.createStore(memStorage()).load();
  const mk = (date, variant, weight) => {
    const x = s.startSession('push', variant); x.date = date;
    s.logSet(x, 'Bench Press', weight, 10); s.finishSession(x); return x;
  };
  mk(1000, undefined, 40);   // legacy, no variant
  mk(2000, 'A', 50);
  mk(3000, 'B', 30);
  ok(s.lastSetsFor('Bench Press', null, 'A')[0].weight === 50, 'A day reads the last A session, not the newer B one');
  ok(s.lastSetsFor('Bench Press', null, 'B')[0].weight === 30, 'B day reads the last B session');
  ok(s.lastSetsFor('Bench Press', null)[0].weight === 30, 'no variant -> most recent of any (old behaviour)');

  const s2 = M.createStore(memStorage()).load();
  const legacy = s2.startSession('push'); legacy.date = 1000;
  s2.logSet(legacy, 'Bench Press', 40, 10); s2.finishSession(legacy);
  ok(s2.lastSetsFor('Bench Press', null, 'B')[0].weight === 40, 'no same-variant history yet -> falls back to legacy history');
  const bOnly = s2.startSession('push', 'B'); bOnly.date = 2000;
  s2.logSet(bOnly, 'Bench Press', 30, 10); s2.finishSession(bOnly);
  ok(s2.lastSetsFor('Bench Press', null, 'A')[0].weight === 40,
     'fallback order is same variant -> legacy (no variant) -> anything: an A day never reads a newer B day while legacy exists');
  const s4 = M.createStore(memStorage()).load();
  const onlyB = s4.startSession('push', 'B'); onlyB.date = 2000;
  s4.logSet(onlyB, 'Bench Press', 30, 10); s4.finishSession(onlyB);
  ok(s4.lastSetsFor('Bench Press', null, 'A')[0].weight === 30, '...and with no legacy either, anything beats nothing');

  const today = s.startSession('push', 'A');
  ok(eq(s.defaultsFor(today, 'Bench Press'), { weight: 50, reps: 10 }), 'defaultsFor reads the session\'s own variant');

  ok(s.lastSessionForSplit('push', 'A').date === 2000, 'lastSessionForSplit(split, variant) -> latest of that variant');
  ok(s.lastSessionForSplit('push').date === 3000, 'lastSessionForSplit(split) unchanged');
  const s3 = M.createStore(memStorage()).load();
  const old = s3.startSession('push'); old.date = 500; s3.logSet(old, 'Dips', 0, 10); s3.finishSession(old);
  ok(s3.lastSessionForSplit('push', 'B').date === 500, 'no session of that variant -> falls back to latest of the split');
  const a2 = s3.startSession('push', 'A'); a2.date = 900; s3.logSet(a2, 'Dips', 0, 12); s3.finishSession(a2);
  ok(s3.lastSessionForSplit('push', 'B').date === 500, 'same fallback order: legacy (500) beats a newer other-variant session (900)');
  ok(s3.lastSessionForSplit('legs', 'A') === null, 'nothing at all -> null');
}

console.log('persistence, export, restore');
{
  const s = M.createStore(memStorage()).load();
  const x = s.startSession('pull', 'B'); x.date = new Date(2026, 9, 1, 12).getTime();
  s.logSet(x, 'Row', 100, 10);
  ok(M.toMarkdown([x], 'lbs').startsWith('## 2026-10-01 — Pull B (lbs)'), 'markdown export labels the variant');
  const back = M.fromJSON(M.toJSON([x]));
  ok(back[0].variant === 'B', 'variant survives JSON backup/restore');
  ok(M.resumeOrFinish(x, x.date) === 'resume', 'an in-progress variant session resumes like any other');
  const legacyMd = M.toMarkdown([{ id: 'l', date: x.date, split: 'pull', entries: [] }], 'lbs');
  ok(legacyMd.startsWith('## 2026-10-01 — Pull (lbs)'), 'legacy sessions export exactly as before');
}

console.log('\n' + (fail === 0 ? '✅ ALL PASS' : '❌ FAILURES') + `  (${pass} passed, ${fail} failed)`);
process.exit(fail === 0 ? 0 : 1);
