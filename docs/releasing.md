# Releasing

What users install is the `release` branch, never main: the marketplace entry in `.claude-plugin/marketplace.json` names it. Only the Release workflow (`.github/workflows/release.yml`) moves it, one commit per release, holding the plugin's runtime parts alone: `bin/`, `hooks/`, `skills/`, `src/`, `.claude-plugin/plugin.json`, `LICENSE`, `README.md` and `SECURITY.md`. It has no package manifest or lockfile, so Claude Code installs no npm dependencies with it (`src/package.json` only tells Node the source is ES modules), and no tests, recorded Snapshots, schemas or developer notes. `scripts/ci/release.ts` builds it, and `test/release.test.ts` checks it holds exactly that.

A release is tagged only from a commit where every tier passed (ADR 0004): the workflow runs the contract tier, the live reads and the full GitLab version matrix on the commit it was started on, builds the tree from that same commit, and publishes it only once all three are green. The tag `v<version>` names the release branch's commit, whose message names the main commit it was built from.

The version lives in the release alone. main's `.claude-plugin/plugin.json` stays at `0.0.0`; the workflow writes the version it releases into the tree's manifest, and takes the release notes from that version's section of `CHANGELOG.md`, so the tag, the manifest and the notes always say the same version.

## Before the first release

An owner of the repository, under **Settings → Rules → Rulesets**, adds a branch ruleset for `release` that restricts updates and deletions and blocks force pushes, and a tag ruleset for `v*` that restricts updates and deletions, so only the Release workflow writes them. If a ruleset refuses the workflow's own push, give bypass on it to the actor GitHub lists for Actions or the repository admin role, never everyone.

## Releasing a version

1. On main, add a section to `CHANGELOG.md` headed `## <version>`, such as `## 0.2.0`, saying what the release changes for someone using the Map. The workflow refuses a version with no section, or an empty one.
2. Optionally, try it first: in the Actions tab run **Release** on main with the version and **dry-run** ticked. It runs no tier, pushes and tags nothing; it builds the tree, draws the GitHub Fixture's Map from it on Node 22.18 with nothing installed, and keeps the tree and its notes as the artifact `issue-map-v<version>`.
3. Run **Release** on main with the version, dry-run left unticked. It refuses any branch but main and a version already tagged. Once every tier and the tree are green, it commits the tree to `release`, pushes that commit with the tag `v<version>` together, and makes the GitHub release with the notes.
4. If the run fails after the push, while making the GitHub release, make it by hand from the artifact's notes: `gh release create v<version> --verify-tag --title v<version> --notes-file notes.md`. Don't run the workflow again for the same version: the tag is already there.

## What users see

A marketplace that isn't Anthropic's doesn't update itself unless the user turned auto-update on for it. Users get a new release with:

```sh
claude plugin marketplace update issue-map
claude plugin update issue-map@issue-map
```

or from the `/plugin` panel in a session.

Claude Code sees a new version because the release's manifest says one. Commits on main reach nobody until the next release.
