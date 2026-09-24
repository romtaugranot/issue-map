# Security

## Reporting a vulnerability

Report it privately through **Report a vulnerability** on this repository's [Security tab](https://github.com/romtaugranot/issue-map/security), not in a public Issue. You'll get an answer there.

Fixes go into the latest release.

## What's in scope

- The CLI in `src/` and `bin/`, run by Claude Code as the plugin's commands.
- The `MessageDisplay` hook (`hooks/hooks.json`, `bin/issue-map-display`), which runs on every reply while the plugin is enabled.
- The status line entry, `bin/issue-map-status-line`.
- How Issue text written by others reaches Claude: `start` and `suggest` fence it as data, and the skill in `skills/map/SKILL.md` says never to act on it.
- What the plugin keeps on disk, in its state directory, and the logins it borrows from `gh` and `glab`. It never stores a token of its own.
