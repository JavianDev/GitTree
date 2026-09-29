# Changelog

All notable changes to GitTree are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added — Bitbucket pull requests

- **Bitbucket Cloud joins GitHub, Azure DevOps, and GitLab.** A remote on `bitbucket.org` (https,
  `git@bitbucket.org:`, or `ssh://` form, including the `user@bitbucket.org` URLs Bitbucket hands out
  for cloning) now brings up the sidebar's Pull Requests section automatically, with the full
  workflow: list by status, create, approve / request changes, merge (merge commit or squash, with
  close-source-branch), decline, comment threads, build statuses, and per-commit diffs via
  `refs/pull-requests/{id}/from`. Self-hosted Bitbucket Server / Data Center is not detected.
- **Sign-in uses an Atlassian API token**, not an App Password — Atlassian retired App Passwords in
  2026. Git Tree asks once for the Atlassian account email and a scoped API token and keeps them in
  VS Code's secret storage.

### Fixed

- **A rejected pull request credential no longer leaves the section stuck.** A failed list used to be
  swallowed into an empty list — indistinguishable from "no pull requests" — and a wrong or revoked
  token was reused forever with no way to re-enter it. The error is now shown, and for Bitbucket a
  401 forgets the saved credential so the section offers "Sign in to Bitbucket" again.

### Added — merge conflict resolution

- **One-click "Resolve Using Mine" / "Resolve Using Theirs"** on any conflicted file, from the
  right-click menu — no confirmation dialog, since re-resolving the other way (or aborting
  entirely) is always available right up until the operation is completed. Handles every conflict
  shape correctly, including add/delete conflicts where one side has no file to check out at all:
  it tries `checkout --ours`/`--theirs` first and falls back to `git rm` on failure, rather than
  duplicating git's own conflict-code semantics.
- **A persistent banner explains what "mine" and "theirs" actually mean** for whatever operation is
  in progress — merge, rebase, cherry-pick, or revert — detected by reading the same marker files
  (`MERGE_HEAD`, `rebase-merge`/`rebase-apply`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`) git itself uses.
  This matters because **the meaning reverses during a rebase**: git replays your commits on top of
  the target, so mid-conflict the target branch becomes "ours" and your own commit becomes
  "theirs" — backwards from merge, cherry-pick, and revert, where "mine" is simply the current
  branch. Getting this right (and saying so explicitly) was the point of the feature.
- **Continue and Abort buttons** once every conflict is resolved. Continue for a merge is just an
  ordinary commit — the message box now prefills from git's own `MERGE_MSG`, the same message plain
  `git commit` would use. Rebase, cherry-pick, and revert get real `--continue` commands.
  `rebase --continue`/`cherry-pick --continue`/`revert --continue` are now run with `GIT_EDITOR=true`
  to guarantee they can never hang waiting for an interactive editor this headless process has no
  way to show.
- **Manual resolution hands off to VS Code's own editor** rather than building a second conflict UI
  inside Git Tree: "Open to Resolve Manually" opens the file in a normal tab, where VS Code's
  built-in Accept Current/Incoming/Both actions already appear above the conflict markers.
- Fixed a related bug found while building this: selecting a conflicted file previously fell
  through to the ordinary diff pipeline, which asks git for a plain unified diff — but `git diff`
  against an unmerged path actually returns *combined-diff* format (`@@@ ... @@@` headers,
  multi-character line prefixes) that the parser was never built to read, rendering something
  garbled rather than nothing. Conflicted files now show a direct empty state pointing at the
  right-click menu instead.

### Fixed

- **The commit graph drifted out of sync with the commit list while scrolling.** The canvas drew
  each rail/node at `(rowIndex - start) * rowHeight`, which only lines up with the list's actual
  on-screen position the instant `scrollTop` happens to be an exact multiple of the row height —
  `start` itself only advances in whole-row jumps, while the list scrolls pixel-smoothly. Between
  those instants the graph and the rows beneath it were offset by up to a full row, reading as the
  graph cutting off or misaligning as you scrolled. The canvas now positions every row from the
  same continuous `scrollTop` the list uses (`rowIndex * rowHeight - scrollTop`), so it tracks the
  list exactly rather than snapping into place once per row.

### Added — multi-provider Pull Requests (GitHub, Azure DevOps, GitLab)

- **Zero-configuration detection.** The sidebar's Pull Requests section appears automatically
  when a repo's remote points at `github.com`, `dev.azure.com` (or the legacy
  `*.visualstudio.com` form), or `gitlab.com` — no settings screen, no manual org/project entry.
  `origin` is tried first, then every other remote in listed order.
- **Sign-in uses VS Code's own built-in authentication providers** for GitHub and Azure DevOps
  (native "Sign in to GitHub" / "Sign in to Microsoft" popups, via
  `vscode.authentication.getSession`) — no new dependency, no custom UI. GitLab has no built-in
  VS Code auth provider, so it is the one place in the feature that asks for a manually entered
  credential: a personal access token, requested once and cached in `vscode.SecretStorage`.
- **Full workflow**: list (with an Active/Completed/Abandoned filter), create, vote (approve /
  approve with suggestions / wait for author / reject, where the provider supports it),
  complete/merge with squash and delete-source-branch options, abandon, and comment threads.
  Azure DevOps additionally supports a policy-bypass override on completion; GitHub and GitLab
  hide that control entirely rather than showing a no-op, since neither has the concept.
- **No new diff-rendering code.** A PR's overall diff and its per-commit diffs reuse the existing
  `diff/get` RPC and `DiffViewer` verbatim — a PR's commits are real git objects once fetched
  locally, so the same pipeline that renders a regular commit's diff renders these too. GitHub
  PRs stay diffable even after their source branch is deleted, via GitHub's own synthetic
  `refs/pull/{id}/head`; Azure DevOps and GitLab fall back to fetching the raw commit SHA.
- Policy/check-run/pipeline status and linked work items/issues render per PR when the provider
  exposes them; GitHub's linked issues are a best-effort `#123` scan of the title/body rather
  than a GraphQL query, kept deliberately simple.

### Added — full stash management

- **Every stash is now visible, not just the tip.** The sidebar's Stashes section calls a new
  `stash/list` RPC instead of relying on `refs/list`'s single `refs/stash` entry, which only ever
  exposed the most recent one.
- **Apply, Pop, and Drop are reachable from a right-click menu on each stash row**, each opening
  the same review-before-run command sheet every other mutating action uses. There is deliberately
  no double-click default — apply-vs-pop is not a safe thing to guess, and Drop requires the same
  destructive confirmation as any other unrecoverable action.
- **Clicking a stash previews its diff** through the same commit-diff pipeline the commit graph
  uses — a stash's commit is a real git object, just one not reachable from any branch, so no new
  diff endpoint was needed.
- **The Command Sheet gained a text field option** (`stash.push`'s message), alongside the existing
  checkboxes, so a stash description no longer requires hand-editing the raw command.
- Removed the standing `// TODO: add UI to choose pop/apply` — double-clicking a stash used to
  hardcode a plain `stash pop` with no way to preview it or choose apply instead.

### Fixed

- **The commit graph was cut off partway down.** Adding the pinned "Uncommitted changes" row
  wrapped the view in a new `.gt-history-pane` and no CSS rule for that class was ever written.
  Without one the element defaults to `display: block`, so the `flex: 1 1 auto` and
  `min-height: 0` on the element inside it meant nothing — flex properties only apply inside a
  flex container. The list sized to its content instead of the available box, and the canvas,
  painted to the measured list height, stopped short while the commits carried on.
- **The theme toggle appeared to do nothing.** It was cycling correctly all along; the fault was
  in the cascade. Themes declared their tokens on `:root` (`<html>`) while the base palette
  declares them on `body.vscode-dark`. Custom properties inherit, so for anything inside `<body>`
  the declaration on the *nearer ancestor* wins — specificity never enters into it, because the
  two rules match different elements. Both now target `<body>`, where `body[data-gt-theme]`
  genuinely outranks `body.vscode-dark`; high-contrast is specificity-bumped so a named theme
  cannot switch it off for someone who needs it.
- **Branch folder rows rendered as light grey blocks.** They are `<button>`s with
  `appearance: none`, which removes the platform look but *not* the UA's `buttonface`
  background.
- **The command log dimmed settings writes and lit up remote listings.** `config` was classified
  read-only and `remote` was not classified at all — the same mistake in opposite directions,
  since for both the verb is in the flags rather than the subcommand.

### Added — guard against dangling CSS classes

A test walks every `className` in the webview and fails if a `gt-` class has no rule in any
stylesheet. It found three more on its first run — the exact bug class that had just cut the
commit graph in half, invisible until it ships as a layout fault.

### Added — Settings

- A real settings sheet replaces the gear's placeholder: **Remotes** (add, edit, remove, with
  differing push URLs preserved), **User** identity with a "use global" toggle showing the
  inherited values, **Appearance**, **Behaviour**, and the repository's own details.
- Every write runs through the same path `commands/run` uses, so each edit is journaled and
  appears in the command log like a command you typed.

### Changed — fewer clicks

- **History is the first tab** and the default mode, matching what the middle pane shows.
- **The tip commit is selected automatically** when a walk finishes, so the review pane has
  content without a click — but only when nothing is selected or the selection has gone, so a
  watcher tick never yanks you off the commit you were reading.
- **Selecting a branch goes to its tip**, scrolling the graph to that commit and loading it into
  the review pane.
- **Panes can be pinned or auto-hidden.** Unpinned, a pane collapses to a rail when focus leaves
  and slides open *over* the content on hover — overlaying rather than reflowing, so the graph
  and diff do not jump every time the pointer crosses the rail.
- **The context bar is decluttered.** Commit ordering and show-remote-branches move into
  Settings ▸ Appearance; the bar keeps only what changes many times an hour.

### Added — three resizable panes and a review pane

- **The working area is now three independently sizable panes** — branches, commit tree, review
  — each draggable by its handle and collapsible to a rail. Sizes persist across reloads.
  Handles are `role="separator"` and move with the arrow keys, because a drag-only splitter is
  unusable without a mouse. Dragging uses pointer capture, so a fast drag that outruns the
  handle keeps working.
- **The middle pane is no longer modal.** History and the working tree are visible at the same
  time, which is the point of three panes. The Changes/History switcher now drives the *review*
  pane, and selecting in the tree moves the switcher with it — selecting a commit switches to
  History, selecting the pinned **Uncommitted changes** row switches to Changes. Without that
  coupling, clicking a commit while in Changes mode appears to do nothing.
- **Review pane**, modelled on pull-request review surfaces: file counts and `+N −N` totals from
  `git diff --numstat`, a filter, sort modes, per-file **Viewed** state, a folder tree that
  collapses single-child chains, and old/new line gutters. Splits file-tree | diff above 900px
  and stacks below it.
- **Telling staged from unstaged.** A file that is partly staged with further edits appears in
  both groups, and nothing previously said the two rows were the same file. Every path now shows
  its *two* git statuses — index and working tree — as a two-cell pill, so "in both states" is
  visible at a glance and position rather than hue carries the meaning. The pill is also the
  control: the left cell stages, the right unstages. Rows are multi-selectable and draggable
  between groups, with keyboard parity.
- **Search is a permanent field in the context bar**, filtering the commit tree. It re-runs the
  walk rather than filtering what is loaded — the view holds one page, so a local filter would
  search that page while appearing to search the repository.
- **Theme toggle** in the toolbar, cycling Follow VS Code → macOS Light → macOS Dark → Graphite
  → Midnight.
- **Keyboard scheme** — 50 bindings across 8 groups, with a <kbd>?</kbd> sheet generated from
  the same table the matcher reads so help cannot drift from behaviour. Bare letters are used
  deliberately: every git action opens its command sheet rather than executing, so a mistyped
  key shows a dialog rather than pushing. Avoids `Alt`+letter (opens the Windows menu bar) and
  `Ctrl`+`Shift`+letter (VS Code claims most of them), both asserted by tests.

### Added — instant refresh

- The watcher now debounces on the **leading edge**: the first change fires immediately and the
  rest of a burst coalesces into one trailing refresh. A checkout touching a thousand files
  still costs about two refreshes; a single save costs no delay at all.
- The host listens to `onDidSaveTextDocument` and the create/delete/rename file events, which
  fire *before* the filesystem watcher notices.
- `gitTree.autoRefresh` mirrors SourceTree's setting, with <kbd>r</kbd>, <kbd>F5</kbd>, and
  `Ctrl+Shift+G R` for manual refresh.

### Changed — build and the F5 loop

- **Typechecking moved from the build to a pre-commit hook.** esbuild and vite both erase
  TypeScript without checking it, so the check has to exist somewhere — but gating `npm run
  build` on it taxed every F5 with two full `tsc` passes to catch something that only matters
  once. `.githooks/pre-commit` runs it instead, installed by `npm install` via `core.hooksPath`
  and bypassable with `--no-verify`. `npm run build` is back to 4.5s, down from 70s.
- **The bundle steps no longer nest `npm run` calls.** Vite reported 6.5s while the wall clock
  was 49.5s; almost all of the difference was npm process startup, paid twice.
- **`.vscode/tasks.json` now exists.** `launch.json` referenced `npm: build`, which relies on
  npm task auto-detection — commonly disabled, and when it is, F5 fails with "Could not find the
  task" and the host never launches, which reads as the extension being broken.
- **TypeScript errors surface earlier than the gate ever did.** A `gittree: watch types`
  background task runs `tsc --watch` with the `$tsc-watch` problem matcher, so errors appear in
  the Problems panel as you type. It starts on folder open.
- A **Run GitTree (clean host)** launch configuration starts the host with `--disable-extensions`,
  which is how to tell whether console output belongs to GitTree or to another extension.

### Changed — the commit graph

- **Rail colours now belong to a branch, not to a lane index.** A colour is assigned when a rail
  is opened and held until it ends, so a branch keeps one hue for its whole visible life instead
  of changing whenever lanes are recycled beneath it. Colours advance from a counter rather than
  the lane number, so consecutive branches are visibly distinct and lane 0 is not permanently
  one colour. Merge rails take the colour of the branch they join, so the eye follows the
  destination.
- **Twelve rail colours instead of eight**, walking the wheel in large steps. With eight, a busy
  repository wrapped often enough that two visible rails regularly shared a hue — exactly when
  the graph stops being readable. Both themes have their own values; the light-mode colours sink
  into a dark ground.
- **Node shape carries meaning that colour cannot.** A merge is a ring, a root is a square, an
  ordinary commit a filled dot — legible with any colour vision. Nodes are larger, and punch a
  gap in the rails behind them so they sit on top rather than being crossed.
- **Author chips.** Initials tinted by a hash of the email, so a run of commits from one person
  reads at a glance. No avatar images: they would mean network access from a panel that makes
  none, with nothing to load and nothing to leak.
- **Ref pills are tinted per kind and carry a glyph**, so branch, remote, and tag are
  distinguishable without reading them. The checked-out branch is filled rather than outlined.
  A remote pill drops the redundant `origin/` prefix.
- **Selection is a tinted band with an accent edge** rather than a solid fill, which used to
  fight the rail colours beside it and flatten the pills into one wash. The selected commit's
  node gains a soft halo and the other rails dim.

### Performance

- **History loads roughly an order of magnitude faster.** Three changes, in order of impact:
  - **Graph rows now travel with their commits.** Layout previously ran as a request *from* the
    webview: every commit was structured-cloned to the host and every row cloned back —
    megabytes on a large history — and it could not start until the walk had finished, so the
    graph stayed blank the entire time. Lane assignment is now incremental and runs as commits
    stream, so rails render with the first batch and nothing crosses the boundary twice.
  - **The history list uses a lean commit format.** The list shows a subject, author, date, and
    refs, but the walk was streaming every commit body, committer, and signature as well.
    Measured on a 20k-commit repository: 6.5 MB of output down to 3.6 MB. The inspector loads
    the full record for the one selected commit instead.
  - **The walk is capped and paged.** An unbounded `--all` walk measured ~2.5 s before returning
    anything useful; capped, ~0.5 s. Roughly thirty rows are visible at a time, so the rest was
    speculative.
- Batches now start small (120 rows) and grow to 2000, so the first screen paints within a frame
  or two rather than waiting on a full page.
- The batch accumulator no longer copies its arrays per batch, which was quadratic over the
  course of a load, and no longer spreads a batch onto the call stack — a crash rather than a
  slowdown once a batch passed ~100k entries.

### Added

- **Repository tabs.** Each open repository gets a tab inside the GitTree panel, with
  ahead/behind counts and a dirty indicator. Switching is instant — scroll position, selection,
  and filters are kept per repository rather than reloaded.
- **Action toolbar.** Commit, Fetch, Pull, Push, Branch, Merge, Stash, Discard, and Tag, laid
  out in HIG-sized hit targets. Disabled buttons state *why* rather than sitting silently inert.
- **Command learning.** Every action is defined once and rendered from the same definition that
  executes it:
  - hovering a button shows the exact command with each flag glossed in plain English;
  - the **Command Log** records every invocation with its exit code and duration, copyable and
    sendable to a terminal;
  - **"Why this command?"** opens the concept behind the action.
- **Context bar.** View modes (Changes · History · Search) moved out of the sidebar into their
  own switcher, with each mode's options beside it.
- **Object sidebar.** Branches, remotes, tags, and stashes, with folder nesting by `/`, pinned
  **Current** and **Recent** groups, and a fuzzy filter that matches the whole ref path — typing
  a ticket number finds the branch regardless of prefix.
- **Bottom ribbon.** Branch, divergence, pending changes, conflicts, operation status, terminal
  access, and the Command Log disclosure.
- **Terminal integration.** One reused VS Code terminal per repository, opened at the repo root.
  Sending a command from the log *types it without running it*, so it can be read and edited
  first.
- **The command sheet — toolbar actions now execute.** Clicking Fetch, Pull, Push, Branch,
  Merge, Stash, Discard, or Tag opens its command with the options that matter. Toggling an
  option rewrites the command; typing your own text wins over the toggles; **Apply** runs
  exactly what is written and shows stdout and stderr verbatim in place, because a rejected
  push or a conflicted merge is information rather than an error to dismiss. Destructive
  commands require an explicit acknowledgement first.
  - The edited string is split into an argument list and passed to `spawn` with `shell: false`,
    so shell metacharacters in a branch name or message are inert. `git` is fixed outside the
    field: the endpoint cannot invoke any other program.
- **Themes.** Follow VS Code by default, plus macOS Light, macOS Dark, Graphite, and Midnight.
- `refs/list` for the sidebar, backed by a `for-each-ref` parser that resolves tracking state
  and dates for both lightweight and annotated tags.

### Fixed

- **History showed "No commits yet" on repositories that had commits.** The correlation id for a
  history stream was learned from the `log/start` *response*, while the host began emitting
  batches immediately on receiving the request. Every batch that won that race was dropped — on
  a small repository, all of them, including the terminal one, leaving the view permanently
  empty. The id is now minted by the webview and sent *with* the request, so no batch can be
  unroutable. Regression tests in `test/logStream.test.ts`.
- **A cancelled history stream could cancel the wrong one.** The stream id lived in a `useRef`
  shared across effect runs, so React StrictMode's mount → unmount → mount could make the first
  cleanup cancel the second run's live stream. The id is now scoped to its effect.

### Changed

- The shell was rebuilt around SourceTree's arrangement, with one deliberate departure: view
  modes and repository objects no longer share the sidebar. Mixing them meant that with forty
  branches the modes scrolled out of sight.

## [0.1.0]

### Added

- Repository discovery across workspace folders at any depth, classifying ordinary checkouts,
  nested repositories, submodules, and linked worktrees.
- Path identity that collapses every Windows spelling of a directory — separators, drive-letter
  case, junctions, symlinks — to one repository.
- Status parsing (`--porcelain=v2 -z`), including the rename record whose source path arrives as
  a separate NUL-terminated field, and unmerged records carrying all three merge stages.
- Staging by file, hunk, and individual line, with patches validated by `git apply --check`
  before being applied.
- Commit with amend, sign-off, GPG/SSH signing, and co-authors. Failing hooks surface their own
  output verbatim.
- Commit graph with lane assignment across merges and octopus merges, virtualised for large
  histories.
- Diff viewing with rename and binary detection.
- A single global process pool with per-repository fairness, and one workspace watcher routed to
  all repositories by longest-prefix match.
- Apple HIG design token layer supporting light, dark, and high-contrast.
