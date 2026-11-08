# MOSS Live two-speaker meeting verification

User-authorized real MOSS sessions, captured on November 8, 2026 UTC. All four attempts used new visible canvases. No existing canvas was cleared, no human microphone was opened, and no drawing was supplied by the recorder. A synthetic MediaStream fed English Edge TTS speech through the application's normal microphone/worklet path only after MOSS reported `Listening`. MOSS itself issued the recorded native canvas calls.

## Result: protocol works; meeting reliability is not accepted

| Attempt | Input | Tool calls / results / continuations | Provider failed responses | Outcome |
| --- | --- | --- | ---: | --- |
| 1 | Continuous 178-second two-speaker meeting | 3 / 3 / 3 | 1 | Initial symptom notes and empty category placeholders; later decisions and assignments not captured. |
| 2 | Same audio; added persistent meeting-task instructions | 3 / 3 / 3 | 0 | Skeleton board only; subsequent speech did not produce further updates. Absence of provider errors was not success. |
| 3 | 168-second guided discussion, explicit checkpoints, registered assistant name/alias | 4 / 4 / 4 | 2 | Captured symptoms and an option comparison, but omitted final decisions/owners and misattributed a speaker as Amit. |
| 4 | Same guided script; wait between each participant turn | 5 / 5 / 5 | 10 | Captured context, diagnosis and options, but no complete final decision/action summary. Several notes were also clipped. |

Every continued call had a matching server `conversation.item.created` acknowledgement and a successful local tool HTTP result. Attempt 4 additionally retained audio-context and playback receipts; completed speech had actual playback acknowledgements. Later `response.ended` failures contained run/turn IDs but no detailed error or status information. This verifies the repaired client continuation path, not the reason for the remaining provider failures. Recognition, turn scheduling and model behavior remain possible contributors; there is no evidence sufficient to assign a definitive internal cause.

No MAI/Chat fallback, manual note completion, or fabricated successful ending was used. Four attempts were stopped rather than continuing unbounded paid retries.

## Changes and evidence

- `5f1afd1`: clarify the difference between interrupting a spoken response and ending a standing meeting task; honor silent note-taking; discourage empty category placeholders. This did not by itself establish reliable meeting capture.
- `194f308`: register the documented `persona.name` and aliases (`Mico`, `Miko`) for address recognition, without supplying meeting-specific answers.
- Unit/integration suite: 279 passed. MOSS browser suite: 6 passed. Scoped Biome and build passed. These remain separate from real-service acceptance.

`runs.json` records canvas IDs, actual tool results and provider failure IDs. `attemptN-board.json` preserves each board. `last-live.png` and `last-board.png` show the final partial result. Raw event streams and media remain in the `recordingDirectory` paths recorded in `runs.json`.

## Second video

Delivered to `/Users/nocoo/Downloads/Mico-MOSS-Live-Technical-Meeting.mp4`:

- 1920 × 1080, 25 fps, H.264 + stereo AAC, 398.44 seconds.
- Two synthetic participants: Maya, staff engineer (`en-US-AriaNeural`), and Daniel, SRE (`en-US-GuyNeural`). Fictional checkout incident; see `guided-transcript.txt`.
- Captures participant speech plus MOSS's actual audio output. Original timing is retained, including pauses and visible failures. The video is labelled **Partial result**; it is not a successful promotional demo.
- Audio timing was aligned using an explicit visual/audio marker, then verified against the first and final participant turns. Timestamp gaps in MediaRecorder audio were restored using asynchronous resampling. The calibration tone and 16px visual marker were removed in the final encode.
- Full MP4 decode and stream dimensions/codecs verified. SHA-256: `bed99610f3e33d1a4958420eab296b8a81a2054c36b6ff7034b4e12cf2d6a457`.
