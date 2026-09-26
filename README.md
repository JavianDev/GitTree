# GitTree

**A SourceTree-class Git client inside VS Code — that teaches you Git while you use it.**

GitTree gives you the commit graph, line-level staging, and branch management you'd leave the
editor for, in a clean, intuitive workspace-aware interface.
Every button shows the exact Git command it runs, and a live log records everything that
executed — so the GUI makes you better at the command line instead of hiding it.

---

## Why GitTree

VS Code's built-in Git view is a flat file list and a commit box. There's no commit graph, no
line-level staging, no branch tree — and if your workspace holds a parent folder with a dozen
repositories inside it, no coherent way to work across them.

GitTree covers that gap, and adds one thing no other Git GUI does.

### It teaches the commands

Every action is defined once and rendered from the same definition that executes it, so what
you're shown is never a paraphrase of what runs.

- **Hover any button** → the exact command, with each flag explained in plain English.
- **Command Log** → a live console of every invocation, its exit code, and how long it took.
  Copy any of them, or send one to a terminal _without running it_ so you can read and edit it
  first.
- **"Why this command?"** → the concept behind the action: what a rebase does to history, when
  fetch beats pull, why `--force-with-lease` is safer than `--force`.

```
┌─ Pull ────────────────────────────────────┐
│  git pull --rebase --autostash origin main│
│                                           │
│  --rebase     replay your commits on top  │
│               instead of creating a merge │
│  --autostash  shelve uncommitted work     │
│               first, restore it afterwards│
│                          Why this command?│
└───────────────────────────────────────────┘
```

### It understands multi-repo workspaces

Open a folder containing many repositories and GitTree finds all of them, at any depth, and
tells the four kinds apart — because confusing them loses work:

| Kind           | What it is                                       | Why it matters                                                                                                                                          |
| -------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Repository** | An ordinary checkout                             | —                                                                                                                                                       |
| **Nested**     | A separate repo inside another's working tree    | Its parent sees only an untracked _folder_. Staging that would commit an empty gitlink and lose everything inside, so GitTree refuses and explains why. |
| **Submodule**  | A repo the parent tracks by commit               | Shown under its parent, with pointer drift visible                                                                                                      |
| **Worktree**   | A linked checkout sharing another repo's objects | Never presented as an independent clone                                                                                                                 |

Each open repository gets a tab. Switching is instant — scroll position, selection, and filters
are kept per repository rather than reloaded.

### It scales to real branch lists

Forty-seven branches named `feature/INST-11308-crm-decoupling-ingestion` is the normal case, not
the edge case:

- Branches nest into collapsible folders by `/`, with a count per folder.
- **Current** and **Recent** stay pinned above the tree, so where you are is never buried.
- The filter fuzzy-matches the **whole path** — type `11308` and the branch surfaces
  immediately, no prefix required. <kbd>Enter</kbd> checks out the best match.

---

## Requirements

|               |                                                   |
| ------------- | ------------------------------------------------- |
| **VS Code**   | 1.100 or newer                                    |
| **Git**       | 2.11 or newer, on your `PATH` (2.20+ recommended) |
| **Platforms** | Windows, macOS, Linux                             |

GitTree runs _your_ Git binary, so your config, credential helpers, hooks, SSH keys, and
signing setup all work exactly as they do in a terminal. Nothing is reimplemented, and no
credentials pass through the extension.

If Git isn't on your `PATH`, set `gitTree.git.path` to its absolute location.

---

## Getting started

1. Install GitTree and reload VS Code.
2. Open a folder — or a parent folder holding several repositories.
3. Click the **GitTree** icon in the activity bar, or press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd> then <kbd>T</kbd> (<kbd>⌘</kbd>+<kbd>⇧</kbd>+<kbd>G</kbd> <kbd>T</kbd> on macOS).

The Repositories view lists everything found. Selecting one opens it as a tab in the main panel.

---

## The interface

Three panes you can resize and collapse, so history and the working tree are visible at once.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ [web 18↓] [api ×] [gp360-fe] [data-pipelines] [+]          repository tabs│
├──────────────────────────────────────────────────────────────────────────┤
│ ⊕Commit ↓Pull ↑Push⁴ ⇅Fetch │ ⑂Branch ⤙Merge ⛁Stash │    ☀ Light  ⚙     │
├──────────────────────────────────────────────────────────────────────────┤
│ ┌Changes│History┐  ⌕ search commits…  Message ▾  All Branches ▾  Date ▾  │
├───────────┊──────────────────────┊───────────────────────────────────────┤
│ BRANCHES  ┊ COMMIT TREE          ┊ REVIEW                                │
│ ⌕ 11308   ┊ ⦿ Uncommitted    (3) ┊ ┌ 29 files · +3415 −41 ── 0 of 29 ───┐│
│   3 of 47 ┊ ● feat: add parser   ┊ │ ▣ STAGED · 2         Unstage All   ││
│ ▾ CURRENT ┊ ├● fix: porcelain v2 ┊ │  ◧ M src/app.ts   also unstaged    ││
│ ▾ RECENT  ┊ ● Merge PR #412      ┊ │ ▤ UNSTAGED · 3        Stage All    ││
│ ▾ BRANCHES┊                      ┊ │  ◨ M src/app.ts    also staged     ││
│  ▸ bugfix ┊                      ┊ ├──────────────┬─────────────────────┤│
│  ▾ feature┊                      ┊ │ ▾ Insight.Api│ @@ -0,0 +1,90 @@    ││
│ ▸ REMOTES ┊                      ┊ │   Company…cs │ + using Asp.Vers…   ││
│ ▸ TAGS    ┊                      ┊ └──────────────┴─────────────────────┘│
│     ◂     ┊         ◂            ┊                                       │
├───────────┴──────────────────────┴───────────────────────────────────────┤
│ ⑂ feature/INST-11308  ↑4 ↓18  ⛁2 │  Terminal   ▴ Command Log            │
└──────────────────────────────────────────────────────────────────────────┘
       ┊ drag to resize      ◂ collapse
```

**Modes are separated from objects.** SourceTree puts File Status, History, and Search in the
same column as branches and tags — two different kinds of thing competing for one space, so
with forty branches the modes scroll out of sight. In GitTree the switcher drives the _review_
pane, search is a permanent field that filters the _commit tree_, and the sidebar does the one
job a source list is for.

Selecting a commit switches the review pane to History; selecting **Uncommitted changes** at the
top of the tree switches it to Changes. The switcher stays an explicit control, it just cannot
end up pointing somewhere your selection isn't.

## Telling staged from unstaged

The hard case is a file that is _both_ — partly staged, with further edits still in the working
tree. It appears in both groups, and most clients give you no way to tell those two rows are the
same file.

Git's own model is that every path has two statuses, one in the index and one in the working
tree. GitTree shows both, as a two-cell pill:

```
◧  staged only        ◨  unstaged only        ◧◨  both
```

Position carries the meaning, not just colour, so it reads with any colour vision — and it makes
"this file is in both states" visible at a glance. **The pill is also the control:** click the
left cell to stage, the right to unstage. Rows are multi-selectable and draggable between the
Staged and Unstaged groups, with <kbd>→</kbd> and <kbd>←</kbd> doing the same from the keyboard.

## Keyboard

Press <kbd>?</kbd> for the full list — it's generated from the same table the shortcuts run off,
so it can't drift. The scheme uses bare letters, which is safe here for a specific reason: every
git action opens its command sheet rather than executing, so a mistyped <kbd>p</kbd> opens a
Pull dialog you can read and cancel.

|                                                        |                   |                                                         |                     |
| ------------------------------------------------------ | ----------------- | ------------------------------------------------------- | ------------------- |
| <kbd>j</kbd> <kbd>k</kbd>                              | Move              | <kbd>s</kbd> <kbd>u</kbd>                               | Stage / unstage     |
| <kbd>Space</kbd>                                       | Select            | <kbd>Ctrl</kbd>+<kbd>Enter</kbd>                        | Commit              |
| <kbd>/</kbd>                                           | Filter            | <kbd>f</kbd> <kbd>p</kbd> <kbd>Shift</kbd>+<kbd>P</kbd> | Fetch / Pull / Push |
| <kbd>g</kbd> <kbd>c</kbd> · <kbd>g</kbd> <kbd>h</kbd>  | Changes / History | <kbd>r</kbd>                                            | Refresh             |
| <kbd>Ctrl</kbd>+<kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> | Focus a pane      | <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>T</kbd>             | Cycle theme         |

---

## Features

**Working with changes**
Staged / unstaged / conflicts, staging by **file, hunk, or individual line**, discard with
confirmation, side-by-side and inline diffs, open any line straight in the editor.

**Committing**
Amend, sign-off, GPG and SSH signing, co-authors, commit templates. A failing `pre-commit` or
`commit-msg` hook shows **its own output verbatim** — never replaced with "commit failed".

**History**
Commit graph with correct lane assignment across merges, ref decorations, author and date
columns, commit inspector with per-file diffs. Virtualised, so a 50,000-commit repository
scrolls at full speed.

**Settings**
The gear opens repository settings: remotes (add, edit, remove), committer identity with a
"use global" toggle showing the inherited values, appearance, and the repository's own details.
Every write runs as a real git command and appears in the command log — a settings screen that
changed your config invisibly would be the one place this tool stopped teaching.

**Themes**
Follows your VS Code light/dark theme by default, plus **macOS Light**, **macOS Dark**,
**Graphite**, and **Midnight** — cycled from the toolbar or <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>T</kbd>.
High-contrast is fully supported, and every animation respects `prefers-reduced-motion`.

**Instant refresh**
Changes appear as you make them. The watcher fires on the leading edge, so a single save is not
delayed by the window that exists to coalesce a thousand-file checkout, and the host also listens
to the editor's own save, create, delete, and rename events — which arrive before the filesystem
watcher notices. Set `gitTree.autoRefresh` to `false` to drive it manually with <kbd>r</kbd>.

**Accessibility**
Full keyboard navigation, correct ARIA roles on trees, lists, and grids, visible focus rings,
and live-region announcements for long-running operations.

---

## Settings

| Setting                              | Default       | What it does                                |
| ------------------------------------ | ------------- | ------------------------------------------- |
| `gitTree.git.path`                   | _(auto)_      | Absolute path to your Git binary            |
| `gitTree.git.maxConcurrentProcesses` | `0` (auto)    | Git processes across _all_ repositories     |
| `gitTree.discovery.maxDepth`         | `4`           | Folder depth to scan for repositories       |
| `gitTree.discovery.excludeGlobs`     | `[]`          | Extra folder names to skip                  |
| `gitTree.followActiveEditor`         | `true`        | Active repo follows the file you're editing |
| `gitTree.accentColor`                | `#007AFF`     | Interface accent                            |
| `gitTree.graph.density`              | `comfortable` | Commit graph row height                     |
| `gitTree.dateFormat`                 | `relative`    | How commit dates render                     |

`node_modules`, `dist`, `build`, `target`, `.venv` and similar are skipped automatically —
scanning them is what makes other tools slow to open a large workspace.

---

## Privacy

GitTree runs entirely on your machine. It executes your local Git binary and reads your
repositories; it sends **nothing** anywhere. There is no telemetry, no analytics, and no
network access of any kind.

AI features are planned for a later release. They will be **off by default**, require explicit
opt-in, show you the exact payload before anything is sent, and never run in the background.

---

## The command sheet

Clicking a toolbar action opens its command, **editable**, with the options that matter:

```
┌─ Pull ─────────────────────────────────────────────┐
│  git │ pull --rebase --autostash origin main       │
│                                                    │
│  ☑ Rebase   ☑ Autostash   ☐ Prune                  │
│                                                    │
│  --rebase     replay your commits on top instead   │
│               of creating a merge commit           │
│                                                    │
│  Why this command?        [ Cancel ]  [ Apply ]    │
└────────────────────────────────────────────────────┘
```

Toggle an option and the command rewrites itself. Type your own flags and the text wins.
**Apply** runs exactly what's written, and the output — a rejected push, a conflicted merge —
stays on screen verbatim rather than being replaced with a summary.

`git` sits outside the field because this can only ever run git. What you type is split into an
argument list and passed to `spawn` with `shell: false`, so a `;` or `&&` in a branch name or
message is an ordinary character, not an instruction.

## Status

GitTree is actively maintained. The extension provides robust Git repository management with
all core features fully functional and tested.

---

## License

Copyright (c) 2026 Javian Picardo Group Inc

Licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
