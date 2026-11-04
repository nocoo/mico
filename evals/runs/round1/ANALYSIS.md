# Round 1 analysis

Cases: 10; segments: 130; shapes: 365; HTML cards: 11; WAIT: 0; tool errors: 7; overlaps: 12; outside frames: 7; long labels: 0; summaries missing HTML: 0.

| case | segments | avg ms | shapes | html | summary html | tool errors | overlaps | outside frames | long labels |
| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| c01-family-trip | 9 | 16291 | 23 | 2 | yes | 0 | 0 | 0 | 0 |
| c02-product-sprint | 18 | 10684 | 27 | 1 | yes | 4 | 0 | 0 | 0 |
| c03-ai-platform | 10 | 27743 | 32 | 1 | yes | 0 | 1 | 0 | 0 |
| c04-factory-q3 | 8 | 10703 | 31 | 1 | yes | 0 | 0 | 0 | 0 |
| c05-er-handover | 12 | 13343 | 21 | 1 | yes | 1 | 8 | 0 | 0 |
| c06-science-fair | 18 | 15353 | 53 | 1 | yes | 1 | 1 | 4 | 0 |
| c07-incident-postmortem | 16 | 10833 | 43 | 1 | yes | 0 | 0 | 3 | 0 |
| c08-community-center | 10 | 16250 | 35 | 1 | yes | 0 | 2 | 0 | 0 |
| c09-restaurant-launch | 16 | 15478 | 67 | 1 | yes | 0 | 0 | 0 | 0 |
| c10-disaster-drill | 13 | 16776 | 33 | 1 | yes | 1 | 0 | 0 | 0 |

## c01-family-trip


## c02-product-sprint

Tool errors:
- segment 9 add_boxes: {"ok":false,"error":"DUPLICATE_ID","message":"shape id already exists: story-four"}
- segment 10 add_notes: {"ok":false,"error":"DUPLICATE_ID","message":"shape id already exists: dependencies-new"}
- segment 16 add_notes: {"ok":false,"error":"DUPLICATE_ID","message":"shape id already exists: tradeoffs-current"}
- segment 17 add_notes: {"ok":false,"error":"DUPLICATE_ID","message":"shape id already exists: dependencies-new"}

## c03-ai-platform

Overlaps: tool-live-write/audio-format 100%

## c04-factory-q3


## c05-er-handover

Tool errors:
- segment 7 add_notes: An error occurred.
Overlaps: patient2-clinical/patient2-nursing 100%, patient2-clinical/patient2-workup 100%, patient2-clinical/patient1-workup 69%, patient3-clinical/patient3-assignment 100%, patient2-nursing/patient2-workup 100%, patient2-nursing/patient1-workup 69%, lead-role/patient3-workup 100%, patient2-workup/patient1-workup 75%

## c06-science-fair

Tool errors:
- segment 12 add_notes: {"ok":false,"error":"DUPLICATE_ID","message":"shape id already exists: budget-plan-a"}
Overlaps: gym-tradeoffs/cafeteria-tradeoffs 100%
Outside frames: category-list, plan-a-details, plan-b-details, stretch-details

## c07-incident-postmortem

Outside frames: retry-loop, rollback-gap, runbook-gap

## c08-community-center

Overlaps: floor2/bFirst 100%, elevatorSolar/bLater 100%

## c09-restaurant-launch


## c10-disaster-drill

Tool errors:
- segment 11 add_notes: {"ok":false,"error":"DUPLICATE_ID","message":"shape id already exists: pet-area"}
