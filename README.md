# Issue Map

A Claude Code plugin that draws a Project's open Issues as a Map joined by the Links its Tracker records, so you can see which Issue to take next.

## Support

The Map puts every Project in a band from what its Tracker shows there ([ADR 0003](docs/adr/0003-support-by-detected-capability.md)). A Promised Tracker is tested on a running Tracker where the build can run one, and stood in for where it can't ([ADR 0004](docs/adr/0004-promised-means-run-or-stood-in.md)):

| Tracker | Band | How it's tested |
|---|---|---|
| github.com | Promised | The contract suite on every change; the fixture Projects read live every night |
| GHEC, including `*.ghe.com` | Promised | Stood in for: github.com's nightly reads, and every query checked against GHEC's published schema on every change |
| GHES 3.18 and later, the releases GitHub still supports | Promised | Stood in for: github.com's nightly reads, and every query checked against each release's published schema on every change |
| Older GHES | Best effort | Read-only and marked untested |
| gitlab.com | Promised | The contract suite on every change; the fixture Projects read live every night, on Free and on a licensed tier |
| GitLab Dedicated | Promised | Stood in for: gitlab.com's nightly reads, the GitLab version matrix, and every query checked on every change against the schema recorded from each promised version's EE |
| Self-managed GitLab 16.0 and later, every tier | Promised | The GitLab version matrix, before every release: every minor as CE and as EE, one per job; weekly, the oldest and newest minors. EE runs unlicensed, and licensed tiers are stood in for by the licensed group on gitlab.com and by every query checked against the schema recorded from each version's EE |
| Self-managed GitLab 13.4 to 15.11 | Best effort | Read-only and marked untested |
| GitLab before 13.4 | Refused | The Map can read no Link kind there |

The floors come from the adapters, which the matrix and the schema checks read them from; a test fails when this table disagrees. A release is tagged only from a commit where every tier passed: run the Release workflow with the version to release. [docs/fixtures.md](docs/fixtures.md) says how the fixture Projects are set up.
