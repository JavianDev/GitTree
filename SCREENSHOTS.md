# GitTree Screenshots Guide

This guide explains exactly what to capture for each screenshot in the README. The demo repository at `C:\Projects\GitTree-Demo` is already seeded with realistic data (multiple branches, commits, staged/unstaged files, stashes).

## Setup

1. **Launch the Extension Development Host:**
   - Open the GitTree folder in VS Code
   - Press `F5` or run the "Run GitTree (development)" task
   - A new VS Code window will open with the development extension loaded

2. **Open the demo repository:**
   - In the dev VS Code window, open the folder `C:\Projects\GitTree-Demo`
   - GitTree should find the repo automatically
   - Click the GitTree icon in the activity bar
   - The demo repo should appear in the Repositories view

3. **Take screenshots:**
   - Use VS Code's built-in screenshot tool (Windows: `Shift+Win+S`) or a screenshot app like Greenshot
   - **Save each screenshot to:** `media/screenshots/0X-name.png` (1200×800px recommended, at least 1024×600px)

---

## Screenshots to Capture

### 1. `01-three-pane-layout.png` — Three-Pane Layout
**What to show:**
- The full GitTree UI with all three panes visible
- Left pane: The BRANCHES section showing Current/Recent/feature branches
- Middle pane: The commit graph showing multiple commits
- Right pane: Shows some staged/unstaged files (the STAGED section with ◧◨ pills)

**How to set it up:**
- No changes needed; the default view shows this clearly
- Make sure the branches sidebar has some content by ensuring `C:\Projects\GitTree-Demo` is the active repo

**Capture area:** The entire GitTree panel (usually the right half of the window after the sidebar)

---

### 2. `02-commit-graph.png` — Commit Graph
**What to show:**
- Clear, detailed view of the commit graph in the middle pane
- Show lanes, merges, and commit dots
- Ideally with 5-8 commits visible, showing a merge if possible

**How to set it up:**
- The demo repo already has commits and branches; it should show graph automatically
- If graph is collapsed, click the "History" tab to make sure it's visible

**Capture area:** Just the middle pane (commit graph)

---

### 3. `03-line-level-staging.png` — Line-Level Staging
**What to show:**
- The right pane (review pane) showing the STAGED and UNSTAGED sections
- Files with the two-cell pills visible (◧ for staged, ◨ for unstaged, ◧◨ for both)
- Click on a file to show the diff view with highlighted lines

**How to set it up:**
- Make sure `C:\Projects\GitTree-Demo` has staged and unstaged changes
- You may need to run: `git -C C:\Projects\GitTree-Demo add staged.txt` (stage some content)
- Ensure there are also unstaged changes (the working.txt file is unstaged)
- Click on a file in the UNSTAGED section to show the diff

**Capture area:** Right pane, showing both STAGED and UNSTAGED sections with visible diffs

---

### 4. `04-commit-sheet.png` — Commit Sheet
**What to show:**
- The commit dialog/sheet that appears when you click the Commit button
- Show the message input field, checkboxes (Amend, Sign-off), and the GPG/SSH signing options

**How to set it up:**
- Stage some files first (use the UI or: `git -C C:\Projects\GitTree-Demo add -A`)
- Click the **Commit** button in the toolbar
- The command sheet should open

**Capture area:** The modal commit dialog box

---

### 5. `05-command-sheet.png` — Command Sheet
**What to show:**
- One of the command sheets (e.g., Pull, Push, Fetch, or Branch)
- Show the editable command field, toggleable options, and the teaching card

**How to set it up:**
- Click the **Pull** button (or any other action like Push, Fetch, Branch)
- The command sheet should pop up showing the editable command and options

**Capture area:** The modal command sheet dialog

---

### 6. `06-command-log.png` — Command Log
**What to show:**
- The command log at the bottom showing past git invocations
- Each entry should show: the command, exit code, duration, and output

**How to set it up:**
- Run a few git operations (fetch, pull, create branch, etc.) to populate the log
- Click the **Command Log** button at the bottom of the screen (or press the shortcut)
- The command log panel should expand

**Capture area:** The command log panel showing multiple command entries

---

### 7. `07-branch-sidebar.png` — Branch Sidebar
**What to show:**
- The left pane branches section
- Show collapsible folders (feature/, bugfix/, etc.)
- Show Current and Recent branches pinned at the top
- Show multiple branches organized hierarchically

**How to set it up:**
- The demo repo already has branches like feature/commit-graph, bugfix/staging, etc.
- Make sure the BRANCHES section is expanded and visible

**Capture area:** Left pane, the BRANCHES section

---

### 8. `08-toolbar.png` — Toolbar
**What to show:**
- The toolbar at the top showing all the action buttons
- Commit, Pull, Push, Branch, Merge, Stash, Tag icons
- Show badge counts if any (e.g., ahead/behind on the Push button)

**How to set it up:**
- No special setup; the toolbar is always visible
- Make sure the demo repo is active so buttons are enabled

**Capture area:** Just the toolbar area at the top of the GitTree UI

---

### 9. `09-multi-repo.png` — Multi-Repo Tabs and + Button
**What to show:**
- The repository tab strip showing multiple open repositories
- Show the **+** button on the right for opening another repository
- Show state indicators (dirty dots, ahead/behind counts)

**How to set it up:**
- The demo repo is already open as one tab
- You can optionally open another repo to show multiple tabs, OR just show the + button clearly

**Capture area:** The tab strip at the very top showing repo tabs

---

### 10. `10-themes.png` — Theme Selector
**What to show:**
- The theme dropdown or settings showing available themes
- Options: Light, Dark, macOS Light, macOS Dark, Graphite, Midnight

**How to set it up:**
- Click the **Theme Toggle** button (sun/moon icon) in the toolbar
- Or open Settings and look for the theme selector

**Capture area:** The theme selector dropdown or panel

---

## Final Steps

1. **Save all screenshots** to `media/screenshots/` with names `01-name.png` through `10-name.png`
2. **Verify image quality:**
   - Minimum 1024×600px resolution
   - Recommended: 1200×800px or higher
   - Clear text and UI elements visible
3. **Commit and push:**
   ```bash
   git add media/screenshots/
   git commit -m "Add real GitTree screenshots to README"
   git push origin main
   ```
4. **Publish:** `vsce publish patch`

---

## Tips for Good Screenshots

- **Clean workspace:** Close other VS Code windows/panels for a clean UI
- **Consistent window size:** Keep the window size consistent across shots
- **Highlight key features:** Hover over buttons to show tooltips where relevant
- **Real data:** Use the populated demo repo to show real commits, branches, files
- **No sensitive data:** Ensure no API keys, passwords, or personal info appear
- **Dark/Light theme:** Pick one theme and stick with it for consistency (macOS Dark recommended for the sleek look)

---

## Demo Repository Location

The seeded demo repository is at: `C:\Projects\GitTree-Demo`

It already contains:
- Multiple branches: `feature/commit-graph`, `bugfix/staging`, `feature/diff-viewer`, etc.
- Real commits with meaningful messages
- Staged and unstaged files
- A stash entry
- Proper commit history showing a real graph

You can use this directly, or create a fresh demo repo if needed.
