# Git Tree Commands & Shortcuts Quick Reference

## Opening Git Tree

### From Command Palette (Fastest)
Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on macOS) and type:
- `Git Tree: Open` — Opens the main Git Tree panel
- `Git Tree: Refresh` — Refresh repository state
- `Git Tree: Rescan` — Find all repositories in workspace

### Keyboard Shortcuts
| Action | Shortcut |
|--------|----------|
| Open Git Tree | `Ctrl+Shift+G` then `T` |
| Refresh Repos | `Ctrl+Shift+G` then `R` |

### From Activity Bar
Click the **Git Tree icon** (branch) in the left sidebar

---

## Inside Git Tree Panel

### Essential Operations (Press These Inside Git Tree)

| Operation | Keyboard | What It Does |
|-----------|----------|-------------|
| **Commit** | `Ctrl+Enter` | Commit staged files (after typing message) |
| **Fetch** | `f` | Fetch from origin |
| **Pull** | `p` | Pull (rebase) from origin |
| **Push** | `Shift+P` | Push to origin (or choose remote) |
| **New Branch** | `b` | Create a new branch |
| **Checkout Branch** | `/` then `Enter` | Filter branches, then checkout |
| **Merge** | `m` | Merge branches |
| **Stash** | `Shift+S` | Stash current changes |
| **Discard** | Select file + `Del` | Discard file changes (destructive) |

### Navigation

| Action | Keyboard |
|--------|----------|
| Move Up/Down | `j` / `k` |
| Select Row | `Space` |
| Stage/Unstage | `s` / `u` |
| View Help | `?` |
| Toggle Panes | `Ctrl+1`, `Ctrl+2`, `Ctrl+3` |
| Show History | `g` then `h` |
| Show Changes | `g` then `c` |
| Cycle Theme | `Ctrl+Alt+T` |

---

## Common Workflows

### Workflow: Stage Changes & Commit

1. In Git Tree, go to **Changes** view (if not already there)
2. Click files in **UNSTAGED** section to select them
3. Press `s` to stage (or click the two-cell pill)
4. Type your commit message at the bottom
5. Press `Ctrl+Enter` to commit
6. Press `Shift+P` to push

**Keyboard Only:**
1. Press `g` then `c` → go to Changes
2. Navigate with `j`/`k`, select with `Space`
3. Press `s` to stage
4. Type message
5. `Ctrl+Enter` to commit
6. `Shift+P` to push

### Workflow: Create & Checkout a Branch

1. Press `b` to create a new branch
2. Type the branch name
3. Press `Enter` (auto-checks out)
4. Make your changes
5. Stage and commit (`s` then `Ctrl+Enter`)
6. Push with `Shift+P`

### Workflow: Pull Latest Changes

1. Press `f` to fetch
2. Wait for fetch to complete
3. Press `p` to pull (rebase)
4. Resolve conflicts if needed (use staging UI)

### Workflow: Stash & Switch

1. Press `Shift+S` to stash (add a message in the command sheet if you like)
2. Press `b` to create or `/` then `Enter` to checkout another branch
3. Come back, find your stash in the **Stashes** section of the sidebar
4. Click it to preview its diff, or right-click for **Apply**, **Pop**, or **Drop**

Every stash is listed here — not just the most recent one — so this works even with several
stashes stacked up across different branches.

### Workflow: Resolve a Merge Conflict

1. When a merge, rebase, cherry-pick, or revert hits a conflict, a banner appears above the file
   list explaining what "mine" and "theirs" mean for what's happening — read it once, since the
   meaning **reverses during a rebase** (see the table in [Resolving Merge Conflicts](#resolving-merge-conflicts) below)
2. Right-click a conflicted file for **Resolve Using Mine**, **Resolve Using Theirs**, or
   **Open to Resolve Manually**
3. If you opened it manually, edit the conflict markers, then right-click → **Mark as Resolved**
4. Once every conflict is gone, the banner's **Continue** button appears (for a merge, this is just
   committing — the message box is already prefilled)
5. Changed your mind? **Abort** at any point returns everything to how it was before

---

## Pull Requests

Appears automatically in the sidebar (at the bottom, below Stashes) when your repo's remote points at
GitHub, Azure DevOps, GitLab, or Bitbucket — nothing to configure. Sign in with VS Code's own
GitHub/Microsoft account; GitLab asks for a personal access token once; Bitbucket asks for your
Atlassian account email and an API token (id.atlassian.com → Security → API tokens → "Create API
token with scopes" → Bitbucket, with `read:repository`, `read:pullrequest`, `write:pullrequest`).

| Action | Where |
| --- | --- |
| List / filter by status | Sidebar → **Pull Requests** section, status dropdown |
| Create | **+ New** button in the Pull Requests section header |
| View overall or per-commit diff | Click a PR, then a commit row (or **Overall diff**) |
| Vote | Action buttons in the PR detail header |
| Complete / merge | **Complete** button — squash and delete-branch options in the sheet |
| Abandon | **Abandon** button |
| Comment | Comments panel at the bottom of the PR detail view |
| Open on the web | Right-click a PR row → **Open in Browser** |

---

## Resolving Merge Conflicts

Right-click any conflicted file (in the **Conflicts** group at the top of the Changes view):

| Menu item | What it does |
| --- | --- |
| Resolve Using Mine | Keeps your side, discards the other, marks resolved — one click |
| Resolve Using Theirs | Keeps the incoming side, discards yours, marks resolved — one click |
| Open to Resolve Manually | Opens the file in a normal editor tab, where VS Code's own Accept Current/Incoming/Both actions appear above the conflict markers |
| Mark as Resolved | Stages the file as-is — use this after editing conflict markers by hand |

**"Mine" and "theirs" mean different things depending on what's running** — the banner above the
file list always names the right one, but here's the full table:

| Operation | "Mine" is | "Theirs" is |
| --- | --- | --- |
| Merge | Your current branch | The branch being merged in |
| Rebase | The branch you're rebasing **onto** (git calls this "ours" here) | Your own commit being replayed |
| Cherry-pick | Your current branch | The commit being cherry-picked |
| Revert | Your current branch | The commit being reverted |

Once every conflict in the list is gone, use the banner's **Continue** (recommit/replay and move
on) or **Abort** (back out entirely, as if the operation never started) buttons.

---

## Draggable Panes

All four panes are **fully draggable** for custom layout:
- **Branches**: Drag the divider to resize
- **Commit graph**: Drag to resize
- **Files**: The changed files — drag to resize
- **Code**: The diff itself, unified or side by side

Your layout preference is **saved automatically**.

---

## Settings & Customization

Click **Settings** (gear icon, top right) to configure:
- **Theme**: Light, Dark, macOS, Graphite, Midnight
- **Git Path**: Custom git binary location
- **Discovery Options**: Repository search depth

---

## Keyboard Shortcut Cheat Sheet

Print or bookmark this:

```
BASICS:
  ?           Show all shortcuts
  Esc         Close panels
  q           Quit focus mode

GIT OPERATIONS:
  f           Fetch (all)
  p           Pull (rebase)
  Shift+P     Push
  b           Create Branch
  /           Filter / Checkout Branch
  m           Merge
  Shift+S     Stash
  c           Clear (toggle Changes view)

EDITING:
  Space       Select/Deselect
  j / k       Move Up / Down
  s / u       Stage / Unstage
  Del         Discard (with confirm)
  Ctrl+Enter  Commit (in message box)

NAVIGATION:
  Ctrl+1/2/3  Focus Pane 1/2/3
  g h         History (all commits)
  g c         Changes (working tree)
  r           Toggle Auto Refresh

APPEARANCE:
  Ctrl+Alt+T  Cycle Themes
```

---

## Tips & Tricks

✅ **Files are always selected by clicking** — No need for Shift+Click or Ctrl+Click  
✅ **Hover over toolbar icons** — See keyboard shortcut hints  
✅ **Type to filter branches** — Press `/` then start typing  
✅ **Drag to resize panes** — All four panes are draggable and collapsible
✅ **Four panes: Branches | Git Tree | Files | Code** — drag any divider; the diff has its own Code pane
✅ **Clicking a file widens Files + Code** — Branches and Git Tree fold to rails; **⇤ Restore panels** brings them back  
✅ **Click commits to see diffs** — View any commit's changes side-by-side  
✅ **Press `?` anytime** — Full shortcut reference built-in  
✅ **Keyboard-only workflow** — Everything works without touching the mouse  

---

## Troubleshooting

**Can't see Git Tree panel?**
- Press `Ctrl+Shift+P` and type `Git Tree: Open`

**Panel is empty?**
- Click the repository in the Repositories view on the left
- Or press `Ctrl+Shift+G` then `R` to refresh

**Forgot a shortcut?**
- Press `?` inside Git Tree for instant reference
- Or check this file again

**Layout messed up?**
- Refresh the view (double-click a repository tab)
- Layouts auto-save, so give it a moment

---

**Need more help?** Check the [main README](README.md) or visit [GitHub](https://github.com/JavianDev/GitTree)
