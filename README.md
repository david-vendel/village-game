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

| Key | Action |
| --- | --- |
| ← / → | Ride left / right |
| ↓ or Space (at a pennant plot) | Open the build menu |
| ← / → or 1–9 (in menu) | Choose building |
| Enter / Space | Build |
| Esc / ↑ | Cancel |
| C | Toggle the construction phase on/off |

See [ARCHITECTURE.md](ARCHITECTURE.md) for how it is put together.
