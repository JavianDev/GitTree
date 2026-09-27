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

1. Press `Shift+S` to stash
2. Press `b` to create or `Ctrl+/` to checkout another branch
3. Come back and `Shift+S` again to pop stash

---

## Draggable Panes

All three panes are **fully draggable** for custom layout:
- **Branches pane** (left): Drag the divider to resize
- **Commit graph** (middle): Drag to resize
- **File diff** (right): Drag the divider between filenames and diff code

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
✅ **Drag to resize panes** — All three panes + file/diff divider are draggable  
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
