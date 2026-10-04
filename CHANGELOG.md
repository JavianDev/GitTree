# Changelog

All notable changes to GitTree are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- A **Git Tree** button in the status bar opens the panel from anywhere.

### Changed

- **Git failures appear as a floating card** instead of a full-width banner that pushed the panes
  down. It names the problem in a line, keeps git's own message one click away with **Copy**, and
  offers fixes read from that message: **Stash & Retry** and **Review Changes** when uncommitted work
  is in the way, **Pull** for a rejected push, **Push and Set Upstream** for a new branch, and the
  **Command Log**.

### Fixed

- The **◂ hide button** is back in the top-right corner of the Branches, Git Tree and Files panes,
  always visible, so a pane can be folded away by hand.
- **Scrollbars, checkboxes, dropdowns and other native controls follow Git Tree's theme** instead of
  VS Code's. A light Git Tree theme in a dark VS Code no longer shows dark scrollbars, and scrollbars
  are thin, without arrow buttons.

### Changed

- **No more hover auto-hide.** Collapsed panes are plain rails again that open when you click them,
  as in 0.10.1; a pane no longer pops open over its neighbour while the pointer passes over it.
- **Restore panels** now sits at the left edge of the Files pane, beside where the hidden panes were.
- The commit graph starts a few pixels in from the edge, so the leftmost line no longer runs into the
  selected row's accent bar on narrow screens.

### Added — act on any commit in the Git Tree pane

- **Double-click a commit row** to check out its branch, as double-clicking it in the sidebar does.
  A branch held by another worktree offers that worktree; several branches show the menu to choose;
  a remote branch opens `git switch --track`, and a commit with no branch opens
  `git switch --detach`, each for review first.
- **Right-click a commit row** for a panel with the commit's details — parents (click to go to one),
  author and date, committer and commit date, signature, refs, and the full message — beside its
  actions: Check Out, Merge into the current branch, Rebase onto it, New Branch Here, New Tag Here,
  Cherry-pick, Reverse Commit (`git revert`), Reset the current branch (soft, mixed or hard; hard
  asks for confirmation), Archive (`.zip`, `.tar.gz` or `.tar`), Create Patch (`git format-patch`),
  Copy SHA and Copy Short SHA. It replaces the webview's Cut / Copy / Paste menu on commit rows.
  The context-menu key and Shift+F10 open it from the keyboard.
- **Click a commit's dot** in the graph to see its details on their own.
- The New Branch and Tag sheets gain Name (and Message) fields.


### Fixed — README screenshots on the Marketplace and in VS Code

- The README's screenshots are now linked to the exact commit of each release instead of the latest
  files on GitHub. Screenshots replaced under the same file name could keep showing their older
  version from a cache — in VS Code's extension page, the browser, or GitHub's CDN — so the 0.11
  images could appear out of date. Every release now has its own image URLs.

### Added — Worktrees

- **A WORKTREES section in the sidebar**, right after Branches: every worktree of the repository from
  `git worktree list`, the main one first and the rest grouped by branch folder, with `main`, `current`,
  `locked`, `missing` and `detached` badges, uncommitted-change counts, ahead/behind, colour labels, and
  the full and shortest-unique path in the tooltip. The filter box finds worktrees too.
- **Worktree details** (a new Worktree view): the worktree's branch, path, changes and upstream; its
  staged, changed and untracked files (stage and unstage in that worktree); and the commits it has not
  pushed — each file's or commit's diff in the Code pane.
- **New Worktree** (`W`, the section's **+**, a branch or tag's right-click menu, or *GitTree: New
  Worktree…* / `Ctrl+Shift+G W`): a new branch from any branch, remote branch, tag or commit; or an
  existing branch, a remote branch as a new tracking branch, or a tag or commit detached. The folder is
  suggested from the repository's settings (default: `<repo>.worktrees` beside the repository) and
  editable; untracked files such as `.env` and `.venv` can be copied across (never overwriting, never
  `.git`, with a preview and a size limit); and pull, push and lock can follow. Every step is listed
  before it runs, the `git worktree add` command is editable, and each step's output is shown.
- **Open** a worktree as a Git Tree tab (also from outside the workspace — it gets its own file
  watcher), in a new VS Code window, or in this one, reopening the sub-folder you were in.
- **Reveal**, **Terminal**, **Copy Path**, **Colour Label**, **Lock** (with a reason) / **Unlock**,
  **Move**, **Prune**, **Repair**, and **Remove** — which asks for exactly the force git needs (once for
  uncommitted changes, twice for a locked worktree), can delete the branch too, and first closes Git
  Tree's own terminal and watchers on the folder so Windows lets git delete it.
- **Clean Up Gone Branches**: delete local branches whose remote branch was deleted.
- **Settings ▸ Worktrees**: where worktrees go — beside the repository, in a folder inside it (added to
  `.git/info/exclude`), or anywhere, with `${userHome}`, `${repoName}`, `${repoParent}`, `${repoRoot}`
  and `${branch}` — per repository or for all; keeping branch folders; open behaviour; pull/push after
  creating; copy patterns; deleting gone branches on remove; colour labels; an optional title-bar
  tint; and extra folders to scan. Settings are written to `gitTree.worktrees.*` and
  `gitTree.discovery.extraPaths`, or stored per repository by Git Tree.
- A branch checked out in another worktree is marked `wt`, and double-clicking it offers that worktree
  instead of running a `git switch` that git would refuse. Branches and tags gain a right-click menu.

### Changed

- **Stashes moved to the very end of the sidebar**, after Pull Requests.
- When Bitbucket or GitLab browser sign-in isn't set up in a build, signing in now says so and offers
  the setup guide, instead of going straight to a token prompt.

### Fixed

- A worktree of a **bare** repository was shown as an independent repository; worktrees are now
  recognised by their `commondir`, and linked to their main repository.
- A linked worktree's branch moves (commits, fetches) did not refresh it: their refs live in the shared
  git directory, which is now watched too.
- `git worktree list` was logged as a change in the command log; it is a read.
- Double-clicking a branch that could not be checked out did nothing visible; git's reason is now shown.

### Changed — a leaner package, and a README that shows 0.10

- **The extension download is about 650 KB, in 17 files.** The package carried the TypeScript
  sources, the tests, React's `node_modules` (already bundled into the webview), editor and agent
  settings folders, and the README's screenshots. None of it is loaded at runtime — the extension
  runs entirely from `dist/` — so `.vscodeignore` now leaves it out. The README's images are served
  from the repository, as before.
- **README:** every screenshot retaken from the current UI against the GitTree-Demo repository,
  cropped to what each section is about, plus new ones for the Push and Stash tabs and the keyboard
  sheet; a "New in 0.10" summary; Stash's shortcut corrected to `Shift+S`.
- **Tests** for Commit & Push against a real remote (a hook that refuses the commit, skipping hooks,
  the outgoing list before and after a push, the exact push argv, a push the remote refuses) and for
  every path of the AI commit-message draft.

### Added — a Files pane that does the work

- **Commit / Push / Stash tabs** across the top of the Files pane, each with its count:
  *Commit (N)* is the changed files and the commit box; *Push (N)* lists exactly the commits a push
  would send (against the upstream, or every unpublished commit on a new branch) with **↑ Push** and,
  when you are behind, **↓ Pull N**; *Stash (N)* lists every stash with Apply / Pop / Drop on the row
  and **Stash changes…**. Each action still opens the review-before-run command sheet.
- **Changes, Untracked Changes and Staged Changes sections**, each with a tick-all checkbox and a
  file count. Every file row has a stage checkbox (tick to stage, untick to unstage) and a file-type
  icon; the name is coloured by what happened to it (added green, deleted struck through, renamed
  blue). New files get their own section, as in VS Code's Source Control view. These replace the
  two-cell ◧◨ pill.
- **A toolbar** on the summary row: discard all changes to tracked files (untracked files are
  kept), expand all folders, collapse all folders, refresh.
- **✨ AI commit messages.** One click drafts a summary and description from the staged diff (or
  from all changes when nothing is staged) using the language model you already have in VS Code,
  such as GitHub Copilot, through VS Code's own `vscode.lm` API. No API key and no extra account;
  VS Code asks your permission the first time. With no model available, it drafts one from the
  changed files instead and says so.
- **Summary and description** are now separate fields, like GitHub Desktop; the message is the
  summary, a blank line, then the description. Amend and merge messages are split into both.
- **Commit & Push** beside Commit (`Ctrl+Shift+Enter`), which commits, then pushes to `origin`,
  setting the upstream on a branch's first push. A refused push is shown verbatim beside the box,
  after the commit has landed.
- **Run git hooks**, on by default. Untick it to commit with `--no-verify`, skipping pre-commit
  and commit-msg hooks for that commit.

### Changed — crisper panes that size themselves

- **Every pane has a title bar** (Branches, Git Tree, Files, Code) and its pin and collapse buttons
  now live in it. They used to float over the top-right corner of the pane, on top of whatever that
  pane put there — the text beside **⇤ Restore panels** was hidden behind them.
- **Panes fit their text.** When the Branches, Git Tree or Files pane opens — on start, on a
  repository switch, from its rail, or through Restore panels — it widens or narrows to show its
  branch names, commit messages or file names in full, with no gap to the next pane. The Git Tree
  pushes the Files pane along into the Code pane rather than squeezing it. Each pane has a ceiling so
  one very long name cannot take the row, and a double-click on a divider fits the pane to its left.
- **The Git Tree's author and date are aligned columns** that start at the same point on every row,
  instead of wherever each row's message happened to end.
- Removed ten base64 copies of the README screenshots that nothing used (3.9 MB, over half the
  extension's download size).

### Changed — the commit graph, redrawn

- **No gap between the graph and the commit messages.** The graph is now a transparent layer over
  the commit list instead of a column beside it, and every row indents its text by exactly its own
  rails — so a message sits right beside its node, rather than after one wide graph column sized
  for the busiest row in history. Rails never reach into text; a test checks this row by row
  against the demo repository's history.
- **Glassy nodes, each shape with its own meaning.** Commits are glass orbs (a gradient lit from
  the top left, a darker rim, a specular glint, a soft glow in the rail's colour); merges are
  lenses with a dark glass core; the root commit is a rounded-square gem. The selected commit gets
  a ring and a stronger glow. Rails carry a soft glow of their own, drawn as a faint wide stroke
  rather than a blur filter so scrolling stays smooth. Nodes erase the rails beneath them instead
  of painting a background-coloured disc, so they sit cleanly on the row's hover or selection band.
- **Merge commits get an M badge**, and branch pills are tinted in their rail's colour (the
  checked-out branch as a filled glassy pill), so the eye goes from a label straight to its line.
- Author and avatar move to the end of the row and drop out first when the pane is narrow, so the
  message keeps the room.

### Added — browser sign-in for every pull request provider

- **Bitbucket and GitLab now sign in through the browser**, like GitHub and Azure DevOps already did
  through VS Code's accounts: *Sign in with your browser* opens bitbucket.org or gitlab.com, you
  approve Git Tree, and you're returned to VS Code. No token to create or paste. Logins are kept in
  VS Code's secret storage and refreshed automatically; a refresh the provider refuses clears the
  login so sign-in is simply offered again.
- Built on one shared OAuth 2.0 authorization-code engine: a random `state` on every sign-in guards
  against forged callbacks; GitLab uses PKCE as a public client (no secret); Bitbucket, which only
  supports confidential clients, returns to a one-shot local page on `127.0.0.1:47231`, as Git
  Credential Manager does. GitLab returns through VS Code's own `vscode://` link handler.
- The app registrations are built in from a git-ignored `oauth-clients.json` at release time, and can
  be overridden per user in Settings. API tokens / personal access tokens remain available for
  workspaces that block third-party apps. See `docs/oauth-setup.md`.

### Fixed — "Bitbucket rejected the saved credentials" said nothing about why

- A rejected sign-in now passes on the provider's own reason (for example "Token is invalid or
  expired"), and the API-token prompt spells out the most common cause: a plain Atlassian API
  token, rather than one created *with scopes* for Bitbucket, is always rejected by Bitbucket.

### Fixed — the graph stopping part-way down the pane

- **On any pane taller than 600px, the graph stopped painting 600px down** and the commit rows
  below were never rendered until you scrolled. The history view measured its list once, on first
  render — but the first render is always the empty "Reading history…" state, before the list
  exists, so the measurement found nothing, never ran again, and the viewport stayed at its 600px
  default for good. It now re-measures whenever the list mounts, follows resizes, and re-syncs on
  scroll as a safety net. This is the cut-off behind several earlier reports; the lane and
  convergence fixes in 0.8.x were real but sat on top of it.

### Fixed — stashes and merge commits showing "This commit changed nothing"

- **Selecting a stash, or any merge commit, now shows its changes.** Commit diffs asked git for
  `<hash>^!`, which for a commit with more than one parent — every merge, and every stash, which git
  stores as a merge of HEAD and the index — produces a *combined* diff (`diff --cc`, `@@@` hunks)
  that the parser drops. They now diff against the first parent (`git show -m --first-parent`):
  what a merge brought to its branch, and for a stash exactly what `git stash show -p` prints. Root
  commits still diff against the empty tree.

### Fixed — a narrow Git Tree pane hiding commit subjects

- The subject was the only part of a row that could shrink, so in a narrow pane it reached zero
  while author, date, hash, and ref pills kept their width. Now the subject keeps a minimum, pills
  shrink with an ellipsis, and the list drops secondary columns as it narrows (hash, then author,
  then date). The graph's width budget is 40% of the pane (lanes compress to fit), the Git Tree
  pane's default and minimum widths are larger, and the list no longer scrolls sideways.

### Added — a fourth pane: Files and Code side by side

- **The review pane is now two panes, Files and Code**, each resizable and collapsible like
  Branches and Git Tree. The code gets its own full-height column instead of sharing one with the
  file list (and stacking under it whenever the pane was narrower than 900px). Side-by-side diffs
  are offered once the Code pane alone is 640px wide.
- **Focus-diff now works from History too.** Clicking a file — in Changes, or in a commit's file
  list — folds Branches and Git Tree to their rails so Files and Code get the whole width;
  **⇤ Restore panels**, a rail, or switching between History and Changes brings them back.
- **Pull requests use the same four panes**: Git Tree stays visible, Files shows the PR's details
  and commits, and Code shows its diff.
- **Existing layouts carry over.** A layout saved by the three-pane build is read and its review
  pane divided into Files and Code, so pane widths you had dragged to are kept rather than reset.

### Fixed — the stash list was always empty

- **`git stash list` failed on every call since stash management shipped.** Its `--format`
  argument was built with literal NUL characters as field separators, and Node refuses to spawn a
  process whose arguments contain a NUL byte — so the call threw before git ever ran, and the
  sidebar's Stashes section had nothing to show. The format now uses git's `%x00` escapes like
  every other command. The parser tests fed it hand-built output and never spawned git, which is
  how this shipped; a new test checks every git argument list for characters Node cannot spawn and
  round-trips `git stash list` through the real `GitService` against a real repository.

### Fixed — graph rails stopping in mid-air

- **Branches that share a parent now join it.** When several branches start from the same commit,
  the layout converges them into one lane at that commit — but each branch's rail was drawn as a
  single stroke in its *own* lane, so it ended beside the parent's node instead of bending into it.
  On a history like `main` with five branches off it, that left five rails hanging in mid-air.
- **Rails no longer lose their last stretch when you scroll.** That same single stroke only existed
  while the branch tip's row was being drawn; once the tip scrolled above the window, the rail into
  the parent disappeared and the parent looked like a branch tip.
- Rails are now drawn gap by gap between adjacent rows, and the layout records which lanes converge
  into each commit, so every rail bends into its node regardless of where its tip is. Covered by a
  test that replays the exact demo-repository history and asserts no rail ends in mid-air.

### Added — focus-diff mode and new-file contents

- **Clicking a file in Changes folds the Branches and Git Tree panes to their rails**, so the diff
  gets the full width without a fourth pane. A **⇤ Restore panels** button in the review header
  (or clicking a rail) brings them back; leaving Changes restores them automatically, since History
  is read by clicking commits. Only panes this collapsed are restored — one you closed yourself stays
  closed.
- **New (untracked) files now show their contents**, as all-added lines, instead of an empty pane.
  Git has nothing to diff an untracked path against, so the host reads the file and shapes it like
  `git diff` would show a newly added file: CRLF endings normalized, a missing final newline marked,
  binary files detected, and files past 5,000 lines truncated with a note.

### Fixed — the commit graph cutting off

- **Lanes further down history were clipped.** The log stream appends each batch to the same `rows`
  array, so the gutter width — memoized on that array — was computed from the first batch only.
  Wherever history grew wider than its first page, rails and nodes were drawn past the canvas edge.
  The width is now recomputed as batches arrive, the 12-lane cap is gone, and lanes are compressed
  to fit a 240px gutter rather than ever running off it.
- **The graph trailed the list by a frame while scrolling.** The list scrolls natively, but the
  canvas repainted in a plain effect scheduled after the browser had already painted the moved rows.
  It now repaints in a layout effect flushed from the scroll handler — same frame, no tearing.
- The graph also repaints when new rows stream in inside the visible window.
- Commit rows are a little more compact (24px, 12px text, smaller author/date), and a thin sweep
  along the top of the graph shows while history is being (re)loaded. It respects reduced-motion.

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
