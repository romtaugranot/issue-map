# The Map draws only recorded Links; a guess becomes a Link only by being written

The Map draws only the Links a Tracker records. It never draws a Link read from Issue text, not even a convention like "Blocked by #12", so a guess never makes an Issue Blocked or takes it off the Unlinked list. The Map's main promise is saying which Issues are unblocked, and a wrong guess about blocking is the worst mistake it can make. Instead, when the user asks, Claude makes Link Suggestions from Issue text. The user confirms each one, and it is written to the Tracker through `gh`/`glab`, where it becomes an ordinary Link. Drawing the Map stays read-only. Writing is optional, and nothing is written without the user's confirmation.

## Considered Options

- **Draw Links parsed from text conventions, marked as guesses**, as `depviz`, `next-issues` and `gh-issue-graph` do. The same text always gives the same result, but a guessed Blocks Link still decides what looks unblocked.
- **Also let Claude read prose** ("needs the auth work first") on every draw. This costs tokens on every draw, can give different answers each time, and can't run in the status line.
- **Stay read-only and write nothing.** The Map stays purely a reader, but a Project with few Links would have no way to improve.

## Consequences

- A Project that records few Links shows a thin Map and a long Unlinked list until Links are written to it. This is the case ADR 0001 already accepted.
- A Link Suggestion is only made for a kind the Tracker can record. On GitLab Free, "Blocked by #12" can't be suggested as a Related Link, so that Project still can't record blocking.
- The plugin can now write to Trackers as well as read them, which goes beyond ADR 0001. A login that can't write still sees the suggestions, and nothing is written.
