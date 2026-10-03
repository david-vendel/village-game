# Human TODO

Things only you can do or decide, so agents work faster. Tick them off or delete them when done.

## To do

- [ ] **Push `main`.** Agents commit to `main` but don't push unless asked.
- [ ] **Run `/fewer-permission-prompts`** in Claude Code. It adds the commands agents use all the
  time (npm, vitest, `npm run sim`, `npm run shot`, small scripted edits) to an allow list, so you
  aren't asked to approve each one.
- [ ] **Read `docs/DESIGN.md`** and answer its open questions at the end (winter, leaving, coin,
  the castle). Change anything you disagree with; agents build from it, step by step.
- [ ] **Balance the game** in `src/game/balance.ts`: every building's cost, the farm's upgrade
  and the starting stock are there. New buildings come in at 2 wood, 2 stone. The plank costs
  an agent picked in the sawmill round are a first guess.
- [ ] **Decide who makes 3D models for new buildings.** Today mechanics work adds 2D only (the
  sawmill has no 3D model yet, and planks don't show in the 3D yard). Either say in CLAUDE.md
  that mechanics work adds a basic 3D model too, or leave these to the `graphics` branch.
- [ ] **In the `graphics` worktree** (and any other clone), once, with no uncommitted changes,
  after merging `main`: `git rm -r --cached . && git reset --hard`. This rewrites its files with
  LF line endings to match `.gitattributes`.
- [ ] **Check the animals' numbers** in `ANIMALS` (`src/game/balance.ts`): grown up / productive
  until / lifespan in years (a game day is a year), feeds per young one, herd caps, meat per animal.
  Also `PASTURE_CELLS_PER_HORSE` (8) in `src/game/pasture.ts`.
- [ ] **Add the new buildings to the showcase scenario** if you want them there; the free spots
  on its main street are mostly kept for crossroads, so it needs a layout decision.

## Tips for asking

- Send work in batches, each with a check for "done", e.g. "add the iron mine and the smithy
  chain; done when tools reach the yard in the showcase scenario". The agent can then verify it
  with the simulator and a screenshot before reporting back.
