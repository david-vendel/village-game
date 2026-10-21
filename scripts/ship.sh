#!/usr/bin/env bash
# Ship the work: commit everything, bring in what is new on GitHub, build,
# deploy to cellsculture.com/village-game/ and push.
#   scripts/ship.sh "commit message"     (or: npm run ship -- "commit message")
set -euo pipefail
cd "$(dirname "$0")/.."

msg="${1:-}"
if [ -z "$msg" ]; then
  echo 'usage: scripts/ship.sh "commit message"' >&2
  exit 1
fi

# commit (nothing to commit is fine: still pull, deploy and push)
git add -A
if git diff --cached --quiet; then
  echo "· nothing new to commit"
else
  git commit -q -m "$msg"
  echo "· committed: $(git log --oneline -1)"
fi

# never fall behind GitHub: merge what others pushed (stops here on a conflict)
git fetch -q origin
if ! git merge-base --is-ancestor origin/main HEAD; then
  echo "· merging origin/main"
  git merge --no-edit origin/main
fi

# build (typechecks first) and deploy
npm run versions:build --silent >/dev/null
npm run build --silent >/dev/null
rsync -a --delete dist/ ~/village-game-dist/
echo "· deployed to https://cellsculture.com/village-game/"

git push -q origin HEAD:main
echo "· pushed $(git rev-parse --short HEAD) to origin/main"
