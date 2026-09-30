/**
 * A compact, colour-coded badge for a file's type — the at-a-glance cue a file
 * icon theme gives, without depending on one being installed or reachable from
 * a webview. Two or three characters on a tint of the type's colour.
 */

interface IconSpec {
  label: string;
  color: string;
}

const BY_NAME: Record<string, IconSpec> = {
  'package.json': { label: 'npm', color: '#cb3837' },
  'package-lock.json': { label: 'npm', color: '#cb3837' },
  dockerfile: { label: 'Dk', color: '#2496ed' },
  '.gitignore': { label: 'git', color: '#f05032' },
  '.gitattributes': { label: 'git', color: '#f05032' },
  license: { label: '§', color: '#c9a227' },
};

const BY_EXTENSION: Record<string, IconSpec> = {
  ts: { label: 'TS', color: '#3178c6' },
  mts: { label: 'TS', color: '#3178c6' },
  cts: { label: 'TS', color: '#3178c6' },
  tsx: { label: 'TSX', color: '#3178c6' },
  js: { label: 'JS', color: '#e8b10b' },
  mjs: { label: 'JS', color: '#e8b10b' },
  cjs: { label: 'JS', color: '#e8b10b' },
  jsx: { label: 'JSX', color: '#e8b10b' },
  json: { label: '{}', color: '#d9a33a' },
  md: { label: 'M↓', color: '#519aba' },
  mdx: { label: 'M↓', color: '#519aba' },
  css: { label: '#', color: '#663399' },
  scss: { label: '#', color: '#cd6799' },
  less: { label: '#', color: '#1d365d' },
  html: { label: '<>', color: '#e44d26' },
  xml: { label: '<>', color: '#e37933' },
  svg: { label: 'SVG', color: '#ffb13b' },
  py: { label: 'Py', color: '#3776ab' },
  go: { label: 'Go', color: '#00add8' },
  rs: { label: 'Rs', color: '#dea584' },
  java: { label: 'J', color: '#b07219' },
  kt: { label: 'Kt', color: '#a97bff' },
  c: { label: 'C', color: '#555599' },
  h: { label: 'H', color: '#555599' },
  cpp: { label: 'C+', color: '#f34b7d' },
  cs: { label: 'C#', color: '#178600' },
  rb: { label: 'Rb', color: '#cc342d' },
  php: { label: 'php', color: '#777bb4' },
  swift: { label: 'Sw', color: '#f05138' },
  sh: { label: '$', color: '#4eaa25' },
  ps1: { label: 'PS', color: '#2671be' },
  yml: { label: 'Y', color: '#cb171e' },
  yaml: { label: 'Y', color: '#cb171e' },
  toml: { label: 'T', color: '#9c4221' },
  sql: { label: 'SQL', color: '#e38c00' },
  png: { label: 'img', color: '#26a69a' },
  jpg: { label: 'img', color: '#26a69a' },
  jpeg: { label: 'img', color: '#26a69a' },
  gif: { label: 'img', color: '#26a69a' },
  webp: { label: 'img', color: '#26a69a' },
  ico: { label: 'img', color: '#26a69a' },
  lock: { label: 'lk', color: '#8a8a8a' },
  txt: { label: 'txt', color: '#8a8a8a' },
};

const FALLBACK: IconSpec = { label: '·', color: '#8a8a8a' };

export function iconFor(path: string): IconSpec {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  const byName = BY_NAME[name] ?? (name.startsWith('readme') ? { label: 'i', color: '#519aba' } : undefined);
  if (byName) return byName;
  const dot = name.lastIndexOf('.');
  return (dot > 0 ? BY_EXTENSION[name.slice(dot + 1)] : undefined) ?? FALLBACK;
}

export function FileIcon({ path }: { path: string }): React.JSX.Element {
  const spec = iconFor(path);
  return (
    <span className="gt-file-icon" style={{ '--icon': spec.color } as React.CSSProperties} aria-hidden="true">
      {spec.label}
    </span>
  );
}
