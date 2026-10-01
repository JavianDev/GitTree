# GitTree architecture

How the extension is put together, and where the parts are that are easy to get wrong.

## Layers

Three isolated layers with a typed contract between each, so a parsing bug stays in the parser
and a rendering bug stays in the webview — and both are testable without VS Code running.

```
Webview (React, sandboxed, no Node access)
   │  src/shared/{protocol,model,commands}.ts
Extension host (Node)
   │  RepositoryTree · WatcherHub · GitScheduler · GitService · CommandJournal
   │  child_process, argv arrays, shell: false
git (the user's own binary)
```

**The webview sends intent, never a command line.** It asks to `stageHunk` in a named
repository; the host decides which argv that becomes. No string originating in the webview is
ever concatenated into a shell command, and `shell: false` means metacharacters in branch
names, paths, and commit messages are inert.

**Every repository-scoped request names its repository.** The host keeps no implicit "current
repo", so a stale selection in the UI can't land an operation somewhere unintended.

| Path | Role |
| --- | --- |
| `src/shared/` | Model, RPC contract, and the command registry both sides import |
| `src/extension/git/` | Process pool, parsers, patch arithmetic, per-repo service, journal |
| `src/extension/repo/` | Discovery, path identity, containment tree, manager |
| `src/extension/watch/` | One workspace watcher routed to N repositories |
| `src/extension/graph/` | Lane assignment (pure, no I/O) |
| `src/extension/terminal/` | VS Code terminal integration |
| `src/webview/` | React UI, HIG token layer, themes |

## Command fidelity

GitTree's premise is that using it teaches you Git. That only holds if the command shown is the
command that runs, so there is exactly one definition of each action —
[`src/shared/commands.ts`](../src/shared/commands.ts) — and both sides call its `build()`:

```ts
const argv = COMMANDS.pull.build({ rebase: true, autostash: true, remote: 'origin' });
// webview → renders "git pull --rebase --autostash origin"
// host    → spawns  git   pull --rebase --autostash origin
```

Drift isn't a bug that can be introduced, because there is no second code path to drift from.

`CommandJournal` records every invocation, hooked into `GitProcess` at the single point where
spawning happens. That's what lets the command log claim completeness: no path to Git bypasses
it. The journal stores the *meaningful* argv — GitTree's own safety flags are excluded, because
a teaching surface showing `-c core.quotepath=false` teaches noise.

## Multi-repo

**Identity.** Repositories are keyed by normalised real path: forward slashes, case folded on
Windows only, symlinks resolved. Without this, `C:\Projects\App`, `c:/projects/app`, and the
same folder reached through a junction become three repositories with three watchers and
duplicate graph rows. See [`identity.ts`](../src/extension/repo/identity.ts).

**Classification.** A `.git` *directory* is an ordinary checkout. A `.git` *file* redirects
elsewhere, and the target says which kind it is: a gitdir holding a `commondir` file is a linked
worktree (this also covers worktrees of a bare repository), `…/modules/` is a submodule. A plain repo
inside another's working tree is `nested`, and staging it from the parent would commit an empty
gitlink — the UI blocks that specifically. Every node records its `commonDir`, which links a linked
worktree to its main one (`mainId`) and keys per-repository worktree settings.

**Worktrees outside the workspace.** `git worktree list` names folders discovery never scans (the
default `<repo>.worktrees` is a sibling). The repository manager gives such a folder one of two forms:
a **shadow** node — a `RepoNode` and `GitService` with no watchers and no tab, used for its details,
diffs, and terminal — or an **attached** node, added to the tree with git-dir watchers and a
`RelativePattern` file watcher, used for "Open in Git Tree tab". Ids are the same `repoId(path)` either
way, so the ordinary `status/get`, `diff/get` and `log/outgoing` calls work on a worktree. Every RPC
that takes a worktree path checks it against a fresh `git worktree list` first, so the webview can
never point git or the file system at an arbitrary folder.

**Scaling.** Two decisions carry it:

- **One `GitScheduler` for the entire extension**, with per-repository round-robin. A pool per
  repository is the obvious design and the wrong one — with twenty repositories it permits
  twenty times the intended concurrency, and one large repo would otherwise starve the rest.
- **One recursive workspace watcher**, routed to the owning repository by longest-prefix match,
  plus a few non-recursive handles per repo on `.git/HEAD`, `refs`, `index`, and the merge
  files. N recursive watchers over overlapping trees does not scale, especially on Windows.

## The three parsers worth reading carefully

Each of these has a failure mode that is silent, and each has tests pinned to it.

**`status --porcelain=v2 -z` renames.** The original path is *not* tab-separated inside the
record — it arrives as the **next** NUL-terminated field. Miss it and every subsequent record
shifts by one. [`status.ts`](../src/extension/git/parsers/status.ts)

**Chunk boundaries.** A record separator, or a multi-byte UTF-8 sequence, can land across a
64 KB read. `StreamSplitter` carries a residual buffer *and* uses `StringDecoder`; without
both, records vanish and non-ASCII paths get mangled — on someone else's machine, not yours.
[`StreamSplitter.ts`](../src/extension/git/StreamSplitter.ts)

**Hunk headers.** Partial staging must recompute the `@@ -a,b +c,d @@` counts from the lines
that survive filtering — reusing the original header is the usual cause of "corrupt patch". And
unselected lines **invert** between staging and unstaging: staging validates against the index,
where an unselected `+` isn't present yet (drop it) and an unselected `-` still is (keep it as
context); unstaging validates against the staged content, where exactly the opposite holds. Get
this backwards and the patch applies cleanly while staging the wrong lines.
[`patch.ts`](../src/extension/git/patch.ts)

## Streaming and correlation ids

History is streamed in batches so the first screen paints while a large repository is still
being walked. The correlation id is minted by the **webview** and sent with the request.

This is not a stylistic choice. The host starts emitting batches the moment it receives
`log/start`, so if the id came back in the *response*, every batch that won the race would be
unroutable — and on a small repository that's all of them, leaving history permanently empty.
[`logStream.ts`](../src/webview/features/history/logStream.ts) exists as a separate React-free
unit so that ordering is provable in tests.

## Pure modules behind the UI

The pattern throughout: the logic worth testing lives in a plain module, and the React component
is a thin shell over it. What that buys is visible in the list — every one of these has failure
modes at the edges that are far easier to pin down in a test than through a rendered component.

| Module | Holds |
| --- | --- |
| [`keymap.ts`](../src/webview/app/keymap.ts) | The binding table and matcher, including the chord state machine and typing guard. Deliberately DOM-free — see below. |
| [`useLayout.ts`](../src/webview/app/useLayout.ts) | Pane arithmetic: clamping, collapse/restore, refitting to a resized window |
| [`fileState.ts`](../src/webview/features/review/fileState.ts) | The `XY` code → two-cell pill mapping |
| [`fileTree.ts`](../src/webview/features/review/fileTree.ts) | Folder grouping, single-child collapse, sort modes |
| [`useFileSelection.ts`](../src/webview/features/review/useFileSelection.ts) | Selection as a reducer: click, ctrl-toggle, shift-range |
| [`BranchTree.ts`](../src/webview/features/sidebar/BranchTree.ts) / [`RefFilter.ts`](../src/webview/features/sidebar/RefFilter.ts) | Ref nesting and fuzzy matching |

**Two traps this pattern creates, both hit in practice:**

*Webview modules leak into the host build.* `tsconfig.extension.json` compiles `test/`, so a test
importing a webview module pulls it into the host project — which has no `lib.dom`. A reference
to `window` or `HTMLElement` in one of these modules therefore breaks the *extension* build, not
the webview. Keep DOM access in the hook; reach storage through `globalThis` with a runtime
guard. Gating `npm run build` on `tsc --noEmit` is what surfaces this, since esbuild and vite
both erase types without checking them.

*Row identity in the review pane.* A file staged with further unstaged edits is rendered in
**both** groups. Selection keys must therefore be composite (`staged:src/app.ts`), not bare
paths — with bare paths the same string appears twice, `indexOf` resolves to the first, and a
shift-range ending on the second copy comes up short.

## Design tokens

Every colour, size, and duration resolves through a token in
[`tokens.css`](../src/webview/design/tokens.css); no component hard-codes a value. Themes in
[`themes.css`](../src/webview/design/themes.css) are token override blocks on
`[data-gt-theme]`, so adding one never touches a component. The default sets no attribute and
inherits VS Code's own light/dark/high-contrast body class.

## Testing

```bash
npm test
```

- **Unit** — parsers against golden fixtures, graph layout, repo classification, branch tree
  and fuzzy filter, the scheduler's fairness and cancellation.
- **Integration** — [`make-workspace.ts`](../test/fixtures/make-workspace.ts) builds a real
  workspace with real Git: sibling repos, a nested repo, a submodule, a linked worktree,
  unicode paths, and a junction. These run on **Windows paths specifically**, where separators,
  drive-letter casing, and junctions break this class of extension.
- **End-to-end patch validation** — generated patches are applied by real `git apply` and the
  resulting index content asserted. A test that only checked the patch *text* would pass while
  staging the wrong lines.
