#!/usr/bin/env bash
# Redeploy the game as it is on GitHub: pull main, install if needed, build,
# and publish to cellsculture.com/village-game/.
#   ./deploy.sh
set -euo pipefail
cd "$(dirname "$0")"

# pull (fast-forward only: stops rather than make a merge on the server)
git pull --ff-only -q origin main
echo "· at $(git log --oneline -1)"

# install when the lockfile changed since the last install
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  echo "· installing dependencies"
  npm ci --silent
fi

# build (typechecks first) and deploy
npm run versions:build --silent >/dev/null
npm run build --silent >/dev/null
rsync -a --delete dist/ ~/village-game-dist/
echo "· deployed to https://cellsculture.com/village-game/"
