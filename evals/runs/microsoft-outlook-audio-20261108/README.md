# Microsoft earnings Audio evaluation

Five sequential real Audio playbacks on the user-authorized daily canvas, November 8, 2026. Each run created and activated a new named canvas; existing canvases were not deleted. These were not isolated tests or controlled A/B comparisons. The same 175.3-second Edge TTS recording was played at 1× with a 500 ms silence cut. Azure MAI performed actual transcription and the configured Magpie model `auto/gpt-6.1-sol` made real drawing calls. The narration is a paraphrase; its [script and primary sources](../../cases/c13-microsoft-outlook.sources.md) distinguish reported results from forward guidance.

Audio SHA-256: `72bc09077dc9470045175d4accc80dd7db4e8e4157ef42b811c50adfad50f3d2`.

| Round | Canvas ID | Transcripts | AI requests | Shapes | Auto summary | Observation |
| --- | --- | ---: | ---: | ---: | --- | --- |
| 1 | `6c23da6e-4215-4121-8067-801141d22a65` | 32 | 14 | 57 | No | Real MAI server event IDs were mistaken for client request IDs; the recording remained stuck finishing. The model had already created a summary during the wrap-up. |
| 2 | `ee8be1be-c130-486a-874d-43a518484b0c` | 32 | 17 | 43 | Yes | Playback and summary completed. Two updated notes had saturated fills after a pale-color schema rejection. The summary content needed 1224px in a 960px iframe and was clipped. |
| 3 | `9b020926-ead0-4b6d-9b5f-dd993c34f4d7` | 32 | 19 | 39 | Yes | Note fills were pale and the summary included both real questions and answers. Its content needed 1905px in an 1800px iframe, clipping the end. |
| 4 | `5ec7b1fa-066f-46f3-ba40-ca6f8a1afee2` | 32 | 15 | 47 | Yes | The 2600px summary fit its iframe and showed the actuals, guidance, questions, answers and risks. The logic area still repeated facts as disconnected boxes. |
| 5 | `28152437-549f-40f9-8939-9cc25dc5aa8f` | 32 | 18 | 34 | Yes | The notes captured the main figures, questions and answers; the logic area was more compact, with three supported connections. The summary text was visible and complete; its 2400px iframe still had 7px of vertical overflow in bottom spacing. |

`roundN.json` contains the persisted board and `roundN.png` its browser screenshot. Round 1 was captured after playback and before stopping the stuck session. Round 2 was recaptured without the Audio panel obscuring the board. The remaining captures were taken after the automatic summary response and queue completed. A preliminary browser automation attempt failed on an ambiguous status selector before audio started; it created an extra empty canvas and is not counted as a round.

## Changes between rounds

- After round 1: match MAI commit acknowledgements and transcript completions by `item_id`; preserve successful out-of-order results on failure. Prompt evidence consolidation and supported relationships rather than a second inventory.
- After round 2: allow pale note colors on update and normalize vivid note updates; ask summaries to preserve questions and answers and leave more height for detailed content.
- After round 3: increase the suggested height and safety margin after measuring actual iframe overflow.
- After round 4: clarify that logic nodes should participate in supported relationships or a necessary overview; never invent a link.

The raw live transcripts and tool streams were captured under `/tmp/mico-audio-runs/` during this run. Screenshots are zoomed to fit the complete board, so individual text is more readable by zooming the corresponding live canvas. Model output is probabilistic; the final 7px overflow and possible variation on different subjects remain uncorrected. No independent holdout audio was evaluated.
