# Round 3 analysis

Cases: 10; failed: 0; segments: 130; shapes: 253; HTML cards: 18; WAIT: 1; tool errors: 6; content overlaps: 4; frame overlaps: 0; outside frames: 0; long labels: 0; summaries missing HTML: 0.

| case | segments | avg ms | shapes | html | summary html | tool errors | content overlaps | frame overlaps | outside frames | long labels |
| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| c01-family-trip | 9 | 8929 | 23 | 2 | yes | 0 | 0 | 0 | 0 | 0 |
| c03-ai-platform | 10 | 14187 | 40 | 1 | yes | 0 | 0 | 0 | 0 | 0 |
| c05-er-handover | 12 | 12321 | 21 | 1 | yes | 2 | 0 | 0 | 0 | 0 |
| c06-science-fair | 18 | 12906 | 21 | 5 | yes | 0 | 0 | 0 | 0 | 0 |
| c07-incident-postmortem | 16 | 11774 | 50 | 1 | yes | 2 | 0 | 0 | 0 | 0 |
| c08-community-center | 10 | 12039 | 18 | 1 | yes | 0 | 0 | 0 | 0 | 0 |
| c09-restaurant-launch | 16 | 15153 | 29 | 1 | yes | 0 | 4 | 0 | 0 | 0 |
| c10-disaster-drill | 13 | 13553 | 20 | 2 | yes | 1 | 0 | 0 | 0 | 0 |
| c04-factory-q3 | 8 | 11229 | 16 | 3 | yes | 1 | 0 | 0 | 0 | 0 |
| c02-product-sprint | 18 | 11660 | 15 | 1 | yes | 0 | 0 | 0 | 0 | 0 |

## c01-family-trip


## c03-ai-platform


## c05-er-handover

Tool errors:
- segment 3 add_boxes: An error occurred.
- segment 4 add_boxes: An error occurred.

## c06-science-fair


## c07-incident-postmortem

Tool errors:
- segment 8 add_notes: {"ok":false,"error":"LAYOUT_LIMIT","message":"Live layout limit is y=1600; this object reaches y=1768. Place it in the second column at x=1040, y=160, or compact the existing sections with update_shapes.","hint":"Do not extend the current column. Use the second column at x=1040, starting near y=160.
- segment 8 update_shapes: {"ok":false,"error":"NOT_FOUND","message":"shape not found: support-comms"}

## c08-community-center


## c09-restaurant-launch

Overlaps: pricing/promo-social 100%, promotion-b/ops-conditions 86%, launch-promo/owners-deadlines 100%, decision-peak/supply-plan 68%

## c10-disaster-drill

Tool errors:
- segment 13 add_html_cards: {"ok":false,"error":"LAYOUT_LIMIT","message":"Live layout limit is y=1600; this object reaches y=2000. Place it in the second column at x=1040, y=160, or compact the existing sections with update_shapes.","hint":"Do not extend the current column. Use the second column at x=1040, starting near y=160.

## c04-factory-q3

Tool errors:
- segment 7 add_notes: {"ok":false,"error":"LAYOUT_LIMIT","message":"Live layout limit is y=1600; this object reaches y=1776. Place it in the second column at x=1040, y=160, or compact the existing sections with update_shapes.","hint":"Do not extend the current column. Use the second column at x=1040, starting near y=160.

## c02-product-sprint

