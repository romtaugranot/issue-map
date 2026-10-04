# Issue Map documentation

[← README](../README.md)

## Using the Map

| Guide | Covers |
|---|---|
| [Usage](usage.md) | Every phrase Claude understands, paging, moving between Projects, `/issue-map`, the status line, and `claude -p` |
| [Privacy and data](privacy.md) | What it writes, what it keeps and for how long, what runs in the background, and what leaves your machine |
| [Troubleshooting](troubleshooting.md) | Missing output or status line, slow first reads, the sandbox, background logs |
| [Supported Trackers](../README.md#supported-trackers) | Which GitHub and GitLab releases are Promised, Best effort or Refused, and how each is tested |
| [Changelog](../CHANGELOG.md) | What each release changes |

## Reference

| Doc | Covers |
|---|---|
| [Glossary](../CONTEXT.md) | What Issue, Link, Group, Take next, Band and the rest mean here, and the words avoided for each |
| [Security](../SECURITY.md) | How to report a vulnerability, and what's in scope |

## Working on the Map

| Doc | Covers |
|---|---|
| [Contributing](../CONTRIBUTING.md) | Development setup, the repository's layout, the three test tiers, and the conventions changes follow |
| [Fixture Projects](fixtures.md) | The public Projects the live reads assert on, and how to seed and read them |
| [Releasing](releasing.md) | How a release is built, tested and published, and what users see |

## Design decisions

Each decision is recorded as an ADR in [`adr/`](adr), along with what was weighed against it.

| ADR | Decision |
|---|---|
| [0001](adr/0001-build-new-inside-claude-code.md) | Build a new plugin that shows the Map only inside Claude Code |
| [0002](adr/0002-draw-only-recorded-links.md) | The Map draws only recorded Links; a guess becomes a Link only by being written |
| [0003](adr/0003-support-by-detected-capability.md) | Support is decided by what each Project shows; versions only set what is promised |
| [0004](adr/0004-promised-means-run-or-stood-in.md) | Promised means tested on a running Tracker where the build can run one, and stood in for where it can't |
| [0005](adr/0005-one-project-per-map.md) | A Map is one Project; Outside Issues join it but aren't followed |
| [0006](adr/0006-draw-from-a-per-login-snapshot.md) | The Map draws from a per-login Snapshot, refreshed when stale and shown when old |
| [0007](adr/0007-one-fixed-set-of-tracker-needs.md) | The Map reaches every Tracker through one fixed set of needs, and the glossary names shapes rather than Trackers |
| [0008](adr/0008-related-links-dont-join-groups.md) | Related Links don't join Groups; the strongest Link wins |
| [0009](adr/0009-show-output-through-a-display-hook.md) | The Map reaches the screen through a display hook, not through Claude retyping it |
| [0010](adr/0010-an-optional-read-only-picture-beside-the-map.md) | An optional, read-only HTML Picture beside the in-session Map |
| [0011](adr/0011-the-status-line-is-the-plugins-own.md) | The status line is the plugin's own, pinned by a hooks module |
| [0012](adr/0012-a-slash-command-shows-the-map-without-claude.md) | A slash command shows the Map without Claude |
