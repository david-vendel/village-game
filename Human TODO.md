# Human TODO

Things only you can do or decide, so agents work faster. Tick them off or delete them when done.

## To do

- [ ] **Push `main`.** Agents commit to `main` but don't push unless asked.
- [ ] **Run `/fewer-permission-prompts`** in Claude Code. It adds the commands agents use all the
  time (npm, vitest, `npm run sim`, `npm run shot`, small scripted edits) to an allow list, so you
  aren't asked to approve each one.
- [ ] **Write `docs/DESIGN.md`**: the buildings you plan, the production chains (logs → planks,
  grain → flour → bread, what comes next), rough costs and how fast a village should grow. With a
  target list an agent can build several buildings in one round without asking.
- [ ] **Balance the game** in `src/game/balance.ts`: every building's cost, the farm's upgrade
  and the starting stock are there. New buildings come in at 2 wood, 2 stone. The plank costs
  an agent picked in the sawmill round are a first guess.
- [ ] **Decide who makes 3D models for new buildings.** Today mechanics work adds 2D only (the
  sawmill has no 3D model yet, and planks don't show in the 3D yard). Either say in CLAUDE.md
  that mechanics work adds a basic 3D model too, or leave these to the `graphics` branch.
- [ ] **In the `graphics` worktree** (and any other clone), once, with no uncommitted changes,
  after merging `main`: `git rm -r --cached . && git reset --hard`. This rewrites its files with
  LF line endings to match `.gitattributes`.
- [ ] **Say what uses milk, wool, eggs and meat.** The animal farms make them, but nothing uses
  them yet and storage yards don't keep them, so each farm's store fills up and then the keeper
  stops feeding except to raise young. A dairy, a weaver, the tavern's kitchen?
- [ ] **Check the animals' numbers** in `ANIMALS` (`src/game/balance.ts`): grown up / productive
  until / lifespan in years (a game day is a year), feeds per young one, herd caps, meat per animal.
  Also `PASTURE_CELLS_PER_HORSE` (8) in `src/game/pasture.ts`.
- [ ] **Add the new buildings to the showcase scenario** if you want them there; the free spots
  on its main street are mostly kept for crossroads, so it needs a layout decision.

## Tips for asking

- Send work in batches, each with a check for "done", e.g. "add the iron mine and the smithy
  chain; done when tools reach the yard in the showcase scenario". The agent can then verify it
  with the simulator and a screenshot before reporting back.
