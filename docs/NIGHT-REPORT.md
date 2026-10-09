# Night report — v2 feature harvest

Branch `v2-harvest`, 38 commits on top of `main`. Version bumped to 1.1.0 in both places.

**Status (2026-10-09):** merged to `main` and pushed as release 1.1.0 (`bbd7701`). Live on GitHub Pages; the 2026-10-04 known-issue fixes went out with it (Pages build `a81e5f2`).

## Built (from `docs/feature-harvest.md`)

| # | Feature | State |
|---|---|---|
| 0 | MIT license | done |
| 1 | Plate calculator + plate inventory in Settings | done, opt-in per exercise ("Barbell") |
| 2 | Est. 1RM (Epley) | done |
| 3 | Progress chart per exercise | done |
| 4 | Warm-up sets | done |
| 5 | Activity heatmap | done |
| 6 | PR badge + rep-range PRs | done |
| 7 | Volume per session and per week | done |
| 11 | Import from Hevy / Strong | done |
| 14 | Plate milestones + big-three total | done |

Not built, as agreed: 9, 10, 12, 13 (need outside datasets) and 15–17 (reverse v1 decisions). Item 8 (A/B days) was built, then removed by the owner's decision: one list per split, exercises chosen by the user.

## Tests

| Suite | Before | After |
|---|---|---|
| Node (`test-*.js`) | 167 | 317 |
| UI (`test-ui*.html`) | 117 | 196 |

All pass. `node run-ui-tests.js` now runs every UI page headlessly in one command (new this run).

## How it was built

Claude wrote each spec as failing tests first; Codex (gpt-6.1-sol, high) wrote the code against them; Claude verified every result itself (Codex's sandbox can't run Chrome or commit). Each batch then got a read-only Codex bug review. Those reviews raised 20 issues: 16 fixed (15 with regression tests, plus the version bump), 4 judged out of scope (listed below). Fixed ones include: an infinite loop on NaN, kg milestones and volume wrong (several more were in the A/B code, since removed), imports silently storing kg as lbs, and a failed save leaving a phantom import in memory.

## Checked against the real history (22 sessions, local only, never committed)

- All 22 sessions load and survive backup/restore.
- Screens were screenshotted at phone width in light and dark with this data.

## Notes

- After any release push: load the live page once WITHOUT clearing cache (the check that caught the August blank-screen bug).
- Barbell mode is off by default per exercise. Turn it on only for real barbell lifts, or the plate calculator will misread dumbbell weights.

## Known issues

All three fixed on 2026-10-04 (open set editor keeps typed values across repaints; restore rejects an invalid backup whole; "Last time" ignores name case and spacing).
