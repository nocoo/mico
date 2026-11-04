# Emergency handover — round 1 baseline

- Input: `evals/cases/c11-er-handover.zh.txt` (19 sentences, all fictional).
- Product revision: `cd7c63d`; model: `auto/gpt-6.1-sol`; daemon: the user's existing development daemon, with the user's explicit authorization to create a new canvas for viewing. No other canvas content was intentionally modified.
- Canvas: `急诊交接 · 第1轮 · 20261104T232221908Z` (`50fc2c77-4c8b-4941-85e5-9564b1146b5d`).
- The delegated runner started the baseline earlier than instructed; it completed before any product changes. Its automatic active-canvas restoration was unintended; the round-one canvas was reactivated for capture. The runner is being corrected before round two.
- Results: all 19 sentences plus the same automatic post-session summary used by the app completed; no timeouts or failed tools. Final revision 20, 16 objects, including one HTML card.
- Start: the first title is at (80, 64), underneath the top-left identity panel at the initial 1:1 viewport. The fit-view screenshot alone does not demonstrate initial occlusion; coordinates and the first tool call do.
- Updates: six `update_shapes` calls correctly revise earlier beds, including the later 1-bed oxygen, A3 laboratory result, B5 temperature, and 2-bed family update. Round one does not support a claim that the model always creates duplicates.
- Grouping: A and B beds share the same column without distinct ward boundaries; there are no frames. Follow-up notes for the resuscitation beds are separate from their bed notes.
- Summary: the final HTML card is separate from other objects and does not overflow its measured iframe (1824 × 950 content). It contains 766 text characters and no SVG icons; the six-row table is dense and uses Mico's palette rather than a clinical visual hierarchy. The screenshot is a fit view, not evidence that the whole card is readable at that zoom.
- Artifacts: `transcript.jsonl` (complete per-turn requests, tool calls and responses), `final-board.json`, and the 1440 × 960 `screenshot.png`. Each turn used `mode: lecture` with the same pinned canvas id; the final automatic summary used `mode: chat`. Timestamps in the synthetic segment envelope are fixed at `0:00–0:00` in both rounds.

One run per revision is illustrative, not a statistically controlled model comparison.
