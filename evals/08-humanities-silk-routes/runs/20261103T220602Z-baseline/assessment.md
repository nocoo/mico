# Baseline assessment

Score: **5/10**. Visual assessment by the coordinator against the case rubric.

- Land nodes: 1/2. Chang'an and multiple Central Asian nodes are named in sequence, but the east–west spatial placement is reversed relative to a conventional map.
- Maritime nodes: 2/2. Guangzhou, Srivijaya and Siraf are identified.
- Distinct routes: 0/2. The board contains six connectors, but none is visible over the white map background.
- Exchanges: 1/2. Commodities and cultural exchange are listed, but cards are clipped and the east/west headings conflict with the directions described.
- Comparison: 1/1. Land and sea benefits and risks are present.
- Arrows and legend: 0/1. The legend is present, but routes and arrows cannot be seen.

Confirmed renderer issue: `App.tsx` renders every connector before every non-frame shape. The agent's white `map-bg` rectangle is therefore painted over all six connectors even though the connectors are later in board order. The API accepted them, but the diagram lost its essential relationships. This is separate from the agent's conflicting route-direction labels.
