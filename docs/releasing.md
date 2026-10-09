# Releasing

[← Docs](README.md)

What users install is the `release` branch, never main: the marketplace entry in `.claude-plugin/marketplace.json` names it, by its HTTPS address, since Claude Code clones a `github` source over SSH and a user with no SSH key on GitHub couldn't install it. Only the Release workflow (`.github/workflows/release.yml`) moves it, one commit per release, holding the plugin's runtime parts alone: `bin/`, `hooks/`, `skills/`, `src/`, `.claude-plugin/plugin.json`, `LICENSE`, `README.md` and `SECURITY.md`. It has no package manifest or lockfile, so Claude Code installs no npm dependencies with it (`src/package.json` only tells Node the source is ES modules), and no tests, recorded Snapshots, schemas or developer notes. `scripts/ci/release.ts` builds it, and `test/release.test.ts` checks it holds exactly that. On every change the Contract workflow also builds it and checks it as Claude Code checks a plugin, with `claude plugin validate --strict`, so a manifest or hook warning fails the change.

A release is tagged only from a commit where every tier passed (ADR 0004): the workflow runs the contract tier, the live reads and the full GitLab version matrix on the commit it was started on, builds the tree from that same commit, and publishes it only once all three are green. The tag `v<version>` names the release branch's commit, whose message names the main commit it was built from.

The version lives in the release alone. main's `.claude-plugin/plugin.json` stays at `0.0.0`; the workflow writes the version it releases into the tree's manifest, and takes the release notes from that version's section of `CHANGELOG.md`, so the tag, the manifest and the notes always say the same version.

## Before the first release

An owner of the repository does these once:

1. Under **Settings → Actions → General → Workflow permissions**, ticks **Allow GitHub Actions to create and approve pull requests**, so the GitLab matrix's and the GHES schemas workflow's schema jobs can open their pull requests.
2. Dispatches **GitLab matrix** with `only` left empty, and **GHES schemas**, from the Actions tab, and merges the schema pull requests they open once the contract tier passes on them. A pull request opened with the workflow's own token doesn't start the contract tier by itself: close and reopen it.
3. Under **Settings → Rules → Rulesets**, adds a branch ruleset for `release` that restricts updates and deletions and blocks force pushes, and a tag ruleset for `v*` that restricts updates and deletions, so only the Release workflow writes them. The workflow pushes with its own token, which acts as the GitHub Actions app, not as you, so a role bypass, even the admin role, doesn't let it through: give bypass on the `release` ruleset to the GitHub Actions app, never everyone. If the app can't be picked, leave updates unrestricted on `release` and keep deletions restricted and force pushes blocked, since the workflow only ever moves it forward. The first release creates the branch, which restricting updates doesn't stop, so a refused push shows up at the second.

## Releasing a version

1. On main, add a section to `CHANGELOG.md` headed `## <version>`, such as `## 0.2.0`, saying what the release changes for someone using the Map. The workflow refuses a version with no section, or an empty one.
2. Optionally, try it first: in the Actions tab run **Release** on main with the version and **dry-run** ticked. It runs no tier, pushes and tags nothing; it builds the tree, draws the GitHub Fixture's Map from it on Node 22.18 with nothing installed, and keeps the tree and its notes as the artifact `issue-map-v<version>`.
3. Run **Release** on main with the version, dry-run left unticked. It refuses any branch but main and a version already tagged. Once every tier and the tree are green, it commits the tree to `release`, pushes that commit with the tag `v<version>` together, and makes the GitHub release with the notes. Recording the EE schemas the full matrix read is bookkeeping, not a tier, so a failure there alone doesn't stop the release: look for a failed schemas job in the run, and see that its pull request is opened and merged.
4. If the run fails after the push, while making the GitHub release, make it by hand from the artifact's notes: `gh release create v<version> --verify-tag --title v<version> --notes-file notes.md`. Don't run the workflow again for the same version: the tag is already there.

## What users see

A marketplace that isn't Anthropic's doesn't update itself unless the user turned auto-update on for it. Users get a new release with:

```sh
claude plugin marketplace update issue-map
claude plugin update issue-map@issue-map
```

or from the `/plugin` panel in a session.

Claude Code sees a new version because the release's manifest says one. Commits on main reach nobody until the next release.
