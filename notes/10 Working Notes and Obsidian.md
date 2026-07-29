# Working notes, and how the Obsidian sync loop works

## Why this exists
The user wanted a "never-ending" context — a mind map that keeps growing
across sessions without having to re-explain past decisions, viewable in
Obsidian's graph (2D and, via a community plugin, 3D).

## What Claude actually has access to
No connector to the user's phone, iCloud Drive, or Obsidian directly exists
in this workspace (checked via `ListConnectors` — only Google Drive and
Microsoft 365 are connected, neither is the user's Obsidian vault). What
Claude *does* have full, reliable read/write access to is this GitHub repo.

Google Drive was considered as a bridge (a plugin like "Remotely Save" can
sync an Obsidian vault to Drive) but rejected: the available Drive tools
can create new files but have no verified way to overwrite an existing one
in place, which would fight with a sync plugin expecting stable filenames.

## The actual mechanism
1. Claude keeps `CLAUDE.md` (root) and `notes/*.md` (this folder) current
   in the repo, as a normal part of doing project work — not a separate
   chore, just part of finishing a change.
2. A recurring scheduled check (see the Routine named for this project)
   acts as a backstop: it reviews commits since the last note update and
   fills in anything missed, without the user needing to ask.
3. On the user's side: the **Obsidian Git** community plugin (real,
   well-known — by Vinzent03) turns the vault into a git working copy of
   this repo and can auto-pull on a timer. That's the one-time setup that
   makes the user's vault "just stay current" — see the setup steps Claude
   gave them in chat when this was set up (2026-07-29).

## Rule for future sessions
Before making non-trivial changes, skim `CLAUDE.md` and whichever notes
here are relevant — that's the point of this file existing. After making a
non-trivial change, add or update the relevant note(s) and, if it's
history-worthy, add a line to `[[01 Timeline]]`. Keep entries terse; this
is a reference, not a diary.
