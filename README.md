# Issue Map

A Claude Code plugin that draws a Project's open Issues as a Map joined by the Links its Tracker records, so you can see which Issue to take next. GitHub and GitLab already let people record that one Issue Blocks another or sits under a Parent, but neither shows the whole of it at once. The Map does, inside the conversation: it lists the Unblocked Issues in a fixed order, groups the rest by their Links, and lets you walk from one Issue card to the next, assign yourself, or have Claude brief you on an Issue before you start. It draws only the Links someone recorded; Links Claude finds in the Issues' text are offered as Link Suggestions, and become Links only once you confirm them.

## What it looks like

These are drawn by the plugin's own drawing code, rendered as Markdown, from the Issues and Links of [`issue-map-fixtures/map`](https://github.com/issue-map-fixtures/map), the public fixture Project the nightly tests read, as read two days after its blockers closed. Its titles start with the key the fixture seeder finds each Issue by.

Asking for the Map draws the overview. Take next comes first: the Unblocked Issues you could take, ordered by how many open Issues wait on each (`▶2`), then the earliest Planned date, then the oldest. A Parent gives way to its Unblocked children (`via #4`), and an Issue whose blocker closed says when.

> **issue-map-fixtures/map** · 14 open · 8 on the Map · 6 Unlinked · Promised
>
> **Take next: 6** — most waited on first · 1 more not listed
> - #1 \[b1\] Lay the foundation — ▶2 wait on it
> - #6 \[p3\] Tag the build — via #4
> - #7 \[p4\] Proofread the release notes — via #5
> - #9 \[u1\] Remove the compatibility shims — unblocked 2d ago
> - #11 \[u2\] Keep the old parser working — unblocked 2d ago · #10 closed as not planned
>
> **Groups: 3** — largest first
> - #4 \[p1\] Plan the release — 4 Issues, 1↗
> - #1 \[b1\] Lay the foundation — 3 Issues
> - ↗issue-map-fixtures-b/elsewhere#1 \[x1\] Publish the shared config — 1 Issue, 1↗
>
> **Unlinked: 6** — no Link to another open Issue. Ask to list them.

`↗` marks an Outside Issue: an Issue in another Project that a Link reaches. It is drawn, and joins Issues into a Group, but the Map doesn't follow its own Links.

Opening a Group lists what sits at its top, one level at a time:

> **Group 1 of 3** · #4 \[p1\] Plan the release — 4 Issues, 1↗
>
> **Under #4, alone at the top: 3** — most under it first
> - #5 \[p2\] Write the release notes — 1 under it
> - #6 \[p3\] Tag the build
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

Claude then asks where to go next, in a picker: **Assign #2 to me**, **Start work on #2**, **#1** (Blocked by · [b1] Lay the foundation) and **More Links**.

Claude doesn't retype any of this. Each output ends with a line such as `⟦issue-map 3f9a0c1b2d4e⟧`; Claude writes that line in its reply, and the plugin's display hook shows the output in its place, exactly as printed ([ADR 0009](docs/adr/0009-show-output-through-a-display-hook.md)).

## Requirements

- Claude Code 2.1.152 or later, the first to run `MessageDisplay` hooks, which the plugin shows its output through. (A plugin's `bin/` on the Bash tool's `PATH`, which it also needs, came earlier, in 2.1.91.)
- Node.js 22.18 or later on your `PATH`. The plugin is TypeScript that Node runs directly, with no runtime dependencies, and a release holds only what it runs, so there is nothing to install or build.
- `bash`, which the plugin's entry points are written in, and `git`, which it reads the checkout's remotes with.
- For GitHub, the [GitHub CLI](https://cli.github.com/) logged in to the host: `gh auth login --hostname <host>`. Writing needs the `repo` scope on a classic token. `gh` 2.64 or later tells the Map whether your login may write; with an older one it offers writes anyway and stops at the first refusal.
- For GitLab, the [GitLab CLI](https://gitlab.com/gitlab-org/cli) logged in to the host: `glab auth login --hostname <host>`. Writing needs a token with the `api` scope.

The Map reads and writes only through `gh` and `glab`, as whichever login they hold. It never asks for a token of its own.

Under Claude Code's [Bash sandbox](https://code.claude.com/docs/en/sandboxing), the Map's commands can't write their [state directory](#what-it-writes-and-what-it-keeps), so each stops with a line naming it, nor reach a Tracker the sandbox hasn't allowed. Run them outside it, with the usual permission prompts, by adding this to `~/.claude/settings.json`:

```json
{ "sandbox": { "excludedCommands": ["issue-map *"] } }
```

The display hook and the status line aren't commands Claude runs in the shell, so the sandbox doesn't reach them.

## Install

In Claude Code, add this repository as a plugin marketplace and install the plugin from it. It installs the latest release, from the `release` branch, never what is on main:

```text
/plugin marketplace add romtaugranot/issue-map
/plugin install issue-map@issue-map
```

To try it from a clone instead, for one session:

```sh
git clone --branch release https://github.com/romtaugranot/issue-map.git ~/issue-map
cd path/to/your/checkout
claude --plugin-dir ~/issue-map
```

Permissions: the Map's skill pre-approves only its read-only commands — drawing the Map, opening Groups and Issue cards, moving, `back`, `home`, `start`, `suggest`, `offer` and printing the status line's row — so following Links from card to card raises no prompt. Claude Code asks once to use the skill, since it pre-approves commands, and the approval lasts for that request. Assigning an Issue, confirming Link Suggestions and setting up or removing the status line still ask every time: each writes, and the prompt is a second check that the write is yours, not something an Issue's text talked Claude into.

## Using it

Run Claude Code in a git checkout. The Map opens on the checkout's Home Project, the Project its remotes lead to; when they lead to several with open Issues, it asks you to pick one, and remembers the pick. Then say what you want in plain words. Claude runs the plugin's commands for you.

| You say | What happens |
|---|---|
| `map` | The overview of the Project on screen |
| `refresh the Map` | The overview, its Snapshot refreshed now even if it's under two minutes old, so a Link you just recorded in the browser shows |
| `what should I take next?` | The overview, pointing at Take next. Ask what Claude would pick and it says so separately, without reordering the list |
| `open group 1` | The outline of the first Group on the overview |
| `what's under #5?` | The level beneath an Issue in its Group |
| `open #2` | That Issue's card, read live, then a picker of its Links |
| `more` | The next page of an outline, a card's Links or the Unlinked list |
| `list the Unlinked Issues` | The Issues with no Link to another open Issue, 15 a page, newest first |
| `assign #2 to me` | Asks once, then assigns the Issue to you |
| `start work on #2` | Claude reads the Issue's body and comments and briefs you in about a dozen lines. No branch, no checkout, no code |
| `suggest Links` | Link Suggestions for the Issues on screen, each quoting the words it stands on, offered for you to tick |
| `go owner/repo`, `go <URL>`, `go ../other-checkout` | Moves to another Project, or to an Issue inside its own Project's Map; asks which when more than one Tracker holds it. `go` alone offers nearby Projects |
| `back` | One step back along this session's trail |
| `home` | Back to the Home Project's overview; on it, offers to pick the Home Project again |
| `put the Map in my status line` | Adds a row with the Home Project's first Issue in Take next to your status line, after the rows of any status line you already have |
| `take the Map out of my status line` | Removes that row: a status line you already had is put back as it was |

The status line's row looks like this, and never reads the Tracker itself:

```text
◆ issue-map-fixtures/map · Take next: 6 · #1 [b1] Lay the foundation — ▶2 wait on it
```

Under `claude -p` there are no pickers and no display hook: Claude reprints each output instead, and asks nothing.

Where the display hook doesn't run in a session — hooks disabled, only managed hooks allowed, or Node not on the hook's `PATH` — the next command notices, Claude says so once, and reprints each output from then on.

## What it writes, and what it keeps

**To a Tracker**, the Map writes two things, each only after you confirm it: assigning an Issue to you, and a Link Suggestion you ticked. It reads the Issue again before each write, writes once, and stops at the first refusal. It writes nothing on a Best effort Project, or for a login that may only read.

**On your machine**, it keeps its state in `$ISSUE_MAP_STATE_DIR`, or `$XDG_STATE_HOME/issue-map`, or `~/.local/state/issue-map`, readable only by your OS user:

- a Snapshot of each Project's open Issues and Links per login, and the pages of a read not yet finished. They hold private Issue titles, and are deleted once the Tracker says the login can no longer read the Project, or once nothing has drawn or read the Project for a month. The Home Project's is kept warm by the refresher and never expires while it runs; one of a Project you visited with `go` lasts until it's drawn again or expires;
- each output shown through the display hook, kept a month, even once its Project's Snapshot is deleted;
- this session's trail for `back`, kept a month;
- the 10 Projects you moved to last, and the last Home Project of each checkout, each kept until replaced;
- the Link Suggestions offered in each session (references only, never an Issue's text), kept until that session's next offer replaces them, and those you declined, kept so they aren't offered again;
- `background.log`, what the background processes print: past a megabyte it's moved to `background.log.1`, replacing the one there.

Both variables must be absolute paths. One that is empty or relative is ignored, as if unset, so private Issue titles never land in your working tree.

Outside that directory it writes only when you ask: `issue-map.home` in the checkout's local git config when you pick a Home Project among several, and `statusLine` in your Claude Code `settings.json` when you ask for the status line; once it's there, drawing the Map after an update points it at where the plugin is now.

**In the background**, drawing the Map starts a full read of a Project when one is due, and a refresher that keeps the Home Project's Snapshot warm, a few requests every 90 seconds. The refresher runs as a process of its own and carries on after Claude Code exits, until a day passes with nobody drawing the Map or glancing at its status line row, the login changes, the Tracker refuses it, or the Project's path leads elsewhere. To stop it sooner:

```sh
pkill -f 'src/cli.ts refresher'
```

Drawing the Map again starts it again, and after an update replaces one of the version before.

Each `gh` or `glab` call is stopped after 60 seconds, or 5 minutes for a page of a full read, and a full read after 3 hours; the Map then says the Tracker didn't answer, keeps drawing from the Snapshot, and tries again on the next draw or refresher round. A stopped full read resumes from its last page. To stop a stuck full read sooner:

```sh
pkill -f 'src/cli.ts read'
```

**Over the network**, besides `gh` and `glab`, it sends anonymous HTTPS requests to a remote's host to tell whether it runs GitHub or GitLab: one to `/api/v3/meta` and one to `/api/v4/version`, never with a credential. It skips them for the hosts it knows by name: github.com, `*.ghe.com`, gitlab.com and `*.gitlab-dedicated.com`. A host found only that way, with no login for it, is never read.

## Uninstall

1. Take the Map out of your status line first, while the plugin is still there to do it: say `take the Map out of my status line`, or run `issue-map statusline --remove`. A status line you had before is put back as it was; otherwise the `statusLine` setting is removed. Uninstalling the plugin first would leave your status line running a command that's gone.
2. Uninstall the plugin: `/plugin uninstall issue-map@issue-map`.
3. Stop the background processes:

   ```sh
   pkill -f 'src/cli.ts (refresher|read) '
   ```

4. Delete the state directory, `$ISSUE_MAP_STATE_DIR`, or `$XDG_STATE_HOME/issue-map`, or `~/.local/state/issue-map`:

   ```sh
   rm -rf "${ISSUE_MAP_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/issue-map}"
   ```

5. In each checkout where you picked a Home Project among several, unset the key that holds the pick:

   ```sh
   git config --local --unset issue-map.home
   ```

## Support

The Map puts every Project in a band from what its Tracker shows there ([ADR 0003](docs/adr/0003-support-by-detected-capability.md)). A Promised Tracker is tested on a running Tracker where the build can run one, and stood in for where it can't ([ADR 0004](docs/adr/0004-promised-means-run-or-stood-in.md)):

| Tracker | Band | How it's tested |
|---|---|---|
| github.com | Promised | The contract suite on every change; the fixture Projects read live every night |
| GHEC, including `*.ghe.com` | Promised | Stood in for: github.com's nightly reads, and every query checked against GHEC's published schema on every change |
| GHES 3.18 and later, the releases GitHub still supports | Promised | Stood in for: github.com's nightly reads, and every query checked against each release's published schema on every change |
| GHES 3.17 | Best effort | Parent Links only; read-only and marked untested |
| GHES before 3.17 | Refused | The Map can read no Link kind there |
| gitlab.com | Promised | The contract suite on every change; the fixture Projects on Free read live every night. Licensed tiers are stood in for by the contract suite's fake `glab`, which answers in the shapes gitlab.com gives, until GitLab for Open Source licenses the fixture group ([docs/fixtures.md](docs/fixtures.md)) |
| GitLab Dedicated | Promised | Stood in for: gitlab.com's nightly reads, the GitLab version matrix, and every query checked on every change against each EE schema the matrix has recorded, in `test/schemas/gitlab` |
| Self-managed GitLab 16.0 and later, every tier | Promised | The GitLab version matrix, before every release: every minor as CE and as EE, one per job; weekly, the oldest and newest minors. EE runs unlicensed, and licensed tiers are stood in for by the contract suite's fake `glab` and by every query checked against each EE schema the matrix has recorded |
| Self-managed GitLab 13.4 to 15.11 | Best effort | Read-only and marked untested |
| GitLab before 13.4 | Refused | The Map can read no Link kind there |

The floors come from the adapters, which the matrix and the schema checks read them from; a test fails when this table's GHES and GitLab floors disagree with them. A release is tagged only from a commit where every tier passed; [docs/releasing.md](docs/releasing.md) has the steps.

## How it's tested

Three tiers, as [ADR 0004](docs/adr/0004-promised-means-run-or-stood-in.md) sets out:

- **Contract**, on every pull request and every push to main: the drawing code against hand-written and recorded Snapshots, both adapters against fake `gh` and `glab`, and every query checked against the recorded GitHub and GitLab schemas. Once `npm ci` has installed the dev dependencies, it needs no network and no login:

  ```sh
  npm ci
  npm run typecheck
  npm test
  ```

- **Live**, nightly: the fixture Projects on github.com and gitlab.com read through the real adapters. [docs/fixtures.md](docs/fixtures.md) says how they're set up and how to run the live reads yourself.
- **The GitLab version matrix**: GitLab's own images, run in CI, seeded with the GitLab Free fixture and read back through the real adapter: every promised minor, as CE and EE, before a release, and the oldest and newest weekly.

## Design notes

[CONTEXT.md](CONTEXT.md) is the glossary: what an Issue, a Link, a Group, Take next and the rest mean here, and the words avoided for each. [docs/adr](docs/adr) holds the decisions and what was weighed against them, from why the Map lives inside Claude Code ([ADR 0001](docs/adr/0001-build-new-inside-claude-code.md)) and draws only recorded Links ([ADR 0002](docs/adr/0002-draw-only-recorded-links.md)) to why it reaches the screen through a display hook ([ADR 0009](docs/adr/0009-show-output-through-a-display-hook.md)).

## Licence

MIT — see [LICENSE](LICENSE).
