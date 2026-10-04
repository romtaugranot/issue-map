<div align="center">

# Issue Map

**See which Issue to take next, without leaving Claude Code.**

A Claude Code plugin that draws a GitHub or GitLab Project's open Issues as a Map joined by the Links its Tracker records: what you could take now, what waits on what, and what nothing touches.

[![Release](https://img.shields.io/github/v/release/romtaugranot/issue-map?sort=semver)](https://github.com/romtaugranot/issue-map/releases/latest)
[![Contract](https://github.com/romtaugranot/issue-map/actions/workflows/contract.yml/badge.svg)](https://github.com/romtaugranot/issue-map/actions/workflows/contract.yml)
[![Live](https://github.com/romtaugranot/issue-map/actions/workflows/live.yml/badge.svg)](https://github.com/romtaugranot/issue-map/actions/workflows/live.yml)
[![Claude Code plugin](https://img.shields.io/badge/Claude_Code-plugin-D97757?logo=claude&logoColor=white)](https://code.claude.com/docs/en/plugins)
[![Node.js 22.18+](https://img.shields.io/badge/node-%E2%89%A522.18-339933?logo=nodedotjs&logoColor=white)](#requirements)
[![Licence: MIT](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)

[Quick start](#quick-start) • [Features](#features) • [Usage](#usage) • [Supported Trackers](#supported-trackers) • [Docs](docs/README.md) • [Changelog](CHANGELOG.md)

</div>

> **issue-map-fixtures/map** · 14 open · 8 on the Map · 6 Unlinked · Promised
>
> **Take next: 6** — most waited on first · 1 more not listed, ask to list them
> - #1 \[b1\] Lay the foundation — ▶2 wait on it
> - #6 \[p3\] Tag the build — via #4
> - #7 \[p4\] Proofread the release notes — via #5
> - #9 \[u1\] Remove the compatibility shims — unblocked 2d ago
> - #11 \[u2\] Keep the old parser working — unblocked 2d ago · #10 closed as not planned
>
> **Groups: 3** — largest first
> - #4 \[p1\] Plan the release — 4 Issues, 2 Unblocked, 1↗ Outside
> - #1 \[b1\] Lay the foundation — 3 Issues, 1 Unblocked
> - ↗issue-map-fixtures-b/elsewhere#1 \[x1\] Publish the shared config — 1 Issue, 0 Unblocked, 1↗ Outside
>
> **Unlinked: 6** — no Link to another open Issue. Ask to list them.

<p align="center"><sub>The Map of <a href="https://github.com/issue-map-fixtures/map"><code>issue-map-fixtures/map</code></a>, the public fixture Project the nightly tests read, drawn by the plugin's own code. A test fails if this picture ever stops matching what the plugin draws.</sub></p>

GitHub and GitLab already let people record that one Issue Blocks another or sits under a Parent, but neither shows the whole of it at once. The Map does, inside the conversation. **Take next** lists the Unblocked Issues in a fixed order, **Groups** gather the rest by their Links, and **Unlinked** counts what no Link reaches. From there you walk from one Issue card to the next, assign yourself, or have Claude brief you on an Issue before you start.

It draws only the Links someone recorded ([ADR 0002](docs/adr/0002-draw-only-recorded-links.md)). When Claude finds a Link in the Issues' text, it offers it as a Link Suggestion, which becomes a Link only once you confirm it.

## Quick start

In Claude Code:

```text
/plugin marketplace add romtaugranot/issue-map
/plugin install issue-map@issue-map
```

Then, in a git checkout of a GitHub or GitLab Project, with `gh` or `glab` logged in, type `/issue-map`, or ask Claude _"what should I take next?"_

## A tour

Take next comes first: the Unblocked Issues you could take, ordered by how many open Issues wait on each (`▶2`), then the earliest Planned date, then the oldest. A Parent gives way to its Unblocked children (`via #4`), and an Issue whose blocker closed says when. `↗` marks an Outside Issue: an Issue in another Project that a Link reaches. The Map draws it, and it joins Issues into a Group, but the Map doesn't follow its own Links. Each Group line says how many of its Issues are Unblocked, counted the same way as Take next, so the two always agree.

Opening a Group lists what sits at its top, one level at a time. Each line says how many Unblocked Issues it and those beneath it hold:

> **Group 1 of 3** · #4 \[p1\] Plan the release — 4 Issues, 2 Unblocked, 1↗ Outside
>
> **Under #4, alone at the top: 3** — most under it first
> - #5 \[p2\] Write the release notes — 1 under it · 1 Unblocked
> - #6 \[p3\] Tag the build — 1 Unblocked
> - ↗issue-map-fixtures/site#1 \[s1\] Update the website for the release
>
> _Name one to open the level below it · `map` for the Map_

Opening an Issue shows its card, read live from the Tracker, with its Links under the Tracker's own names:

> **#2 \[b2\] Build the walls**\
> https://github.com/issue-map-fixtures/map/issues/2\
> **Blocked** — 1 open Issue Blocks it · unassigned
>
> **Blocked by**
> - #1 \[b1\] Lay the foundation
>
> **Blocking**
> - #3 \[b3\] Put on the roof

Claude then asks where to go next in a picker, offering **Assign #2 to me**, **Start work on #2**, **#1** (Blocked by · [b1] Lay the foundation) and **More Links**.

Claude doesn't retype any of this. Each output ends with a line such as `⟦issue-map 3f9a0c1b2d4e⟧`. Claude writes that line in its reply, and the plugin's display hook shows the output in its place, exactly as printed ([ADR 0009](docs/adr/0009-show-output-through-a-display-hook.md)).

## Features

- **Take next.** The Unblocked Issues you could take, in a fixed order, with those someone else has already taken kept apart.
- **Groups, one level at a time.** Every set of Issues joined by Blocks and Parent Links, largest first, opened from the top down.
- **Live Issue cards.** Each Link is shown under the Tracker's own name, and a picker takes you to the next card, back along your trail, or to another Project.
- **Pictures.** You can draw a Group whole, or the Issues around one Issue. Either can be exported as Mermaid or DOT to paste into a GitHub or GitLab comment. The whole Map can also be one read-only HTML page in your browser, or a private claude.ai Artifact.
- **A status line of its own.** The Home Project's first Issue in Take next, pinned under the prompt beside your status line, with nothing to set up.
- **`/issue-map`.** Shows the Map, a Group or a card at once, with no reply to wait for.
- **Briefings.** `start work on #2` has Claude read the Issue's body and comments and brief you in about a dozen lines.
- **Writes only what you confirm.** It writes two things, assigning you and the Link Suggestions you tick, and asks every time.
- **GitHub and GitLab, cloud and self-managed.** It works through your existing `gh` and `glab` logins, with no token of its own and no runtime dependencies.

## Requirements

| Requirement | Details |
|---|---|
| OS | Linux, or macOS 13 or later. On Windows, run Claude Code under WSL: the plugin is untested on Windows itself. |
| Claude Code | 2.1.152 or later, the first to run `MessageDisplay` hooks, which the plugin shows its output through. The status line and `/issue-map` also need a build that loads plugins' hooks modules, which are early access. They're tested on 2.1.287. Without such a build, everything else still works, through Claude. |
| Node.js | 22.18 or later on your `PATH`. Node runs the plugin's TypeScript directly, and a release holds only what it runs, so there is nothing to install or build. |
| Tools | `bash`, and `git`, which the plugin uses to read the checkout's remotes. |
| GitHub | The [GitHub CLI](https://cli.github.com/), logged in to the host: `gh auth login --hostname <host>` |
| GitLab | The [GitLab CLI](https://gitlab.com/gitlab-org/cli), logged in to the host: `glab auth login --hostname <host>` |

The Map reads and writes only through `gh` and `glab`, as whichever login they hold. It never asks for a token of its own.

<details>
<summary>Roles and scopes needed to write</summary>

- **GitHub**: writing a Link or assigning needs the triage role or above in the Project, and the `repo` scope on a classic token. With `gh` 2.81 or later, the Map can tell whether your login may write. With an older `gh`, it offers writes anyway and stops at the first refusal.
- **GitLab**: writing a Link needs the Guest role or above in the Project (Reporter before GitLab 17.0), and assigning needs Reporter. Both need a token with the `api` scope.

</details>

> [!TIP]
> Under Claude Code's [Bash sandbox](https://code.claude.com/docs/en/sandboxing), the Map's commands can't write their [state directory](docs/privacy.md#on-your-machine), so each one stops with a line naming it. They also can't reach a Tracker the sandbox hasn't allowed. To run them outside the sandbox, with the usual permission prompts, add this to `~/.claude/settings.json`:
>
> ```json
> { "sandbox": { "excludedCommands": ["issue-map *"] } }
> ```
>
> The display hook and the status line aren't commands Claude runs in the shell, so the sandbox doesn't affect them.

## Installation

### From the marketplace

Add this repository as a plugin marketplace and install the plugin from it. This installs the latest release, from the `release` branch, never what is on main:

```text
/plugin marketplace add romtaugranot/issue-map
/plugin install issue-map@issue-map
```

### From a clone, for one session

```sh
git clone --branch release https://github.com/romtaugranot/issue-map.git ~/issue-map
cd path/to/your/checkout
claude --plugin-dir ~/issue-map
```

### Updating

A marketplace that isn't Anthropic's updates itself only if you turned on auto-update for it. To update by hand, run the commands below, or use the `/plugin` panel in a session:

```sh
claude plugin marketplace update issue-map
claude plugin update issue-map@issue-map
```

### Permissions

The Map's skill pre-approves only its read-only commands: drawing the Map, opening Groups and Issue cards, moving, `back`, `home`, `start`, `suggest`, `offer` and printing the status line's row. Following Links from card to card therefore raises no prompt. Because the skill pre-approves commands, Claude Code asks once to use it, and the approval lasts for that request.

Assigning an Issue, confirming Link Suggestions and removing an old status line still ask every time. Each one writes, and the prompt is a second check that the write is yours, not something an Issue's text talked Claude into.

<details>
<summary>Uninstall</summary>

1. If you set up the status line under 0.1.0 and haven't taken it out, do that first, while the plugin is still there to do it. Say `take the Map out of my status line`, or run `issue-map statusline --remove`. A status line you had before is put back as it was; otherwise the `statusLine` setting is removed. The plugin's own status line goes with the plugin.
2. Uninstall the plugin: `/plugin uninstall issue-map@issue-map`.
3. Stop the background processes:

   ```sh
   pkill -f 'src/cli.ts (refresher|read) '
   ```

4. Delete the [state directory](docs/privacy.md#on-your-machine):

   ```sh
   rm -rf "${ISSUE_MAP_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/issue-map}"
   ```

5. In each checkout where you picked a Home Project among several, unset the key that holds the pick:

   ```sh
   git config --local --unset issue-map.home
   ```

</details>

## Usage

Run Claude Code in a git checkout. The Map opens on the checkout's Home Project, the Project its remotes lead to. When the remotes lead to several Projects with open Issues, it asks you to pick one and remembers your pick. Then say what you want in plain words, and Claude runs the plugin's commands for you.

| You say | What happens |
|---|---|
| `map` | The overview of the Project |
| `what should I take next?` | The overview, pointing at Take next. If you ask what Claude would pick, it answers separately and leaves the list's order alone |
| `open group 1` | The outline of the first Group on the overview |
| `open #2` | That Issue's card, read live, then a picker of its Links |
| `picture around #5` | That Issue in the middle, with what it waits on above it and what waits on it beneath |
| `group 1 as Mermaid` | That Group's Picture as a Mermaid block to paste where GitHub or GitLab render it (`as DOT` for Graphviz) |
| `show the whole Map in a browser` | One read-only HTML page of the whole Map |
| `assign #2 to me` | Asks once, then assigns the Issue to you |
| `start work on #2` | Claude reads the Issue's body and comments and briefs you. It makes no branch, no checkout and no code |
| `suggest Links` | Link Suggestions for the Issues on screen, each quoting the words it stands on, for you to tick |
| `go owner/repo` · `back` · `home` | Moves to another Project, one step back along this session's trail, or back to the Home Project |

Every phrase, paging, and how the Map behaves under `claude -p` are in **[docs/usage.md](docs/usage.md)**.

You can also skip Claude. Type `/issue-map` for the Map, or `/issue-map` followed by a view, such as `/issue-map group 1`, `/issue-map issue 2` or `/issue-map back`. It shows the output at once, with no reply to wait for, and Claude reads it too, so you can carry on by asking ([ADR 0012](docs/adr/0012-a-slash-command-shows-the-map-without-claude.md)).

The plugin also pins a status line of its own under the prompt, beside yours, with nothing to set up. It shows the Home Project's first Issue in Take next, and never reads the Tracker itself:

```text
◆ issue-map-fixtures/map · Take next: 6 · #1 [b1] Lay the foundation — ▶2 wait on it
```

## Supported Trackers

The Map is Promised on github.com, GitHub Enterprise Cloud and Server, gitlab.com, GitLab Dedicated and self-managed GitLab, on every tier. It reads older releases as Best effort. The band comes from what each Project's Tracker shows ([ADR 0003](docs/adr/0003-support-by-detected-capability.md)). A Promised Tracker is tested on a running Tracker where the build can run one, and stood in for where it can't ([ADR 0004](docs/adr/0004-promised-means-run-or-stood-in.md)).

<details>
<summary>Every Tracker, its band, and how it's tested</summary>

| Tracker | Band | How it's tested |
|---|---|---|
| github.com | Promised | The contract suite on every change; the fixture Projects read live every night |
| GHEC, including `*.ghe.com` | Promised | Stood in for: github.com's nightly reads, and every query checked against GHEC's published schema on every change |
| GHES 3.19 and later | Promised | Stood in for: github.com's nightly reads, and every query checked against each release's published schema on every change |
| GHES from 3.18, before 3.19 | Promised: no Blocks, so no Take next | 3.18, the oldest release GitHub still supports, records no Blocks Links. Stood in for as 3.19 and later are |
| GHES from 3.17, before 3.18 | Best effort | Parent Links only; read-only and marked untested |
| GHES before 3.17 | Refused | The Map can read no Link kind there |
| gitlab.com | Promised; on Free, no Blocks, so no Take next | The contract suite on every change; the fixture Projects on Free read live every night. Licensed tiers are stood in for by the contract suite's fake `glab`, which answers in the shapes gitlab.com gives, until GitLab for Open Source licenses the fixture group ([docs/fixtures.md](docs/fixtures.md)) |
| GitLab Dedicated | Promised | Stood in for: gitlab.com's nightly reads, the GitLab version matrix, and every query checked on every change against each EE schema the matrix has recorded, in `test/schemas/gitlab` |
| Self-managed GitLab 16.0 and later, every tier | Promised; on Free and CE, no Blocks, so no Take next | The GitLab version matrix, before every release: every minor as CE and as EE, one per job; weekly, the oldest and newest minors. EE runs unlicensed, and licensed tiers are stood in for by the contract suite's fake `glab` and by every query checked against each EE schema the matrix has recorded |
| Self-managed GitLab from 13.4, before 16.0 | Best effort | Read-only and marked untested |
| GitLab before 13.4 | Refused | The Map can read no Link kind there |

The floors come from the adapters, which the matrix and the schema checks read them from. A test fails when any floor in this table disagrees with them. A release is tagged only from a commit where every tier passed; [docs/releasing.md](docs/releasing.md) has the steps.

</details>

Where a Project can't record Blocks Links, on GitLab Free and CE and on the oldest GHES, no Issue is Unblocked, so there is no Take next. You still get the Groups its Parent Links make, its Related Links where the Tracker records them (GitHub records none), and Link Suggestions of those kinds.

## Privacy

- **To a Tracker**, it writes only two things, each after you confirm it: assigning an Issue to you, and a Link Suggestion you ticked.
- **On your machine**, it keeps Snapshots of each Project's open Issues in a state directory only your OS user can read. They expire after a month in which nothing draws them.
- **In the background**, a refresher keeps the Home Project's Snapshot warm with a few requests every 90 seconds. It stops after a day of disuse; to stop it sooner, run `pkill -f 'src/cli.ts refresher'`.
- **Over the network**, it uses only `gh` and `glab`, plus two anonymous requests to tell whether an unfamiliar host runs GitHub or GitLab.
- **To your model provider**, Issue titles reach the provider, as everything in a Claude Code conversation does. So do an Issue's body and comments when you start work on it or ask for Link Suggestions.

What it keeps, for how long, and how to stop each part: **[docs/privacy.md](docs/privacy.md)**.

## Documentation

| Guide | Covers |
|---|---|
| [Usage](docs/usage.md) | Every phrase Claude understands, paging, moving between Projects, `/issue-map`, the status line, and `claude -p` |
| [Privacy and data](docs/privacy.md) | What it writes, what it keeps and for how long, what runs in the background, and what leaves your machine |
| [Troubleshooting](docs/troubleshooting.md) | Missing output or status line, slow first reads, background logs |
| [Glossary](CONTEXT.md) | What Issue, Link, Group, Take next and the rest mean here |
| [Design decisions](docs/README.md#design-decisions) | The ADRs: what was decided and what was weighed against it |
| [Contributing](CONTRIBUTING.md) | Development setup, the three test tiers, fixtures and releasing |

## Contributing

Bug reports go through the [bug form](https://github.com/romtaugranot/issue-map/issues/new?template=bug_report.yml), which asks for what it takes to diagnose one. Report security issues privately, as [SECURITY.md](SECURITY.md) says. Before changing code, read [CONTRIBUTING.md](CONTRIBUTING.md). The contract tests need no network and no login:

```sh
npm ci && npm run typecheck && npm test
```

## Licence

[MIT](LICENSE) © [romtaugranot](https://github.com/romtaugranot)
