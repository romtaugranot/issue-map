# PROTOTYPE — the Map of a Project with thousands of open Issues

Throwaway code for the wayfinder ticket "Prototype: the Map of a Project with thousands of open
Issues" (#22). Not the plugin. Nothing here is meant to be kept.

It builds on [`prototype/map-look`](../map/README.md) (#9), which settled what the Map looks like on
Projects of a few hundred Issues. This one asks what happens at 10,000 and 50,000.

Test data are snapshots taken 2026-09-22:

| Snapshot | Open Issues | On the Map | Unlinked | Groups | Full read |
|---|---|---|---|---|---|
| `rust-lang/rust` (github.com) | 11,219 | 473 | 10,746 | 63 | 113 requests, 5.4 min, 7.4 MB |
| `gitlab-org/gitlab` (gitlab.com) | 48,243 | see below | | | 483 requests, ~37 min |

| File | What it does |
|---|---|
| `fetch_github.py` | Snapshot a GitHub Project (100 an page), rewriting the file every page so a partial Snapshot can be drawn |
| `fetch_gitlab.py` + `gl_query.graphql` | The same for a GitLab Project, anonymous GraphQL, one request per 100 work items |
| `render_large.py` | The text Maps: `overview`, `outline`, `unlinked`, `firstread`, `stats`, each with variants A/B/C |
| `measure_suggest.py` | What `suggest` costs: reads Unlinked Issues' body, comments and Mentions and counts text, tokens and references |
| `search_first.py` | Whether GitHub's advanced search can find every Linked Issue before the full read |

```sh
python3 prototype/large/fetch_github.py rust-lang/rust
python3 prototype/large/render_large.py rust-lang__rust overview --variant A
python3 prototype/large/render_large.py gitlab-org__gitlab outline --variant B --group 1
python3 prototype/large/render_large.py rust-lang__rust firstread --variant C --at 5
python3 prototype/large/measure_suggest.py rust-lang__rust 120
```

`--upto N` draws from the first N Issues read, as a partial Snapshot would. `--links` prints
Markdown links, as Claude would in the conversation.

## What the tests showed (2026-09-22)

- **Scale is lopsided.** On `rust-lang/rust`, 473 of 11,219 open Issues are on the Map and 10,746 are
  Unlinked; the largest Group holds 29. On `gitlab-org/gitlab` a third of the Issues have an epic
  parent, so the Map is large and the Groups are many.
- **Most Groups are headed by an Outside Issue.** Nearly every GitLab Group's head is a group-level
  epic, which the Map draws but does not follow.
- **Blocks Links are rare.** In the 7,000 GitLab work items first read there were 81 Blocks ends
  against 1,777 Parent and 1,802 Related. A "what waits on what" outline is therefore empty on most
  Groups, and 2,203 of 2,273 unblocked Issues had nothing waiting on them, which leaves the Take-next
  order resolving on its last tie-break (oldest first).
- **`suggest` can't sweep a Project.** The newest 120 Unlinked rust Issues held 1.04 M characters of
  body and comments, about 261k tokens, read in 12 requests and 26.7 s. All 10,746 would be about
  1,075 requests, 40 minutes and 23M tokens. One Issue held 64,000 characters of ICE backtrace.
- **Search can't stand in for the first read.** Four `ISSUE_ADVANCED` searches (`is:blocked`,
  `is:blocking`, `has:sub-issue`, `has:parent-issue`) returned 141 Issues in 2.9 s, but the snapshot
  shows 332 with Links: task-list (tracked-by) Links have no search qualifier, so 192 are missed.
- **A first read is minutes.** 5.4 min for `rust-lang/rust`, about 37 min for `gitlab-org/gitlab`. A
  draw's 5-second refresh buys 100 Issues, or one page.
