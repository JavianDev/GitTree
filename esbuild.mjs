import * as esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** Resolves the `@shared/*` path alias without pulling in a plugin package. */
const sharedAlias = {
  name: 'shared-alias',
  setup(build) {
    build.onResolve({ filter: /^@shared\// }, (args) => ({
      path: path.join(here, 'src', 'shared', args.path.slice('@shared/'.length) + '.ts'),
    }));
  },
};

/** Surfaces build results as single lines so `watch` output stays readable. */
const reporter = {
  name: 'reporter',
  setup(build) {
    build.onEnd((result) => {
      for (const e of result.errors) {
        console.error(`✘ ${e.text}`);
        if (e.location) console.error(`    ${e.location.file}:${e.location.line}:${e.location.column}`);
      }
      if (result.errors.length === 0) {
        console.log(`✔ extension host bundled${watch ? ' (watching)' : ''}`);
      }
    });
  },
};

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ['src/extension/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  // `vscode` is injected by the extension host, never bundled.
  external: ['vscode'],
  sourcemap: !production,
  minify: production,
  logLevel: 'silent',
  plugins: [sharedAlias, reporter],
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
