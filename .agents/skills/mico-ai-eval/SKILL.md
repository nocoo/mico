---

name: mico-ai-eval
description: Run and analyze Mico's layered AI pipeline evaluation (L1 tool schemas and concurrency, L2 static KV-cache prefix and anchor-preserving board digest, L3 chunk-aligned long-session compaction, L4 Live VAD and adaptive queue lag, L5 multi-topic swimlanes and summary rubrics). Use for AI prompt tuning, tool optimization, long-session latency benchmarking, or multi-topic summary validation.
---

# Mico AI pipeline evaluation

Use this skill to measure and compare Mico's AI drawing pipeline across layers **L1–L5** before and after changes to tools, prompts, board digests, conversation compaction, VAD/queueing, or multi-topic summary behavior.

For agent HTTP/CLI canvas drawing benchmarks and screenshot reviews, use `.agents/skills/mico-canvas-eval/SKILL.md`.

## Safety and isolation

- **Never point tests or evals at `.mico/board.sqlite` or daily ports (`7063`, `37063`).**
- Offline evals (`pnpm eval:ai`, `pnpm test:unit`, `pnpm test:integration`) use isolated `mkdtempSync` SQLite databases, ephemeral `port: 0` daemons, and deterministic `MockLanguageModelV4` / simulation harness checks with zero provider cost.
- Live provider replay (`--live`) **incurs real LLM API usage** and requires **explicit user authorization** and both `--case <id>` and `--confirm-provider-usage` flags. Without `--confirm-provider-usage`, the script exits non-zero before booting a daemon or reading provider credentials.

## Quick commands

Run from the repository root (`Node >= 24` / `26.13.0`):

```sh
# Run all deterministic offline L1-L5 metrics (JSON output)
node scripts/ai-pipeline-eval.ts --json

# Run a single layer
node scripts/ai-pipeline-eval.ts --layer L1 --json
node scripts/ai-pipeline-eval.ts --layer L2 --json
node scripts/ai-pipeline-eval.ts --layer L3 --json
node scripts/ai-pipeline-eval.ts --layer L4 --json
node scripts/ai-pipeline-eval.ts --layer L5 --json

# Verify unit + integration suites including layered target thresholds
node scripts/run-tests.ts unit
node scripts/run-tests.ts integration

# Authorized live provider replay against multi-topic or single-topic fixtures (explicit permission required)
node scripts/ai-pipeline-eval.ts --live --case c14-quarterly-product-review --confirm-provider-usage

# Authorized live Audio-mode arrival-queue & post-meeting catch-up benchmark (30s catchUpAfterEndMs budget)
node scripts/audio-latency-bench.ts --confirm-provider-usage --case c15-architecture-tradeoffs --model auto/gpt-6-sol --lecture-reasoning none --summary-reasoning none --hot-min 8 --chunk-size 12
```

## Layered metric contract

Thresholds live in [`evals/cases/layered-eval-suite.json`](../../../evals/cases/layered-eval-suite.json) and are asserted by [`scripts/ai-pipeline-eval.test.ts`](../../../scripts/ai-pipeline-eval.test.ts).

| Layer                        | Key metrics                                                                                                                                                 | Target / invariant                                                                                                                                                                                                                                                        |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **L1** Tools & Card CSS      | `allToolsCount`, `activeLectureNoImageSchemaBytes`, `parallelChainSucceeded`, `geometryReceiptPresent`, `htmlCardRuntimeCssInjected`                        | `activeLectureNoImageSchemaBytes <= 15500`; parallel same-step calls serialize cleanly; `created`/`updated` return geometry (`x,y,w,h`); `htmlCardDocument` injects `.mico-*` CSS at runtime.                                                                             |
| **L2** KV Prefix & Digest    | `systemPromptInvariantAcrossRevisions`, `boardContext180ShapesBytes`, `anchorsRetainedAt180Shapes`                                                          | System `instructions` remain byte-identical across board revisions (`# Current canvas` attaches only to the last user turn); 180-shape board keeps `frame`/`html`/`actions`/title anchors in `<= 15000` bytes.                                                            |
| **L3** Long Sessions         | `turn105AcceptedWithoutHttp400`, `turn120AcceptedWithoutHttp400`, `turn120ModelBytes`, `turn120CacheablePrefixRatio`                                        | Up to `1200` UI messages accepted; `chunkSize = 12`, `hotMin = 8` compaction keeps `turn120ModelBytes <= 45000` and `turn120CacheablePrefixRatio >= 0.72`.                                                                                                                |
| **L4** Live VAD & Queue      | `liveMicDefaultSilenceMs`, `audioPlaybackDefaultSilenceMs`, `coalescedFillerCount`, `maxQueueDepth`, `p95DrawingLagMs`, `summaryRecoveredAfterLectureError` | Live mic defaults to `900 ms` (`audioPlaybackDefaultSilenceMs = 500`); standalone fillers coalesce into substantive turns; adaptive batching (`3/6/8`) caps `maxQueueDepth <= 12` and `p95DrawingLagMs <= 38000`; post-session summary recovers from lecture-turn errors. |
| **L5** Multi-Topic Swimlanes | `promptAllowsMultipleTopicCards`, `promptDefinesTopicTransitionTrigger`, `promptNoSingletonSummaryLock`, `promptRequiresConditionalExecutiveCard`           | All `true`: vertical Topic Swimlanes (`topic-card-<slug>`), closeout triggered on topic transition, no `"exactly one prominent HTML summary"` lock, conditional `executive-summary` only when `>= 2` topics exist.                                                        |

## Case fixtures and board rubric

[`evals/cases/layered-eval-suite.json`](../../../evals/cases/layered-eval-suite.json) defines rubrics scored by `evaluateBoardAgainstRubric`:

- `c12-service-incident` (`zh`, single-topic incident review): 1 swimlane + 1 topic card + `0` executive cards + action items.
- `c13-microsoft-outlook` (`en`, single-topic financial outlook): 1 swimlane + 1 topic card + `0` executive cards.
- `c14-quarterly-product-review` (`zh`, 118 lines, 5 agenda topics, Topic-1 trap cue, Topic-2 revisit, spoken fillers): 5 distinct `topic-card-<slug>` cards + `1` `executive-summary` + global `actions` checklist (`>= 4` items).
- `c15-architecture-tradeoffs` (`en`, 45 lines, 3 topics, Topic-2 revisit, fillers): 3 `topic-card-<slug>` cards + `1` `executive-summary` + global `actions` (`>= 2` items).

## Interpreting and comparing runs

1. Always capture a clean baseline (`node scripts/ai-pipeline-eval.ts --json > baseline.json`) before modifying any layer.
2. When optimizing tool schemas or system prompts, check `L3.turn120ModelBytes` and `L3.turn120CacheablePrefixRatio` alongside `L1`/`L2` so prompt additions do not break the 120-turn token budget or prefix stability.
3. For `--live` runs, inspect the printed `BoardRubricEvaluation` counts (`topicCards`, `duplicateTopicCards`, `executiveCardMatch`, `overlapPairs`, `frameOverlapPairs`, `outsideFrameShapes`, `keyFactMatchRatio`). Never relax rubric thresholds or mock assertions to force green results.
