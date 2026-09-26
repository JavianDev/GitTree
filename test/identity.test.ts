import { describe, expect, it } from 'vitest';
import {
  disambiguateNames,
  relativeTo,
  displayPath,
  findOwningPath,
  isPathInside,
  pathKey,
  repoId,
} from '../src/extension/repo/identity';

describe('displayPath', () => {
  it('converts backslashes to forward slashes', () => {
    expect(displayPath('C:\\Projects\\App', 'win32')).toBe('C:/Projects/App');
  });

  it('uppercases the drive letter but preserves the rest of the casing', () => {
    expect(displayPath('c:/Projects/MyApp', 'win32')).toBe('C:/Projects/MyApp');
  });

  it('collapses repeated separators', () => {
    expect(displayPath('C:\\\\Projects\\\\App', 'win32')).toBe('C:/Projects/App');
  });

  it('preserves a UNC prefix', () => {
    expect(displayPath('\\\\server\\share\\repo', 'win32')).toBe('//server/share/repo');
  });

  it('strips a trailing separator but keeps a drive root', () => {
    expect(displayPath('C:/Projects/App/', 'win32')).toBe('C:/Projects/App');
    expect(displayPath('C:/', 'win32')).toBe('C:/');
  });

  it('leaves POSIX paths and their casing alone', () => {
    expect(displayPath('/home/me/Projects/App', 'posix')).toBe('/home/me/Projects/App');
  });
});

describe('pathKey', () => {
  it('collapses every Windows spelling of one directory to one key', () => {
    const spellings = [
      'C:\\Projects\\GitTree',
      'c:/projects/gittree',
      'C:/Projects/GitTree/',
      'c:\\Projects\\\\GitTree',
    ];

    const keys = new Set(spellings.map((p) => pathKey(p, 'win32')));
    expect(keys.size).toBe(1);
  });

  it('does not fold case on POSIX, where two casings are two directories', () => {
    expect(pathKey('/home/me/App', 'posix')).not.toBe(pathKey('/home/me/app', 'posix'));
  });
});

describe('repoId', () => {
  it('is stable across spellings of the same path', () => {
    expect(repoId('C:\\Projects\\App', 'win32')).toBe(repoId('c:/projects/app/', 'win32'));
  });

  it('differs between different repositories', () => {
    expect(repoId('C:/Projects/A', 'win32')).not.toBe(repoId('C:/Projects/B', 'win32'));
  });

  it('is a short, DOM-safe hex string', () => {
    expect(repoId('C:/Projects/App', 'win32')).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('isPathInside', () => {
  it('accepts a descendant and the path itself', () => {
    expect(isPathInside('C:/proj/app/src/x.ts', 'C:/proj/app', 'win32')).toBe(true);
    expect(isPathInside('C:/proj/app', 'C:/proj/app', 'win32')).toBe(true);
  });

  it('rejects a sibling whose name shares a prefix', () => {
    // Without the separator check, `app2` reads as a child of `app`.
    expect(isPathInside('C:/proj/app2/src/x.ts', 'C:/proj/app', 'win32')).toBe(false);
  });

  it('ignores casing and separator style on Windows', () => {
    expect(isPathInside('c:\\PROJ\\App\\src', 'C:/proj/app', 'win32')).toBe(true);
  });
});

describe('findOwningPath', () => {
  const repos = [
    { root: 'C:/work/parent', name: 'parent' },
    { root: 'C:/work/parent/nested', name: 'nested' },
    { root: 'C:/work/other', name: 'other' },
  ];

  it('attributes a file to the innermost repository containing it', () => {
    // The whole point of longest-prefix: a file in a nested repo belongs to
    // the nested repo, not the outer one that also contains its path.
    expect(findOwningPath(repos, 'C:/work/parent/nested/src/x.ts', 'win32')?.name).toBe('nested');
  });

  it('falls back to the outer repository outside the nested one', () => {
    expect(findOwningPath(repos, 'C:/work/parent/src/x.ts', 'win32')?.name).toBe('parent');
  });

  it('returns undefined for a path in no repository', () => {
    expect(findOwningPath(repos, 'C:/elsewhere/x.ts', 'win32')).toBeUndefined();
  });

  it('is order-independent', () => {
    const reversed = [...repos].reverse();
    expect(findOwningPath(reversed, 'C:/work/parent/nested/a.ts', 'win32')?.name).toBe('nested');
  });
});

describe('disambiguateNames', () => {
  it('prefixes the parent folder when names collide', () => {
    const repos = [
      { root: 'C:/work/frontend/api', name: 'api' },
      { root: 'C:/work/backend/api', name: 'api' },
    ];

    disambiguateNames(repos);
    expect(repos.map((r) => r.name)).toEqual(['frontend/api', 'backend/api']);
  });

  it('leaves unique names untouched', () => {
    const repos = [
      { root: 'C:/work/web', name: 'web' },
      { root: 'C:/work/api', name: 'api' },
    ];

    disambiguateNames(repos);
    expect(repos.map((r) => r.name)).toEqual(['web', 'api']);
  });
});

describe('relativeTo', () => {
  it('returns the child path the way git reports it', () => {
    expect(relativeTo('C:/work/parent', 'C:/work/parent/tools/nested', 'win32')).toBe('tools/nested');
  });

  it('tolerates mismatched casing and separators on Windows', () => {
    expect(relativeTo('c:\\work\\parent', 'C:/Work/Parent/libs/lib', 'win32')).toBe('libs/lib');
  });

  it('returns an empty string when the paths are the same', () => {
    expect(relativeTo('C:/work/parent', 'C:/work/parent', 'win32')).toBe('');
  });

  it('returns undefined when the child is outside the parent', () => {
    expect(relativeTo('C:/work/parent', 'C:/work/other', 'win32')).toBeUndefined();
    // A sibling sharing a name prefix is not a child.
    expect(relativeTo('C:/work/app', 'C:/work/app2/src', 'win32')).toBeUndefined();
  });
});
