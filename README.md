# GitTree — Visual Git Management for VS Code

**A SourceTree-class Git client inside VS Code — featuring a real commit graph, line-level staging, multi-repo support, and a command sheet that teaches you Git while you use it.**

> Every button shows the exact Git command it runs. Every action is editable before execution. The GUI makes you better at the command line instead of hiding it.

---

## ✨ What Makes GitTree Different

### 1. **Three-Pane Layout** — See Everything At Once

Unlike VS Code's flat file list, GitTree shows your branches, commit graph, and changes side-by-side. No modal dialogs, no context switching.

![GitTree Main Interface — three resizable panes with branches, commit graph, and staged/unstaged files visible simultaneously](media/screenshots/01-three-pane-layout.png)

- **Left pane:** Branches, tags, remotes, and stashes organized hierarchically
- **Middle pane:** The full commit graph with correct lane assignment, real-time as you work
- **Right pane:** File-level diff, line-level staging, and conflict resolution

### 2. **Commit Graph That Actually Works**

Real lane assignment across merges, decorations for HEAD/tags/upstream, author and date columns, and instant navigation. Virtualised so a 50,000-commit repository scrolls at full speed.

![Commit Graph — lanes don't cross, merges are clear, clicking a commit shows its diff instantly](media/screenshots/02-commit-graph.png)

**Key features:**
- Click a commit to see its full diff side-by-side
- Navigate by keyboard: `j`/`k` to move, `Space` to select
- Filter by message, author, or date without re-rendering
- Decorated with refs (branches, tags, `HEAD`, upstream markers)

### 3. **Line-Level Staging** — Stage Exactly What You Mean

Pick individual lines, hunks, or whole files. The interface shows **which state each file is in** using a two-cell pill: `◧` (staged), `◨` (unstaged), or `◧◨` (both).

![Staging UI — two-cell pills show file state, click cells to stage/unstage, drag to reorder](media/screenshots/03-line-level-staging.png)

- Stage by file, hunk, or individual line
- Drag files between Staged and Unstaged groups
- Use `→` and `←` keyboard shortcuts
- Multi-select with `Space`, arrow keys to navigate
- Discard with confirmation to prevent accidents

### 4. **Commit with Full Control**

Amend, sign-off, GPG/SSH signing, co-authors, and commit templates — all editable before you press Enter.

![Commit Sheet — editable message, amend checkbox, signoff, GPG signing options](media/screenshots/04-commit-sheet.png)

- **Pre-commit hooks** show their output verbatim, never replaced with "commit failed"
- **Co-authors** via trailer syntax (recognized by GitHub, GitLab, etc.)
- **Signing** — GPG or SSH (git handles the credential, GitTree just enables the flag)
- **Templates** — `.gitmessage` support

### 5. **The Command Sheet — Learn Git While You Click**

Every action opens a modal showing the exact command, **editable in real-time**. Toggle options and the command rewrites itself. Hover to see a plain-English explanation of each flag.

![Command Sheet — editable command field, toggleable options, plain-English explanations](media/screenshots/05-command-sheet.png)

**Why this matters:**
- Mistyped? See the dialog **before anything runs**
- Want to add a flag? Edit the command directly
- Want to understand the flags? Hover for the teaching card
- **"Why this command?"** button explains the concept (what `--rebase` does, when `--force-with-lease` is safe)

### 6. **Command Log — Copy, Send to Terminal, or Re-run**

A live console of every git invocation, exit code, runtime, and output. Copy any command and paste it into your terminal. Or send it unsigned so you can read and edit it first.

![Command Log — shows all git commands, exit codes, durations, with Copy and Send buttons](media/screenshots/06-command-log.png)

- Scroll through your session history
- Copy any command verbatim (including pipes/redirects)
- "Send to Terminal" types it in the integrated terminal without running it
- Filter by command, repo, or date

### 7. **Branch Management at Scale**

With forty-seven branches, a flat list is useless. GitTree nests branches by `/`, collapses folders, and lets you fuzzy-search the full path.

![Branch Sidebar — folders collapse/expand, Current/Recent stay pinned, search filters instantly](media/screenshots/07-branch-sidebar.png)

- **Current** and **Recent** branches pinned above the tree
- Type to filter — matches the whole path, not just the prefix
- `Enter` checks out the best match (or double-click)
- Shows ahead/behind counts and whether upstream exists

### 8. **Fetch, Pull, Push, Merge, Stash — All at Your Fingertips**

One-click toolbar buttons for the most common operations. Each opens the command sheet for a second to review. Keyboard shortcuts available (press `?` to see them all).

![Toolbar — Commit, Pull, Push, Branch, Merge, Stash icons with badges for unmerged commits](media/screenshots/08-toolbar.png)

| Action | Keyboard | Notes |
|--------|----------|-------|
| Fetch | `f` | `--all` and `--prune` by default |
| Pull | `p` | `--rebase --autostash` by default |
| Push | `Shift+P` | Sets upstream on first push |
| Branch Create | `b` | Checks out immediately |
| Merge | `m` | `--no-ff` by default (leaves history clear) |
| Stash Push | `s` | `--include-untracked` by default |

### 9. **Multi-Repo Workspaces**

Open a folder and GitTree finds every repository inside it — at any depth. Understands the difference between nested repos, submodules, and worktrees.

![Repositories View — tabs for each open repo, instant switching, state kept per-repo](media/screenshots/09-multi-repo.png)

- **Tabs** for each open repository
- Scroll position, selection, and filters remembered per-repo
- Detects and explains submodules vs. nested repos (prevents accidents)
- Worktrees never presented as independent clones

### 10. **Themes — Light, Dark, macOS, Graphite, Midnight**

Follows your VS Code theme by default. Also offers curated system-class alternatives.

![Theme Selector — dropdown showing Light, Dark, macOS Light, macOS Dark, Graphite, Midnight](media/screenshots/10-themes.png)

- Cycle themes with `Ctrl+Alt+T` (macOS: `⌘+⌥+T`)
- High-contrast mode fully supported
- Animations respect `prefers-reduced-motion`

---

## 🎬 Feature Walkthroughs

### Workflow: Stage a Change and Commit It

```
[Demo GIF: Open a file with staged + unstaged changes, highlight a hunk,
           press 's' to stage it, write a commit message, Ctrl+Enter to commit]
```

[**Watch:** git add → commit in 15 seconds](media/demo-stage-commit.gif)

### Workflow: Check Out a Branch Via Sidebar

```
[Demo GIF: Type in the filter box to find a branch, press Enter to switch,
           watch the graph and diff update in real time]
```

[**Watch:** Find and checkout a feature branch](media/demo-checkout-branch.gif)

### Workflow: Fetch, Review, and Push

```
[Demo GIF: Press 'f' for fetch, review incoming changes in the graph,
           press Shift+P to push when ready]
```

[**Watch:** Fetch and push with full visibility](media/demo-fetch-push.gif)

---

## 📋 Complete Feature List

✅ **Working today:**

- ✓ Repository discovery (nested, submodules, worktrees, at any workspace depth)
- ✓ Real commit graph with correct merge lane assignment
- ✓ Status and staging (file / hunk / individual line)
- ✓ Commit (amend, sign-off, GPG/SSH signing, co-authors, templates)
- ✓ Diff (file-level and line-level, side-by-side and inline)
- ✓ History search (by message or author)
- ✓ Fetch, Pull, Push, Branch, Merge, Stash, Tag operations
- ✓ Command log and editable command sheet
- ✓ Remote management (add / remove / setUrl)
- ✓ Settings panel (identity, appearance, repository details)
- ✓ Integrated terminal with command clipboard
- ✓ Themes (Light, Dark, macOS Light/Dark, Graphite, Midnight)
- ✓ Full keyboard navigation
- ✓ Multi-repo workspaces with per-repo state

---

## 🛠️ Requirements

| | |
|---|---|
| **VS Code** | 1.100 or newer |
| **Git** | 2.11 or newer, on your `PATH` (2.20+ recommended) |
| **Platforms** | Windows, macOS, Linux |

GitTree runs **your** Git binary, so your config, credential helpers, hooks, SSH keys, and signing setup all work exactly as they do in a terminal. Nothing is reimplemented, and no credentials pass through the extension.

**Git not on PATH?** Set `gitTree.git.path` in settings to the absolute path.

---

## 🚀 Getting Started

1. **Install GitTree** from the VS Code Extensions marketplace
2. **Reload VS Code**
3. **Open a folder** — or a parent folder holding several repositories
4. **Click the GitTree icon** in the activity bar (or press `Ctrl+Shift+G` then `T`)

The **Repositories** view lists everything found. Click one to open it as a tab.

---

## ⌨️ Keyboard Shortcuts

Press `?` in GitTree for the full list. Here's the quick reference:

| Action | Keys |
|--------|------|
| Move (up/down) | `j` / `k` |
| Select | `Space` |
| Stage / Unstage | `s` / `u` |
| Commit | `Ctrl+Enter` |
| Filter refs | `/` |
| Fetch / Pull / Push | `f` / `p` / `Shift+P` |
| Branch / Merge | `b` / `m` |
| Stash | `Shift+S` |
| Changes / History | `g` `c` / `g` `h` |
| Focus pane 1/2/3 | `Ctrl+1` / `Ctrl+2` / `Ctrl+3` |
| Cycle theme | `Ctrl+Alt+T` |

---

## ⚙️ Settings

| Setting | Default | What it does |
|---------|---------|--------------|
| `gitTree.git.path` | _(auto)_ | Absolute path to your Git binary |
| `gitTree.discovery.maxDepth` | `4` | Folder depth to scan for repositories |
| `gitTree.discovery.excludeGlobs` | `[]` | Extra folder names to skip |
| `gitTree.followActiveEditor` | `true` | Active repo follows the file you're editing |
| `gitTree.autoRefresh` | `true` | Auto-refresh when files change (press `r` to toggle) |
| `gitTree.accentColor` | `#007AFF` | Interface accent color |
| `gitTree.graph.density` | `comfortable` | Commit graph row height |
| `gitTree.dateFormat` | `relative` | How commit dates render (relative/absolute/iso) |

`node_modules`, `dist`, `build`, `target`, `.venv` and similar are skipped automatically.

---

## 🔒 Privacy

GitTree runs **entirely on your machine**. It executes your local Git binary and reads your repositories. It sends **nothing** anywhere — no telemetry, no analytics, no network access of any kind.

Future AI features will be **off by default**, require explicit opt-in, show you the exact payload before anything is sent, and never run in the background.

---

## 💙 Support GitTree

GitTree is **free and open source**. If you find it useful and want to support development:

**[☕ Buy Me a Coffee](https://buymeacoffee.com/javian)** — Help keep GitTree maintained and improved.

Your support goes directly towards:
- Bug fixes and stability improvements
- New features and enhancements  
- Documentation and community support

---

## 📄 License

Copyright (c) 2026 Javian Picardo Group Inc

Licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

---

## 🔗 Resources

- **[GitHub Repository](https://github.com/JavianDev/GitTree)** — Source code, issues, and contributions
- **[Marketplace](https://marketplace.visualstudio.com/items?itemName=javian-picardo-group-inc.gittree)** — Install the extension

---

**Made with ❤️ by Javian Picardo Group Inc**
