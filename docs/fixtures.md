# Fixture Projects

[← Docs](README.md)

The Projects the live reads assert on (spec #25, Seam B; ADR 0004's nightly tier). What they hold is declared once, in [`test/live/fixtures.ts`](../test/live/fixtures.ts): the seeder writes it to the Trackers, and the live reads assert the adapters read exactly that back. They live in project-owned organisations and groups, never a personal account, and name no person, private Project or machine.

`scripts/fixtures/setup-wizard.sh` walks through every manual step below.

## Where they live

| Fixture | Tracker | Namespace | Holds |
|---|---|---|---|
| `github` | github.com | organisations `issue-map-fixtures` and `issue-map-fixtures-b` | a Blocks chain; a Parent tree reaching into another Project; blockers closed as completed, not planned and as a duplicate; a Closing Request; an Unlinked Issue; an Outside Issue in the other organisation Blocking one here |
| `gitlab-free` | gitlab.com, and every GitLab the version matrix runs | group `issue-map-fixtures`, on Free | Related strands; tasks under an Issue; an Issue closed as a duplicate; a Closing Request; an Outside Issue in another Project; an Unlinked Issue. No Blocks Links: Free can't record them |
| `gitlab-oss` | gitlab.com | group `issue-map-fixtures-oss`, on the tier GitLab for Open Source grants | a Blocks chain; a closed blocker; an epic over Issues, one with a task; Related Links; a Closing Request; an Outside Issue Blocking across Projects |

The names are kept in one place, `NAMESPACES` in `test/live/fixtures.ts`; renaming one is an edit there.

Two organisations, because an Outside Issue in another owner's Project is read differently from one next door. Two GitLab groups, because a GitLab tier decides which Link kinds a Project records: Blocks Links and epics need Premium or above, so they live only in the group GitLab for Open Source licenses. Tasks and Related Links work on Free.

## Reading them: a GitHub App, never a personal login

CI reads the GitHub Fixtures as a GitHub App, through an installation token `actions/create-github-app-token` mints for each run and exports as `GH_TOKEN`.

- **Owner**: the `issue-map-fixtures` organisation.
- **Repository permissions**: Issues: Read-only; Pull requests: Read-only (Closing Requests); Metadata: Read-only (always granted). Nothing else, and no webhook.
- **Installed on** both organisations, all repositories.

The GitLab Fixtures are public, and are read with a token of a project-owned bot account on gitlab.com with the `read_api` scope. Group access tokens would be better, but on gitlab.com they need Premium, which the Free group doesn't have.

## Seeding them: a login that may write

Seeding writes Projects, Issues, Links and Closing Requests, which the reading credentials can't. An owner of the organisations and groups runs it once, and again whenever `fixtures.ts` changes, with their own `gh` and `glab` login:

```sh
node scripts/fixtures/seed.ts github
node scripts/fixtures/seed.ts gitlab-free
node scripts/fixtures/seed.ts gitlab-oss   # once GitLab for Open Source has licensed the group
```

It makes what's missing and deletes nothing; an Issue is found again by the `[key]` its title starts with, so a second run writes nothing. The Closing Requests are pull and merge requests from `fixture/<key>` branches: never merge them. An Issue someone edits by hand can drift from the manifest, and the next night's live reads say so.

## Credentials

Kept only as GitHub Actions settings of this repository, never in the repo:

| Name | Kind | What |
|---|---|---|
| `FIXTURES_APP_CLIENT_ID` | variable | the GitHub App's Client ID |
| `FIXTURES_APP_PRIVATE_KEY` | secret | a private key generated for the App |
| `FIXTURES_GITLAB_TOKEN` | secret | the gitlab.com bot account's `read_api` token |
| `ISSUE_MAP_LIVE` | variable | the Fixtures the nightly tier reads; `github,gitlab-free` when unset, and `github,gitlab-free,gitlab-oss` once GitLab for Open Source licenses the group |
| `GITLAB_LICENCE_AGREED` | variable | `false` until GitLab agrees in writing to a self-generated test licence in public CI (ADR 0004); see below |
| `GITLAB_TEST_LICENCE` | secret | only once `GITLAB_LICENCE_AGREED` is `true`: the licence the version matrix's EE jobs apply |

## Running the live reads

```sh
ISSUE_MAP_LIVE=github,gitlab-free,gitlab-oss npm run test:live
```

- `ISSUE_MAP_LIVE` names the Fixtures to read, comma-separated; with none named, every live read is skipped.
- `ISSUE_MAP_LIVE_GITLAB_HOST` is where the GitLab Fixtures are read, `gitlab.com` by default.
- The login is whatever `gh` and `glab` hold, as always: `GH_TOKEN`, or `GITLAB_TOKEN` with `GITLAB_HOST`.

## GitLab for Open Source

**Outcome: pending — not yet applied.**

The `issue-map-fixtures-oss` group is where the Map's licensed-tier reads are tested live: Blocks Links, epics as Parents, and the Link kinds a Premium or Ultimate Project records. Until GitLab licenses it, the `gitlab-oss` Fixture can't be seeded and isn't read nightly, and licensed tiers are stood in for only by the contract suite's recorded responses.

GitLab's programme asks for a public project under an OSI-approved licence. This repository is under the MIT licence, and goes public before applying. Its application form, tried on 2026-09-24, refuses a group without a public project, so `issue-map-fixtures-oss` needs one too.

When the outcome is known, record it here:

- Applied on: _date_
- Outcome: _approved / declined_, tier granted: _Ultimate_, until: _date_
- Unlocks: _e.g. Blocks Links, epics, and every licensed Link kind on gitlab.com, read nightly_
- Doesn't unlock: a licensed **self-managed** GitLab. The version matrix runs CE, and EE unlicensed, so licensed self-managed tiers stay stood in for by the gitlab.com group until GitLab agrees in writing that a self-generated test licence in public CI falls under the EE licence's "development and testing" clause (ADR 0004). `GITLAB_LICENCE_AGREED` stays `false` until then.
