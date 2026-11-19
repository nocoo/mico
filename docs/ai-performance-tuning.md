# AI Latency Tuning & Reproducible Benchmarking

Real-time Audio and Live sessions feed speech segments while the speaker talks and trigger `[Post-session summary]` automatically after the final transcript settles. The operational target is **`catchUpAfterEndMs <= 30,000 ms`** — the board must finish draining all trailing transcript turns and post-session reconciliation within 30 seconds of session end without sacrificing 4-column alignment or multi-topic coverage.

## 1. Baseline Root Causes (173.4s Catch-Up)

Before tuning, an unmodified 5.4-minute 3-topic session (`c15-architecture-tradeoffs`, `324 s`) on `auto/gpt-6.1-sol` required **`173,365 ms`** after playback ended (`125,247 ms` trailing queue drain + `32,642 ms` in-flight spill + `15,476 ms` summary):

1. **Slow default gateway model**: `auto/gpt-6.1-sol` averaged **`47,243 ms`** per lecture turn (`94,109 ms` p95) against ~6–10 s speech segment arrival intervals, building a **`13`-batch queue backlog**.
2. **Serial multi-step tool loops**: turns averaged **`4.70` steps** (inspect → notes → boxes → connectors sequentially), with `stopWhen` set to `40` steps.
3. **100% prefix KV-cache invalidation on summary**: `[Post-session summary]` was sent with `mode: 'chat'`, switching static system instructions, expanding the tool schema from `11` lecture tools to `13` chat tools, and forcing `reasoningEffort: 'low'`.
4. **Oversized hot compaction window**: client and server compaction defaulted to `hotMin = 12, chunkSize = 16`, retaining up to `27` unarchived messages (`41,875` model bytes at turn 120 before tuning).
5. **Uncoalesced fillers in Audio playback**: standalone low-signal acknowledgements consumed whole AI round-trips during recorded playback (`useLessonViewModel.ts`), unlike Live MAI microphone capture (`useMicrophoneViewModel.ts`).

## 2. Implemented Optimizations & Default Contract

- **KV-prefix preservation & model routing** ([`src/server/ai.ts`](../src/server/ai.ts), [`src/server/index.ts`](../src/server/index.ts)): `isPostSessionSummaryRequest` keeps `[Post-session summary]` on `promptMode = 'lecture'` (identical static instructions and 11-tool surface) and defaults `summaryReasoning` to `lectureReasoning`. Optional `MAGPIE_SUMMARY_MODEL` and `MAGPIE_SUMMARY_REASONING` (`omit` supported for providers without reasoning-effort support) allow independent summary overrides when explicitly benchmarking.
- **Single-step parallel tool batching & step caps** ([`src/server/aiPrompt.ts`](../src/server/aiPrompt.ts), [`src/shared/summaryPrompt.ts`](../src/shared/summaryPrompt.ts), [`src/server/ai.ts`](../src/server/ai.ts)): lecture and summary instructions direct the model to batch independent creations/updates in a single parallel step using the attached `# Current canvas` snapshot instead of redundant `get_board` polling; `stopWhen` bounds lecture turns to `6` steps / `8` tool calls and summary turns to `8` steps (`40` retained for interactive `chat`).
- **Synchronized `8 / 12` chunk-aligned compaction** ([`src/shared/conversationCompact.ts`](../src/shared/conversationCompact.ts), [`src/server/aiConfig.ts`](../src/server/aiConfig.ts)): both client (`useAssistantSession.ts`) and server (`MICO_LECTURE_HOT_MIN = 8`, `MICO_LECTURE_CHUNK_SIZE = 12`, configurable in `4..64`) default to `8 / 12`.
- **Audio filler coalescing** ([`src/web/frame/assistant/protocol.ts`](../src/web/frame/assistant/protocol.ts), [`src/web/frame/assistant/useLessonViewModel.ts`](../src/web/frame/assistant/useLessonViewModel.ts)): `isLowSignalSegment` includes Japanese fillers alongside EN/ZH acknowledgements; `useLessonViewModel` coalesces standalone fillers into the next substantive segment and flushes any terminal buffer via `rt.activeClip` in `finish()`.
- **Locked local default**: `DEFAULT_CHAT_MODEL = 'auto/gpt-6-sol'`, `lectureReasoning = 'none'`, `summaryReasoning = 'none'`, `hotMin = 8`, `chunkSize = 12` ([`ai-configuration.md`](ai-configuration.md)).

## 3. Reproducible 3-Tier Testing Methodology

### Isolation & Experimental Controls

1. **Never target daily state**: all harnesses run against ephemeral `mkdtempSync` SQLite databases and temporary `settings.json` paths (`~/.config/mico/settings.json` and `.mico/board.sqlite` are bypassed so user-saved settings cannot contaminate comparisons).
2. **Sequential execution (`concurrency = 1`)**: run live provider benchmarks one configuration at a time. Parallel benchmark runs contend on the same local Magpie gateway (`127.0.0.1:3425/v1`) and inflate turn timings.
3. **Explicit provider authorization**: Tier 2 and Tier 3 incur live API usage and refuse to boot unless `--confirm-provider-usage` is passed.

### Tier 1 — Deterministic Offline Pipeline Audit (`L1–L5`)

Verifies schema budgets, prefix stability, 180-shape anchor compression, 120-turn chunk alignment, adaptive queue bounds, and multi-topic prompt invariants offline in `< 1 s`:

```sh
node scripts/ai-pipeline-eval.ts --json
node scripts/run-tests.ts unit
node scripts/run-tests.ts integration
```

Key gates in [`evals/cases/layered-eval-suite.json`](../evals/cases/layered-eval-suite.json):

| Layer | Metric                                 | Threshold  | Purpose                                                         |
| ----- | -------------------------------------- | ---------- | --------------------------------------------------------------- |
| L1    | `activeLectureNoImageSchemaBytes`      | `<= 15500` | Keep active lecture tool definitions compact                    |
| L2    | `systemPromptInvariantAcrossRevisions` | `true`     | Guarantee byte-identical static prefix across board edits       |
| L2    | `boardContext180ShapesBytes`           | `<= 15000` | Keep `# Current canvas` digest bounded while retaining anchors  |
| L3    | `turn120ModelBytes`                    | `<= 45000` | Cap compacted 120-turn model payload (`40,627` bytes at `8/12`) |
| L3    | `turn120CacheablePrefixRatio`          | `>= 0.72`  | Verify chunk boundary alignment (`0.9751` at `8/12`)            |

`compactUiMessages` archives `Math.floor((total - hotMin) / chunkSize) * chunkSize` messages. With `hotMin = 8, chunkSize = 12`, turns `99` (`197` messages) and `100` (`199` messages) both archive `180` messages, and turns `119` (`237` messages) and `120` (`239` messages) both archive `228` messages — keeping the shared archived prefix + hot head byte-identical across nearby turns (`turn100CacheablePrefixRatio = 0.9802`, `turn120CacheablePrefixRatio = 0.9751`).

### Tier 2 — Virtual-Clock Arrival-Queue & Catch-Up Benchmark (`scripts/audio-latency-bench.ts`)

Measures real LLM turn latency under simulated real-time speech arrival against an isolated `port: 0` daemon (`createDaemon`) with 90 s per-request timeout protection:

- **Timing model**: lines from the case transcript are distributed proportionally over `public/evals/manifest.json` `duration` (or estimated via `zh = 3.5`, `ja = 6.0`, `en = 14.5 chars/s`). Optional filler coalescing (`--coalesce-fillers`, default `true`) mirrors `useLessonViewModel`.
- **Queue drain model**: each iteration dispatches `takeLectureBatch` (`< 4` queued: up to `3` items / `1200` chars; `>= 4`: `6` / `2400`; `>= 8` or `flushAll`: `8` / `3200`) over `/api/ai/chat`, advances `clock += elapsedMs / 1000`, enqueues segments ready by `clock`, then runs `[Post-session summary]`.
- **Primary metric**:

```text
catchUpAfterEndMs = inFlightSpillMs + postEndDrainMs + summaryMs
```

| Flag                           | Default                       | Description                                                                             |
| ------------------------------ | ----------------------------- | --------------------------------------------------------------------------------------- |
| `--confirm-provider-usage`     | required                      | Guard before contacting the configured gateway                                          |
| `--case <id>`                  | `c15-architecture-tradeoffs`  | Fixture ID (`c15-architecture-tradeoffs`, `c14-quarterly-product-review`, etc.)         |
| `--model <id>`                 | `loadAiConfig` default        | Override `MAGPIE_MODEL` for lecture turns (and summary unless `--summary-model` is set) |
| `--summary-model <id>`         | same as `--model`             | Override `MAGPIE_SUMMARY_MODEL` for `[Post-session summary]` only                       |
| `--lecture-reasoning <effort>` | `none`                        | Override `MAGPIE_LECTURE_REASONING` (`none`, `minimal`, `low`, `medium`, `omit`)        |
| `--summary-reasoning <effort>` | same as lecture               | Override `MAGPIE_SUMMARY_REASONING`                                                     |
| `--hot-min <int>`              | `12` in harness (`8` default) | Explicit `--hot-min` & `--chunk-size` override `compactUiMessages` and server bounds    |
| `--chunk-size <int>`           | `16` in harness               | Compaction chunk size                                                                   |
| `--coalesce-fillers <bool>`    | `true`                        | Disable (`false`) to measure pre-coalescing baseline behavior                           |
| `--out <path>`                 | omitted                       | Write full JSON report (per-turn timings, layout metrics, `BoardRubricEvaluation`)      |

Reproducible comparison commands (run sequentially into a directory outside Git, e.g. `/tmp/mico-bench`):

```sh
# 1. Baseline ablation on the legacy local model (without coalescing, legacy 12/16 window)
node scripts/audio-latency-bench.ts --confirm-provider-usage \
  --case c15-architecture-tradeoffs --model auto/gpt-6.1-sol \
  --lecture-reasoning none --summary-reasoning none --hot-min 12 --chunk-size 16 \
  --coalesce-fillers false --out /tmp/mico-bench/baseline.json

# 2. Winning configuration — 3-topic 5.4-min session (c15)
node scripts/audio-latency-bench.ts --confirm-provider-usage \
  --case c15-architecture-tradeoffs --model auto/gpt-6-sol \
  --lecture-reasoning none --summary-reasoning none --hot-min 8 --chunk-size 12 \
  --out /tmp/mico-bench/c15-gpt6sol-8-12.json

# 3. Winning configuration — 5-topic 14.6-min stress session (c14)
node scripts/audio-latency-bench.ts --confirm-provider-usage \
  --case c14-quarterly-product-review --model auto/gpt-6-sol \
  --lecture-reasoning none --summary-reasoning none --hot-min 8 --chunk-size 12 \
  --out /tmp/mico-bench/c14-gpt6sol-8-12.json
```

### Tier 3 — Real-Browser Audio + Real Azure MAI End-to-End Verification (`scripts/verify-real-audio.ts`)

Tier 2 replays ground-truth transcript segments; Tier 3 validates the complete browser pipeline using a real MP3 recording, WebAudio 16 kHz resampling, `SilenceSegmenter`, real Azure MAI streaming (`/mai/realtime` via `maiRealtimeProxy`), React state transitions (`useLessonViewModel` / `useAssistantSession`), and sandboxed `.mico-*` iframe rendering.

Because `src/shared/config.ts` validates browser `Origin` against `ALLOWED_ORIGINS`, `verify-real-audio.ts` binds its isolated Vite dev server to `E2E_PORT` (`127.0.0.1:17063`, unused by daily `7063` and Playwright `27063`) and proxies `/api` to an ephemeral `port: 0` daemon backed by `mkdtempSync` storage. Requires valid `AZURE_MAI_HOST`, `AZURE_OPENAI_API_KEY`, and `AZURE_OPENAI_DEPLOYMENT` in `.env` plus `--confirm-provider-usage`:

```sh
node scripts/verify-real-audio.ts --confirm-provider-usage \
  --clip c13-microsoft-outlook \
  --model auto/gpt-6-sol --lecture-reasoning none --summary-reasoning none \
  --hot-min 8 --chunk-size 12 --max-catch-up-ms 30000 \
  --screenshot /tmp/mico-real-audio.png --out /tmp/mico-real-audio.json
```

`realBrowserCatchUpMs` measures elapsed time from `.lesson[data-phase="done"]` (`Recording complete`) until the `[Post-session summary]` response completes and `.ai-status-pill[data-state="idle"]` displays `Mico is ready` with zero queued segments.

## 4. Empirical Results & Ablation Conclusions

### `c15-architecture-tradeoffs` (3 Topics, 324 s)

| Run                  | Model / Summary         | Lec / Sum Reasoning | Window     | Catch-Up (ms) | Avg Turn (ms) |  p95 (ms) | Summary (ms) | Shapes | Actions | Tool Errs | Rubric   |
| -------------------- | ----------------------- | ------------------- | ---------- | ------------: | ------------: | --------: | -----------: | -----: | ------: | --------: | -------- |
| Baseline (unopt)     | `auto/gpt-6.1-sol`      | `none` / `none`     | `12/16`    |       173,365 |        47,243 |    94,109 |       15,476 |     60 |       6 |         0 | Pass     |
| Opt pipeline only    | `auto/gpt-6.1-sol`      | `none` / `none`     | `6/8`      |        35,238 |         8,188 |    12,152 |       11,237 |     78 |       5 |         0 | Pass     |
| `gpt-6-luna` std     | `auto/gpt-6-luna`       | `none` / `none`     | `12/16`    |        29,896 |        11,326 |    16,894 |       11,135 |    114 |       3 |         0 | Pass     |
| `gpt-6-luna` tight   | `auto/gpt-6-luna`       | `none` / `none`     | `6/8`      |        25,563 |         9,127 |    16,006 |       13,658 |     62 |       4 |        11 | Pass     |
| `gpt-6-sol` tight    | `auto/gpt-6-sol`        | `none` / `none`     | `6/8`      |        13,145 |         5,964 |     8,650 |        6,755 |     90 |       4 |         0 | Pass     |
| **Default winner**   | **`auto/gpt-6-sol`**    | **`none` / `none`** | **`8/12`** |    **17,823** |     **5,284** | **8,852** |    **9,833** | **82** |   **4** |     **0** | **Pass** |
| Hybrid switch        | `luna` → `gpt-6-sol`    | `none` / `low`      | `6/8`      |        30,691 |        10,440 |    17,643 |        5,375 |     67 |       4 |         4 | Pass     |
| Hybrid `gpt-6.2-sol` | `luna` → `gpt-6.2-sol`  | `none` / `minimal`  | `6/8`      |       267,263 |        24,110 |    30,900 |       20,397 |     70 |       4 |         3 | Pass     |
| Group Mico           | `group/mico`            | `none` / `none`     | `6/8`      |        26,204 |         7,726 |    12,110 |        9,360 |     77 |       4 |         1 | Pass     |
| Haiku omit           | `auto/claude-haiku-5-5` | `omit` / `omit`     | `6/8`      |        24,068 |         5,124 |     9,299 |        6,514 |     74 |       4 |         0 | Pass     |

### `c14-quarterly-product-review` (5 Topics, 876.6 s Stress Test)

| Run                 | Model                   | Lec / Sum Reasoning | Window     | Catch-Up (ms) | Avg Turn (ms) |  p95 (ms) | Summary (ms) |  Shapes | Topics | Actions | Tool Errs | Overlaps | Rubric   |
| ------------------- | ----------------------- | ------------------- | ---------- | ------------: | ------------: | --------: | -----------: | ------: | -----: | ------: | --------: | -------: | -------- |
| **Default winner**  | **`auto/gpt-6-sol`**    | **`none` / `none`** | **`8/12`** |    **23,632** |     **5,613** | **9,471** |   **10,100** | **174** |  **5** |  **14** |     **1** |    **0** | **Pass** |
| `6/8` tight window  | `auto/gpt-6-sol`        | `none` / `none`     | `6/8`      |        32,523 |         5,269 |     8,664 |       17,999 |     157 |      5 |      12 |         0 |        0 | Pass     |
| Summary `low`       | `auto/gpt-6-sol`        | `none` / `low`      | `8/12`     |        40,258 |         5,366 |     9,146 |       21,732 |     170 |      5 |      10 |         0 |        0 | Pass     |
| `gpt-6-luna` `8/12` | `auto/gpt-6-luna`       | `none` / `none`     | `8/12`     |        42,121 |         9,660 |    16,250 |       23,401 |     157 |      5 |      10 |         7 |        2 | Fail     |
| `claude-haiku-5-5`  | `auto/claude-haiku-5-5` | `omit` / `omit`     | `8/12`     |         607\* |         1,829 |     7,604 |        304\* |      49 |      1 |       3 |         0 |        0 | Fail     |

\* `auto/claude-haiku-5-5` failed repeatedly with upstream `AI request failed` errors under 114 sustained lecture turns.

### Tier 3 Real Browser Run (`c13-microsoft-outlook`, 175.3 s Audio, Real MAI)

- `audioPlaybackMs`: **178,613 ms**
- `realBrowserCatchUpMs`: **13,689 ms** (`summaryRequestElapsedMs`: **7,893 ms**)
- `lectureChatCalls` / `summaryChatCalls` / `failedChatStatuses`: **29 / 1 / `[]`**
- `layout`: `62` shapes, `3` Col-3 stage cards (`stageCardsAtCol3Ratio = 1`), Col-4 executive overview + empty action card (`0` invented items, `col4Aligned = true`).

### Reproducible Engineering Conclusions

1. **Same-model continuity outweighs model switching**: switching models for `[Post-session summary]` (`luna → gpt-6-sol`, `luna → gpt-6.2-sol`) drops the Magpie KV prefix cache and hurts total catch-up (`30.7 s` and `267.3 s`).
2. **`auto/gpt-6-sol` outperforms `auto/gpt-6-luna` in both latency and geometry**: on `c14`, `gpt-6-sol` ran nearly 2x faster (`5,613 ms` / `1.94` steps vs `9,660 ms` / `2.52` steps) with `0` overlaps, whereas `gpt-6-luna` exceeded `42 s` catch-up and failed rubric (`7` tool errors, `2` overlaps).
3. **`8 / 12` avoids the summary re-read cliff of `6 / 8`**: on 15-minute `c14`, `6 / 8` trimmed recent tool receipts too aggressively, forcing the summary step to spend `17,999 ms` inspecting the board (`32,523 ms` total catch-up). `8 / 12` retained enough hot context for a `10,100 ms` summary (`23,632 ms` total catch-up).
4. **Extra summary reasoning (`low`) slows closeout without improving board quality**: `summaryReasoning = low` doubled summary duration (`10.1 s → 21.7 s`, `40.3 s` total catch-up) while scoring the same `c14` rubric facts.

## 5. Checklist When Evaluating a New Model

1. Run Tier 1 (`node scripts/ai-pipeline-eval.ts --json`) after any prompt or compaction edit and verify `turn120ModelBytes <= 45000` and `turn120CacheablePrefixRatio >= 0.72`.
2. Probe Tier 2 on `c15-architecture-tradeoffs` first to eliminate models above `30,000 ms` or with high `toolErrors`.
3. Validate finalists on 15-minute `c14-quarterly-product-review` (`catchUpAfterEndMs <= 30,000 ms`, `rubric.passed === true`, `overlapPairs === 0`).
4. Confirm real MP3 + MAI streaming + browser rendering end-to-end with `scripts/verify-real-audio.ts --confirm-provider-usage`.
