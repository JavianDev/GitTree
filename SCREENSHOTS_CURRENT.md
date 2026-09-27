# Git Tree Screenshots Guide — Current Features with Demo Repository

This guide explains how to capture screenshots for the Git Tree README, with reference to the current demo repository that showcases real features through commits and branches.

## ✅ Current Demo Repository Status

The demo repository at `C:\Projects\Git-Tree-Demo` now includes:

### Feature Commits (Showcasing Real Use Cases)
- `52b914f` - **Add line-level staging demo** — Files with two-cell state pills, hunk staging, line selection
- `62eef15` - **Improve commit graph visualization** — Real commit graph with lanes, merges, decorations
- `457d67c` - **Support multi-repo workspaces** — Tab switching, per-repo state management
- `64dabe2` - **Add keyboard shortcuts** — j/k navigation, space selection, modifier keys
- `9243df9` - **Implement theme system** — Light, Dark, macOS, Graphite, Midnight themes

### Feature Branches (Showcasing Branch Management)
- `feature/commit-graph` — Demonstrates commit graph features
- `feature/keyboard-shortcuts` — Shows keyboard navigation
- `feature/themes` — Displays theme switching
- `feature/diff-viewer` — Multiple branches for exploring branch sidebar
- `bugfix/staging` — Bug fix workflow example
- `feature/interactive-rebase` — Interactive rebase features
- `long-lived/cleanup-branch` — Long-lived branch pattern

## Setup

1. **Launch the Extension Development Host:**
   - Open the Git Tree folder in VS Code
   - Press `F5` or run the "Run Git Tree (development)" task
   - A new VS Code window will open with the development extension loaded

2. **Open the demo repository:**
   - In the dev VS Code window, open the folder `C:\Projects\Git-Tree-Demo`
   - Git Tree should find the repo automatically
   - Click the Git Tree icon in the activity bar
   - The demo repo should appear in the Repositories view

3. **Take screenshots:**
   - Use VS Code's built-in screenshot tool (Windows: `Shift+Win+S`) or Greenshot
   - **Save each screenshot to:** `media/screenshots/0X-name.png` (1200×800px recommended, at least 1024×600px)

---

## Screenshots to Capture

### 1. `01-three-pane-layout.png` — Three-Pane Layout

**What to show:**
- The full Git Tree UI with all three panes visible
- Left pane: BRANCHES section showing Current/Recent and feature branches (feature/keyboard-shortcuts, feature/themes, etc.)
- Middle pane: The commit graph showing commits from the demo repo
- Right pane: Staged/unstaged files with two-cell state pills (◧/◨)

**How to set it up:**
- The demo repo has multiple branches and commits—no special setup needed
- Make sure `C:\Projects\Git-Tree-Demo` is the active repo
- The graph will show the real commit history with lanes and merges

**Capture area:** The entire Git Tree panel (right half of window)

---

### 2. `02-commit-graph.png` — Commit Graph

**What to show:**
- Clear, detailed view of the commit graph in the middle pane
- Show lanes, merges, and commit dots
- Ideally 5-8 commits visible (the demo repo has commits from 52b914f back to f1216cb)

**How to set it up:**
- Switch to the "History" view if needed
- The demo repo already has proper commit history with branches
- You'll see the real lanes created by the feature branches

**Demo commits to highlight:**
- `52b914f` - Line-level staging demo
- `62eef15` - Commit graph improvements
- `457d67c` - Multi-repo support
- `64dabe2` - Keyboard shortcuts
- `9243df9` - Theme system

**Capture area:** Just the middle pane (commit graph section)

---

### 3. `03-line-level-staging.png` — Line-Level Staging

**What to show:**
- The right pane (review pane) showing STAGED and UNSTAGED sections
- Files with two-cell pills visible (◧ = staged, ◨ = unstaged, ◧◨ = both)
- Click on a file to show the diff view with highlighted lines

**How to set it up:**
- Ensure the demo repo has staged and unstaged changes
- The repo includes staged.txt and working.txt files for this demo
- Click on a file in UNSTAGED to show diff highlighting

**Capture area:** Right pane showing both STAGED and UNSTAGED sections

---

### 4. `04-commit-sheet.png` — Commit Sheet

**What to show:**
- The commit dialog/sheet with message field, checkboxes (Amend, Sign-off)
- Show GPG/SSH signing options if enabled
- Demonstrate the command preview showing the exact git command

**How to set it up:**
- Stage some files first
- Click the **Commit** button in the toolbar
- The command sheet will open showing the editable command

**Capture area:** The modal commit dialog box

---

### 5. `05-command-sheet.png` — Command Sheet

**What to show:**
- One of the command sheets (e.g., Pull, Push, Fetch, or Branch)
- Show the editable command field with real git flags
- Show toggleable options that rewrite the command in real-time
- Include hover tooltip showing what a flag does

**How to set it up:**
- Click the **Pull** button (or any action like Push, Fetch, Branch)
- The command sheet will pop up
- Hover over an option to show the teaching tooltip

**Capture area:** The modal command sheet dialog

---

### 6. `06-command-log.png` — Command Log

**What to show:**
- The command log showing past git invocations
- Each entry displays: command, exit code, duration, and output
- Show multiple entries from different operations

**How to set it up:**
- Run a few git operations (fetch, pull, checkout branch, etc.)
- Click the **Command Log** button (or open from the menu)
- The log panel expands showing all operations

**Capture area:** The command log panel with multiple entries

---

### 7. `07-branch-sidebar.png` — Branch Sidebar

**What to show:**
- The left pane branches section with real demo data
- Show collapsible folders (feature/, bugfix/, long-lived/)
- Show Current and Recent branches pinned at the top
- Display branches organized hierarchically

**Demo branches visible:**
- Current: main
- Recent: feature/keyboard-shortcuts (recently checked out)
- feature/themes, feature/commit-graph, bugfix/staging, feature/diff-viewer
- long-lived/cleanup-branch

**How to set it up:**
- The demo repo has 9 branches total—no setup needed
- Make sure BRANCHES section is expanded and visible

**Capture area:** Left pane, the BRANCHES section

---

### 8. `08-toolbar.png` — Toolbar

**What to show:**
- The toolbar at the top with all action buttons
- Commit, Fetch, Pull, Push, Branch, Merge, Stash, Tag icons
- Show badge counts if any (e.g., ahead/behind counts)
- Optional: hover to show tooltips

**How to set it up:**
- No special setup; toolbar is always visible
- Make sure the demo repo is active (buttons enabled)

**Capture area:** Just the toolbar area at the top of Git Tree UI

---

### 9. `09-multi-repo.png` — Multi-Repo Tabs

**What to show:**
- The repository tab strip showing open repositories
- Show the **+** button on the right for adding another repository
- Show state indicators (dirty dots, ahead/behind counts)

**How to set it up:**
- The demo repo is already open as one tab
- Just show this tab and the + button clearly

**Capture area:** The tab strip at the very top showing repo tabs

---

### 10. `10-themes.png` — Theme Selector

**What to show:**
- The theme dropdown showing available themes
- Options: Light, Dark, macOS Light, macOS Dark, Graphite, Midnight
- Show the current selection highlighted

**How to set it up:**
- Click the **theme toggle** button (sun/moon icon) in the toolbar
- Or access themes from the Settings panel

**Capture area:** The theme selector dropdown menu

---

## Final Steps

1. **Save all screenshots** to `media/screenshots/0X-name.png` (01 through 10)
2. **Verify quality:**
   - Minimum 1024×600px (recommended 1200×800px or higher)
   - Clear, readable text and UI
   - No sensitive data visible

3. **Commit and push:**
   ```bash
   git add media/screenshots/
   git commit -m "Add Git Tree feature screenshots with demo repo"
   git push origin main
   ```

4. **Publish:** `vsce publish patch`

---

## Tips for Good Screenshots

✓ **Clean workspace** — Close other VS Code windows  
✓ **Consistent size** — Keep window size consistent across shots  
✓ **Highlight features** — Hover to show tooltips where relevant  
✓ **Real demo data** — Use the populated demo repo with actual commits/branches  
✓ **No sensitive data** — Ensure no API keys, passwords, or personal info  
✓ **Pick one theme** — Recommended: macOS Dark (sleek appearance)

---

## Demo Repository Reference

Location: `C:\Projects\Git-Tree-Demo`

### Commit History
```
9243df9 Implement theme system
64dabe2 Add keyboard shortcuts
457d67c Support multi-repo workspaces
62eef15 Improve commit graph visualization
52b914f Add line-level staging demo
f1216cb Initial commit: add README
```

### Branches (9 total)
- main
- master
- feature/commit-graph
- feature/diff-viewer
- feature/interactive-rebase
- feature/keyboard-shortcuts
- feature/themes
- bugfix/staging
- long-lived/cleanup-branch

This demo repo is fully populated and ready to showcase all Git Tree features!