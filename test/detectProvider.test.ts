import { describe, expect, it } from 'vitest';
import type { GitRemote } from '../src/shared/model';
import { detectProvider } from '../src/extension/pullRequests/detectProvider';

const remote = (name: string, fetchUrl: string): GitRemote => ({ name, fetchUrl, pushUrl: fetchUrl });

describe('detectProvider — GitHub', () => {
  it('matches the https form', () => {
    expect(detectProvider([remote('origin', 'https://github.com/JavianDev/GitTree.git')])).toEqual({
      provider: 'github',
      ref: { owner: 'JavianDev', repo: 'GitTree' },
    });
  });

  it('matches the https form without a .git suffix', () => {
    expect(detectProvider([remote('origin', 'https://github.com/JavianDev/GitTree')])?.ref).toEqual({
      owner: 'JavianDev',
      repo: 'GitTree',
    });
  });

  it('matches the scp-like ssh form', () => {
    expect(detectProvider([remote('origin', 'git@github.com:JavianDev/GitTree.git')])).toEqual({
      provider: 'github',
      ref: { owner: 'JavianDev', repo: 'GitTree' },
    });
  });

  it('matches the ssh:// form', () => {
    expect(detectProvider([remote('origin', 'ssh://git@github.com/JavianDev/GitTree.git')])?.ref).toEqual({
      owner: 'JavianDev',
      repo: 'GitTree',
    });
  });

  it('strips embedded credentials', () => {
    expect(detectProvider([remote('origin', 'https://user:token@github.com/JavianDev/GitTree.git')])?.ref).toEqual({
      owner: 'JavianDev',
      repo: 'GitTree',
    });
  });

  it('keeps a dot inside a repo name that is not the .git suffix', () => {
    expect(detectProvider([remote('origin', 'https://github.com/JavianDev/git.tree.git')])?.ref.repo).toBe(
      'git.tree',
    );
  });
});

describe('detectProvider — Azure DevOps', () => {
  it('matches the modern dev.azure.com form', () => {
    expect(
      detectProvider([remote('origin', 'https://dev.azure.com/contoso/WebApp/_git/frontend')]),
    ).toEqual({
      provider: 'azureDevOps',
      ref: { owner: 'contoso', project: 'WebApp', repo: 'frontend' },
    });
  });

  it('matches the legacy visualstudio.com form', () => {
    expect(
      detectProvider([remote('origin', 'https://contoso.visualstudio.com/WebApp/_git/frontend')]),
    ).toEqual({
      provider: 'azureDevOps',
      ref: { owner: 'contoso', project: 'WebApp', repo: 'frontend' },
    });
  });

  it('matches the ssh v3 form', () => {
    expect(
      detectProvider([remote('origin', 'git@ssh.dev.azure.com:v3/contoso/WebApp/frontend')]),
    ).toEqual({
      provider: 'azureDevOps',
      ref: { owner: 'contoso', project: 'WebApp', repo: 'frontend' },
    });
  });

  it('decodes a URL-encoded project name', () => {
    expect(
      detectProvider([remote('origin', 'https://dev.azure.com/contoso/My%20Project/_git/frontend')])?.ref
        .project,
    ).toBe('My Project');
  });
});

describe('detectProvider — GitLab', () => {
  it('matches the https form', () => {
    expect(detectProvider([remote('origin', 'https://gitlab.com/group/project.git')])).toEqual({
      provider: 'gitlab',
      ref: { owner: 'group', repo: 'project' },
    });
  });

  it('matches the scp-like ssh form', () => {
    expect(detectProvider([remote('origin', 'git@gitlab.com:group/project.git')])?.ref).toEqual({
      owner: 'group',
      repo: 'project',
    });
  });
});

describe('detectProvider — negatives and precedence', () => {
  it('returns undefined for an unsupported host', () => {
    expect(detectProvider([remote('origin', 'https://bitbucket.org/group/project.git')])).toBeUndefined();
  });

  it('returns undefined for a self-hosted GitLab / on-prem Azure DevOps Server URL', () => {
    expect(detectProvider([remote('origin', 'https://gitlab.mycompany.internal/group/project.git')])).toBeUndefined();
    expect(
      detectProvider([remote('origin', 'https://tfs.mycompany.internal/tfs/DefaultCollection/proj/_git/repo')]),
    ).toBeUndefined();
  });

  it('returns undefined when there are no remotes at all', () => {
    expect(detectProvider([])).toBeUndefined();
  });

  it('prefers origin over other remotes, even when origin is listed last', () => {
    const result = detectProvider([
      remote('upstream', 'https://github.com/other/other.git'),
      remote('origin', 'https://github.com/JavianDev/GitTree.git'),
    ]);
    expect(result?.ref.owner).toBe('JavianDev');
  });

  it('falls back to the first matching remote in listed order when there is no origin', () => {
    const result = detectProvider([
      remote('fork', 'https://github.com/fork-owner/repo.git'),
      remote('upstream', 'https://github.com/upstream-owner/repo.git'),
    ]);
    expect(result?.ref.owner).toBe('fork-owner');
  });

  it('picks whichever supported provider matches when a repo has all three configured', () => {
    // origin wins regardless of which provider it happens to point at.
    const result = detectProvider([
      remote('gitlab-mirror', 'https://gitlab.com/group/project.git'),
      remote('origin', 'https://dev.azure.com/contoso/WebApp/_git/frontend'),
      remote('github-mirror', 'https://github.com/JavianDev/GitTree.git'),
    ]);
    expect(result?.provider).toBe('azureDevOps');
  });
});
