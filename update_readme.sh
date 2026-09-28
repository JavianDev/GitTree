#!/bin/bash

# Read base64 images
img01=$(cat media/screenshots/01-three-pane-layout.png.b64)
img02=$(cat media/screenshots/02-commit-graph.png.b64)
img03=$(cat media/screenshots/03-line-level-staging.png.b64)
img04=$(cat media/screenshots/04-commit-sheet.png.b64)
img05=$(cat media/screenshots/05-command-sheet.png.b64)
img06=$(cat media/screenshots/06-command-log.png.b64)
img07=$(cat media/screenshots/07-branch-sidebar.png.b64)
img08=$(cat media/screenshots/08-toolbar.png.b64)
img09=$(cat media/screenshots/09-multi-repo.png.b64)
img10=$(cat media/screenshots/10-themes.png.b64)

# Replace image paths in README
sed -i "s|!\[Three-pane layout.*\](.*01.*)|![Three-pane layout with branches, commit graph, and file diffs](data:image/png;base64,$img01)|" README.md
sed -i "s|!\[Commit graph.*\](.*02.*)|![Commit graph showing lanes, merges, and decorations](data:image/png;base64,$img02)|" README.md
sed -i "s|!\[File staging.*\](.*03.*)|![File staging interface with two-cell pills showing file state](data:image/png;base64,$img03)|" README.md
sed -i "s|!\[Commit dialog.*\](.*04.*)|![Commit dialog with message, amend, signoff, and signing options](data:image/png;base64,$img04)|" README.md
sed -i "s|!\[Command sheet.*\](.*05.*)|![Command sheet with editable command field and toggleable options](data:image/png;base64,$img05)|" README.md
sed -i "s|!\[Command log.*\](.*06.*)|![Command log showing all git commands, exit codes, and durations](data:image/png;base64,$img06)|" README.md
sed -i "s|!\[Branch sidebar.*\](.*07.*)|![Branch sidebar with collapsible folders and Current/Recent pinned](data:image/png;base64,$img07)|" README.md
sed -i "s|!\[Toolbar.*\](.*08.*)|![Toolbar with Commit, Pull, Push, Branch, Merge, Stash buttons](data:image/png;base64,$img08)|" README.md
sed -i "s|!\[Repository tabs.*\](.*09.*)|![Repository tabs showing multiple open repos with quick-add button](data:image/png;base64,$img09)|" README.md
sed -i "s|!\[Theme selector.*\](.*10.*)|![Theme selector dropdown showing multiple theme options](data:image/png;base64,$img10)|" README.md

echo "README updated with Base64 images"
