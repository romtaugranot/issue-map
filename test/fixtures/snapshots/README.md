# Recorded Snapshots

Four public Projects, recorded for the prototypes and lifted into the Snapshot format (`src/snapshot/snapshot.ts`), gzipped.

| File | Recorded | By |
|---|---|---|
| `opentofu__opentofu.json.gz` | 2026-09-21, github.com | #9, `prototype/map-look` |
| `microsoft__playwright.json.gz` | 2026-09-21, github.com | #9, `prototype/map-look` |
| `rust-lang__rust.json.gz` | 2026-09-22, github.com | #22, `prototype/large-map` |
| `gitlab-org__gitlab.json.gz` | 2026-09-22, gitlab.com | #22, `prototype/large-map` |

Where they differ from what a live read would hold:

- **Identities** are the Issue's full reference (`owner/name#123`, or `group&12` for an epic), since the prototypes kept no Tracker identities. An Issue the login couldn't read is `hidden-<n>`, each one distinct.
- **Assignees** are `fixture-assignee` where the Issue was assigned, since the prototypes kept only whether it was.
- **The login** is `fixture-viewer`.
- **Personal accounts.** An Outside Issue in a Project owned by a person, rather than an organisation or group, has its owner renamed `fixture-user-<n>` in its path, reference and URL. The repo is headed public, and a fixture names no person.
