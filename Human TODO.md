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
- [ ] **Check the plank costs** an agent picked for the sawmill round, in `src/game/buildings.ts`:
  house 2 wood, 2 planks, 1 stone; farm 3/2/2; mill 3/4/6; bakery 2/2/5; blacksmith 2/2/8;
  market 2/4/2; chapel 2/2/15; tavern 4/4/4; watchtower 4/2/6. Huts, the sawmill (5 wood,
  2 stone), yards, the well, roads and crossroads take logs only. A new village starts with
  10 planks.
- [ ] **Decide who makes 3D models for new buildings.** Today mechanics work adds 2D only (the
  sawmill has no 3D model yet, and planks don't show in the 3D yard). Either say in CLAUDE.md
  that mechanics work adds a basic 3D model too, or leave these to the `graphics` branch.
- [ ] **Say in CLAUDE.md whether agents may commit to `main` on their own** once tests pass,
  so each round ends committed without you asking.
- [ ] **In the `graphics` worktree** (and any other clone), once, with no uncommitted changes,
  after merging `main`: `git rm -r --cached . && git reset --hard`. This rewrites its files with
  LF line endings to match `.gitattributes`.

## Tips for asking

- Send work in batches, each with a check for "done", e.g. "add the iron mine and the smithy
  chain; done when tools reach the yard in the showcase scenario". The agent can then verify it
  with the simulator and a screenshot before reporting back.
