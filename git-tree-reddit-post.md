# 🌳 Git Tree: A SourceTree-Class Git Client Inside VS Code (Now Available)

## TL;DR
We just published **Git Tree**, a free VS Code extension that brings a SourceTree-like Git experience right into your editor. Real commit graphs, line-level staging, multi-repo support, and an educational command sheet that teaches you Git while you use it. [Install it now](https://marketplace.visualstudio.com/items?itemName=javian-picardo-group-inc.git-tree).

---

## The Problem We're Solving

If you're using VS Code's built-in Git tools, you know the pain:
- ❌ No real commit graph (just a flat log)
- ❌ File-level staging only (no line-level control)
- ❌ No side-by-side diff viewing
- ❌ Branches scattered across the sidebar
- ❌ Every action feels like clicking through menus

Most of us jump to SourceTree or GitLens... but then we're juggling two tools instead of one.

## Enter Git Tree

Git Tree is what VS Code's Git integration should be. It's a fully-featured Git client **inside VS Code** — three panes, real-time updates, full keyboard navigation, and yes, even teaches you Git while you're using it.

### Key Features That Make It Special

**1. Real Commit Graph (Like Actually Real)**
- Correct lane assignment across merges
- Branch decorations, tags, HEAD markers
- Click a commit to see its full diff side-by-side
- Virtualised so a 50,000-commit repo scrolls at full speed
- Navigate with keyboard: `j`/`k` to move, `Space` to select

**2. Line-Level Staging**
- Stage individual lines, hunks, or whole files
- Two-cell pill shows file state: ◧ (staged), ◨ (unstaged), ◧◨ (both)
- Drag files between Staged/Unstaged groups
- Keyboard shortcuts: `s` stage, `u` unstage

**3. Three-Pane Layout**
- Left: Branches, tags, remotes, stashes (searchable)
- Middle: Commit graph with full history
- Right: File diff with line-level staging
- Everything visible at once. No modal dialogs.
- **All panes are draggable** — customize your layout, it auto-saves

**4. The Command Sheet (Our Favorite Part)**
Every git action shows the exact command before it runs:
- See what you're about to execute
- Edit the command if you want
- Learn git flags by hovering over them
- Keyboard shortcuts on every action
- Copy commands to your terminal for later

Example: push to origin? See: `git push origin main --set-upstream` before it runs.

**5. Multi-Repo Support**
- Open multiple repositories as tabs
- Each repo remembers your scroll position, filters, and selections
- Understands nested repos, submodules, and worktrees
- Smart discovery finds everything in your workspace

### Screenshots / What It Looks Like

- **Three-pane layout** with branches, graph, and diffs visible at once
- **Commit graph** with correct lanes and merge handling
- **Line-level staging** with the two-cell state pills
- **Draggable panes** so you can customize the layout

---

## Keyboard First (But Mouse Works Too)

The whole thing works without your mouse:
- `j` / `k` — navigate
- `Space` — select
- `s` / `u` — stage/unstage
- `f` — fetch
- `p` — pull
- `Shift+P` — push
- `b` — create branch
- `/` — filter branches
- `m` — merge
- `Shift+S` — stash
- `Ctrl+Enter` — commit
- `?` — see all shortcuts

But if you like the mouse, everything's clickable too.

---

## Why This Matters

**VS Code developers:** You're already spending 8 hours a day in VS Code. Why switch to SourceTree for Git? Keep your flow.

**GitLens users:** Git Tree is complementary (not a replacement for code-lens features), but if you want a full Git client experience without a separate app, this is it.

**Teaching Git:** The command sheet shows exactly what git is doing. No "magic," just transparent git. Perfect for onboarding junior devs or learning git yourself.

**Terminal lovers:** Every command is editable and copyable. Use the GUI to see what's happening, copy the command to your terminal, run it there.

---

## Installation

1. Open VS Code Extensions (`Ctrl+Shift+X`)
2. Search **"Git Tree"**
3. Click Install
4. Click the Git Tree icon in the activity bar
5. Open a repository

**Free, open source, no telemetry.** [GitHub link here](https://github.com/JavianDev/GitTree)

---

## What's Next

We're actively developing:
- Pull request management (GitHub, Azure DevOps, GitLab)
- Enhanced stash workflows
- Native VS Code Command Palette integration
- More theme options

---

## Questions? Feedback?

- Inside the app, press `?` for all keyboard shortcuts
- Issues & feature requests: [GitHub Issues](https://github.com/JavianDev/GitTree/issues)
- Want to contribute? [Contributions welcome](https://github.com/JavianDev/GitTree)

---

## One More Thing

Git Tree is **100% free**. No ads, no telemetry, no "free tier" limitations. It runs entirely on your machine. If you find it useful and want to support development, there's a [coffee link](https://buymeacoffee.com/javian), but zero pressure.

Give it a shot and let us know what you think! 🚀

---

**Install now:** [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=javian-picardo-group-inc.git-tree)
