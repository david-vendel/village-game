# Village Crown

A 2D side-view village builder inspired by *Kingdom Two Crowns*, painted in the
warm style of the *Age of Empires II* intro: a monarch rides a horse along one
village street and raises buildings on free plots.

```sh
npm install
npm run dev      # play in the browser
npm test         # game-logic unit tests (headless)
npm run build    # typecheck + static build into dist/
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
| C | Tap the Construction pill | Toggle the construction phase on/off |
| − / + or mouse wheel, 0 to reset | Pinch, or − / + buttons | Zoom out / in |

Touch controls appear automatically on phones and tablets (or after the first
touch). Portrait phones start zoomed out, with the street lifted above the buttons.

## Farms

A finished farm has fields behind the farmstead and in front of the road. Its farmer
sows one plot at a time and goes back to the farm between plots. Each plot grows on
its own clock, from sprouts to ripe gold. Ripe plots are harvested, and the sheaves
are stacked in front of the house (up to 5). Ride up to a farm to see its store and
crop counts.

See [ARCHITECTURE.md](ARCHITECTURE.md) for how it is put together.
