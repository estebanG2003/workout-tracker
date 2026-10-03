/* Tests for importing Hevy / Strong CSV exports (feature harvest item 11).
   Run: node test-import.js
   Column layouts follow the formats Strength Journeys' importers handle
   (github.com/wayneschuller/strengthjourneys, src/lib/import/parsers). */
const M = require('./model.js');

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ FAIL: ' + msg); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('exports');
['parseCSV', 'guessSplit', 'importWorkoutCSV'].forEach(k => ok(k in M, `model exports ${k}`));

console.log('parseCSV');
{
  ok(eq(M.parseCSV('a,b\n1,2\n'), [['a', 'b'], ['1', '2']]), 'basic rows; trailing newline adds no empty row');
  ok(eq(M.parseCSV('a,b\r\n"x, y","say ""hi"""\r\n'), [['a', 'b'], ['x, y', 'say "hi"']]), 'quoted commas, escaped quotes, CRLF');
  ok(eq(M.parseCSV('a;b;c\n1;2,5;3'), [['a', 'b', 'c'], ['1', '2,5', '3']]), 'semicolon delimiter detected from the header line');
  ok(eq(M.parseCSV('a\tb\n1\t2'), [['a', 'b'], ['1', '2']]), 'tab delimiter detected');
  ok(eq(M.parseCSV('a,b\n"line1\nline2",2'), [['a', 'b'], ['line1\nline2', '2']]), 'newline inside quotes stays in the field');
  ok(eq(M.parseCSV('﻿a,b\n1,2'), [['a', 'b'], ['1', '2']]), 'a UTF-8 BOM is stripped');
}

console.log('guessSplit');
{
  ok(M.guessSplit('Push Day') === 'push' && M.guessSplit('PULL A') === 'pull', 'push / pull by keyword, any case');
  ok(M.guessSplit('Legs & Glutes') === 'legs' && M.guessSplit('Leg day') === 'legs', 'leg or legs -> legs');
  ok(M.guessSplit('Upper A') === null && M.guessSplit('') === null, 'no keyword -> null');
  ok(M.guessSplit('Push/Pull superset') === null, 'more than one keyword is ambiguous -> null');
}

const HEVY_LB = [
  'title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_lbs,reps,distance_miles,duration_seconds,rpe',
  'Push A,"28 Mar 2025, 17:29","28 Mar 2025, 18:45",,Bench Press (Barbell),,Go heavy,0,warmup,45,10,,,6',
  'Push A,"28 Mar 2025, 17:29","28 Mar 2025, 18:45",,Bench Press (Barbell),,,1,normal,185,8,,,8',
  'Push A,"28 Mar 2025, 17:29","28 Mar 2025, 18:45",,Bench Press (Barbell),,,2,failure,185,6,,,10',
  'Push A,"28 Mar 2025, 17:29","28 Mar 2025, 18:45",,Dips,,,0,normal,,12,,,',
  'Push A,"28 Mar 2025, 17:29","28 Mar 2025, 18:45",,Treadmill,,,0,normal,,,1.2,600,',
  'Upper B,"30 Mar 2025, 09:00","30 Mar 2025, 10:00",,Row,,,0,normal,135,10,,,',
].join('\n');

console.log('importWorkoutCSV: Hevy');
{
  const r = M.importWorkoutCSV(HEVY_LB, {});
  ok(r.format === 'hevy', 'detected as Hevy');
  ok(r.sessions.length === 1 && r.unmatched === 1, 'one workout mapped (Push A); "Upper B" counted as unmatched and left out');
  const s = r.sessions[0];
  ok(s.split === 'push' && s.date === new Date(2025, 2, 28, 17, 29).getTime(), 'split from the title, date from start_time in LOCAL time');
  ok(M.fromJSON(M.toJSON(r.sessions)).length === 1, 'imported sessions pass the backup validator');
  ok(eq(s.entries.map(e => e.exercise), ['Bench Press (Barbell)', 'Dips']), 'exercise names kept as exported, in first-seen order');
  ok(eq(s.entries[0].sets, [{ weight: 185, reps: 8 }, { weight: 185, reps: 6 }]), 'warm-up sets skipped; normal and failure sets kept');
  ok(eq(s.entries[1].sets, [{ weight: 0, reps: 12 }]), 'empty weight = bodyweight (0)');
  ok(r.skippedSets === 2, 'skippedSets counts the warm-up and the distance/duration row');
  ok(/^hevy-/.test(s.id) && M.importWorkoutCSV(HEVY_LB, {}).sessions[0].id === s.id, 'id is deterministic, so re-importing the same file dedupes');

  const r2 = M.importWorkoutCSV(HEVY_LB, { fallbackSplit: 'pull' });
  ok(r2.sessions.length === 2 && r2.unmatched === 0, 'fallbackSplit pulls the unmatched workout in');
  ok(r2.sessions.find(x => x.entries[0].exercise === 'Row').split === 'pull', 'unmatched workout gets the fallback split');
  ok(r2.sessions.find(x => x.split === 'push').split === 'push', 'a matched title keeps its own split');
}

console.log('importWorkoutCSV: Hevy in kg');
{
  const csv = [
    'title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_kg,reps,distance_km,duration_seconds,rpe',
    'Leg Day,"25 Aug 2025, 09:38","25 Aug 2025, 10:54",,Squat (Barbell),,,0,normal,100,5,,,8',
  ].join('\n');
  const s = M.importWorkoutCSV(csv, {}).sessions[0];
  ok(s.split === 'legs' && s.entries[0].sets[0].weight === M.toCanonicalWeight(100, 'kg'), 'kg weights converted to canonical lbs (220.5)');
}

console.log('importWorkoutCSV: Strong');
{
  const strong = [
    'Date,Workout Name,Duration,Exercise Name,Set Order,Weight (kg),Reps,Distance,Seconds,Notes,Workout Notes,RPE',
    '2025-01-06 07:15:00,Pull Day,1h,Deadlift (Barbell),1,140,5,,,,,',
    '2025-01-06 07:15:00,Pull Day,1h,Deadlift (Barbell),2,150,3,,,,,',
    '2025-01-06 07:15:00,Pull Day,1h,Pull Up,1,0,10,,,,,',
    '2025-01-08 18:00:00,Pull Day,1h,Plank,1,0,0,,60,,,',
  ].join('\n');
  const r = M.importWorkoutCSV(strong, {});
  ok(r.format === 'strong', 'detected as Strong');
  ok(r.sessions.length === 1, 'two workouts in the file, but the second has no valid sets and is dropped');
  const s = r.sessions[0];
  ok(s.split === 'pull' && s.date === new Date(2025, 0, 6, 7, 15).getTime(), 'split + LOCAL date from Strong');
  ok(eq(s.entries[0].sets.map(x => x.weight), [M.toCanonicalWeight(140, 'kg'), M.toCanonicalWeight(150, 'kg')]), 'unit read from the "Weight (kg)" header');
  ok(r.skippedSets === 1, 'the zero-rep plank row is skipped');
  ok(/^strong-/.test(s.id), 'Strong ids are prefixed strong-');

  const plain = 'Date;Workout Name;Exercise Name;Set Order;Weight;Reps\n2025-01-06 07:15:00;Push;Bench Press;1;60;8';
  ok(M.importWorkoutCSV(plain, { unit: 'kg' }).sessions[0].entries[0].sets[0].weight === M.toCanonicalWeight(60, 'kg'),
     'bare "Weight" header uses opts.unit; semicolon file works');
  ok(M.importWorkoutCSV(plain, {}).sessions[0].entries[0].sets[0].weight === 60, 'bare "Weight" with no opts.unit assumes lbs');
}

console.log('importWorkoutCSV: rejects what it cannot read');
{
  let msg = '';
  try { M.importWorkoutCSV('foo,bar\n1,2', {}); } catch (e) { msg = e.message; }
  ok(/hevy/i.test(msg) && /strong/i.test(msg), 'unknown layout throws a message naming the supported apps');
  const bad = 'title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_lbs,reps\nPush,"31 Feb 2025, 12:00",,,Bench,,,0,normal,100,5';
  ok(M.importWorkoutCSV(bad, {}).sessions.length === 0, 'impossible date (31 Feb) is skipped, not rolled into March');
}

console.log('importWorkoutCSV: review fixes (wrong data in is worse than a row skipped)');
{
  const strongHead = 'Date;Workout Name;Exercise Name;Set Order;Weight (kg);Reps\n';
  const r1 = M.importWorkoutCSV(strongHead + '2025-01-06 07:15:00;Push;Bench Press;1;60,5;8', {});
  ok(r1.sessions[0].entries[0].sets[0].weight === M.toCanonicalWeight(60.5, 'kg'), 'decimal comma "60,5" in a semicolon file is 60.5, not a skipped row');

  const r2 = M.importWorkoutCSV(strongHead + '2025-01-06 07:15:00;Push;Bench Press;1;60;8.6\n2025-01-06 07:15:00;Push;Bench Press;2;60;500', {});
  const sets2 = r2.sessions[0].entries[0].sets;
  ok(sets2[0].reps === 9, 'reps are rounded to a whole number like logSet does, got ' + sets2[0].reps);
  ok(sets2[1].reps === M.MAX_REPS, 'reps are clamped to MAX_REPS like logSet does, got ' + sets2[1].reps);

  const r3 = M.importWorkoutCSV([
    'title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_kg,reps',
    'Pull,"1 Oct 2026, 18:00",,,Pull Up (Assisted),,,0,normal,-25,8',
    'Pull,"1 Oct 2026, 18:00",,,Row,,,0,normal,50,8',
  ].join('\n'), {});
  ok(r3.sessions[0].entries.length === 1 && r3.sessions[0].entries[0].exercise === 'Row', 'a negative (assisted) weight is skipped, never stored as bodyweight');
  ok(r3.skippedSets === 1, 'the assisted set is counted as skipped');

  const row = t => `Date,Workout Name,Exercise Name,Set Order,Weight (lbs),Reps\n2026-10-01 18:00:15,${t},Bench Press,1,100,5`;
  ok(M.importWorkoutCSV(row('Push'), {}).sessions[0].id === M.importWorkoutCSV(row('Push A'), {}).sessions[0].id,
     'renaming a workout in the source app does not change its id, so re-import still dedupes');

  ok(M.importWorkoutCSV(row('Push'), {}).unitFromHeader === true, 'unitFromHeader true when the header names the unit');
  const bare = 'Date,Workout Name,Exercise Name,Set Order,Weight,Reps\n2026-10-01 18:00:15,Push,Bench Press,1,60,5';
  ok(M.importWorkoutCSV(bare, {}).unitFromHeader === false, 'unitFromHeader false for a bare "Weight" column, so the UI must ask');
  ok(M.importWorkoutCSV(HEVY_LB, {}).unitFromHeader === true, 'Hevy always names its unit');
}

console.log('\n' + (fail === 0 ? '✅ ALL PASS' : '❌ FAILURES') + `  (${pass} passed, ${fail} failed)`);
process.exit(fail === 0 ? 0 : 1);
