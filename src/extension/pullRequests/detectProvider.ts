import type { GitRemote, PrProvider } from '@shared/model';

/** What a provider needs to address one repository through its REST API. */
export interface ProviderRepoRef {
  /** GitHub org/user, Azure DevOps organization, or GitLab namespace. */
  owner: string;
  repo: string;
  /** Azure DevOps project only. */
  project?: string;
}

export interface DetectedProvider {
  provider: PrProvider;
  ref: ProviderRepoRef;
}

/** Strips embedded `user:pass@` / `user@` credentials from an HTTP(S) URL. */
function stripCredentials(url: string): string {
  return url.replace(/^(https?:\/\/)[^/@]+@/i, '$1');
}

/** Trailing slashes only — `.git` is stripped separately so repo names that
 * legitimately contain a dot (`my.repo`) are not mistaken for the suffix. */
function normalize(url: string): string {
  return stripCredentials(url.trim()).replace(/\/+$/, '');
}

function stripDotGit(segment: string): string {
  return segment.replace(/\.git$/i, '');
}

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function detectGitHub(rawUrl: string): ProviderRepoRef | undefined {
  const url = normalize(rawUrl);

  const https = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)$/i.exec(url);
  if (https) return { owner: decode(https[1]!), repo: stripDotGit(decode(https[2]!)) };

  // scp-like syntax: `git@github.com:owner/repo`. `normalize`'s credential
  // stripping only matches an `http(s)://` scheme, so it is a no-op here and
  // safe to reuse — only the trailing-slash trim applies.
  const scp = /^git@github\.com:([^/]+)\/([^/]+)$/i.exec(normalize(rawUrl));
  if (scp) return { owner: decode(scp[1]!), repo: stripDotGit(decode(scp[2]!)) };

  const sshUrl = /^ssh:\/\/git@github\.com\/([^/]+)\/([^/]+)$/i.exec(url);
  if (sshUrl) return { owner: decode(sshUrl[1]!), repo: stripDotGit(decode(sshUrl[2]!)) };

  return undefined;
}

function detectAzureDevOps(rawUrl: string): ProviderRepoRef | undefined {
  const url = normalize(rawUrl);

  const cloud = /^https?:\/\/dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/]+)$/i.exec(url);
  if (cloud) {
    return { owner: decode(cloud[1]!), project: decode(cloud[2]!), repo: stripDotGit(decode(cloud[3]!)) };
  }

  const legacy = /^https?:\/\/([^./]+)\.visualstudio\.com\/([^/]+)\/_git\/([^/]+)$/i.exec(url);
  if (legacy) {
    return { owner: decode(legacy[1]!), project: decode(legacy[2]!), repo: stripDotGit(decode(legacy[3]!)) };
  }

  const ssh = /^git@ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/([^/]+)$/i.exec(normalize(rawUrl));
  if (ssh) return { owner: decode(ssh[1]!), project: decode(ssh[2]!), repo: stripDotGit(decode(ssh[3]!)) };

  return undefined;
}

function detectGitLab(rawUrl: string): ProviderRepoRef | undefined {
  const url = normalize(rawUrl);

  const https = /^https?:\/\/gitlab\.com\/([^/]+)\/([^/]+)$/i.exec(url);
  if (https) return { owner: decode(https[1]!), repo: stripDotGit(decode(https[2]!)) };

  const ssh = /^git@gitlab\.com:([^/]+)\/([^/]+)$/i.exec(normalize(rawUrl));
  if (ssh) return { owner: decode(ssh[1]!), repo: stripDotGit(decode(ssh[2]!)) };

  const sshUrl = /^ssh:\/\/git@gitlab\.com\/([^/]+)\/([^/]+)$/i.exec(url);
  if (sshUrl) return { owner: decode(sshUrl[1]!), repo: stripDotGit(decode(sshUrl[2]!)) };

  return undefined;
}

/**
 * Detection order: Azure DevOps before GitHub before GitLab — arbitrary
 * between the three since their URL hosts are disjoint, but fixed so the
 * "which one wins on an ambiguous repo" question always has one answer.
 */
const DETECTORS: ReadonlyArray<{ provider: PrProvider; detect: (url: string) => ProviderRepoRef | undefined }> = [
  { provider: 'azureDevOps', detect: detectAzureDevOps },
  { provider: 'github', detect: detectGitHub },
  { provider: 'gitlab', detect: detectGitLab },
];

/**
 * Detects which of the three supported providers (if any) a repo's remotes
 * point at. `origin` is tried first — matching what every other git tool
 * assumes "the" remote means — then every other remote in listed order.
 *
 * Pure and synchronous: no I/O, no `vscode.*` calls, so it is unit-testable
 * without mocking anything.
 */
export function detectProvider(remotes: readonly GitRemote[]): DetectedProvider | undefined {
  const ordered = [...remotes].sort((a, b) => {
    if (a.name === 'origin') return -1;
    if (b.name === 'origin') return 1;
    return 0;
  });

  for (const remote of ordered) {
    for (const { provider, detect } of DETECTORS) {
      const ref = detect(remote.fetchUrl);
      if (ref) return { provider, ref };
    }
  }

  return undefined;
}
