# Promised means tested on a running Tracker where the build can run one, and stood in for where it can't

ADR 0003 promises GHES, GHEC (including `*.ghe.com`) and GitLab Dedicated, but none of them can run in a public build. A Tracker in the Promised band counts as tested when two things hold:

- every read and write the Map uses there has run against the closest Tracker the build can run
- every query the Map sends has been checked against that version's own schema

For GHES and GHEC, the closest Tracker is github.com, and the checks use the GraphQL schema GitHub publishes for each release. For GitLab Dedicated and for licensed self-managed tiers the build can't run, it is the GitLab matrix or gitlab.com, and the checks use the schema recorded from that version's EE. GHES is built from the same code as github.com, and GitHub publishes each release's schema from its release branch, so a missing field shows up in a check that needs no running GHES. Moving GHES to Best effort would take writes away from the users most likely to record Blocks Links.

## Considered Options

- **Strict: Promised only where the build runs that version.** GHES and Dedicated would become read-only.
- **A fourth band for Trackers checked only against their schema**, with a note on the Map. Users would have one more band to understand, for a gap the schema checks already close.
- **Promise GHES only after someone with access contributes a recording of its responses.** The Promise would then depend on a stranger.

## Consequences

- **On GHES, the Map detects Link kinds from the version and a targeted schema check, never from the shape of an error.** GHES error bodies are unverified, so an unfamiliar one can't make a Blocked Issue look Unblocked. A write still stops at the first refusal (ADR 0003).
- **The Map shows no note for a stood-in Tracker.** The README's support table says how each Promised Tracker is tested.
- **A Tracker release that ships after a plugin release is Promised straight away.** gitlab.com runs GitLab's code first and is read every night. The weekly matrix works out which release is current each time it runs. New GHES schemas arrive through a scheduled pull request. A failure opens an Issue and is fixed in a patch release.
- **Licensed self-managed EE is stood in for until GitLab agrees in writing** that a self-generated test licence in public CI falls under the EE licence's "development and testing" clause. Only that route gives a Tracker licensed for Premium alone. Until then, responses recorded from a public Premium group stand in for that state — once GitLab for Open Source licenses the fixture group; until it does, the contract suite's fake `glab` stands in (see docs/fixtures.md).
- **A release is tagged only from a commit where every tier passed**: the contract checks, the live reads of the fixture Projects, and the full GitLab matrix.
