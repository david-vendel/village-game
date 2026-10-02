// npm run versions:build: build the game as it was at each major commit
// (src/app/versions.json) into public/versions/<commit>/, for the
// Versions panel (src/app/versions.ts: ?v=<commit>). Versions already built
// are skipped; --force rebuilds them.
//
// Each commit is checked out in a temporary git worktree that borrows this
// checkout's node_modules (the packages only grew over time), and built in
// development mode, so its art isn't dropped as unapproved. Each old build
// keeps its own saves: its IndexedDB database names get the commit added, so
// an old version can never read, stash or overwrite the village of today's.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

interface Version {
  commit: string;
  date: string;
  title: string;
  note: string;
}

const ROOT = resolve(import.meta.dirname, '../..');
const versions: Version[] = JSON.parse(readFileSync(join(ROOT, 'src/app/versions.json'), 'utf8'));
const OUT = join(ROOT, 'public/versions');
const TREES = join(ROOT, '.versions-wt');
const force = process.argv.includes('--force');
const git = (...args: string[]) => execFileSync('git', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

mkdirSync(OUT, { recursive: true });
for (const v of versions) {
  const out = join(OUT, v.commit);
  if (!force && existsSync(join(out, 'index.html'))) {
    console.log(`${v.commit} ${v.title}: built already`);
    continue;
  }
  const tree = join(TREES, v.commit);
  rmSync(tree, { recursive: true, force: true });
  git('worktree', 'prune');
  git('worktree', 'add', '--detach', tree, v.commit);
  try {
    // borrow this checkout's packages (a junction on Windows needs no special rights)
    symlinkSync(join(ROOT, 'node_modules'), join(tree, 'node_modules'), 'junction');
    rmSync(out, { recursive: true, force: true });
    execFileSync(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), 'build', '--mode', 'development', '--outDir', out, '--emptyOutDir', '--logLevel', 'warn'], { cwd: tree, stdio: 'inherit' });
    // all of its art, approved or not (a build would leave the unapproved out)
    if (existsSync(join(tree, 'public/assets'))) cpSync(join(tree, 'public/assets'), join(out, 'assets'), { recursive: true });
    // its own saves: every IndexedDB database it opens is named after the commit too
    const page = join(out, 'index.html');
    const isolate = `<script>(() => { const open = indexedDB.open.bind(indexedDB); indexedDB.open = (name, version) => open(name + '@${v.commit}', version); })();</script>`;
    writeFileSync(page, readFileSync(page, 'utf8').replace('<head>', `<head>\n    ${isolate}`));
    console.log(`${v.commit} ${v.title}: built`);
  } finally {
    // remove the link itself first, never what it points to: removing the worktree must not follow it
    const link = join(tree, 'node_modules');
    try {
      unlinkSync(link);
    } catch {
      try {
        rmdirSync(link); // a junction on Windows goes this way; not recursive
      } catch {
        // not there
      }
    }
    if (existsSync(link)) throw new Error(`could not unlink ${link}; remove it by hand (it points to the real node_modules)`);
    git('worktree', 'remove', '--force', tree);
  }
}
rmSync(TREES, { recursive: true, force: true });
