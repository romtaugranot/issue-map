# The Map draws from a per-login Snapshot, refreshed when stale and shown when old

The Map is drawn from a Snapshot on disk, not from a live read. A full read takes minutes on the largest Projects, and the status line can only ever read something saved. A draw refreshes the Snapshot first when it is more than a short window old. That refresh is incremental and costs a few requests. When the Tracker can't be read, because of a rate limit, a timeout or no network, the Map still draws from the Snapshot and says how old it is and why. Only an Issue card reads the Tracker every time it opens, and every write re-reads the Issues it touches first, so the moment the user acts is never based on old data. A Snapshot belongs to one Tracker, one Project and one login. It holds private Issue titles, so it keeps only what the Map draws, can be read only by its OS user, is never shown to another login, and is deleted as soon as the Tracker says the login can no longer read the Project.

## Considered Options

- **Refuse to draw when the Tracker can't be read**, or hide Take next once the Snapshot is old. Nothing old is ever shown, but a rate limit or a dropped network leaves the user with no Map at all. The live read on the card already protects the moment of acting.
- **Draw only from the Snapshot, and refresh it only in the background.** Every draw is instant, but the status line is optional, and without it the Map could be hours old.
- **Read the Tracker before every draw.** The Map is always fresh, but every step through it waits seconds.
- **One Snapshot per Project, shared by every login.** This is simpler, but after `gh auth switch` another login could see titles it can't read.
- **Keep no titles on disk.** No private text is stored, but every overview has to read the titles again.

## Consequences

- **Incremental refreshes can drift.** GitHub doesn't mark a Link change on either Issue, GitLab occasionally misses one end, and Closing Requests are read from recently updated pull and merge requests. So the Snapshot is read again in full, in the background, whenever a refresh can't prove it caught up, and otherwise once a week.
- **Offline, the Map can't tell lost access from a lost network.** It keeps drawing, with a note, until the Tracker actually refuses the login.
- **A partial Snapshot is never drawn.** The first read of a large Project takes minutes — 5.4 for `rust-lang/rust`, about 37 for `gitlab-org/gitlab` — and until it finishes the Map shows progress instead of a Map. Issue cards still open, because a card reads its Issue live. An interrupted first read resumes from its last page.
- **A refresher runs outside the conversation**, as a detached process with one lock per Snapshot, so concurrent sessions share one refresh.
- **A Snapshot nobody draws expires.** Besides a refused login, a month untouched deletes a Snapshot, and any read towards one, unless a refresher keeps it warm, so Projects visited once don't keep their titles forever.

_Amended by ADR 0010: a local Picture is kept and deleted with its Snapshot, and an Artifact sends titles off the machine only on the user's yes to each publish._
