/* Tests for the v2 analytics + barbell helpers in model.js (feature harvest
   items 1, 2, 4, 5, 6, 7, 14). Run: node test-analytics.js */
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
const day = (y, mo, d, h = 12) => new Date(y, mo - 1, d, h).getTime();
const sess = (id, date, split, entries) => ({ id, date, split, entries });
const en = (exercise, ...sets) => ({ exercise, sets: sets.map(([weight, reps]) => ({ weight, reps })) });

console.log('exports');
['DEFAULT_PLATES', 'DEFAULT_BAR', 'platesPerSide', 'nearestLoadable', 'createPlatePref',
 'createBarbellPref', 'e1rm', 'exerciseKey', 'warmupSets', 'sessionVolume', 'weekStart',
 'weeklyVolume', 'activityByDay', 'plateMilestones', 'bigThreeTotal', 'exerciseHistory',
 'repPRs', 'isNewPR'].forEach(k => ok(k in M, `model exports ${k}`));

console.log('item 1: platesPerSide');
{
  const P = [45, 35, 25, 10, 5, 2.5];
  ok(eq(M.DEFAULT_PLATES.lbs, P), 'default lbs plates are 45/35/25/10/5/2.5');
  ok(eq(M.DEFAULT_PLATES.kg, [25, 20, 15, 10, 5, 2.5, 1.25]), 'default kg plates are 25/20/15/10/5/2.5/1.25');
  ok(M.DEFAULT_BAR.lbs === 45 && M.DEFAULT_BAR.kg === 20, 'default bar is 45 lbs / 20 kg');
  ok(eq(M.platesPerSide(135, 45, P), [45]), '135 = one 45 per side');
  ok(eq(M.platesPerSide(255, 45, P), [45, 45, 10, 5]), '255 = 45/45/10/5 per side, heaviest first');
  ok(eq(M.platesPerSide(45, 45, P), []), 'bar weight alone = no plates (empty array, not null)');
  ok(M.platesPerSide(40, 45, P) === null, 'below the bar is not loadable -> null');
  ok(M.platesPerSide(136, 45, P) === null, '136 is not loadable with these plates -> null');
  ok(eq(M.platesPerSide(50, 45, P), [2.5]), '50 = one 2.5 per side');
  /* Greedy (take the biggest plate that fits) fails here: 60/side greedy takes
     45 then cannot make 15 from 20s. The answer exists, so it must be found. */
  ok(eq(M.platesPerSide(165, 45, [45, 20]), [20, 20, 20]), 'non-greedy inventory: 165 on [45,20] = 20/20/20 (greedy would wrongly say null)');
  ok(eq(M.platesPerSide(60, 20, M.DEFAULT_PLATES.kg), [20]), 'kg: 60 on a 20 bar = one 20 per side');
  ok(eq(M.platesPerSide(22.5, 20, M.DEFAULT_PLATES.kg), [1.25]), 'kg: 22.5 = one 1.25 per side');
  ok(eq(M.platesPerSide(225, 45, [45, 45, 10]), [45, 45]), 'duplicate entries in the inventory are harmless');
}

console.log('item 1: nearestLoadable');
{
  const P = [45, 35, 25, 10, 5, 2.5];
  ok(eq(M.nearestLoadable(136, 45, P), { below: 135, above: 140 }), '136 -> 135 below, 140 above');
  ok(eq(M.nearestLoadable(135, 45, P), { below: 135, above: 135 }), 'already loadable -> both equal the input');
  ok(eq(M.nearestLoadable(30, 45, P), { below: null, above: 45 }), 'below the bar -> below null, above = bar');
  ok(eq(M.nearestLoadable(170, 45, [45, 20]), { below: 165, above: 175 }), 'non-greedy inventory finds 165 and 175 (45+20+... per side)');
}

console.log('item 1: createPlatePref + createBarbellPref');
{
  const st = memStorage();
  const pp = M.createPlatePref(st);
  ok(eq(pp.get('lbs'), { bar: 45, plates: [45, 35, 25, 10, 5, 2.5] }), 'plate pref defaults to DEFAULT_BAR/DEFAULT_PLATES for lbs');
  ok(eq(pp.get('kg'), { bar: 20, plates: [25, 20, 15, 10, 5, 2.5, 1.25] }), 'plate pref defaults for kg');
  ok(pp.set('lbs', 35, [10, 45, 25, 25]) === true, 'set accepts a valid inventory');
  ok(eq(M.createPlatePref(st).get('lbs'), { bar: 35, plates: [45, 25, 10] }), 'persisted, deduped, sorted heaviest first');
  ok(eq(M.createPlatePref(st).get('kg').bar, 20), 'setting lbs does not touch kg');
  ok(pp.set('lbs', 45, []) === false, 'empty plate list rejected');
  ok(pp.set('lbs', 45, [45, -5]) === false, 'negative plate rejected');
  ok(pp.set('lbs', 0, [45]) === false, 'zero bar rejected');
  ok(pp.set('lbs', 45, [45, 'x']) === false, 'non-numeric plate rejected');
  ok(eq(pp.get('lbs'), { bar: 35, plates: [45, 25, 10] }), 'a rejected set leaves the stored value unchanged');
  st.setItem('workout-plates-v1', '{corrupt');
  ok(eq(M.createPlatePref(st).get('lbs').bar, 45), 'corrupt storage falls back to defaults');

  const bb = M.createBarbellPref(memStorage());
  ok(bb.is('Squat') === false, 'no exercise is a barbell exercise by default');
  bb.set('Squat', true);
  ok(bb.is('squat ') === true && bb.is('SQUAT') === true, 'barbell flag matches by exerciseKey (case/space-insensitive)');
  bb.set('squat', false);
  ok(bb.is('Squat') === false, 'flag can be cleared');
  const st2 = memStorage();
  M.createBarbellPref(st2).set('Deadlift', true);
  ok(M.createBarbellPref(st2).is('deadlift') === true, 'barbell flags persist to storage');
}

console.log('item 2: e1rm + exerciseKey');
{
  ok(M.e1rm(100, 1) === 100, '1 rep: e1rm is the weight itself');
  ok(M.e1rm(100, 10) === 133.3, 'Epley: 100 x 10 -> 133.3 (rounded to 0.1)');
  ok(M.e1rm(225, 5) === 262.5, 'Epley: 225 x 5 -> 262.5');
  ok(M.e1rm(0, 10) === null, 'bodyweight set (weight 0) -> null, not 0');
  ok(M.e1rm(100, 0) === null, '0 reps -> null');
  ok(M.e1rm(100, 21) === null, 'above 20 reps the estimate is meaningless -> null');
  ok(M.e1rm(100, 20) === 166.7, '20 reps still estimated');
  ok(M.exerciseKey('  Bar  curl ') === 'bar curl', 'exerciseKey trims, lowercases, collapses spaces');
  ok(M.exerciseKey('Bar Curl') === M.exerciseKey('Bar curl'), 'case forks of one exercise share a key');
}

console.log('item 4: warmupSets');
{
  const P = [45, 35, 25, 10, 5, 2.5];
  ok(eq(M.warmupSets(225, { bar: 45, plates: P }),
        [{ weight: 45, reps: 10 }, { weight: 90, reps: 5 }, { weight: 135, reps: 3 }, { weight: 180, reps: 2 }]),
     'barbell 225: bar x10, 40% x5, 60% x3, 80% x2, each rounded DOWN to loadable');
  ok(eq(M.warmupSets(100, { bar: 45, plates: P }),
        [{ weight: 45, reps: 10 }, { weight: 60, reps: 3 }, { weight: 80, reps: 2 }]),
     'barbell 100: 40% (40) is below the bar so it is dropped; 60 and 80 kept');
  ok(eq(M.warmupSets(45, { bar: 45, plates: P }), []), 'working weight at the bar -> no warm-up');
  ok(eq(M.warmupSets(130, { step: 2.5 }), [{ weight: 65, reps: 8 }, { weight: 97.5, reps: 4 }]),
     'non-barbell 130: 50% x8, 75% x4, rounded DOWN to the step');
  ok(eq(M.warmupSets(10, { step: 2.5 }), [{ weight: 5, reps: 8 }, { weight: 7.5, reps: 4 }]), 'non-barbell small weight');
  ok(eq(M.warmupSets(2.5, { step: 2.5 }), []), 'warm-ups that round to 0 or reach the working weight are dropped');
  ok(eq(M.warmupSets(0, { step: 2.5 }), []), 'bodyweight -> no warm-up');
}

console.log('item 7: sessionVolume + weekStart + weeklyVolume');
{
  const s1 = sess('a', day(2026, 9, 14), 'push', [en('Bench Press', [100, 10], [100, 8]), en('Dips', [0, 12])]);
  ok(M.sessionVolume(s1) === 1800, 'volume = sum of weight x reps; bodyweight sets add 0');
  ok(M.sessionVolume(sess('e', 0, 'push', [])) === 0, 'empty session -> 0');
  ok(M.weekStart(day(2026, 9, 16, 18)) === new Date(2026, 8, 14, 0, 0, 0, 0).getTime(), 'weekStart of Wed Sep 16 is Mon Sep 14 00:00 local');
  ok(M.weekStart(day(2026, 9, 14, 0)) === new Date(2026, 8, 14).getTime(), 'a Monday is its own week start');
  ok(M.weekStart(day(2026, 9, 20, 23)) === new Date(2026, 8, 14).getTime(), 'Sunday belongs to the week that started Monday');
  const s2 = sess('b', day(2026, 9, 16), 'pull', [en('Row', [50, 10])]);
  const s3 = sess('c', day(2026, 9, 29), 'legs', [en('Leg Press', [200, 10])]);
  const wv = M.weeklyVolume([s3, s1, s2]);
  ok(eq(wv, [
    { weekStart: new Date(2026, 8, 14).getTime(), volume: 2300 },
    { weekStart: new Date(2026, 8, 21).getTime(), volume: 0 },
    { weekStart: new Date(2026, 8, 28).getTime(), volume: 2000 },
  ]), 'weeklyVolume: contiguous weeks oldest first, empty weeks present as 0, input order irrelevant');
  ok(eq(M.weeklyVolume([]), []), 'no sessions -> []');
}

console.log('item 5: activityByDay');
{
  const a = M.activityByDay([
    sess('a', day(2026, 9, 14, 7), 'push', []),
    sess('b', day(2026, 9, 14, 19), 'pull', []),
    sess('c', day(2026, 9, 15), 'legs', []),
  ]);
  ok(eq(a, { '2026-09-14': 2, '2026-09-15': 1 }), 'counts sessions per LOCAL calendar day');
  ok(eq(M.activityByDay([]), {}), 'no sessions -> {}');
}

console.log('item 14: plateMilestones + bigThreeTotal');
{
  ok(M.plateMilestones(134) === 0 && M.plateMilestones(135) === 1, '135 lbs = 1 plate milestone');
  ok(M.plateMilestones(225) === 2 && M.plateMilestones(314) === 2 && M.plateMilestones(315) === 3, '225 = 2, 315 = 3');
  ok(M.plateMilestones(500) === 4, 'caps at 4 plates (405+)');
  const hist = [
    sess('a', day(2026, 9, 1), 'legs', [en('Squat', [225, 5], [245, 3]), en('Deadlift', [315, 5])]),
    sess('b', day(2026, 9, 3), 'push', [en('bench press', [185, 5])]),
    sess('c', day(2026, 9, 5), 'push', [en('Bench Press', [205, 1])]),
  ];
  const all = () => true;
  ok(eq(M.bigThreeTotal(hist, all), { squat: 245, bench: 205, deadlift: 315, total: 765 }),
     'big three = heaviest single set per lift (any reps), names matched by exerciseKey');
  const onlySquat = name => M.exerciseKey(name) === 'squat';
  ok(eq(M.bigThreeTotal(hist, onlySquat), { squat: 245, bench: null, deadlift: null, total: null }),
     'only exercises the predicate marks as barbell count; total is null unless all three exist');
}

console.log('items 3 + 6: exerciseHistory, repPRs, isNewPR');
{
  const hist = [
    sess('s3', day(2026, 9, 10), 'pull', [en('Bar curl', [15, 11], [15, 10])]),
    sess('s1', day(2026, 9, 1), 'pull', [en('Bar Curl', [10, 12], [15, 8])]),
    sess('s2', day(2026, 9, 5), 'pull', [en('Rows', [100, 10])]),
    sess('s4', day(2026, 9, 12), 'push', [en('Dips', [0, 12], [0, 15])]),
  ];
  const h = M.exerciseHistory(hist, 'BAR CURL');
  ok(h.length === 2 && h[0].sessionId === 's1' && h[1].sessionId === 's3', 'history merges case forks, oldest first');
  ok(h[0].bestE1rm === 19 && h[0].topWeight === 15 && h[0].bestReps === 12 && h[0].volume === 240,
     'row s1: bestE1rm 19 (15x8), topWeight 15, bestReps 12, volume 240');
  ok(h[1].bestE1rm === 20.5 && h[1].date === day(2026, 9, 10) && h[1].sets.length === 2, 'row s3: bestE1rm 20.5 (15x11), carries date + sets');
  const dips = M.exerciseHistory(hist, 'dips');
  ok(dips.length === 1 && dips[0].bestE1rm === null && dips[0].bestReps === 15 && dips[0].topWeight === 0,
     'bodyweight history: bestE1rm null, bestReps still tracked');
  ok(eq(M.exerciseHistory(hist, 'nope'), []), 'unknown exercise -> []');

  const prs = M.repPRs(hist, 'bar curl');
  ok(eq(prs, {
    8:  { weight: 15, date: day(2026, 9, 1) },
    10: { weight: 15, date: day(2026, 9, 10) },
    11: { weight: 15, date: day(2026, 9, 10) },
    12: { weight: 10, date: day(2026, 9, 1) },
  }), 'repPRs: heaviest weight for EXACTLY n reps, keyed by n, with the date first achieved');
  const tie = M.repPRs([
    sess('x', day(2026, 9, 1), 'pull', [en('Row', [100, 5])]),
    sess('y', day(2026, 9, 9), 'pull', [en('Row', [100, 5])]),
  ], 'row');
  ok(tie[5].date === day(2026, 9, 1), 'a tie keeps the FIRST date it was achieved');
  ok(eq(M.repPRs(hist, 'dips'), {}), 'bodyweight sets never produce weight PRs');

  ok(M.isNewPR(hist, 'Bar Curl', { weight: 20, reps: 8 }) === true, 'beats best prior e1rm (20.5) -> PR');
  ok(M.isNewPR(hist, 'bar curl', { weight: 15, reps: 11 }) === false, 'equal to best prior e1rm is not a PR');
  ok(M.isNewPR(hist, 'Brand New', { weight: 50, reps: 5 }) === false, 'first-ever set of an exercise is not a PR');
  ok(M.isNewPR(hist, 'Dips', { weight: 0, reps: 20 }) === false, 'bodyweight sets are never e1rm PRs');
}

console.log('review regressions (Codex review of batch A)');
{
  const t0 = Date.now();
  const r = M.nearestLoadable(NaN, 45, M.DEFAULT_PLATES.lbs);
  ok(Date.now() - t0 < 500 && eq(r, { below: null, above: null }), 'nearestLoadable(NaN) returns {below:null, above:null} immediately instead of looping');
  ok(eq(M.nearestLoadable(Infinity, 45, M.DEFAULT_PLATES.lbs), { below: null, above: null }), 'nearestLoadable(Infinity) -> nulls');
  ok(M.platesPerSide(NaN, 45, M.DEFAULT_PLATES.lbs) === null, 'platesPerSide(NaN) -> null');

  const broken = sess('x', day(2026, 9, 14), 'legs', [{ exercise: 'Squat' }, en('Squat', [100, 5])]);
  ok(M.sessionVolume(broken) === 500, 'an entry with no sets counts as empty instead of throwing');
  ok(M.exerciseHistory([broken], 'squat').length === 1 && M.exerciseHistory([broken], 'squat')[0].topWeight === 100, 'exerciseHistory skips a set-less entry');
  ok(M.bigThreeTotal([broken], () => true).squat === 100, 'bigThreeTotal skips a set-less entry');
  ok(eq(M.repPRs([broken], 'squat'), { 5: { weight: 100, date: day(2026, 9, 14) } }), 'repPRs skips a set-less entry');
  ok(M.weeklyVolume([broken])[0].volume === 500, 'weeklyVolume survives a set-less entry');

  ok(M.e1rm(102.1, 15) === 153.2, 'e1rm rounds half up despite float error: 102.1 x 15 = 153.15 -> 153.2');
  ok(M.isNewPR([sess('p', day(2026, 9, 1), 'push', [en('Bench', [102.1, 15])])], 'bench', { weight: 153.2, reps: 1 }) === false,
     'equal rounded estimates are not a PR');
}

console.log('\n' + (fail === 0 ? '✅ ALL PASS' : '❌ FAILURES') + `  (${pass} passed, ${fail} failed)`);
process.exit(fail === 0 ? 0 : 1);
