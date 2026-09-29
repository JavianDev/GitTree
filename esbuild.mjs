import * as esbuild from 'esbuild';
import { existsSync, readFileSync } from 'node:fs';
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

/**
 * OAuth app registrations for browser sign-in (Bitbucket consumer, GitLab
 * application), read from the git-ignored `oauth-clients.json` or from
 * environment variables, and baked into the bundle — so no key or secret is
 * ever committed. Missing is fine: sign-in then falls back to tokens.
 */
function oauthClients() {
  const file = path.join(here, 'oauth-clients.json');
  const fromFile = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const env = process.env;
  return {
    bitbucket: {
      key: env.GITTREE_BITBUCKET_OAUTH_KEY ?? fromFile.bitbucket?.key ?? '',
      secret: env.GITTREE_BITBUCKET_OAUTH_SECRET ?? fromFile.bitbucket?.secret ?? '',
    },
    gitlab: {
      applicationId: env.GITTREE_GITLAB_OAUTH_APP_ID ?? fromFile.gitlab?.applicationId ?? '',
    },
  };
}

const clients = oauthClients();
console.log(
  `  browser sign-in: Bitbucket ${clients.bitbucket.key && clients.bitbucket.secret ? 'configured' : 'not configured'}, ` +
    `GitLab ${clients.gitlab.applicationId ? 'configured' : 'not configured'}`,
);

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
  define: { __GITTREE_OAUTH__: JSON.stringify(clients) },
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
