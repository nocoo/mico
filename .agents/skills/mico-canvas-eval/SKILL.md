---

name: mico-canvas-eval
description: Evaluate Mico's AI canvas using independent coding agents, isolated boards, school-subject drawing tasks, screenshots and before/after comparisons. Use for canvas evaluations, AI drawing benchmarks, or investigating canvas API and rendering usability.
---

# Mico canvas evaluation

Run this workflow from the Mico repository root as the coordinator. The cases in `evals/` are frozen inputs: each `prompt.md` is given to the drawing agent; `rubric.md` is for the coordinator only. Compare the same prompts, model, tools, viewport and scoring rules across revisions. Record any deviation rather than implying a controlled comparison.

## Safety and isolation

- Never use the daily board (`.mico/board.sqlite`, ports 7063/37063) for an evaluation. Do not copy it, clear it or seed it.
- Run one isolated case at a time in the existing Herdr `dev server` tab. Create a fresh private directory with `mktemp -d /tmp/mico-eval-XXXXXX`, then run `pnpm eval:server /tmp/<directory>/board.sqlite` in a foreground shell there. Confirm the empty board at `http://127.0.0.1:57063/api/board` and the canvas at `http://127.0.0.1:27063`. If either port is in use, stop rather than targeting an unknown service.
- Evaluation captures use the isolated loopback URL, not the daily Caddy origin. Never modify shared Caddy, certificates, or other users' processes as part of this workflow.
- Set `MICO_PORT=57063` in the drawing pane. Tell the agent to use only the isolated board, not read `evals/`, not edit the repository, and put temporary scripts in `/tmp`. Give it the exact text of `prompt.md`, without the rubric, answers or layout instructions. Let it independently discover and use the public Mico interface. It may inspect and refine its own work.
- Create a **new interactive coding pane and fresh agent session for every case and every round**. Use the same model and thinking settings each time. Follow the local Herdr rules; close each owned pane after retrieving evidence. Never reuse a drawing session between cases or rounds.

## Run and inspect

1. Record the source revision, case prompt, model/provider, start time, pane/session identity, isolated endpoint and any additional coordinator messages. Start with an empty isolated board.
2. Wait for the agent to finish. Preserve its tool calls, errors, responses and final message as a transcript without image payloads or private reasoning; do not report an infrastructure failure as a drawing result.
3. Create `evals/<case>/runs/<UTC timestamp>-<round>/`. Run `pnpm eval:capture <run-directory>`. This saves `board.json` and a 1440×960 Chrome `screenshot.png`; failure is explicit and should still retain whatever evidence can be captured. Keep the run even when empty or failed. Check that the captured revision and screenshot match and that the browser shows a live connection.
4. Open the screenshot and assess each criterion in `rubric.md`, factual accuracy, visual readability and whether the requested visual information is actually visible. Save a short `assessment.md` with points and concrete evidence. A valid API response is not proof of a good drawing. Note agent friction, rejected operations, rendering defects and whether a failure is in the task, model, API, or renderer; do not infer root cause without evidence.
5. Save metadata and checksums, terminate only the owned fixture in its Herdr pane, remove only its temporary database and cache, and close the drawing pane. Repeat with a fresh fixture and pane for the next case.

## Compare and repair

Complete all 10 baseline cases before changing the canvas implementation. Group reproducible problems, add regression tests, fix root causes with minimal changes and independent review, then rerun the same 10 cases on the repaired revision with fresh panes and boards. Compare paired scores and screenshots per case; discuss model variability and avoid attributing every difference to the code change. Keep failures and non-comparable runs in the report. Commit logical changes and evidence atomically on `main`; never overwrite earlier runs.
