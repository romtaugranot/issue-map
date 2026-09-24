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
- **Closing Requests** weren't recorded, so each Snapshot says they're unread and no Issue has one.
- **Personal accounts.** An Outside Issue in a Project owned by a person, rather than an organisation or group, has its owner renamed `fixture-user-<n>` in its path, reference and URL. The repo is headed public, and a fixture names no person.
- **Close dates and ways.** The prototypes kept only whether a Link's far end was open, so a closed one has no `closedAt` or `closedAs`, and the Snapshots are still in format 2. The Map names such a blocker rather than dating when it closed.
- **Link kinds.** The prototypes didn't ask which Link kinds each Project records, so each Snapshot says what github.com or gitlab.com answers a Project that records every kind (GitHub records no Related Links), on a version the Map is tested on.
