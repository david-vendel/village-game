import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';

/**
 * Production builds ship only approved art (docs/art/ASSET_SPEC.md §13): drop
 * assets without `source.approvedBy` from the copied manifest, and their files.
 * Dev (`npm run dev`) serves everything, for review.
 */
function approvedAssetsOnly(): Plugin {
  let outDir = 'dist';
  return {
    name: 'approved-assets-only',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    closeBundle() {
      const dir = join(outDir, 'assets');
      const path = join(dir, 'manifest.json');
      if (!existsSync(path)) return;
      // (src/render/manifest.ts approvedOnly; inlined: Vite loads this file natively, without the bundler's resolution)
      const all = JSON.parse(readFileSync(path, 'utf8')) as { assets: Record<string, { source?: { approvedBy?: string } }> };
      const m = { ...all, assets: Object.fromEntries(Object.entries(all.assets).filter(([, a]) => !!a.source?.approvedBy)) };
      writeFileSync(path, JSON.stringify(m));
      // every file path an approved asset mentions, at every tier
      const keep = new Set<string>();
      JSON.stringify(m.assets).replace(/"([^"]+\.(?:webp|png|avif))"/g, (_, p: string) => {
        for (const t of ['1', '2', '4']) keep.add(p.replace('{tier}', t));
        return '';
      });
      const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
      let dropped = 0;
      for (const f of walk(dir)) {
        const rel = relative(dir, f).split(sep).join('/');
        if (rel !== 'manifest.json' && !keep.has(rel)) {
          rmSync(f);
          dropped++;
        }
      }
      const prune = (d: string): boolean => {
        const empty = readdirSync(d).every((n) => statSync(join(d, n)).isDirectory() && prune(join(d, n)));
        if (empty && d !== dir) rmSync(d, { recursive: true });
        return empty;
      };
      prune(dir);
      if (dropped) console.log(`approved-assets-only: left out ${dropped} file${dropped === 1 ? '' : 's'} of unapproved assets`);
    },
  };
}

export default defineConfig({
  base: './',
  // the bundle goes to build/, so dist/assets/ is only the art (public/assets)
  build: { target: 'es2022', assetsDir: 'build' },
  plugins: [approvedAssetsOnly()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
