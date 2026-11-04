# Live-session evaluation rounds

Real-data runs against the daily daemon. Each case creates a fresh canvas named `R<round>-C<nn> <title>`; the user's previously active canvas is restored after every round. The script feeds the original script sentence by sentence (no audio playback, no STT network) through `/api/ai/chat` in `lecture` mode, then requests a post-session HTML summary.

## Commands

```sh
node scripts/run-ai-cases.ts <round> [caseIds]
node scripts/analyze-round.ts <round>
node scripts/capture-round.ts <round>
```

Artifacts per round: `<case>.json` (per-segment replies, tools and errors), `summary.json`, `analysis.json`, `ANALYSIS.md`, and `shots/<case>.png`.

## Rounds

| Round | Canvas prefix | Segments | Shapes | HTML cards | Tool errors | Content overlaps | Frame escapes | WAIT | Summary cards |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | `R1-…` | 130 | 365 | 11 | 7 | 12 | 7 | 0 | 10/10 |
| 2 | `R2-…` | 130 | 295 | 18 | 2 | 0 | 0 | 0 | 10/10 |
| 3 | `R3-…` | 130 | 253 | 18 | 6 | 4 | 0 | 1 | 10/10 |

Round 1 exposed vertical sprawl, duplicate ids, frame escapes, a note-color schema rejection and summaries that were not consistently placed. Round 2 added the two-column layout contract, `get_board` warnings, note-color mapping and post-session summary handling. Round 3 added a hard two-column live layout bound, width limit, upsert-on-duplicate-id and larger HTML/text tool limits; it also stopped live segments from creating a session summary.

Remaining round-3 issues: one case (c09, the Japanese restaurant launch) still has four content overlaps, and six tool calls hit the new layout limits before the model recovered. `WAIT` is now exercised once. The large architecture case (c03) reached a readable 40% fit with a proper left/right layout; c09 reached about 33% with three note columns and a bottom summary.

## Cases

| ID | Lang | Duration | Subject |
| --- | --- | ---: | --- |
| c01-family-trip | zh | 4:18 | Family travel plan |
| c02-product-sprint | en | 4:55 | Sprint planning |
| c03-ai-platform | zh | 3:54 | AI whiteboard architecture |
| c04-factory-q3 | zh | 3:46 | Factory quarterly plan |
| c05-er-handover | ja | 4:48 | ER handover |
| c06-science-fair | en | 5:00 | Science fair planning |
| c07-incident-postmortem | en | 4:57 | Payment outage postmortem |
| c08-community-center | zh | 4:22 | Community center budget |
| c09-restaurant-launch | ja | 4:55 | Restaurant menu launch |
| c10-disaster-drill | ja | 4:54 | Disaster drill |
