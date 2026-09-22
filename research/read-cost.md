# What reading a Project's open Issues and Links costs on each Tracker

Research note for ticket #16: what does it cost to read one Project's open Issues and their Links on each Tracker, how cheaply can the Map read only what changed, and how can Claude Code keep a cached Map fresh without making the status line slow? Terms follow [`CONTEXT.md`](../CONTEXT.md).

Researched 2026-09-22. Sources were read at these snapshots:

- GitHub's docs source at `github/docs` commit `d3500dbf` (2026-09-22). This includes the public GraphQL schemas for github.com and GHES 3.17–3.22. The REST OpenAPI description is at `github/rest-api-description` commit `338cb199` (2026-09-18).
- GitLab source and docs at `master` commit `7b490b32` (`19.5.0-pre`, 2026-09-22). Older behaviour comes from the same files at release tags (`vX.Y.0-ee`), named with each claim.
- Claude Code docs at code.claude.com on 2026-09-22, and the changelog up to 2.1.278 (2026-09-19). One detail the docs leave out comes from the published 2.1.278 build ([LV7]).

Measurements were read-only and used public Projects only:

- On github.com: an authenticated `gh` OAuth login, calling GraphQL and REST ([LV1]–[LV3]).
- On gitlab.com: anonymous GraphQL and REST ([LV4]–[LV6]).

The GitHub runs used under 1,000 GraphQL points. The GitLab runs used about 100 API requests. **Nothing was written to any Tracker.** GHES and self-hosted GitLab weren't measured live, because no public instance of the right versions was at hand ([TI]). Their numbers come from docs, schemas and source.

This note builds on the earlier notes and doesn't repeat them:

- [TL]: where each Tracker records Links.
- [CAP]: version gates and detection.
- [PS]: a plugin can't ship a status line, and what monitors are.
- [TI]: why GHES is covered by schemas and not live.

## Short answer

- **github.com, full read.** The Map's query costs **6 GraphQL points per page of 100 Issues**. That is Links of every kind, labels, assignees, milestone, comment count and open Closing Requests with authors.
  - Measured serially:

    | Project | Open Issues | Requests | Points | Time |
    |---|---|---|---|---|
    | `opentofu/opentofu` | 274 | 3 | 18 | 9 s |
    | `kubernetes/kubernetes` | 1,882 | 19 | 114 | 71 s |
    | `rust-lang/rust` | 11,221 | 113 | 678 | 5.6 min |

  - A user login has 5,000 points an hour. So points are not the bottleneck. **Time is.** Pages take about 3 s each (up to 6.3 s, against a 10 s timeout).
  - GitHub's CPU-time secondary limit allows about 60 s of GraphQL response time a minute ([GH2]). A serial read already sits near that, so running pages in parallel buys little.
- **gitlab.com, full read.** The same query shape fits in **one request per 100 Issues on GitLab 17.1+**. Its complexity is 88 against limits of 200 (anonymous) and 250 (signed in).
  - On `gitlab-org/gitlab` a page took about 5 s (3.1–9.0 s). Its 48,242 open work items would need **483 requests: about 40 minutes and 50 MB**, extrapolated from 20 sampled pages.
  - **Before 16.7**, Links aren't readable through GraphQL unless an off-by-default flag is on. **Before 17.1**, Closing Requests aren't either.
  - On those versions the Map falls back to one REST `links` call per Issue, and one `closed_by` call per Issue whose Closing Requests it shows. For `gitlab-org/gitlab` that would be about 48,700 requests.
- **Incremental reads split the two Trackers.**
  - **On GitLab a Link change bumps `updated_at` on both Issues.** The system note it writes touches each Issue ([GL11]–[GL14]). Live, 67 of 69 new Links matched this. So `updatedAfter`/`updated_after` finds every Issue whose Links changed.
  - **On GitHub it does not.** Neither end's `updatedAt` moves (seen live). So the Map needs a second stream: the repository's issue-events feed, which lists `blocked_by_added`, `sub_issue_added` and the rest, newest first.
  - **On neither Tracker does a new Closing Request bump the Issue.** GitLab's cross-reference notes skip the touch. On GitHub, 38 of 216 Issues had a cross-reference newer than their `updatedAt`. So Closing Requests need a read of recently updated pull or merge requests.
- **Conditional requests help only on GitHub REST.** An authorized `304 Not Modified` there doesn't count against the limit (documented and seen live). GitHub GraphQL returns no ETag. GitLab REST returns ETags, but a 304 **still counts** against the rate limit, and the server still does the full work (seen live).
- **In a normal hour an incremental read is 1–2 requests.** The busiest measured Projects (`kubernetes/kubernetes`, `rust-lang/rust`) had 37–48 Issues change in a day. They logged 1,289–1,838 issue and pull request events, which is 13–19 REST pages. In the last hour, at most 8 Issues changed and about 100 events arrived.
- **The status line can only show a cache.**
  - It re-runs on every new assistant message, debounced by 300 ms.
  - A new trigger **cancels the run in progress**, and a slow script holds the line back ([CC1]).
  - No timeout is documented. The 2.1.278 build runs it through the hook runner, whose default limit is 600 s ([LV7]). In practice the next trigger cancels a run long before that.
  - `refreshInterval` (1 s or more, from 2.1.97) adds a timer ([CC1] [CC6]).
- **Refreshing in the background.** Four places can do it:
  - a detached process that the status line starts when the cache is stale;
  - an `async` `SessionStart` hook, whose timeout isn't enforced;
  - a plugin's stdio MCP server, which lives as long as the session;
  - a plugin monitor, which must print nothing, because every stdout line goes to Claude. Monitors are experimental and work only in the interactive CLI.

  The cache belongs in `${CLAUDE_PLUGIN_DATA}`, with one copy per Project shared by all sessions ([CC2]–[CC5]).

## A. GitHub (github.com, GHEC, GHES)

### How a query is priced

The primary limit is in points. To price a query:

1. Take 1 for the outer connection.
2. For every nested connection that has `first`, add the number of parent nodes it runs under.
3. Divide by 100 and round to the nearest whole number. The minimum is 1 ([GH1]).

For one page of Issues with `k` nested connections, that is `round((1 + page × k) / 100)`:

- The `first` values of the **nested** connections don't change the cost.
- `comments { totalCount }` without `first` isn't counted.
- `rateLimit(dryRun: true)` prices a query without spending points ([GH5], seen live).

Other hard limits ([GH1]):

- `first`/`last` must be between 1 and 100.
- A query may touch at most 500,000 nodes.
- github.com cuts a query off after 10 s, and **deducts extra points** when it does.
- A query that uses too many resources returns partial results with an error.

The Map query used for the measurements reads, for each open Issue:

- number, title, URL and timestamps;
- `labels(first:100)`, `assignees(first:10)`, `comments{totalCount}` and `milestone{title dueOn}`;
- `parent`, `subIssues(first:100)`, `blockedBy(first:50)` and `blocking(first:50)`;
- `closedByPullRequestsReferences(first:100, includeClosedPrs:false){number isDraft state author}`.

Each Link carries the other Issue's `state` and `repository`, so Outside Issues come along. That makes `k = 6`. Adding github.com's tracked-by Links (`trackedIssues`, `trackedInIssues`; [TL]) makes `k = 8`.

**Measured cost per page** ([LV1]; dry-run prices, confirmed by `rateLimit.cost` on the real reads):

| Page size | Points, `k = 6` | Points, `k = 8` | Points per 1,000 Issues (`k = 6`) | Median time per page | Response time per 1,000 Issues |
|---|---|---|---|---|---|
| 100 | 6 | 8 | 60 | 2.8 s | 28 s |
| 50 | 3 | 4 | 60 | 1.7 s | 34 s |
| 25 | 2 | 2 | 80 | — | — |
| **24** | **1** | 2 | **42** | 1.0 s | 43 s |
| 16 | 1 | 1 | 63 | — | — |

Rounding makes the cheapest page the largest one where `1 + page × k` stays below 150: page 24 for `k = 6`, page 18 for `k = 8`. Page 24 uses about 30% fewer points than page 100, but about 50% more response time. At page 100 with every nested maximum, a page may touch up to 41,100 nodes, far under the 500,000 limit.

The supported GHES releases lack `blockedBy`/`blocking` before 3.19. On those, `k = 4`, which is 4 points per page of 100. Every other field the query uses is in GHES 3.17 and later ([GH5], [CAP]).

### Full reads measured on github.com

These ran serially with an authenticated `gh` OAuth login, at page 100 and `k = 6`. There were no errors, no retries, no timeouts and no truncated Link lists ([LV1]).

| Project | Open Issues | Requests | Points | Share of 5,000/h | Time | Median per request (max) | Data | Links found |
|---|---|---|---|---|---|---|---|---|
| `opentofu/opentofu` | 274 | 3 | 18 | 0.4% | 9.4 s | 3.3 s (3.8) | 0.19 MB | 50 Issues with Links (35 with blockers, 6 blocking, 9 with a parent, 4 with sub-issues); 6 Outside Issues |
| `cli/cli` | 1,026 | 11 | 66 | 1.3% | 29.7 s | 2.8 s (3.4) | 0.62 MB | 6 Issues with Links (Parent only) |
| `kubernetes/kubernetes` | 1,882 | 19 | 114 | 2.3% | 70.6 s | 3.8 s (4.6) | 1.33 MB | no Links; 420 Issues with open Closing Requests |
| `rust-lang/rust` | 11,221 | 113 | 678 | 13.6% | 334.9 s | 2.8 s (6.3) | 7.4 MB | 142 Issues with Links (mostly Parent); 13 Outside Issues |

On the same pattern, the largest Projects on github.com would cost these amounts at page 100:

| Project | Open Issues | Requests | Points | Serial time |
|---|---|---|---|---|
| `flutter/flutter` | 12,648 | 127 | 762 | about 6 min |
| `godotengine/godot` | 13,475 | 135 | 810 | about 6.5 min |
| `microsoft/vscode` | 18,589 | 186 | 1,116 | about 9 min |

The login's point counter also moves with any other traffic on the same login. The REST `/rate_limit` endpoint's `graphql` figures didn't match the GraphQL `rateLimit` field during the runs. So the costs above are each response's own `rateLimit.cost`.

### Limits by kind of login

**GraphQL** limits, from [GH1]:

| Login | Points per hour |
|---|---|
| User: a personal access token (classic or fine-grained), the `gh` OAuth login, or any GitHub App or OAuth app acting for a user | **5,000** |
| A GitHub App owned by a GHEC organization, acting for a user | 10,000 |
| An OAuth app owned or approved by a GHEC organization, acting for a member of it | 10,000 |
| GitHub App installation | 5,000, plus 50 for each repository over 20 and 50 for each organization user over 20, up to 12,500. 10,000 on GHEC |
| `GITHUB_TOKEN` in Actions | 1,000 per repository; 15,000 for enterprise resources |

**REST** limits: 5,000 requests an hour for users, 15,000 for the same GHEC-owned apps, and 60 unauthenticated. A higher-limit app's requests also use up the user's 5,000 ([GH3]). An authenticated `gh` OAuth login reported `x-ratelimit-limit: 5000` for both GraphQL and REST ([LV1]).

**Secondary limits** apply on top of these ([GH2]):

- **100 concurrent requests.** This is shared by REST and GraphQL.
- **2,000 GraphQL points a minute** for a single endpoint. A query costs 1 and a mutation 5; this is separate from primary points. REST endpoints allow **900 points a minute**.
- **90 s of CPU time per 60 s**, of which at most **60 s may be GraphQL**. GitHub says to estimate CPU time from total response time.
- 80 content-creating requests a minute and 500 an hour. The Map's reads don't touch this.

By that estimate, a serial read at about 3 s a page already uses about 60 s of GraphQL time a minute. So **reading a large Project in parallel is more likely to hit the secondary limit than to finish sooner**. None of the serial runs hit it.

**GHES**:

- Rate limits are **off by default**. A site administrator can turn on the API limits and the secondary limits separately in the Management Console ([GH1] [GH4]).
- The 10 s timeout section isn't published for GHES ([GH1]).
- Whether `rateLimit` reports anything useful while limits are off wasn't checked (GHES wasn't available; [TI]).

### Reading only what changed

- **By update time.** GraphQL `issues(filterBy: {since: T}, states: [OPEN, CLOSED])` returns Issues updated at or after `T`. The field is in the github.com schema and in every GHES schema from 3.17 ([GH5]). Closed Issues must be included, so that an Issue that left the open set is noticed. The REST list has the same `since` ([GH6]).

  Issues updated in the last hour, day and week, in all states ([LV3]):

  | Project | Hour | Day | Week |
  |---|---|---|---|
  | `opentofu/opentofu` | 1 | 5 | 15 |
  | `cli/cli` | 0 | 13 | 45 |
  | `kubernetes/kubernetes` | 8 | 37 | 113 |
  | `rust-lang/rust` | 2 | 48 | 265 |

  Even a week of changes fits in 1–3 pages.
- **A Link change does not bump `updatedAt`** on either Issue ([LV2]):
  - Four GitHub searches returned 398 recently updated Issues (`is:blocked`, `is:blocking`, `has:sub-issues`, `has:parent-issue`; 100 each, sorted by update). 43 of them had a Link event on their timeline.
  - Most of those Issues changed again after the Link was made, so they can't show either way. **Three Link events were newer than the Issue's own `updatedAt`**. In one of them, the Blocks Link came 26 s after one end's `updatedAt` and 21 minutes after the other's.
  - REST checks on single Issues agreed. A parent had `sub_issue_added` events 13 and 20 days after its `updated_at`. Another parent had one five days after. A child had `parent_issue_added` 11 s after its `updated_at`.
  - All were small public Projects, left unnamed here.

  So **`since` alone misses added and removed Links**, and with them changes to which Issues are Unblocked.
- **A new Closing Request doesn't bump it either.** In the same searches, 38 of the 216 Issues with a cross-reference had one newer than their `updatedAt` ([LV2]). A pull request that says "Fixes #N" shows up on the Issue only as a `cross-referenced` timeline event.
- **The issue-events feed does see Links.**
  - `GET /repos/{owner}/{repo}/issues/events` lists the repository's issue and pull request events, newest first. It takes only `per_page` and `page`; there is no `since` ([GH6]).
  - The OpenAPI description defines `sub_issue_added`/`_removed`, `parent_issue_added`/`_removed`, `blocked_by_added`/`_removed` and `blocking_added`/`_removed`. They appeared live, with `closed`, `reopened` and `connected`.
  - `cross-referenced` is timeline-only and never appears in this feed ([GH7]). So Closing Requests made by keyword are missing; only ones linked by hand (`connected`) appear.
  - Responses carry an ETag and `Cache-Control: private, max-age=60`.

  Volume in one day ([LV3]):

  | Project | Events | Pages of 100 | Events an hour | Link events that day |
  |---|---|---|---|---|
  | `kubernetes/kubernetes` | 1,289 | 13 | 109 | 0 |
  | `rust-lang/rust` | 1,838 | 19 | 95 | 0 |
  | `opentofu/opentofu` | 60 | 1 | — | 0 |

  The feed includes pull request events, such as `merged` and `deployed`, so a Map filters them out.
- **ETags help on REST only.**
  - An authorized conditional request that gets `304` doesn't count against the primary limit ([GH3]). Live, two `304`s on an issues-list page left `x-ratelimit-remaining` unchanged ([LV3]).
  - GraphQL responses carry no ETag, so every GraphQL poll costs at least 1 point.
  - A `304` is likely only with a stable sort and the same parameters ([GH3]). The feed's first page changes with every new event.
- **The REST issues list as a cheap signal.**
  - Each item carries `sub_issues_summary` and `issue_dependencies_summary`, which are counts only ([GH6]). So an unchanged page shows that counts, comments and labels are unchanged too.
  - But it mixes in pull requests (73 Issues among 100 items on one `opentofu/opentofu` page, [LV3]).
  - And a change to one Link that leaves the counts equal is invisible.
- **Outside Issues** are Issues in other repositories, so they aren't in the Project's `since` results or its feed. They can be re-read by node ID. `nodes(ids: [...])` takes up to 100 IDs and has no connection, so it costs 1 point ([LV1]).

## B. GitLab (gitlab.com, Dedicated, self-hosted)

### How a query is priced

GitLab rates a query by **complexity**, not points ([GL1]–[GL4]):

- Each field adds 1.
- A connection backed by a resolver adds its own complexity. For example `sort` adds 1 and `search` adds 5. That total is then multiplied by `1 + min(first, 100) × 0.01`.
- `queryComplexity { score limit }` returns the score of the query it appears in.

The caps:

- **Complexity: 200 anonymous, 250 signed in, 300 for administrators.**
- Depth: 15 anonymous, 20 signed in.
- Page size: 100.
- Query text: 10,000 characters.
- Timeout: 30 s (`graphql_timeout`).

Complexity is a per-query cap, not a budget. **Every request counts as one API request** against the rate limits below.

The Map query ran on `project(fullPath:).workItems(state: opened, sort: CREATED_ASC)` and read these widgets:

- assignees, labels and milestone with due date;
- hierarchy: parent and children;
- linked items: `linkType` and the other Issue;
- development: `closingMergeRequests` with `iid state draft author`.

It also read `userDiscussionsCount`. Each linked Issue carries `state` and `namespace.fullPath`, so Outside Issues come along. The query is 852 characters.

Its complexity, anonymous on gitlab.com ([LV4]):

| Page size | 10 | 25 | 50 | 100 |
|---|---|---|---|---|
| Complexity | 50 | 56 | 67 | **88** |

So page 100 fits even anonymously.

### Full read measured on `gitlab-org/gitlab`

`gitlab-org/gitlab` has 48,242 open work items, 1,009 of them tasks. 20 pages of 100 were sampled: the 10 oldest and the 10 newest ([LV4]).

| | Oldest 1,000 | Newest 1,000 | All 20 pages |
|---|---|---|---|
| Time per request | median 5.2 s (4.3–7.5) | median 3.9 s (3.1–9.0) | **mean 5.0 s, median 4.6 s** |
| Size per page | 105 KB | 101 KB | about 103 KB |
| Items with at least one Link | 335 | 586 | |
| Blocks / Related Link ends | 20 / 580 | 144 / 164 | |
| Items with a parent | 212 | 517 (61 tasks among the 1,000) | |
| Link ends in another Project | 190 | 13 | |
| Items with open Closing Requests | 63 | 118 | |

**Extrapolated to the whole Project: 483 requests, about 40 minutes serially, and about 50 MB.**

Nothing was measured on smaller GitLab Projects. A Project with a few hundred open Issues needs a few requests, but whether pages there are faster than 5 s is untested.

### What a full read costs on each GitLab version

| GitLab | Links | Closing Requests | Requests for `N` open Issues |
|---|---|---|---|
| **17.1 and later** (gitlab.com, Dedicated, current self-hosted) | `linkedItems` and hierarchy widgets | `WorkItemWidgetDevelopment.closingMergeRequests`, added in 17.1 ([GL18]) | `⌈N/100⌉` |
| **16.7–17.0** | Same. `linkedItems` is on by default from 16.7 ([GL17]) | Not in the list query. One REST `closed_by` per Issue that needs it ([GL9]). `Issue.relatedMergeRequests` resolves for only one Issue per request ([GL10]) | `⌈N/100⌉` + one `closed_by` per Issue card shown |
| **16.0–16.6** | `linkedItems` returns null unless the `linked_work_items` flag is on. The flag appeared in 16.3 and was off by default through 16.6 ([GL17] [GL21]). Hierarchy (parent and tasks) works ([TL]). Related and Blocks Links need REST `GET /projects/:id/issues/:iid/links`, one call per Issue ([TL]) | As above | `⌈N/100⌉` + **`N`** + `closed_by` calls |

The REST path is expensive:

- **`links` rejects anonymous calls**, even on public Projects (`before { authenticate! }`; [GL20], [TL]). So its time per call couldn't be measured anonymously.
- `closed_by` took 0.3 s anonymously, and an offset page of the REST Issues list took about 1 s ([LV5]).
- For `gitlab-org/gitlab`, the path would be 483 list pages plus 48,242 `links` calls: **48,725 requests**. That is about 24 minutes of gitlab.com's current 2,000-a-minute user limit, or about 10 hours under the proposed Free limit.
- The `links` part matters only on self-hosted 16.0–16.6. There, rate limits are off unless an administrator turned them on.

REST pagination ([GL7] [GL8]):

- `per_page` is at most 100.
- The project Issues list supports keyset pagination from 18.3.
- **Above 10,000 results, `x-total`, `x-total-pages` and `rel="last"` are left out.** This was seen live on `gitlab-org/gitlab` ([LV5]).
- Offset pagination stops at offset 50,000 by default. The limit applies only to endpoints that also support keyset pagination, and self-hosted administrators can change it.

### Rate limits

| Where | Signed in | Anonymous |
|---|---|---|
| **gitlab.com today** | **2,000 API requests a minute per user** | 500 requests a minute per IP |
| **gitlab.com, proposed and not yet in force** | Free 5,000 an hour (burst 100 a minute); Premium 15,000 (1,250 a minute); Ultimate 25,000 (2,000 a minute) | **60 an hour** per IP |
| **Self-hosted** | **Off by default.** When turned on, the default is 7,200 per user per hour | Off by default; 3,600 per IP per hour when turned on |
| **Dedicated** | The instance's own limits, set by its operator ([GL5]) | Same |

Sources: [GL5] and [GL6].

GraphQL requests count as API requests: a `/api/graphql` response carried `ratelimit-name: throttle_unauthenticated_api` with a falling `ratelimit-remaining` ([LV4]).

GitLab says the proposed limits will be announced with dates and preceded by short brownouts. It says the plan's limit applies "per user" ([GL5]). Under the proposed anonymous limit, **an anonymous full read of a large Project won't be possible**: `gitlab-org/gitlab` alone needs 483 requests. The Map should read signed in, which [TL] already recommends for `links`.

### Reading only what changed

- **By update time:**
  - REST `GET /projects/:id/issues?updated_after=T` ([GL9]).
  - GraphQL `Project.workItems(updatedAfter: T)`, from **17.9** ([GL19]). Before 17.9, `sort: UPDATED_DESC` can be read until items are older than `T` ([GL10]).
  - The older `Project.issues(updatedAfter:)` field also exists, but lacks the work-item widgets.
  - As on GitHub, closed items must be included, so that closures are noticed.
- **A Link change bumps `updated_at` on both Issues.** The code path:
  - `IssuableLinks::CreateService#create_notes` writes a `relate_issuable` system note on the source and on the target ([GL11]).
  - Blocks Links use the EE `block_issuable`/`blocked_by_issuable` notes ([GL15]).
  - Parent changes write a `hierarchy_changed` note on both parent and child ([GL14]).
  - `SystemNotes::BaseService#create_note` defaults to `skip_touch_noteable: false` ([GL12]). `Note` has `after_save :touch_noteable` ([GL13]).
  - Links made through the work-item GraphQL mutation write their notes asynchronously, in `Issuable::RelatedLinksCreateWorker` ([GL16]).

  Live on `gitlab-org/gitlab` ([LV6]):
  - Of 69 Links created in the last 7 days, **67 had both ends' `updatedAt` at or after `linkCreatedAt`**. For 31 of them, the other end's `updatedAt` was 0–10 s after the Link was made.
  - The two exceptions both involve Issue #561564: its Links with #630337 and #630350. There, one end's `updatedAt` was 13 s and 52 s older than the Link. The cause wasn't found.
- **Closing Requests don't bump it.** A merge request that mentions an Issue leaves a `cross_reference` note, which is created with `skip_touch_noteable: true` ([GL14]). New Closing Requests therefore need `Project.mergeRequests(updatedAfter: T)` ([GL10]), which wasn't measured.
- **ETags don't save anything on GitLab** ([LV5]). REST list responses carry a weak ETag, and a matching `If-None-Match` returns `304`. But `ratelimit-observed` still went up by one, and `x-runtime` showed the same server time as a full response. GraphQL `POST`s carry no ETag.
- **Outside Issues** can be re-read with `Query.workItemsByReference(refs: [...])`, which is an Experiment from 16.7 ([GL10]).

## C. Claude Code: when the status line runs, and how a cache can be kept fresh

### Status line cadence and timeout

The status line script runs once when a session starts or is resumed ([CC1]). After that it runs again when:

- an assistant message arrives;
- `/compact` finishes;
- the permission mode changes;
- Vim mode toggles;
- the `command` changes;
- a `refreshInterval` timer elapses;
- a rate-limit window or a warm prompt cache in the last input reaches its reset or expiry time.

How runs behave ([CC1]):

- Updates are **debounced by 300 ms**.
- **If a new update triggers while the script is running, the running script is cancelled.** Slow scripts hold the status line back until they finish.
- The events can go quiet while the session is idle. `refreshInterval` re-runs the command every N seconds, with a minimum of 1. It was added in 2.1.97 on 2026-04-08 ([CC6]).
- The docs name no timeout. In the published 2.1.278 build, the status line command runs through the same runner as command hooks. It is logged as timed out when it has run for at least 600,000 ms, which is the hooks' default of 600 s ([LV7] [CC2]).

In an active session, cancellation comes first. **Even the smallest measured full read (9 s for `opentofu/opentofu`) would be cancelled by the next assistant message.** So the status line script can only show a snapshot on disk, and perhaps start a refresh.

### Places a refresh can run

| Mechanism | How long it lives | When it starts | Constraints | Sources |
|---|---|---|---|---|
| **Detached process started by the status line** when the snapshot is stale | As long as it needs | On any status-line trigger, including `refreshInterval` while idle | Must fully detach, or the next trigger cancels it. Needs a lock so that concurrent sessions don't all refresh. The status line isn't a plugin component ([PS]), so the setup command must write the cache path out in full | [CC1] |
| **`SessionStart` hook with `async: true`** | No timeout is enforced on async command hooks | Session start, resume and `/clear` | Without `async`, Claude's first response waits for every SessionStart hook. With it, output reaches Claude on the next turn, so a refresher should print nothing. In `-p` mode it is killed at teardown unless it detaches | [CC2] |
| **Plugin stdio MCP server** | The session | At startup, for enabled plugins. In cloud sessions, on the first tool call | If it dies, stdio servers aren't reconnected automatically. A plugin update needs `/reload-plugins` | [CC4] [CC3] |
| **Plugin monitor** (experimental) | The session. Disabling the plugin doesn't stop it | Session start (`when: "always"`) or the first use of a named skill | **Every stdout line becomes a notification to Claude**, so a refresher must stay silent. Interactive CLI only. Not available on Bedrock, Google's Agent Platform or Foundry, or when `DISABLE_TELEMETRY` or `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` is set. A plugin update needs a session restart | [CC3] [CC5] |

**Where to keep the cache.** `${CLAUDE_PLUGIN_DATA}` resolves to `~/.claude/plugins/data/{id}/`. It survives plugin updates and is deleted when the plugin is uninstalled from its last scope, unless `--keep-data` is used ([CC3]). Hook, monitor and MCP commands get the path substituted. Every session on the machine sees the same directory, so a snapshot per Project with a lock file serves them all.

## What this means for the Map (input, not decisions)

- **Two costs: a full read, and a refresh.**
  - A full read is a few seconds for a typical Project, minutes for the largest on github.com, and tens of minutes for `gitlab-org/gitlab`-sized Projects on GitLab. It should run rarely and in the background, and survive between sessions.
  - A refresh is 1–3 requests on either Tracker in a normal hour, so it can run every minute or two.
  - The first Map of a large Project will be partial while the full read runs.
- **GitHub refresh:**
  - GraphQL `issues(filterBy:{since})`: 1 point per 24 Issues, or 6 per 100.
  - The REST issue-events feed for Link changes: free when it returns `304`.
  - `nodes(ids:)` for Outside Issues: 1 point.
  - Recently updated open pull requests for Closing Requests.

  Without the feed, the Map would miss Links added or removed on Issues that didn't otherwise change.
- **GitLab refresh:**
  - `workItems(updatedAfter:)`, or `UPDATED_DESC` before 17.9. It catches Link changes, because both ends are touched.
  - `mergeRequests(updatedAfter:)` for Closing Requests.
  - `workItemsByReference` for Outside Issues.

  ETags don't lower GitLab's cost, so poll less often rather than conditionally.
- **Page size on GitHub is a trade-off.**
  - Page 100 uses the least time.
  - Page 24 uses 30% fewer points.
  - Page 50 keeps each request further from the 10 s timeout (the largest page took 6.3 s).

  Points are rarely the constraint: `rust-lang/rust` uses 14% of an hour's budget. Serial pacing is what matters, because of the CPU-time secondary limit.
- **On GitLab 16.0–17.0, reading Links or Closing Requests means one REST call per Issue.** The version gate from [CAP] should pick the query. On those versions, Closing Requests might be fetched only for the Issue cards the Map actually shows.
- **The status line shows the snapshot and its age.** Refreshing belongs to a detached process, an async hook, an MCP server or a monitor. The monitor is the most limited of these: it is experimental, runs only in the interactive CLI, and is missing on some providers.

## Open questions

- **Status line timeout.** The 600 s figure comes from the build, not the docs, and could change without notice. Whether the status line kills or abandons a detached child when it cancels a run wasn't tested.
- **GHES.**
  - What does `rateLimit` return while limits are off?
  - Does GHES time out long queries, and does a timeout cost points?

  No GHES was available ([TI]).
- **GHEC's 10,000-point tier for `gh`.** It covers OAuth apps "owned or approved by" a GHEC organization when the user is a member ([GH1]). Whether the `gh` OAuth app counts, once an organization approves it, wasn't checked.
- **The GitLab exceptions.** Why two recent Links around `gitlab-org/gitlab` #561564 left one end's `updatedAt` behind is unknown. An earlier look found a label event on #630337 that was newer than its `updatedAt` too, which suggests something other than Link handling.
- **GitLab `links` wall time.** It needs a signed-in call, so it wasn't timed.
- **Proposed gitlab.com limits.** "Your plan" is per user, but a user can belong to groups on several plans. Which plan applies wasn't found.
- **Closing Requests incrementally.** Reading recently updated open pull or merge requests was not measured on either Tracker. Nor was whether editing a pull request's body to add "Fixes #N" bumps the pull request's own `updatedAt`.
- **Other GitLab Projects.** Timing was measured only on `gitlab-org/gitlab`, one of gitlab.com's largest Projects. Smaller Projects may answer faster.
- **`userDiscussionsCount`.** The version that added it to work items wasn't checked, so the Map's comment count may need a fallback on older GitLab.
- **The GitHub events feed.** How far back it can be paged wasn't checked. This matters for a Map that hasn't refreshed for days.

## Sources

Earlier notes:

- **TL** — How Trackers record Links between Issues — <https://github.com/romtaugranot/issue-map/blob/research/tracker-links/research/tracker-links.md>
- **CAP** — What the Map can detect and write — <https://github.com/romtaugranot/issue-map/blob/research/capabilities/research/capabilities.md>
- **PS** — What a Claude Code plugin can show the user — <https://github.com/romtaugranot/issue-map/blob/research/plugin-surfaces/research/plugin-surfaces.md>
- **TI** — Where the build gets a test Tracker — <https://github.com/romtaugranot/issue-map/blob/research/test-instances/research/test-instances.md>

Live checks, read-only, 2026-09-22:

- **LV1** — github.com GraphQL with an authenticated `gh` OAuth login:
  - Full serial reads of `opentofu/opentofu`, `cli/cli`, `kubernetes/kubernetes` and `rust-lang/rust` with the Map query at page 100, recording `rateLimit { cost nodeCount remaining }`, time and bytes for each page.
  - Samples of `rust-lang/rust` at page 50 (4 pages) and page 24 (8 pages).
  - `rateLimit(dryRun: true)` prices for pages 16–100 with `k = 6` and `k = 8`.
  - `nodes(ids:)` with 100 IDs (cost 1) and with 101 (`ARGUMENT_LIMIT`: "You may not provide more than 100 node ids").
  - Open Issue totals of `flutter/flutter`, `godotengine/godot` and `microsoft/vscode`.
  - Response headers (`x-ratelimit-limit: 5000`).
- **LV2** — github.com: `search(type: ISSUE)` for `is:issue is:blocked`, `is:blocking`, `has:sub-issues` and `has:parent-issue`, 100 each, sorted by update. For each Issue, `updatedAt` was compared with its latest Link event, latest cross-reference and latest timeline item. REST `GET /repos/{o}/{r}/issues/{n}` and `/timeline` were then read for single Issues on small public Projects, not named here.
- **LV3** — github.com:
  - `issues(filterBy:{since})` counts for 1 hour, 1 day and 7 days on the four Projects in LV1.
  - REST `GET /repos/{o}/{r}/issues/events`, paged back one day on `kubernetes/kubernetes`, `rust-lang/rust` and `opentofu/opentofu`, with its headers.
  - Two conditional `GET`s of a REST issues-list page with `If-None-Match`, which returned `304` and left `x-ratelimit-remaining` unchanged.
  - REST list item fields.
- **LV4** — gitlab.com, anonymous GraphQL on `gitlab-org/gitlab`:
  - Open work-item and task counts.
  - `queryComplexity` of the Map query at pages 10–100.
  - 10 pages of 100 in `CREATED_ASC` and 10 in `CREATED_DESC` order, recording time, bytes, Links and Closing Requests.
  - `ratelimit-*` response headers.
- **LV5** — gitlab.com, anonymous REST on `gitlab-org/gitlab`:
  - Issues list pages, offset and keyset, with their pagination headers.
  - `…/issues/:iid/links` (401), `…/closed_by` and `…/related_merge_requests`.
  - A conditional `GET` with `If-None-Match`, which returned `304` while `ratelimit-observed` still went up and `x-runtime` stayed the same.
- **LV6** — gitlab.com, anonymous GraphQL: the 500 most recently updated work items in `gitlab-org/gitlab` (`sort: UPDATED_DESC`), with every Link's `linkCreatedAt` and both ends' `updatedAt`. 69 Links were less than 7 days old.
- **LV7** — Claude Code 2.1.278 as published: a string search of the shipped bundle for the status line runner. The runner cancels the previous run through an `AbortController`, waits 300 ms, and runs the command through the hook command runner. It logs `timeout` when elapsed time reaches the constant that also holds the 600,000 ms hook default.

[TL]: https://github.com/romtaugranot/issue-map/blob/research/tracker-links/research/tracker-links.md
[CAP]: https://github.com/romtaugranot/issue-map/blob/research/capabilities/research/capabilities.md
[PS]: https://github.com/romtaugranot/issue-map/blob/research/plugin-surfaces/research/plugin-surfaces.md
[TI]: https://github.com/romtaugranot/issue-map/blob/research/test-instances/research/test-instances.md
[LV1]: #sources
[LV2]: #sources
[LV3]: #sources
[LV4]: #sources
[LV5]: #sources
[LV6]: #sources
[LV7]: #sources

GitHub:

- **GH1** — Rate limits and query limits for the GraphQL API (points, node limit, timeouts, GHES) — <https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api> ([source at `d3500dbf`](https://github.com/github/docs/blob/d3500dbf90d355a6552b4588bea0c7ea47735f0d/content/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api.md))
- **GH2** — Secondary rate limits, shared by REST and GraphQL — <https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api#about-secondary-rate-limits>
- **GH3** — Rate limits for the REST API, and best practices (conditional requests) — <https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api>, <https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#use-conditional-requests>
- **GH4** — Configuring rate limits on GHES — <https://docs.github.com/en/enterprise-server@latest/admin/configuring-settings/configuring-user-applications-for-your-enterprise/configuring-rate-limits>
- **GH5** — Public GraphQL schemas for github.com and GHES 3.17–3.22 (`IssueFilters.since`, `blockedBy` from 3.19, `RateLimit`, `dryRun`) — <https://github.com/github/docs/tree/d3500dbf90d355a6552b4588bea0c7ea47735f0d/src/graphql/data>
- **GH6** — REST OpenAPI description (`/repos/{owner}/{repo}/issues` with `since`, `/repos/{owner}/{repo}/issues/events`, the `*-issue-event` schemas, `sub_issues_summary`, `issue_dependencies_summary`) — <https://github.com/github/rest-api-description/tree/338cb199baa4f326790b0b1c246d8d4f481a82a0>
- **GH7** — Issue event types (`cross-referenced` is timeline-only; `connected` is in both) — <https://docs.github.com/en/rest/using-the-rest-api/issue-event-types>

[GH1]: https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api
[GH2]: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api#about-secondary-rate-limits
[GH3]: https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#use-conditional-requests
[GH4]: https://docs.github.com/en/enterprise-server@latest/admin/configuring-settings/configuring-user-applications-for-your-enterprise/configuring-rate-limits
[GH5]: https://github.com/github/docs/tree/d3500dbf90d355a6552b4588bea0c7ea47735f0d/src/graphql/data
[GH6]: https://github.com/github/rest-api-description/tree/338cb199baa4f326790b0b1c246d8d4f481a82a0
[GH7]: https://docs.github.com/en/rest/using-the-rest-api/issue-event-types

GitLab (source at `7b490b32` unless a tag is named):

- **GL1** — GraphQL API limits (page size, complexity, query size, 30 s timeout) — <https://docs.gitlab.com/api/graphql/#limits>
- **GL2** — `GitlabSchema`: complexity caps 200/250/300, depth 15/20, `default_max_page_size 100` — <https://gitlab.com/gitlab-org/gitlab/-/blob/7b490b32cd60af36c475d6dca408f52149cbbbf9/app/graphql/gitlab_schema.rb>
- **GL3** — `BaseField#field_resolver_complexity` and `connection_complexity_multiplier` — <https://gitlab.com/gitlab-org/gitlab/-/blob/7b490b32cd60af36c475d6dca408f52149cbbbf9/app/graphql/types/base_field.rb>
- **GL4** — `BaseResolver.resolver_complexity` and `complexity_multiplier` (0.01) — <https://gitlab.com/gitlab-org/gitlab/-/blob/7b490b32cd60af36c475d6dca408f52149cbbbf9/app/graphql/resolvers/base_resolver.rb>; `MAX_QUERY_SIZE` in <https://gitlab.com/gitlab-org/gitlab/-/blob/7b490b32cd60af36c475d6dca408f52149cbbbf9/app/controllers/graphql_controller.rb>; `graphql_timeout` in <https://gitlab.com/gitlab-org/gitlab/-/blob/7b490b32cd60af36c475d6dca408f52149cbbbf9/config/initializers/1_settings.rb>
- **GL5** — GitLab.com rate limits: current, and proposed by plan — <https://docs.gitlab.com/user/gitlab_com/rate_limits/>
- **GL6** — User and IP rate limits on self-hosted GitLab (off by default; 7,200 and 3,600 per hour) — <https://docs.gitlab.com/administration/settings/user_and_ip_rate_limits/>
- **GL7** — REST API pagination (keyset for project Issues from 18.3; headers left out above 10,000) — <https://docs.gitlab.com/api/rest/#pagination>
- **GL8** — Instance limits: max offset for offset pagination, default 50,000 — <https://docs.gitlab.com/administration/instance_limits/#max-offset-allowed-by-the-rest-api-for-offset-based-pagination>
- **GL9** — Issues API (`updated_after`, `closed_by`, `related_merge_requests`) — <https://docs.gitlab.com/api/issues/>
- **GL10** — GraphQL reference (`Project.workItems` arguments, `WorkItemSort`, `LinkedWorkItemType.linkCreatedAt`, `closingMergeRequests`, `Project.mergeRequests(updatedAfter:)`, `Query.workItemsByReference`) — <https://docs.gitlab.com/api/graphql/reference/>
- **GL11** — `IssuableLinks::CreateService#create_notes`, which writes a note on both ends — <https://gitlab.com/gitlab-org/gitlab/-/blob/7b490b32cd60af36c475d6dca408f52149cbbbf9/app/services/issuable_links/create_service.rb>
- **GL12** — `SystemNotes::BaseService#create_note(…, skip_touch_noteable: false)` — <https://gitlab.com/gitlab-org/gitlab/-/blob/7b490b32cd60af36c475d6dca408f52149cbbbf9/app/services/system_notes/base_service.rb>
- **GL13** — `Note`: `after_save :touch_noteable` — <https://gitlab.com/gitlab-org/gitlab/-/blob/7b490b32cd60af36c475d6dca408f52149cbbbf9/app/models/note.rb>
- **GL14** — `SystemNotes::IssuablesService`: `relate_issuable`, `hierarchy_changed` (parent and child), and `cross_reference` with `skip_touch_noteable: true` — <https://gitlab.com/gitlab-org/gitlab/-/blob/7b490b32cd60af36c475d6dca408f52149cbbbf9/app/services/system_notes/issuables_service.rb>
- **GL15** — EE `block_issuable` and `blocked_by_issuable` notes — <https://gitlab.com/gitlab-org/gitlab/-/blob/7b490b32cd60af36c475d6dca408f52149cbbbf9/ee/app/services/ee/system_notes/issuables_service.rb>
- **GL16** — Work-item Links: notes written asynchronously — <https://gitlab.com/gitlab-org/gitlab/-/blob/7b490b32cd60af36c475d6dca408f52149cbbbf9/app/services/work_items/related_work_item_links/create_service.rb>, <https://gitlab.com/gitlab-org/gitlab/-/blob/7b490b32cd60af36c475d6dca408f52149cbbbf9/app/workers/issuable/related_links_create_worker.rb>
- **GL17** — `linked_work_items` flag: `default_enabled: false` at 16.6 and `true` at 16.7, milestone 16.3 — <https://gitlab.com/gitlab-org/gitlab/-/blob/v16.6.0-ee/config/feature_flags/development/linked_work_items.yml>, <https://gitlab.com/gitlab-org/gitlab/-/blob/v16.7.0-ee/config/feature_flags/development/linked_work_items.yml>
- **GL18** — Development widget: no `closing_merge_requests` at 17.0, present at 17.1 — <https://gitlab.com/gitlab-org/gitlab/-/blob/v17.0.0-ee/app/graphql/types/work_items/widgets/development_type.rb>, <https://gitlab.com/gitlab-org/gitlab/-/blob/v17.1.0-ee/app/graphql/types/work_items/widgets/development_type.rb>
- **GL19** — Work-item filter arguments: no `updated_after` at 17.8, present at 17.9 — <https://gitlab.com/gitlab-org/gitlab/-/blob/v17.8.0-ee/app/graphql/resolvers/concerns/work_items/shared_filter_arguments.rb>, <https://gitlab.com/gitlab-org/gitlab/-/blob/v17.9.0-ee/app/graphql/resolvers/concerns/work_items/shared_filter_arguments.rb>
- **GL20** — REST `issue_links`: `before { authenticate! }` — <https://gitlab.com/gitlab-org/gitlab/-/blob/7b490b32cd60af36c475d6dca408f52149cbbbf9/lib/api/issue_links.rb>
- **GL21** — `linkedItems` "null if `linked_work_items` feature flag is disabled" at 16.6 — <https://gitlab.com/gitlab-org/gitlab/-/blob/v16.6.0-ee/app/graphql/types/work_items/widgets/linked_items_type.rb>

[GL1]: https://docs.gitlab.com/api/graphql/#limits
[GL2]: https://gitlab.com/gitlab-org/gitlab/-/blob/7b490b32cd60af36c475d6dca408f52149cbbbf9/app/graphql/gitlab_schema.rb
[GL3]: https://gitlab.com/gitlab-org/gitlab/-/blob/7b490b32cd60af36c475d6dca408f52149cbbbf9/app/graphql/types/base_field.rb
[GL4]: https://gitlab.com/gitlab-org/gitlab/-/blob/7b490b32cd60af36c475d6dca408f52149cbbbf9/app/graphql/resolvers/base_resolver.rb
[GL5]: https://docs.gitlab.com/user/gitlab_com/rate_limits/
[GL6]: https://docs.gitlab.com/administration/settings/user_and_ip_rate_limits/
[GL7]: https://docs.gitlab.com/api/rest/#pagination
[GL8]: https://docs.gitlab.com/administration/instance_limits/#max-offset-allowed-by-the-rest-api-for-offset-based-pagination
[GL9]: https://docs.gitlab.com/api/issues/
[GL10]: https://docs.gitlab.com/api/graphql/reference/
[GL11]: https://gitlab.com/gitlab-org/gitlab/-/blob/7b490b32cd60af36c475d6dca408f52149cbbbf9/app/services/issuable_links/create_service.rb
[GL12]: https://gitlab.com/gitlab-org/gitlab/-/blob/7b490b32cd60af36c475d6dca408f52149cbbbf9/app/services/system_notes/base_service.rb
[GL13]: https://gitlab.com/gitlab-org/gitlab/-/blob/7b490b32cd60af36c475d6dca408f52149cbbbf9/app/models/note.rb
[GL14]: https://gitlab.com/gitlab-org/gitlab/-/blob/7b490b32cd60af36c475d6dca408f52149cbbbf9/app/services/system_notes/issuables_service.rb
[GL15]: https://gitlab.com/gitlab-org/gitlab/-/blob/7b490b32cd60af36c475d6dca408f52149cbbbf9/ee/app/services/ee/system_notes/issuables_service.rb
[GL16]: https://gitlab.com/gitlab-org/gitlab/-/blob/7b490b32cd60af36c475d6dca408f52149cbbbf9/app/workers/issuable/related_links_create_worker.rb
[GL17]: https://gitlab.com/gitlab-org/gitlab/-/blob/v16.7.0-ee/config/feature_flags/development/linked_work_items.yml
[GL18]: https://gitlab.com/gitlab-org/gitlab/-/blob/v17.1.0-ee/app/graphql/types/work_items/widgets/development_type.rb
[GL19]: https://gitlab.com/gitlab-org/gitlab/-/blob/v17.9.0-ee/app/graphql/resolvers/concerns/work_items/shared_filter_arguments.rb
[GL20]: https://gitlab.com/gitlab-org/gitlab/-/blob/7b490b32cd60af36c475d6dca408f52149cbbbf9/lib/api/issue_links.rb
[GL21]: https://gitlab.com/gitlab-org/gitlab/-/blob/v16.6.0-ee/app/graphql/types/work_items/widgets/linked_items_type.rb

Claude Code:

- **CC1** — Customize your status line (triggers, 300 ms debounce, cancellation, `refreshInterval`) — <https://code.claude.com/docs/en/statusline#how-status-lines-work>
- **CC2** — Hooks reference (`timeout` defaults; `async: true`; SessionStart runs in the background) — <https://code.claude.com/docs/en/hooks#run-hooks-in-the-background>
- **CC3** — Plugins reference (monitors, `${CLAUDE_PLUGIN_DATA}`, plugin MCP servers) — <https://code.claude.com/docs/en/plugins-reference#monitors>
- **CC4** — MCP (plugin servers start at session startup; stdio servers aren't reconnected; cloud sessions start them on demand) — <https://code.claude.com/docs/en/mcp#automatic-reconnection>
- **CC5** — Tools reference, Monitor tool (where it is unavailable) — <https://code.claude.com/docs/en/tools-reference#monitor-tool>
- **CC6** — Changelog (2.1.97 added `refreshInterval`, 2026-04-08) — <https://code.claude.com/docs/en/changelog>

[CC1]: https://code.claude.com/docs/en/statusline#how-status-lines-work
[CC2]: https://code.claude.com/docs/en/hooks#run-hooks-in-the-background
[CC3]: https://code.claude.com/docs/en/plugins-reference#monitors
[CC4]: https://code.claude.com/docs/en/mcp#automatic-reconnection
[CC5]: https://code.claude.com/docs/en/tools-reference#monitor-tool
[CC6]: https://code.claude.com/docs/en/changelog
