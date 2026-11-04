# Canvas evaluation

The results below are historical. The evaluation files were retained after updating to the 0.6.5 UI branch; the restored fixture has not been revalidated against that branch.

These cases exercise whether an independent coding agent can turn a natural-language school assignment into a readable Mico board. Each `prompt.md` is given verbatim to a fresh agent; its `rubric.md` is reserved for the coordinator. Every run has an isolated SQLite board, a Chrome screenshot, a board export, an agent transcript, a scored assessment and checksums. The workflow is in `.agents/skills/mico-canvas-eval/SKILL.md`.

## Baseline

All ten baseline drawings used the same canvas implementation at `66c3a72`, provider `magpie`, model `group/coding`, high thinking, and a 1440 × 960 Chrome viewport. The fixture and rubric corrections are recorded in each run's metadata. A single run per case is not enough to separate product effects from model variability; paired reruns are indicative, not a statistical guarantee.

| Case | Subject                  | Score / 10 | Key observation                                                                |
| ---- | ------------------------ | ---------: | ------------------------------------------------------------------------------ |
| 01   | Literature illustration  |          6 | Overlapping strokes and weak contrast obscure the intended scene.              |
| 02   | Modern Chinese history   |          8 | Event text is clipped or overlaps.                                             |
| 03   | East Asian monsoon       |          7 | Labels overlap; chart annotations are clipped.                                 |
| 04   | Quadratic function       |          7 | An opaque rectangle hides the axes.                                            |
| 05   | Projectile               |          8 | Most values are clear; the landing force is drawn at the wrong location.       |
| 06   | Acid–base titration      |          9 | Correct chemistry but clipped labels and callouts hide part of the curve.      |
| 07   | Meiosis                  |          7 | The result relies on small text instead of drawing the chromosome transitions. |
| 08   | Silk routes              |          5 | Six persisted connectors disappear beneath a background shape.                 |
| 09   | Unit-circle trigonometry |          7 | The white unit-circle outline and white titles disappear on fixed white fills. |
| 10   | Collision and energy     |          7 | Dense labels are clipped and a white title disappears.                         |

Mean rubric score: **7.1/10**. Scores measure each case's subject-specific criteria and do not replace a visual review: in particular, case 06 scores highly despite poor readability.

## Paired results

The final round uses canvas revision `b86eb89` and the same prompts, model and viewport as the baseline. Each score is a coordinator's visual judgement, not an automated correctness proof. The two intermediate runs of cases 01 and 02 are retained for transparency but excluded from this table; an additional multiline-label fix was needed before the final round.

| Case | Baseline | Final | Screenshots                                                                                                                                                                     |
| ---- | -------: | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01   |        6 |     6 | [Before](01-literature-moonlit-thought/runs/20261103T213254Z-baseline/screenshot.png) · [After](01-literature-moonlit-thought/runs/20261104T000806Z-final/screenshot.png)       |
| 02   |        8 |    10 | [Before](02-history-modern-china-timeline/runs/20261103T214128Z-baseline/screenshot.png) · [After](02-history-modern-china-timeline/runs/20261104T001201Z-final/screenshot.png) |
| 03   |        7 |     8 | [Before](03-geography-east-asia-monsoon/runs/20261103T214750Z-baseline/screenshot.png) · [After](03-geography-east-asia-monsoon/runs/20261104T001525Z-final/screenshot.png)     |
| 04   |        7 |     7 | [Before](04-math-quadratic/runs/20261103T215201Z-baseline/screenshot.png) · [After](04-math-quadratic/runs/20261104T001841Z-final/screenshot.png)                               |
| 05   |        8 |     9 | [Before](05-physics-projectile/runs/20261103T215526Z-baseline/screenshot.png) · [After](05-physics-projectile/runs/20261104T002219Z-final/screenshot.png)                       |
| 06   |        9 |    10 | [Before](06-chemistry-acid-base-titration/runs/20261103T215841Z-baseline/screenshot.png) · [After](06-chemistry-acid-base-titration/runs/20261104T002620Z-final/screenshot.png) |
| 07   |        7 |     9 | [Before](07-biology-meiosis/runs/20261103T220158Z-baseline/screenshot.png) · [After](07-biology-meiosis/runs/20261104T003052Z-final/screenshot.png)                             |
| 08   |        5 |     9 | [Before](08-humanities-silk-routes/runs/20261103T220602Z-baseline/screenshot.png) · [After](08-humanities-silk-routes/runs/20261104T003449Z-final/screenshot.png)               |
| 09   |        7 |    10 | [Before](09-math-circular-trig/runs/20261103T221103Z-baseline/screenshot.png) · [After](09-math-circular-trig/runs/20261104T003851Z-final/screenshot.png)                       |
| 10   |        7 |     8 | [Before](10-physics-energy-collision/runs/20261103T221705Z-baseline/screenshot.png) · [After](10-physics-energy-collision/runs/20261104T004234Z-final/screenshot.png)           |

Mean: **7.1 → 8.6/10**; eight cases increased and two were unchanged. One independent sample per case and revision cannot establish statistical significance or isolate product effects from agent variability. In case 08 the final agent used lines rather than connectors, so its score increase is not direct evidence of the connector fix; that fix has separate Chrome regression coverage.

## Confirmed product issues

- Connectors are always painted before non-frame objects, so later opaque backgrounds can completely hide valid connections (case 08).
- Rectangle and ellipse `color` means outline rather than fill, but the original documentation does not explain that distinction; the API cannot request a transparent or colored fill (cases 04, 09 and 10).
- Typographic text is clipped to its supplied height; model-generated Chinese labels routinely underestimate that height (cases 02, 03, 06, 08 and 10).
- Fit and selection use stored object bounds, so any solution that makes overflowing text visible must also account for its actual rendered geometry.

The canvas fixes add explicit fill, honor board paint order, preserve connector and transparent-shape interaction, wrap multiline labels, preserve multiline edits, measure overflow for selection and Fit, and account for the dock. API validation and browser regressions cover these behaviors. The history intermediate run exposed the separate shape-label newline defect; it was fixed before all ten final runs.

The subsequent stroke-width follow-up received three independent review passes. Its final review findings were fixed and tested after the third pass; that last revision did not receive another independent review.

## Remaining limits

- Agents can still choose opaque fills, put labels on top of each other, draw unclear figures or make scientifically inconsistent diagrams. The final quadratic and energy cases demonstrate this. Mico does not automatically solve layout or verify subject facts.
- Case 01 still lacks a clear two-pose transition and frost, and its final score matches baseline. The agent initially tried a rectangle/ellipse `strokeWidth` unsupported by the evaluated revision. Follow-up commit `022b022` adds it, with store and Chrome interaction regressions; it was made after the paired runs and is not included in their scores.
- Small labels, crowded annotations and whitespace remain in several final screenshots, even where subject-specific rubric scores are high.

Incorrect factual reasoning, arbitrary layout choices and weak illustration are recorded separately in the assessments; they are not automatically attributed to the drawing engine.
