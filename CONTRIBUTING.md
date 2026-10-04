# Contributing to Issue Map

Issues and plans live as [GitHub Issues](https://github.com/romtaugranot/issue-map/issues) on this repository. Use the [bug form](https://github.com/romtaugranot/issue-map/issues/new?template=bug_report.yml) to report a bug, and report security issues privately, as [SECURITY.md](SECURITY.md) says.

## Development setup

You need Node.js 22.18 or later. The plugin has no runtime dependencies. The dev dependencies are needed only for type checks and the schema checks.

```sh
git clone https://github.com/romtaugranot/issue-map.git
cd issue-map
npm ci
npm run typecheck
npm test
```

Once `npm ci` has installed the dev dependencies, the tests need no network and no login.

To try your working tree in Claude Code:

```sh
claude --plugin-dir path/to/issue-map
```

## Repository layout

| Path | What's there |
|---|---|
| `bin/` | The entry points Claude Code runs: `issue-map`, the display hook, and the status line |
| `hooks/` | `hooks.json`, which declares the display hook, and `plugin.ts`, the hooks module behind the status line and `/issue-map` |
| `skills/map/SKILL.md` | The skill that tells Claude how to run the Map |
| `src/` | The CLI: `map/` draws, `tracker/` holds the GitHub and GitLab adapters, `snapshot/` holds the Snapshot store and refresher, and `home/`, `move/`, `show/` and `status/` hold the rest |
| `test/` | The contract suite, its fakes, the recorded Snapshots and schemas, and the live reads in `test/live/` |
| `scripts/` | CI helpers in `ci/`, and the fixture seeder in `fixtures/` |
| `docs/` | User guides, [ADRs](docs/adr), and the [fixture](docs/fixtures.md) and [release](docs/releasing.md) notes |

## How it's tested

There are three tiers, as [ADR 0004](docs/adr/0004-promised-means-run-or-stood-in.md) sets out.

- **Contract**, on every pull request and every push to main. It runs the drawing code against hand-written and recorded Snapshots, and both adapters against fake `gh` and `glab`. It checks every query against the recorded GitHub and GitLab schemas. It also checks the tree users install with `claude plugin validate --strict` on the pinned Claude Code build. The hooks module's tests, `hooks/*.test.ts`, run with `claude plugin test` on that tree once copied into it; CI doesn't run them yet ([#131](https://github.com/romtaugranot/issue-map/issues/131)).
- **Live**, nightly. It reads the fixture Projects on github.com and gitlab.com through the real adapters. [docs/fixtures.md](docs/fixtures.md) says how they're set up and how to run the live reads yourself.
- **The GitLab version matrix**. It runs GitLab's own images in CI, seeds them with the GitLab Free fixture, and reads them back through the real adapter. Before a release, it covers every promised minor as CE and as EE. Weekly, it covers the oldest and newest.

## Conventions

- **Use the glossary's words.** [CONTEXT.md](CONTEXT.md) defines Issue, Link, Group, Take next and the rest, and the words to avoid for each. Use those terms in code, tests, Issues and docs.
- **Record decisions as ADRs.** A change that settles a design question gets an ADR in [docs/adr](docs/adr) and a row in the [docs index](docs/README.md#design-decisions). If a change contradicts an existing ADR, say so rather than overriding it silently.
- **The README's examples are drawn, not typed.** `test/readme.test.ts` checks that the README's first three blockquotes and its status line row equal what the plugin draws from the GitHub fixture. `test/versions.test.ts` checks the support table's floors against the adapters. When you change either, update the README to match.
- **Say what a release changes.** A change users will notice gets a line in the next version's section of [CHANGELOG.md](CHANGELOG.md), which becomes the release notes.

## Releasing

Users install the `release` branch, never main. Only the Release workflow moves it, after every tier has passed. [docs/releasing.md](docs/releasing.md) has the steps.
