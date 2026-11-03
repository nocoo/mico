# Canvas evaluation

These cases exercise whether an independent coding agent can turn a natural-language school assignment into a readable Mico board. Each `prompt.md` is given verbatim to a fresh agent; its `rubric.md` is reserved for the coordinator. Every run has an isolated SQLite board, a Chrome screenshot, a board export, an agent transcript, a scored assessment and checksums. The workflow is in `.agents/skills/mico-canvas-eval/SKILL.md`.

## Baseline

All ten baseline drawings used the same canvas implementation at `66c3a72`, provider `magpie`, model `group/coding`, high thinking, and a 1440 × 960 Chrome viewport. The fixture and rubric corrections are recorded in each run's metadata. A single run per case is not enough to separate product effects from model variability; paired reruns are indicative, not a statistical guarantee.

| Case | Subject | Score / 10 | Key observation |
| --- | --- | ---: | --- |
| 01 | Literature illustration | 6 | Overlapping strokes and weak contrast obscure the intended scene. |
| 02 | Modern Chinese history | 8 | Event text is clipped or overlaps. |
| 03 | East Asian monsoon | 7 | Labels overlap; chart annotations are clipped. |
| 04 | Quadratic function | 7 | An opaque rectangle hides the axes. |
| 05 | Projectile | 8 | Most values are clear; the landing force is drawn at the wrong location. |
| 06 | Acid–base titration | 9 | Correct chemistry but clipped labels and callouts hide part of the curve. |
| 07 | Meiosis | 7 | The result relies on small text instead of drawing the chromosome transitions. |
| 08 | Silk routes | 5 | Six persisted connectors disappear beneath a background shape. |
| 09 | Unit-circle trigonometry | 7 | The white unit-circle outline and white titles disappear on fixed white fills. |
| 10 | Collision and energy | 7 | Dense labels are clipped and a white title disappears. |

Mean rubric score: **7.1/10**. Scores measure each case's subject-specific criteria and do not replace a visual review: in particular, case 06 scores highly despite poor readability.

## Confirmed product issues

- Connectors are always painted before non-frame objects, so later opaque backgrounds can completely hide valid connections (case 08).
- Rectangle and ellipse `color` means outline rather than fill, but the original documentation does not explain that distinction; the API cannot request a transparent or colored fill (cases 04, 09 and 10).
- Typographic text is clipped to its supplied height; model-generated Chinese labels routinely underestimate that height (cases 02, 03, 06, 08 and 10).
- Fit and selection use stored object bounds, so any solution that makes overflowing text visible must also account for its actual rendered geometry.

Incorrect factual reasoning, arbitrary layout choices and weak illustration are recorded separately in the assessments; they are not automatically attributed to the drawing engine.
