# Reddit post — Git Tree 0.11.1

r/vscode removed the first attempt automatically: it needs a minimum account age and karma, with no
exceptions. Post where people share their own projects instead: r/SideProject, r/coolgithubprojects,
or r/opensource. Read each one's rules first, since some have their own minimums. Come back to
r/vscode once the account has some history there.

Post type: **Images & Video** (gallery). Add all 20 images in the order below, the title, then the
post text. The links are at the end of the post text, so no separate comment is needed.

---

## Title (pick one)

1. I got tired of switching between VS Code and a Git GUI, so I built Git Tree, a free VS Code extension that puts one inside the editor. It now handles worktrees
2. I built Git Tree, a free SourceTree-style Git client that lives inside VS Code. 0.11 adds worktrees
3. Git Tree 0.11: commit graph, line-level staging, pull requests and now worktrees, without leaving VS Code (free, MIT)

---

## Gallery (in this order, with captions)

Images are in `media/screenshots/` in the repo, or download them from these links (pinned to the 0.11.1 commit):

| # | File | Caption |
|---|---|---|
| 1 | [01-three-pane-layout.png](https://raw.githubusercontent.com/JavianDev/GitTree/be6c58ce696f3268122efd542e378aaf8937c113/media/screenshots/01-three-pane-layout.png) | Four panes: branches, commit graph, the commit's files, and the diff, all visible at once |
| 2 | [13-worktrees.png](https://raw.githubusercontent.com/JavianDev/GitTree/be6c58ce696f3268122efd542e378aaf8937c113/media/screenshots/13-worktrees.png) | New in 0.11: a Worktrees section. Click one to see its changes and unpushed commits |
| 3 | [15-new-worktree.png](https://raw.githubusercontent.com/JavianDev/GitTree/be6c58ce696f3268122efd542e378aaf8937c113/media/screenshots/15-new-worktree.png) | New Worktree: pick a branch, it suggests a folder, copies your .env, and shows every command before it runs |
| 4 | [14-worktree-menu.png](https://raw.githubusercontent.com/JavianDev/GitTree/be6c58ce696f3268122efd542e378aaf8937c113/media/screenshots/14-worktree-menu.png) | Open a worktree as a tab or a new window, lock, move, or remove it |
| 5 | [16-remove-worktree.png](https://raw.githubusercontent.com/JavianDev/GitTree/be6c58ce696f3268122efd542e378aaf8937c113/media/screenshots/16-remove-worktree.png) | Removing asks for exactly the --force git needs, and says why |
| 6 | [18-branch-in-worktree.png](https://raw.githubusercontent.com/JavianDev/GitTree/be6c58ce696f3268122efd542e378aaf8937c113/media/screenshots/18-branch-in-worktree.png) | Double-click a branch that's checked out elsewhere and it offers that worktree instead of a failing git switch |
| 7 | [17-worktree-settings.png](https://raw.githubusercontent.com/JavianDev/GitTree/be6c58ce696f3268122efd542e378aaf8937c113/media/screenshots/17-worktree-settings.png) | Choose where each repository's worktrees go, with a live preview |
| 8 | [02-commit-graph.png](https://raw.githubusercontent.com/JavianDev/GitTree/be6c58ce696f3268122efd542e378aaf8937c113/media/screenshots/02-commit-graph.png) | A real commit graph: every message sits right next to its node |
| 9 | [03-line-level-staging.png](https://raw.githubusercontent.com/JavianDev/GitTree/be6c58ce696f3268122efd542e378aaf8937c113/media/screenshots/03-line-level-staging.png) | Checkbox staging by file, hunk, or line, with untracked files in their own section |
| 10 | [04-commit-sheet.png](https://raw.githubusercontent.com/JavianDev/GitTree/be6c58ce696f3268122efd542e378aaf8937c113/media/screenshots/04-commit-sheet.png) | ✨ drafts the commit message with the AI model you already have in VS Code. Commit & Push in one step |
| 11 | [11-push-stash-tabs.png](https://raw.githubusercontent.com/JavianDev/GitTree/be6c58ce696f3268122efd542e378aaf8937c113/media/screenshots/11-push-stash-tabs.png) | Push and Stash tabs: what a push would send, and every stash with Apply / Pop / Drop |
| 12 | [05-command-sheet.png](https://raw.githubusercontent.com/JavianDev/GitTree/be6c58ce696f3268122efd542e378aaf8937c113/media/screenshots/05-command-sheet.png) | Every action shows the exact git command first. Edit it, or ask "Why this command?" |
| 13 | [06-command-log.png](https://raw.githubusercontent.com/JavianDev/GitTree/be6c58ce696f3268122efd542e378aaf8937c113/media/screenshots/06-command-log.png) | The command log: everything that ran, with exit codes and git's own errors |
| 14 | [19-pull-requests.png](https://raw.githubusercontent.com/JavianDev/GitTree/be6c58ce696f3268122efd542e378aaf8937c113/media/screenshots/19-pull-requests.png) | Pull requests for GitHub, Azure DevOps, GitLab, and Bitbucket: review, vote, and merge inside the editor |
| 15 | [20-pr-comments.png](https://raw.githubusercontent.com/JavianDev/GitTree/be6c58ce696f3268122efd542e378aaf8937c113/media/screenshots/20-pr-comments.png) | PR comment threads next to the diff |
| 16 | [07-branch-sidebar.png](https://raw.githubusercontent.com/JavianDev/GitTree/be6c58ce696f3268122efd542e378aaf8937c113/media/screenshots/07-branch-sidebar.png) | Type "feat" and every branch containing it lights up; the pane widens to fit the names |
| 17 | [09-multi-repo.png](https://raw.githubusercontent.com/JavianDev/GitTree/be6c58ce696f3268122efd542e378aaf8937c113/media/screenshots/09-multi-repo.png) | Several repositories as tabs in one window |
| 18 | [08-toolbar.png](https://raw.githubusercontent.com/JavianDev/GitTree/be6c58ce696f3268122efd542e378aaf8937c113/media/screenshots/08-toolbar.png) | One-click fetch, pull, push, branch, merge, stash, and tag, each reviewed before it runs |
| 19 | [12-keyboard-shortcuts.png](https://raw.githubusercontent.com/JavianDev/GitTree/be6c58ce696f3268122efd542e378aaf8937c113/media/screenshots/12-keyboard-shortcuts.png) | Fully keyboard-driven: press ? for the whole map |
| 20 | [10-themes.png](https://raw.githubusercontent.com/JavianDev/GitTree/be6c58ce696f3268122efd542e378aaf8937c113/media/screenshots/10-themes.png) | Follows your VS Code theme, or pick Light, macOS Dark, Graphite, or Midnight |

---

## Body (paste as the post text)

I kept jumping between VS Code and a separate Git app just to look at the commit graph, stage a few lines, or check a pull request. So I put all of that into a VS Code panel instead.

You get your branches, the commit graph, the changed files and the diff side by side (first screenshot). The part I cared about most is that every button shows you the exact git command before it runs, and you can edit it. Everything that ran goes into a log, so you always know what happened, and you pick up the commands along the way.

The latest version adds worktrees, which is what most of the screenshots are about. If you haven't used them, a worktree is a second folder checked out from the same repo, so you can have two branches open at once. I use it to review a PR without stashing whatever I'm in the middle of. Git Tree lists them under your branches, shows what's changed in each one, and lets you create, open, lock, move or remove them.

A few other things it does:

- stage single lines or hunks with checkboxes
- the ✨ button drafts a commit message with whatever AI model you already have in VS Code (like Copilot), and only when you click it
- commit and push in one step
- pull requests for GitHub, Azure DevOps, GitLab and Bitbucket
- several repos open as tabs, and it all works from the keyboard

It's free, MIT licensed, and has no telemetry. It's just me working on it, so there are rough edges: GitLab and Bitbucket still need an access token to sign in, and GitHub Enterprise isn't detected yet.

I'd really like to hear what you think, especially about the worktree part.

- VS Code Marketplace: https://marketplace.visualstudio.com/items?itemName=javian-picardo-group-inc.git-tree
- Source: https://github.com/JavianDev/GitTree
