# Village Crown

A 2D side-view village builder inspired by *Kingdom Two Crowns*, painted in the
warm style of the *Age of Empires II* intro: a monarch rides a horse along one
village street and raises buildings on free plots.

```sh
npm install
npm run dev        # play in the browser
npm test           # logic tests + layer-boundary checks (headless)
npm run typecheck  # whole project, plus src/game alone without browser APIs
npm run build      # typecheck + static build into dist/
```

`dist/` is plain static files (relative paths), so it can be served from any
folder by nginx, the same way as ~/hollow. Not deployed yet.

## Controls

| Keyboard | Touch | Action |
| --- | --- | --- |
| ← / → | Hold ◀ / ▶ buttons | Ride left / right |
| ↓ or Space (at a pennant plot) | Hammer button | Open the build menu |
| ← / → or 1–9 | Tap a card | Choose building |
| Enter / Space | Tap the chosen card again, or "Build" | Build |
| Esc / ↑ | "Cancel" or tap outside | Cancel |
| ↑ / ↓ (at a crossroads) | ▲ / ▼ buttons | Turn onto the crossing street |
| C | Tap the Construction pill | Toggle the construction phase on/off |
| − / + or mouse wheel, 0 to reset | Pinch, or − / + buttons | Zoom out / in |

Touch controls appear automatically on phones and tablets (or after the first
touch). Portrait phones start zoomed out, with the street lifted above the buttons.

## Streets

A **Crossroads** (10 wood) cuts a road across the street. Once it is built, ride up to it
and press ↑ or ↓ to turn onto the new street, which runs off at right angles with its own
plots and woods. A crossroads on that street opens another, so the village grows into a
net of streets. A new street joins any street it runs into where that street's plot is
free (a crossroads appears there, so four crossroads close a loop), and ends one plot
short where a building stands in its way. The map in the top right corner shows the streets and every building.
Villagers walk round the corners to reach work and goods on other streets.

## Farms

A finished farm has fields behind the farmstead and in front of the road. Its farmer
sows one plot at a time and goes back to the farm between plots. Each plot grows on
its own clock, from sprouts to ripe gold. Ripe plots are harvested, and the sheaves
are stacked in front of the house (up to 5), each in its own place. Serfs (people
looking for work) carry them to the warehouse, and grain on to the mill, whose miller
grinds it into flour. Ride up to a farm to see its store and
crop counts.

## Code layout

Graphics and game logic are separate layers:
- `src/game`: rules and simulation. No drawing.
- `src/render`: all visuals. It only reads game state.
- `src/app`: input and screen handling.

Tests enforce the boundaries. See [ARCHITECTURE.md](ARCHITECTURE.md) for the rules and a
"where do I make this change" guide.
