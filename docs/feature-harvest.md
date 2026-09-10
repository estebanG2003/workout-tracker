# Feature Harvest — what to take from other open-source lifting apps

_Compiled 2026-09-02. Repo activity numbers measured via the GitHub API on that date._

The goal is to not design v2 from scratch. Every item below is a feature that
already exists, works, and has been shipped to real users by someone else.

## The rule this list runs on

**Ideas are not copyrightable. Implementations are.**

Read any repo here and reimplement any feature from it freely. Do not paste code
across a license boundary.

| License | Projects here | What that permits |
|---|---|---|
| **MIT** | Flexify, FitBook, OpenHIIT, simplefitnessapp | Copy code, keep the notice |
| **GPL-3.0 / AGPL-3.0** | Liftosaur, Strength Journeys, MyFit, wger, body.build, LiftLog | Read freely. Copying code forces this whole repo to the same license |
| **None declared** | SparkyFitness, waistline, wingfit | All rights reserved. Cannot legally copy anything |

⚠️ **This repo currently has no LICENSE file**, which means all rights reserved —
readers cannot legally fork or reuse it. That is item 0 below and it gates the
rest.

Effort key: **S** = a pure function in `model.js` plus tests, **M** = new screen
or new stored state, **L** = new data model or an external dataset.

---

## Ranked

| # | Take | From | Lic | Effort | Why it ranks here |
|---|---|---|---|---|---|
| 0 | **A LICENSE file** | — | — | S | Nothing else on this list is safely shareable until this exists. One file. |
| 1 | **Plate calculator + plate-aware rounding** | Liftosaur | AGPL | S | Fixes a live defect, not just adds a feature: the ±2.5/5/10 nudges can produce weights that no combination of real plates can build. Liftosaur prefixes every weight with the plates to load per side (`45/25/25/10 255lb`) from a plate inventory set once in Settings, and rounds all prescribed weights to what those plates can make. Pure function, drops into `model.js`. |
| 2 | **E1RM (estimated one-rep max) per set** | Strength Journeys, Liftosaur | GPL | S | One formula (Epley or Brzycki) that unlocks items 3, 6, 7 and 14 downstream. Turns a set log into a number comparable across different rep ranges — the highest analytical value per line of code on this list. |
| 3 | **Progress graph per exercise** | Flexify, Strength Journeys, Liftosaur | MIT / GPL | M | The history data already exists; this is presentation only. Vanilla SVG, no chart library. Best screenshot-to-effort ratio here, which matters if this repo is doing portfolio work. |
| 4 | **Warm-up set generator** | Strength Journeys | GPL | S | Working weight in, ramp sets out. Pure function, pairs naturally with item 1 (a ramp is only useful if its weights are loadable), and it gets used every single session. |
| 5 | **Activity heatmap** | Strength Journeys | GPL | S | GitHub-contributions-style calendar of sessions. Derives entirely from existing history, no new stored state. Reads as consistency at a glance. |
| 6 | **PR tracking, including rep-range PRs** | Strength Journeys | GPL | M | "Best ever at 5 reps" is a different question from "best ever", and both derive from data already stored. Needs item 2 to compare across rep ranges. |
| 7 | **Tonnage / volume over time** | Strength Journeys | GPL | S | Total weight moved per session and per week. Trivial from existing sets, and it is the number that actually tracks whether volume is going up. |
| 8 | **Program variants (A/B days)** | MyFit, Liftosaur | AGPL | M | A known gap: a 5-day PPL with Push A / Push B collapses into one bucket, so "Last time" mixes two different sessions. Both sources model program structure properly — read how before designing it. |
| 9 | **Muscle map / relative volume** | Liftosaur, body.build | AGPL | L | Best screenshot on the entire list. Liftosaur shows which muscles a day or a whole program hits relative to each other; body.build ships an anatomy module for muscles and joint articulations. Needs an exercise→muscle dataset, which is what makes it L. |
| 10 | **Exercise substitution by similar muscles** | Liftosaur | AGPL | M | "Machine is taken — what else hits this?" Genuinely useful in a real gym. Nearly free once item 9's dataset exists; not worth building that dataset for this alone. |
| 11 | **Import from Hevy / Strong / StrongLifts** | Strength Journeys | GPL | M | Parses CSV/XLSX exports from six commercial apps entirely client-side. This is the item that makes the app usable by someone who is not already using it, and handling real-world messy input is a stronger engineering signal than another feature. |
| 12 | **Exercise library** | wger, body.build | AGPL | L | wger ships a large free exercise database behind a REST API. Would replace free-text exercise names — which currently fork on a typo and silently split an exercise's history. |
| 13 | **Strength levels / percentile vs population** | Strength Journeys | GPL | L | "How strong am I" against published standards. Needs a standards dataset; the feature itself is small once that exists. |
| 14 | **Plate milestones + 1000lb club** | Strength Journeys | GPL | S | One-plate / two-plate / three-plate markers, and a squat+bench+deadlift total. Pure derivation, no new state. Motivational rather than structural, which is why it sits below the analytics. |
| 15 | **RIR (reps in reserve) logging** | MyFit | AGPL | M | One field per set, plus MyFit's progression formulas that compute overload from past performance. ⚠️ Reverses a v1 decision — see below. |
| 16 | **Rest timer** | Flexify, Strength Journeys, Liftosaur | MIT / GPL | M | ⚠️ Reverses a v1 decision. Also: Liftosaur notes its timer's push notification works only in the native wrapper, not the PWA. iOS Home Screen web apps are the weak spot. Add if this ever gets a native shell. |
| 17 | **Accounts / cloud sync** | Liftosaur, SparkyFitness | AGPL / none | L | ⚠️ Reverses a v1 decision, and adds a backend to an app whose whole architecture is "no framework, no build step, no backend". Highest cost, lowest fit. |

## Already decided against in v1

The README lists these as deliberately out of scope. Items 15, 16 and 17 above
each reverse one. That is allowed — but it should be a decision made again on
purpose, not a gap quietly filled:

- no rest timers, RPE/RIR, or auto progression suggestions
- no accounts, no cloud sync — one device, `localStorage` only
- no automatic integration with any notes app

## Sources worth reading

| Repo | Stars | Open issues | Last push | Stack | License |
|---|---:|---:|---|---|---|
| [Liftosaur](https://github.com/astashov/liftosaur) | 692 | 223 | 2026-09-02 | TypeScript, **PWA** | AGPL-3.0 |
| [Strength Journeys](https://github.com/wayneschuller/strengthjourneys) | 14 | 3 | 2026-09-02 | JavaScript, client-side | GPL-3.0 |
| [MyFit](https://github.com/WhyAsh5114/MyFit) | 139 | 41 | 2026-08-29 | SvelteKit, tRPC, Prisma | AGPL-3.0 |
| [Flexify](https://github.com/brandonp2412/Flexify) | 423 | 2 | 2026-09-01 | Dart / Flutter | MIT |
| [LiftLog](https://github.com/LiamMorrow/LiftLog) | 557 | 14 | 2026-09-01 | TypeScript | AGPL-3.0 |
| [wger](https://github.com/wger-project/wger) | 6828 | 271 | 2026-09-02 | Django + Flutter | AGPL-3.0 |
| [body.build](https://github.com/Dieterbe/body.build) | 38 | 17 | 2026-08-05 | Flutter / Dart | AGPL-3.0 |

**Liftosaur is the closest analog and the primary source.** It is a lifting
tracker PWA with thin iOS/Android wrappers around it — the same architecture as
this app, several years further along, and its source is readable.

**Strength Journeys is the best-matched stack.** Plain JavaScript, client-side,
nothing stored on a server. Most of the analytics items above come from it
precisely because it was built under the same constraint this app runs under.

## Not worth mining

- **SparkyFitness** (5,732 stars) — self-hosted MyFitnessPal alternative, nutrition-focused, needs a backend, and **declares no license**. Wrong shape and legally untouchable.
- **jovandeginste/workout-tracker** (1,249 stars) — GPX/TCX/FIT route tracking in Go, aimed at running. Wrong domain. ⚠️ Its README badge claims MIT but GitHub's license detector returns `NOASSERTION` — read the LICENSE file directly before copying anything from it.
- **Elevate** (1,456 stars, MPL-2.0) — Strava analytics as a desktop app plus browser extension. Interesting, unrelated shape.
- **FitBook** (MIT), **OpenNutriTracker**, **openScale**, **trale** — nutrition and body-metrics apps. Good code, different product. FitBook is worth remembering only if nutrition ever comes into scope: it ships 7,000 foods from the CORGIS dataset and does OpenFoodFacts barcode lookup, under MIT.
- **Liftoscript** — Liftosaur's built-in scripting language for progression logic. Genuinely impressive, and far more machinery than this app needs. Reject.

## If only three things get built

Items **0, 1, 2**. A license, a plate calculator, and an E1RM function. That is
one file plus roughly two pure functions with tests — and items 3, 5, 6, 7 and
14 all get cheap afterwards, because they are views over what item 2 produces.
