# How Trackers record Links between Issues

Research note for the question "What kinds of Link between Issues do Trackers record, how is each one read through the API, and where is each available?"

Researched 2026-09-21. Sources were read at these snapshots: GitLab docs and source at `master` commit `47c3bd8b` (GitLab `19.5.0-pre`, so 19.4 is the current release), GitHub docs at commit `27965d16` (2026-09-18), and GitHub's OpenAPI descriptions at commit `338cb199` (2026-09-18). GitHub behaviour was also checked live with read-only calls against public Projects, and gitlab.com with anonymous read-only calls against the public `gitlab-org/gitlab` Project ([LV1], [LV2]).

## Short answer

- **No kind of Link is recorded in a structured way on every Tracker and tier.** The only thing a Map can read everywhere is a **mention**. GitHub records it as a `cross-referenced` timeline event [GH7] [GH8]. GitLab records it as a "mentioned in" system note [GL27] [GL33]. A mention only says that one Issue named another. It carries no meaning such as "blocks" or "part of".
- **GitHub (github.com, every plan)** records two structured Link kinds between Issues:
  - **Parent/child ("sub-issues")**: generally available since 2025-04-09 [GH17].
  - **Blocked by / blocking ("issue dependencies")**: generally available since 2025-08-21 [GH18].

  Both can be read through REST and GraphQL [GH4] [GH5] [GH9]. GitHub also records **duplicate** marks [GH15]. On github.com and GHEC only, it records **tracked-by**, which it derives from Markdown task-list items that reference an Issue; in practice this means items that are just the reference (GraphQL only) [GH12] [LV1]. GitHub has **no general "relates to" Link**.
- **GitHub Enterprise Server** lags behind. Parent/child is readable through GraphQL from the oldest supported release (3.17), but GHES has no REST sub-issue endpoints at all. Blocked-by/blocking arrives in 3.19 [GH20] [GH22].
- **GitLab Free** (on EE or CE builds, any supported version) records two kinds:
  - **`relates_to` Links between Issues**: Free since 13.4. Before that it was a paid feature, starting at 9.4 [GL2] [GL3].
  - **Issue → child task**: Free, on by default since 15.3, and readable **only through GraphQL** [GL18] [GL22].

  **GitLab Free cannot express "blocks" or "is blocked by"**, which needs Premium (from 12.8) [GL1] [GL2]. It also cannot express epics (Premium), multi-level epics or Links between epics (Ultimate), or OKR hierarchies (Ultimate, still behind a feature flag that is off by default) [GL7] [GL10] [GL19].
- **Text conventions** such as "Blocked by #12", "Depends on #12" or "Part of #12" are **not parsed into Links by either Tracker**. They only produce a mention on #12 [GH13] [GH14] [GL27] [GL28]. The only text that becomes a structured Link is covered in [Text conventions](#text-conventions) below:
  - GitHub's `Duplicate of #n` comment [GH15].
  - GitHub's bare task-list item `- [ ] #n`, on github.com and GHEC only [GH12] [LV1].
  - GitLab's quick actions (`/relate`, `/blocks`, `/blocked_by`, `/set_parent`, `/epic`, `/duplicate`), which are commands, not prose [GL31].

## The table: Link kind × Tracker × tier/version × API field

Notes on reading the table:

- "GHES" means GitHub Enterprise Server. The GHES releases still supported, and still documented, are 3.17–3.22 [GH23].
- GitLab versions are the ones in which a capability first shipped. A "flag" is a feature flag. "Experiment" is GitLab's own status label for a GraphQL field [GL22].
- GitLab "CE" means the Community Edition build. "EE, no licence" is the Free tier on the Enterprise Edition build [GL36].

| # | Link kind | Tracker | Where available (tier / version) | REST | GraphQL | Sources |
|---|---|---|---|---|---|---|
| 1 | Parent / child ("sub-issues") | GitHub | github.com (all plans) and GHEC: GA 2025-04-09. GHES: GraphQL fields present from 3.17 (oldest supported), user docs from 3.18; **no REST sub-issue endpoints on any GHES 3.16–3.22**. At most 100 children per parent and 8 levels. Child must share the parent's repository owner | Issue object: `parent_issue_url`, `sub_issues_summary{total,completed,percent_completed}`. Lists: `GET /repos/{o}/{r}/issues/{n}/sub_issues`, `GET …/issues/{n}/parent` | `Issue.parent`, `Issue.subIssues`, `Issue.subIssuesSummary`. Timeline: `SubIssueAddedEvent`, `ParentIssueAddedEvent` (+ `…Removed…`) | [GH1] [GH2] [GH4] [GH6] [GH9] [GH17] [GH20] [GH21] [GH22] [LV1] |
| 2 | Blocked by / blocking ("issue dependencies") | GitHub | github.com (all plans) and GHEC: GA 2025-08-21, at most 50 per direction. GHES: REST and GraphQL from **3.19**; the how-to page is not published for GHES. Crosses repositories and owners [LV1] | Issue object: `issue_dependencies_summary{blocked_by, blocking, total_blocked_by, total_blocking}` (`blocked_by`/`blocking` count **open** Issues only [LV1]). Lists: `GET …/issues/{n}/dependencies/blocked_by`, `GET …/issues/{n}/dependencies/blocking` | `Issue.blockedBy`, `Issue.blocking`, `Issue.issueDependenciesSummary`. Timeline: `BlockedByAddedEvent`, `BlockingAddedEvent` (+ `…Removed…`) | [GH3] [GH5] [GH6] [GH9] [GH18] [GH20] [GH22] [GH25] [LV1] |
| 3 | Tracked by / tracks (a task-list item in the body that is a bare Issue reference) | GitHub | github.com and GHEC only; the fields are absent from every GHES schema. The separate "tasklist blocks" preview was retired 2025-04-30, and the Tracks/Tracked-by fields on GitHub Projects went with it. Plain Markdown tracking still works (seen on an Issue created 2026-09-17) | none | `Issue.trackedIssues`, `Issue.trackedInIssues`, `Issue.trackedIssuesCount` | [GH12] [GH19] [GH22] [LV1] |
| 4 | Duplicate of | GitHub | all; GraphQL `duplicateOf` in GHES from 3.18 | Close with `state_reason: "duplicate"` (+ `duplicate_issue_id` on update). Timeline events `marked_as_duplicate` / `unmarked_as_duplicate` | `Issue.duplicateOf`, `MarkedAsDuplicateEvent{canonical, duplicate}`, `ClosedEvent.duplicateOf` | [GH6] [GH8] [GH9] [GH15] [GH22] |
| 5 | Mention (cross-reference) | GitHub | all | Timeline event `cross-referenced` on the **mentioned** Issue, with `source.issue` | `CrossReferencedEvent{source, target, isCrossRepository, willCloseTarget}` | [GH7] [GH8] [GH9] [GH13] |
| 6 | Closing keyword (pull request or commit → Issue; **not** Issue → Issue) | GitHub | all; only for pull requests that target the default branch | Timeline `connected` / `cross-referenced` | `Issue.closedByPullRequestsReferences`, `ConnectedEvent`, `CrossReferencedEvent.willCloseTarget` | [GH9] [GH14] |
| 7 | GitHub Projects fields (the planning boards, not our Project) | GitHub | github.com / GHEC | — | `ProjectV2FieldType` has `PARENT_ISSUE` and `SUB_ISSUES_PROGRESS` (views of row 1); `TRACKS`/`TRACKED_BY` are still in the enum but retired. No Link store of their own | [GH10] [GH16] [GH19] |
| 8 | Relates to | GitLab | **Free since 13.4**; introduced 9.4 in Starter. Cross-project Links allowed. At most 100 Links per Issue | `GET /projects/:id/issues/:iid/links` → each linked Issue carries `link_type` (`relates_to`/`blocks`/`is_blocked_by`), `issue_link_id`, `link_created_at` | `WorkItemWidgetLinkedItems.linkedItems(filter: RELATED)` → `LinkedWorkItemType.linkType` (16.3, Experiment). `Issue.linkedWorkItems` (17.8, Experiment) | [GL1] [GL2] [GL3] [GL4] [GL22] [GL32] |
| 9 | Blocks / is blocked by (Issue ↔ Issue) | GitLab | **Premium/Ultimate** since 12.8. CE rejects `link_type=blocks` with 400; EE with no licence returns 403 | Same `links` endpoint, `link_type` = `blocks` / `is_blocked_by`. The Issue object carries `blocking_issues_count` | Issue: `blocked` (13.3), `blockedByCount` (13.6), `blockedByIssues` (13.10), `blockingCount` (14.1), all EE-only. Work item: `WorkItemWidgetLinkedItems{blocked, blockedByCount, blockingCount}` and `linkedItems(filter: BLOCKED_BY/BLOCKS)` | [GL1] [GL2] [GL4] [GL22] [GL24] [GL26] [GL32] [GL35] |
| 10 | Epic → child Issue | GitLab | **Premium/Ultimate** (introduced in Ultimate 10.2, moved to Premium in 12.8). An Issue has at most one parent epic. Epics live in groups, not Projects | Issue object: `epic{iid,…}` (`epic_iid` deprecated). `GET /groups/:id/epics/:epic_iid/issues` (Epics REST API deprecated in 17.0, still served, no removal date) | `WorkItemWidgetHierarchy{parent, children}`; epics became work items behind a flag in 17.2, on by default in 17.7, GA in 18.1. Legacy `Issue.epic` (deprecated 17.5); `Epic` type planned for removal | [GL6] [GL7] [GL8] [GL12] [GL13] [GL16] [GL22] [GL26] |
| 11 | Epic → child epic (multi-level) | GitLab | **Ultimate** since 11.7; up to 7 levels | `GET /groups/:id/epics/:epic_iid/epics` (deprecated) | `WorkItemWidgetHierarchy`; legacy `Epic.children` | [GL6] [GL9] [GL14] [GL22] [GL34] |
| 12 | Linked epics (epic ↔ epic, and from 18.1 epic ↔ Issue/task/OKR; relates/blocks) | GitLab | **Ultimate**; epic ↔ epic since 14.9 | Linked epics API (epic ↔ epic only, deprecated) | `linkedItems` on the epic work item; legacy `Epic.blockedByEpics` | [GL10] [GL11] [GL15] [GL22] |
| 13 | Issue → child task | GitLab | **Free**. Added in 14.5 behind a flag, creation in 15.0, on by default in 15.3. Also Incident → task and Ticket → task | **none.** Tasks can be listed with `issue_type=task`, but no parent field exists (the old docs called this a known limitation) | `WorkItemWidgetHierarchy{parent, children, hasParent, hasChildren}` (widget since 15.1; `Query.workItem`/`Project.workItems` 15.1, Experiment) | [GL17] [GL18] [GL22] [GL23] [GL26] [GL34] |
| 14 | Links among tasks / OKRs (relates, blocks) | GitLab | Tasks: Free for `relates_to`; blocking needs Premium. Added in 16.5 behind a flag, GA in 17.0 | none | `linkedItems` | [GL5] [GL17] [GL18] [GL19] |
| 15 | Objective → objective / key result | GitLab | **Ultimate**, 15.6, behind flag `okrs_mvc`, **still off by default and "not ready for production use"** | none | `WorkItemWidgetHierarchy` | [GL19] [GL34] |
| 16 | Duplicate of | GitLab | all tiers (`/duplicate` quick action: closes the Issue **and adds a `relates_to` Link**) | Shows as a `relates_to` Link | `Issue.closedAsDuplicateOf` (15.1) | [GL25] [GL31] |
| 17 | Mention (crosslink) | GitLab | all | Notes API: a system note (`system: true`) whose body reads "mentioned in …". No structured type, so the text must be parsed | `Note.systemNoteMetadata.action` = `cross_reference` | [GL27] [GL33] [GL38] |
| 18 | Closing pattern (commit or merge request → Issue; not Issue → Issue) | GitLab | all; the pattern can be changed by self-hosted admins | `GET /projects/:id/issues/:iid/closed_by` | `Issue.mergeRequestsCount` ("merge requests that close the issue") | [GL26] [GL28] [GL29] |
| 19 | Parent / child | Jira Cloud | all | `fields.parent` (replaced Epic Link / Parent Link; deprecation began 2021-11-30, deadline 2022-11-30) | — | [OT1] [OT3] |
| 20 | Typed Link (admin-defined; default types include Blocks, Duplicate, Relates, Cloners) | Jira Cloud | all; admins can switch linking off | `fields.issuelinks[]{type{name,inward,outward}, inwardIssue \| outwardIssue}`; `/rest/api/3/issueLink`, `/issueLinkType` | — | [OT1] [OT2] |
| 21 | Relation (`blocks`, `duplicate`, `related`, `similar`) + parent/children | Linear | all | — | `Issue.relations` / `inverseRelations` → `IssueRelation{type, issue, relatedIssue}`; `Issue.parent`, `Issue.children` | [OT4] |
| 22 | Depends on / blocks (only kind) | Gitea, Forgejo | Gitea 1.6+ (API 1.20+); Forgejo inherits it. Per-repository switch; cross-repository needs `ALLOW_CROSS_REPOSITORY_DEPENDENCIES` | `GET /repos/{o}/{r}/issues/{index}/dependencies` (blockers), `…/blocks` (blocked) | — | [OT5] [OT6] [OT7] [OT8] |
| 23 | Parent/child, predecessor/successor, related, duplicate, remote … | Azure Boards | Services and Server | `GET …/wit/workitems/{id}?$expand=relations` → `relations[]{rel, url, attributes}`, where `rel` is e.g. `System.LinkTypes.Hierarchy-Forward/-Reverse`, `System.LinkTypes.Dependency-Forward/-Reverse`, `System.LinkTypes.Related`, `System.LinkTypes.Duplicate-Forward/-Reverse` | — | [OT9] [OT10] |

## Detail

### GitHub

**Parent/child (sub-issues).** You can add up to 100 sub-issues per parent and nest them up to eight levels [GH1]. The REST "add sub-issue" operation states that "the sub-issue must belong to the same repository owner as the parent issue" [GH20]. So a parent/child Link can leave the Project, but not the owner. The REST issue object carries a `parent_issue_url` and a `sub_issues_summary`, which gives a Map the parent direction without an extra call [GH6] [GH20]. Listing children takes one `GET …/sub_issues` per parent. In GraphQL, `parent`, `subIssues` and `subIssuesSummary` can be fetched for many Issues in one query [GH9]. Verified live: `cli/cli#12438` lists three sub-issues, and `GET …/issues/13016/parent` returns #12438 [LV1].

**Blocked by / blocking (issue dependencies).** GA on 2025-08-21, with up to 50 Issues per relationship type, and with REST, GraphQL (`addBlockedBy`) and webhooks. Search qualifiers are `is:blocked`, `is:blocking`, `blocked-by:` and `blocking:` [GH18]. The how-to page is versioned for github.com and GHEC only. It says dependencies are "available for users on GitHub Free, Pro, Team, and GitHub Enterprise Cloud plans" [GH3]. The REST endpoints, however, are published for GHES 3.19 and later [GH25] [GH20], and the GHES 3.19+ GraphQL schemas include `blockedBy`, `blocking` and `issueDependenciesSummary` [GH22]. In the issue object, `blocked_by`/`blocking` count only **open** Issues, while `total_blocked_by`/`total_blocking` count all of them. For example, `microsoft/vscode#274013` shows `blocked_by: 1, total_blocked_by: 2`, because one of its two blockers is closed [LV1]. GitHub stores a single Link and shows it from both ends: `…/274013/dependencies/blocked_by` lists #274770, and `…/274770/dependencies/blocking` lists #274013 [LV1]. Dependencies can cross owners: `microsoft/vscode-containers#605` is blocked by `dotnet/vscode-csharp#9748` [LV1].

**Tracked by (Markdown task lists).** On github.com, "any issues referenced in the tasklist will specify that they are tracked in the referencing issue" [GH12]. These Links are exposed only as GraphQL `trackedIssues` / `trackedInIssues` / `trackedIssuesCount` (added to the schema 2022-03-30 [GH11]). The fields are absent from every supported GHES schema [GH22], and REST has no equivalent. The separate "tasklist blocks" private preview was retired on 2025-04-30. At the same time, "the `Tracked` and `Tracked by` fields on projects will no longer be available" [GH19]. Plain Markdown tracking still works. `rust-lang/rust#162911`, created 2026-09-17, has a line `- [ ] #153646`, and GraphQL reports #153646 in its `trackedIssues`. Lines with prose around a reference (for example `… (see … and #162478)`) did not produce a tracked Link [LV1]. That is an observation from one sample, not a documented rule.

**Duplicates.** A comment of the form "Duplicate of #97" creates a "marked as duplicate" timeline event. The commenter needs write access [GH15]. Closing with `state_reason: "duplicate"` (and `duplicate_issue_id`) is available on REST update [GH20]. GraphQL exposes `Issue.duplicateOf` and `MarkedAsDuplicateEvent` [GH9]. `duplicateOf` is in GHES schemas from 3.18 [GH22].

**Mentions and timeline.** A mention creates a `cross-referenced` event. The event is available only from the timeline API, not the issue-events API, and appears on the **mentioned** Issue with the mentioning Issue in `source` [GH8]. To find the Issues that A mentions, you must either parse A's body or read the timelines of the other Issues. The GraphQL enum `IssueTimelineItemsItemType` also has `SUB_ISSUE_ADDED_EVENT`, `PARENT_ISSUE_ADDED_EVENT`, `BLOCKED_BY_ADDED_EVENT`, `BLOCKING_ADDED_EVENT` and their `…REMOVED…` twins [GH10]. The REST timeline returns them as `sub_issue_added`, `blocked_by_added` and so on. These names are in the OpenAPI description [GH20] and in live responses [LV1], but the "issue event types" page does not list them [GH8].

**Closing keywords** (`close(s|d)`, `fix(es|ed)`, `resolve(s|d)`) work only in a pull request description or commit message, and only for the default branch [GH14]. They link a pull request to an Issue, never an Issue to an Issue.

**GitHub Projects (the planning boards).** These are not a separate Link store. They surface the sub-issue hierarchy as the "Parent issue" and "Sub-issue progress" fields [GH16]. `ProjectV2FieldType` still lists `TRACKS`/`TRACKED_BY`, which were retired [GH10] [GH19]. Organisation-level "issue fields" are Text, Number, Date and Single-select only, so none of them holds a Link [GH24].

**Documentation contradiction worth knowing (GHES).** The user docs version sub-issues for GHES ≥ 3.18 [GH21], but the REST sub-issue page is published for github.com and GHEC only [GH4], and no GHES OpenAPI description (3.16–3.22) contains a sub-issue path [GH20]. The "issue dependencies" docs run the other way round: the user docs are github.com/GHEC only [GH3], while REST and GraphQL exist from GHES 3.19 [GH20] [GH22] [GH25]. **On GHES, read parent/child through GraphQL, and blocking through either API from 3.19 on.**

### GitLab

**Linked issues: `relates_to`, `blocks`, `is_blocked_by`.** Linked issues are "a bi-directional relationship between any two issues" and "you can link issues in different projects" [GL1]. The history is as follows:

- Introduced in 9.4, in Starter [GL3].
- "The simple 'relates to' relationship moved to GitLab Free in 13.4" [GL2].
- Blocking was introduced in 12.8 [GL2] and is tier-badged **Premium, Ultimate** today [GL1].

In storage, only two types exist: `relates_to` (0) and `blocks` (1). An `is_blocked_by` request is stored as `blocks` with source and target swapped. The API then presents `is_blocked_by` from the target's side ("we don't store is_blocked_by in the db but need it for displaying the relation from the target") [GL32]. On Free, a `blocks` request fails in one of two ways. The CE REST API accepts only `relates_to` for `link_type` (400 otherwise). EE without the licensed feature returns 403 "Blocked issues not available for current license" [GL32]. There are at most 100 Links per Issue (`MAX_LINKS_COUNT = 100`) [GL32].

Verified live, read-only, on `gitlab-org/gitlab`, which runs on gitlab.com Ultimate. GraphQL shows Issue #630081 with `relates_to`, two `blocks`, two `is_blocked_by`, and a parent epic. Issue #606447 `blocks` an **epic**, so Links can join Issues of different kinds. The REST `links` endpoint returned **401 when called anonymously**, even though the Issue is public, while anonymous GraphQL returned the Links [LV2]. The Map should always call authenticated.

**GraphQL for linked items.** The work-item widget `WorkItemWidgetLinkedItems.linkedItems(filter: RELATED|BLOCKED_BY|BLOCKS)` was introduced in 16.3 as an Experiment. `Issue.linkedWorkItems` arrived in 17.8 [GL22]. So on GitLab older than 16.3, a Map can read `relates_to` only through REST. The legacy Issue fields `blocked`, `blockedByCount`, `blockedByIssues` and `blockingCount` date from 13.3, 13.6, 13.10 and 14.1 respectively [GL24]. They are defined only in EE code [GL35], so they do **not exist in a CE schema** at all.

**Hierarchy (parent/child).** GitLab's built-in types allow these pairs [GL34]:

| Parent | Allowed children |
|---|---|
| Issue, Incident, Ticket | Task (depth 1) |
| Epic | Epic (depth 7), Issue, Ticket |
| Objective | Objective (depth 9), Key result |

An Issue can be the child of at most one epic [GL6]. Epics are Premium. Multi-level epics are Ultimate, since 11.7 [GL7] [GL9]. Tasks are Free [GL17], and their hierarchy is readable only through `WorkItemWidgetHierarchy`, since REST has no parent field [GL18] [GL26]. From 19.0/19.1, Premium can define custom work item types, whose "widgets and hierarchy restrictions match those of issues" [GL21]. The built-in type list is issues, epics, tasks, OKRs and test cases [GL20]. So a Map should not assume that every Issue has `issue_type = issue`.

**Epics are being moved into work items.** Epics became work items behind a flag in 17.2, on by default in self-hosted 17.7, and GA in 18.1 [GL7] [GL16]. The epic REST APIs were deprecated in 17.0 but still work, with "no set removal date". The `WorkItem` GraphQL API "is marked as experimental", and the legacy `Epic` GraphQL API is "planned for removal in GitLab 19.0" [GL16]. The `Epic` type is nevertheless still in the 19.5-pre reference [GL22]. A Map that has to cover very old self-hosted instances needs the REST epic endpoints. For current ones, it needs the work-item GraphQL.

**OKRs** are Ultimate and have sat behind `okrs_mvc`, off by default, since 15.6. The docs describe them as "available for testing, but not ready for production use" [GL19].

**Mentions** ("crosslinks") come from mentioning an Issue in another Issue, a merge request, or a commit. They are shown as "mentioned in issue #N" [GL27]. The Notes API exposes only `system: true` plus the text [GL38]. GraphQL gives `systemNoteMetadata.action = "cross_reference"` [GL22] [GL33].

**Closing patterns** (`close`, `fix`, `resolve`, `implement` and their forms) work from commits and merge requests, and self-hosted admins can change the regular expression [GL28] [GL29].

**Detecting what an instance has.** `GET /version` returns `version` and `enterprise` (true on the EE build) [GL39]. When no licence is installed, "only Free features are enabled" [GL36]. GitLab backports security fixes to the current release and the two before it [GL37], but self-hosted instances often run older releases. That is why the table gives the first version for each capability.

### Text conventions

- **Reference syntax** that both Trackers turn into links and mentions:
  - GitHub: `#26`, `GH-26`, `owner/repository#26`, or the Issue URL [GH13].
  - GitLab: `#123`, `GL-123`, `[issue:123]`, `project#123`, `group/project#123`, `[work_item:123]` (18.2+), `&123` for epics, or the URL [GL30].
- **"Blocked by #12", "Depends on #12", "Part of #12", "Parent: #12"**: neither Tracker parses these. GitHub's keyword list is closing words only [GH14], and GitLab's closing regex does not include them either [GL28]. They produce only a mention of #12 (rows 5 and 17). If a Map wants to use them, it has to parse the Issue body itself (GitHub `body`, GitLab `description`). Such a Link would be inferred, not "recorded by the Tracker", which strains the glossary definition of **Link** (see the open questions).
- **Task lists.** GitHub.com turns a task-list item that is just an Issue reference into a tracked-by Link (row 3). GitLab task lists are plain checkboxes. The REST fields `has_tasks` and `task_completion_status` count them but record no Link [GL26] [GL30]. GitLab can turn a task-list item into a child **task**, which is a real Link (row 13) [GL17].
- **Text that does become a structured Link:**
  - GitHub's `Duplicate of #n` comment [GH15].
  - GitLab quick actions in a description or comment. `/relate`, `/blocks`, `/blocked_by` (blocking subject to tier), `/set_parent`, `/epic`, `/add_child` and `/duplicate` are commands that create Links [GL31].

### Other Trackers (brief, for later)

- **Jira Cloud.** Issue links are typed by the admin, and each type has an inward and an outward name (for example Blocks: "blocks" / "is blocked by"). Admins can add types, and can deactivate linking altogether [OT2]. Links are read from `fields.issuelinks` and managed through `/rest/api/3/issueLink`. Each Link has a `type` plus an `inwardIssue` or an `outwardIssue`, labelled by the type's `inward`/`outward` text [OT1]. Parent/child uses the `parent` field, which replaced the Epic Link and Parent Link custom fields (deprecated 2021-11-30, deadline 2022-11-30) [OT3].
- **Linear.** `IssueRelationType` is one of `blocks`, `duplicate`, `related`, `similar`. Read `Issue.relations` (outgoing) and `Issue.inverseRelations` (incoming). Parent/child uses `Issue.parent` / `Issue.children` [OT4].
- **Gitea / Forgejo.** They have only blocking Links ("dependencies"), added in Gitea 1.6.0 with a REST API in 1.20.0 [OT7]. The endpoints are `…/issues/{index}/dependencies` for blockers and `…/issues/{index}/blocks` for blocked Issues. Dependencies can be switched off per repository (`enable_issue_dependencies`) and default from `DEFAULT_ENABLE_DEPENDENCIES`. Cross-repository dependencies need `ALLOW_CROSS_REPOSITORY_DEPENDENCIES` [OT5] [OT6]. Forgejo (as served on codeberg.org, 16.0-dev) has the same endpoints [OT8]. Neither has parent/child or "relates to".
- **Azure Boards.** Work-item link types have a topology: tree (Parent/Child, Duplicate), dependency (Predecessor/Successor), or network (Related). There are also remote types that link across organisations. They are read as `relations[].rel` after `$expand=relations` [OT9] [OT10].

## What this means for a Map (decision-relevant)

1. **One normalized model, many sources.** The Map needs at least these kinds:
   - **parent/child**: GitHub sub-issues; GitLab epic → Issue → task.
   - **blocks** (directed): GitHub dependencies; GitLab Premium.
   - **relates to** (undirected): GitLab only.
   - **duplicate**.
   - optionally **mention**, which is weak and undirected in meaning.

   Store blocking once, as "A blocks B". GitLab already does this [GL32], and GitHub exposes both ends of a single Link [LV1].
2. **GitLab Free Maps have no blocking.** A Free Project can offer only `relates_to` and Issue → task. If blocking must appear there, it can come only from text conventions or quick actions, and quick actions are refused on Free.
3. **Links leave the Project.** GitHub sub-issues can cross repositories within one owner, and dependencies can cross owners. GitLab Links can cross projects and groups, and epics belong to groups, not Projects [GH20] [LV1] [GL1] [GL7]. A Map of one Project will meet Link endpoints outside it.
4. **Closed endpoints.** The Map draws open Issues, but Links often point at closed ones. GitHub's `blocked_by` summary already counts open Issues only [LV1], and GitLab's `blocked` means "has an open blocker" [GL32].
5. **API choice.** GraphQL is the only single-call way to get parent, children and blockers for many Issues on both Trackers. On GitLab, though, the work-item GraphQL is labelled "Experiment", is unavailable before 15.1/16.3, and CE lacks the EE `blocked*` fields [GL22] [GL35]. REST is the stable floor on GitLab (`links`, `epic`), but it cannot see task hierarchy.

## Open questions this raises

- **Does a mention count as a Link?** If it does, almost no Issue is an **Unlinked Issue**. If it doesn't, GitLab Free Maps may be mostly unlinked.
- **Are inferred text-convention Links "recorded by the Tracker"?** The glossary says a Link is something the Tracker records. Parsing "Blocked by #12" contradicts that unless the definition changes.
- **Do GitLab tasks and GitHub sub-issues of an Issue appear on the Map as Issues?** By the glossary they are Issues ("whatever the Tracker calls it").
- **How does the plugin learn the GitLab tier on a self-hosted instance without admin rights?** `GET /version` gives the edition, not the licence [GL39] [GL36]. Probing a field and handling a 403 or schema error may be the practical path.
- **Glossary collision.** "GitHub Projects" (the planning boards) is a different thing from our **Project** (a repository).

## Sources

Live checks, read-only:

- **LV1** — github.com via `gh api`, 2026-09-21. Issues read: `cli/cli#12438` and `#13016` (sub-issues and parent), `microsoft/vscode#274013` and `#274770` (`issue_dependencies_summary`, blocked-by/blocking lists, timeline events), `rust-lang/rust#162911` and `#113349` (tracked-by from task lists), and `microsoft/vscode-containers#605` (blocked by `dotnet/vscode-csharp#9748`, across owners).
- **LV2** — gitlab.com, anonymous. GraphQL `project(fullPath:"gitlab-org/gitlab").workItems` with the linked-items and hierarchy widgets (Issues #630081, #606447, #628305 and others). REST `GET /projects/gitlab-org%2Fgitlab/issues/630081` (fields `epic`, `blocking_issues_count`). REST `…/issues/630081/links` returned 401 anonymously. Run 2026-09-21.

GitHub:

- **GH1** — Adding sub-issues — <https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues>
- **GH2** — Browsing sub-issues — <https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/browsing-sub-issues>
- **GH3** — Creating issue dependencies — <https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-issue-dependencies>
- **GH4** — REST API endpoints for sub-issues — <https://docs.github.com/en/rest/issues/sub-issues>
- **GH5** — REST API endpoints for issue dependencies — <https://docs.github.com/en/rest/issues/issue-dependencies>
- **GH6** — REST API endpoints for issues (issue object) — <https://docs.github.com/en/rest/issues/issues>
- **GH7** — REST API endpoints for timeline events — <https://docs.github.com/en/rest/issues/timeline>
- **GH8** — Issue event types — <https://docs.github.com/en/rest/using-the-rest-api/issue-event-types>
- **GH9** — GraphQL objects (`Issue`, `CrossReferencedEvent`, `MarkedAsDuplicateEvent`, `SubIssueAddedEvent`, `BlockedByAddedEvent`, `ClosedEvent`, `ConnectedEvent`) — <https://docs.github.com/en/graphql/reference/objects>
- **GH10** — GraphQL enums (`IssueTimelineItemsItemType`, `ProjectV2FieldType`) — <https://docs.github.com/en/graphql/reference/enums>
- **GH11** — GraphQL changelog (`trackedIssues` added 2022-03-30; `addSubIssue` 2024-12-02; `addBlockedBy` 2025-07-30) — <https://docs.github.com/en/graphql/overview/changelog>
- **GH12** — About tasklists — <https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/about-tasklists>
- **GH13** — Autolinked references and URLs — <https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/autolinked-references-and-urls>
- **GH14** — Linking a pull request to an issue — <https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue>
- **GH15** — Marking issues or pull requests as a duplicate — <https://docs.github.com/en/issues/tracking-your-work-with-issues/administering-issues/marking-issues-or-pull-requests-as-a-duplicate>
- **GH16** — About Parent issue and Sub-issue progress fields — <https://docs.github.com/en/issues/planning-and-tracking-with-projects/understanding-fields/about-parent-issue-and-sub-issue-progress-fields>
- **GH17** — Changelog 2025-04-09, Evolving GitHub Issues and Projects (sub-issues GA) — <https://github.blog/changelog/2025-04-09-evolving-github-issues-and-projects/>
- **GH18** — Changelog 2025-08-21, Dependencies on issues (GA, 50 per type, filters, APIs) — <https://github.blog/changelog/2025-08-21-dependencies-on-issues/>
- **GH19** — Changelog 2025-02-18 (tasklist blocks retired 2025-04-30; Tracked/Tracked by fields removed) — <https://github.blog/changelog/2025-02-18-github-issues-projects-february-18th-update/>
- **GH20** — GitHub REST OpenAPI descriptions, per product version (`descriptions/api.github.com`, `ghec`, `ghes-3.16` … `ghes-3.22`), commit `338cb199` — <https://github.com/github/rest-api-description>
- **GH21** — GitHub docs feature versioning, `sub-issues` = GHES ≥ 3.18 — <https://github.com/github/docs/blob/main/data/features/sub-issues.yml>
- **GH22** — GitHub docs GraphQL schema data per version (`src/graphql/data/{fpt,ghec,ghes-3.17…3.22}/schema-issues.json`) — <https://github.com/github/docs/tree/main/src/graphql/data>
- **GH23** — Supported GHES releases (3.17–3.22) — <https://github.com/github/docs/blob/main/src/versions/lib/enterprise-server-releases.ts>
- **GH24** — Managing issue fields in your organization — <https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/managing-issue-fields-in-your-organization>
- **GH25** — GHES 3.19 REST issue dependencies — <https://docs.github.com/en/enterprise-server@3.19/rest/issues/issue-dependencies>

GitLab:

- **GL1** — Linked issues — <https://docs.gitlab.com/user/project/issues/related_issues/>
- **GL2** — Linked issues at v13.12 (relates_to to Free in 13.4; blocking 12.8) — <https://gitlab.com/gitlab-org/gitlab/-/blob/v13.12.0-ee/doc/user/project/issues/related_issues.md>
- **GL3** — Related issues at v12.0 (introduced in Starter 9.4) — <https://gitlab.com/gitlab-org/gitlab/-/blob/v12.0.0-ee/doc/user/project/issues/related_issues.md>
- **GL4** — Issue links API — <https://docs.gitlab.com/api/issue_links/>
- **GL5** — Linked items (work items) — <https://docs.gitlab.com/user/work_items/linked_items/>
- **GL6** — Child items — <https://docs.gitlab.com/user/work_items/child_items/>
- **GL7** — Epics (incl. "Epics as work items" history) — <https://docs.gitlab.com/user/group/epics/>
- **GL8** — Epics at v13.12 (Ultimate 10.2 → Premium 12.8) — <https://gitlab.com/gitlab-org/gitlab/-/blob/v13.12.0-ee/doc/user/group/epics/index.md>
- **GL9** — Manage epics at v13.12 (multi-level child epics, Ultimate 11.7) — <https://gitlab.com/gitlab-org/gitlab/-/blob/v13.12.0-ee/doc/user/group/epics/manage_epics.md>
- **GL10** — Linked epics — <https://docs.gitlab.com/user/group/epics/linked_epics/>
- **GL11** — Linked epics at v16.11 (introduced 14.9) — <https://gitlab.com/gitlab-org/gitlab/-/blob/v16.11.0-ee/doc/user/group/epics/linked_epics.md>
- **GL12** — Epics API (deprecated 17.0) — <https://docs.gitlab.com/api/epics/>
- **GL13** — Epic issues API — <https://docs.gitlab.com/api/epic_issues/>
- **GL14** — Epic links API — <https://docs.gitlab.com/api/epic_links/>
- **GL15** — Linked epics API — <https://docs.gitlab.com/api/linked_epics/>
- **GL16** — Migrate epic APIs to work items — <https://docs.gitlab.com/api/graphql/epic_work_items_api_migration_guide/>
- **GL17** — Tasks — <https://docs.gitlab.com/user/tasks/>
- **GL18** — Tasks at v16.11 (14.5 flag, 15.0 create, 15.3 on by default; "Tasks cannot be accessed via REST API"; linked items 16.5) — <https://gitlab.com/gitlab-org/gitlab/-/blob/v16.11.0-ee/doc/user/tasks.md>
- **GL19** — Objectives and key results — <https://docs.gitlab.com/user/okrs/>
- **GL20** — Work items — <https://docs.gitlab.com/user/work_items/>
- **GL21** — Configurable work item types — <https://docs.gitlab.com/user/work_items/configurable_work_item_types/>
- **GL22** — GraphQL API reference (`Issue`, `WorkItemWidgetHierarchy`, `WorkItemWidgetLinkedItems`, `LinkedWorkItemType`, `WorkItemRelatedLinkType`, `SystemNoteMetadata`, `Epic`) — <https://docs.gitlab.com/api/graphql/reference/>
- **GL23** — GraphQL reference at v15.1 (`WorkItemWidgetHierarchy`, `Query.workItem` introduced 15.1) — <https://gitlab.com/gitlab-org/gitlab/-/blob/v15.1.0-ee/doc/api/graphql/reference/index.md>
- **GL24** — EE `IssueType` GraphQL definition across tags. `blocked` is absent at v13.2 and present at v13.3. `blocked_by_count` is present at v13.6. `blocked_by_issues` is absent at v13.9 and present at v13.10. `blocking_count` is absent at v14.0 and present at v14.1. — <https://gitlab.com/gitlab-org/gitlab/-/blob/v14.1.0-ee/ee/app/graphql/ee/types/issue_type.rb>
- **GL25** — CE `IssueType` GraphQL definition (`closed_as_duplicate_of` absent at v15.0, present at v15.1) — <https://gitlab.com/gitlab-org/gitlab/-/blob/v15.1.0-ee/app/graphql/types/issue_type.rb>
- **GL26** — Issues API (`epic`, `epic_iid`, `blocking_issues_count`, `issue_type`, `closed_by`, `task_completion_status`) — <https://docs.gitlab.com/api/issues/>
- **GL27** — Crosslinking issues — <https://docs.gitlab.com/user/project/issues/crosslinking_issues/>
- **GL28** — Closing issues automatically / default closing pattern — <https://docs.gitlab.com/user/project/issues/managing_issues/#closing-issues-automatically>
- **GL29** — Issue closing pattern (administration) — <https://docs.gitlab.com/administration/issue_closing_pattern/>
- **GL30** — GitLab Flavored Markdown: GitLab-specific references; task lists — <https://docs.gitlab.com/user/markdown/>
- **GL31** — Quick actions (`/relate`, `/blocks`, `/blocked_by`, `/duplicate`, `/epic`, `/set_parent`, `/add_child`, `/unlink`) — <https://docs.gitlab.com/user/project/quick_actions/>
- **GL32** — Source: Link storage and licensing: `app/models/concerns/enums/issuable_link.rb`, `app/models/concerns/issuable_link.rb` (`MAX_LINKS_COUNT`), `ee/app/models/concerns/ee/issuable_link.rb`, `app/services/issuable_links/create_service.rb`, `ee/app/services/ee/issuable_links/create_service.rb`, `ee/app/services/ee/issue_links/create_service.rb`, `lib/api/issue_links.rb` — <https://gitlab.com/gitlab-org/gitlab/-/tree/47c3bd8bb0fd1935273ddb1281ea73b838444cbf>
- **GL33** — Source: system note actions (`cross_reference`, `relate`, `relate_to_parent`, …): `app/models/system_note_metadata.rb` — <https://gitlab.com/gitlab-org/gitlab/-/blob/47c3bd8bb0fd1935273ddb1281ea73b838444cbf/app/models/system_note_metadata.rb>
- **GL34** — Source: hierarchy rules: `app/models/work_items/types_framework/system_defined/definitions/{issue,incident,ticket}.rb`, `ee/app/models/work_items/types_framework/system_defined/definitions/{epic,objective}.rb` — <https://gitlab.com/gitlab-org/gitlab/-/tree/47c3bd8bb0fd1935273ddb1281ea73b838444cbf/app/models/work_items/types_framework/system_defined/definitions>
- **GL35** — Source: CE vs EE GraphQL fields: `app/graphql/types/issue_type.rb`, `ee/app/graphql/ee/types/issue_type.rb` — <https://gitlab.com/gitlab-org/gitlab/-/blob/47c3bd8bb0fd1935273ddb1281ea73b838444cbf/ee/app/graphql/ee/types/issue_type.rb>
- **GL36** — Activate GitLab EE ("without a license, only Free features are enabled") — <https://docs.gitlab.com/administration/license/>
- **GL37** — GitLab release and maintenance policy — <https://docs.gitlab.com/policy/maintenance/>
- **GL38** — Notes API — <https://docs.gitlab.com/api/notes/>
- **GL39** — Metadata API (`GET /version` → `version`, `enterprise`) — <https://docs.gitlab.com/api/metadata/>

Other Trackers:

- **OT1** — Jira Cloud REST v3, Issue links, and the published OpenAPI spec — <https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-links/>, <https://developer.atlassian.com/cloud/jira/platform/swagger-v3.v3.json>
- **OT2** — Jira Cloud, Configure work item linking — <https://support.atlassian.com/jira-cloud-administration/docs/configure-issue-linking/>
- **OT3** — Atlassian developer announcement: deprecation of Epic Link, Parent Link and related fields (replaced by `parent`) — <https://community.developer.atlassian.com/t/deprecation-of-the-epic-link-parent-link-and-other-related-fields-in-rest-apis-and-webhooks/54048>
- **OT4** — Linear GraphQL schema (`IssueRelation`, `IssueRelationType`, `Issue.parent/children/relations/inverseRelations`) — <https://github.com/linear/linear/blob/master/packages/sdk/src/schema.graphql>
- **OT5** — Gitea API reference (swagger) — <https://docs.gitea.com/api/>
- **OT6** — Gitea configuration cheat sheet (`DEFAULT_ENABLE_DEPENDENCIES`, `ALLOW_CROSS_REPOSITORY_DEPENDENCIES`) — <https://docs.gitea.com/administration/config-cheat-sheet>
- **OT7** — Gitea changelogs ("Added dependencies for issues", 1.6.0; "Add API to manage issue dependencies", 1.20.0) — <https://github.com/go-gitea/gitea/blob/main/CHANGELOG-archived.md>, <https://github.com/go-gitea/gitea/blob/main/CHANGELOG.md>
- **OT8** — Forgejo API as served by codeberg.org (swagger, Forgejo 16.0-dev) — <https://codeberg.org/api/swagger>
- **OT9** — Azure Boards, Link types reference — <https://learn.microsoft.com/en-us/azure/devops/boards/queries/link-type-reference>
- **OT10** — Azure DevOps REST, Work Items: Get Work Item (`$expand=relations`, `WorkItemRelation`) — <https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items/get-work-item?view=azure-devops-rest-7.1>

[LV1]: #sources
[LV2]: #sources
[GH1]: https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues
[GH2]: https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/browsing-sub-issues
[GH3]: https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-issue-dependencies
[GH4]: https://docs.github.com/en/rest/issues/sub-issues
[GH5]: https://docs.github.com/en/rest/issues/issue-dependencies
[GH6]: https://docs.github.com/en/rest/issues/issues
[GH7]: https://docs.github.com/en/rest/issues/timeline
[GH8]: https://docs.github.com/en/rest/using-the-rest-api/issue-event-types
[GH9]: https://docs.github.com/en/graphql/reference/objects
[GH10]: https://docs.github.com/en/graphql/reference/enums
[GH11]: https://docs.github.com/en/graphql/overview/changelog
[GH12]: https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/about-tasklists
[GH13]: https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/autolinked-references-and-urls
[GH14]: https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue
[GH15]: https://docs.github.com/en/issues/tracking-your-work-with-issues/administering-issues/marking-issues-or-pull-requests-as-a-duplicate
[GH16]: https://docs.github.com/en/issues/planning-and-tracking-with-projects/understanding-fields/about-parent-issue-and-sub-issue-progress-fields
[GH17]: https://github.blog/changelog/2025-04-09-evolving-github-issues-and-projects/
[GH18]: https://github.blog/changelog/2025-08-21-dependencies-on-issues/
[GH19]: https://github.blog/changelog/2025-02-18-github-issues-projects-february-18th-update/
[GH20]: https://github.com/github/rest-api-description
[GH21]: https://github.com/github/docs/blob/main/data/features/sub-issues.yml
[GH22]: https://github.com/github/docs/tree/main/src/graphql/data
[GH23]: https://github.com/github/docs/blob/main/src/versions/lib/enterprise-server-releases.ts
[GH24]: https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/managing-issue-fields-in-your-organization
[GH25]: https://docs.github.com/en/enterprise-server@3.19/rest/issues/issue-dependencies
[GL1]: https://docs.gitlab.com/user/project/issues/related_issues/
[GL2]: https://gitlab.com/gitlab-org/gitlab/-/blob/v13.12.0-ee/doc/user/project/issues/related_issues.md
[GL3]: https://gitlab.com/gitlab-org/gitlab/-/blob/v12.0.0-ee/doc/user/project/issues/related_issues.md
[GL4]: https://docs.gitlab.com/api/issue_links/
[GL5]: https://docs.gitlab.com/user/work_items/linked_items/
[GL6]: https://docs.gitlab.com/user/work_items/child_items/
[GL7]: https://docs.gitlab.com/user/group/epics/
[GL8]: https://gitlab.com/gitlab-org/gitlab/-/blob/v13.12.0-ee/doc/user/group/epics/index.md
[GL9]: https://gitlab.com/gitlab-org/gitlab/-/blob/v13.12.0-ee/doc/user/group/epics/manage_epics.md
[GL10]: https://docs.gitlab.com/user/group/epics/linked_epics/
[GL11]: https://gitlab.com/gitlab-org/gitlab/-/blob/v16.11.0-ee/doc/user/group/epics/linked_epics.md
[GL12]: https://docs.gitlab.com/api/epics/
[GL13]: https://docs.gitlab.com/api/epic_issues/
[GL14]: https://docs.gitlab.com/api/epic_links/
[GL15]: https://docs.gitlab.com/api/linked_epics/
[GL16]: https://docs.gitlab.com/api/graphql/epic_work_items_api_migration_guide/
[GL17]: https://docs.gitlab.com/user/tasks/
[GL18]: https://gitlab.com/gitlab-org/gitlab/-/blob/v16.11.0-ee/doc/user/tasks.md
[GL19]: https://docs.gitlab.com/user/okrs/
[GL20]: https://docs.gitlab.com/user/work_items/
[GL21]: https://docs.gitlab.com/user/work_items/configurable_work_item_types/
[GL22]: https://docs.gitlab.com/api/graphql/reference/
[GL23]: https://gitlab.com/gitlab-org/gitlab/-/blob/v15.1.0-ee/doc/api/graphql/reference/index.md
[GL24]: https://gitlab.com/gitlab-org/gitlab/-/blob/v14.1.0-ee/ee/app/graphql/ee/types/issue_type.rb
[GL25]: https://gitlab.com/gitlab-org/gitlab/-/blob/v15.1.0-ee/app/graphql/types/issue_type.rb
[GL26]: https://docs.gitlab.com/api/issues/
[GL27]: https://docs.gitlab.com/user/project/issues/crosslinking_issues/
[GL28]: https://docs.gitlab.com/user/project/issues/managing_issues/#closing-issues-automatically
[GL29]: https://docs.gitlab.com/administration/issue_closing_pattern/
[GL30]: https://docs.gitlab.com/user/markdown/
[GL31]: https://docs.gitlab.com/user/project/quick_actions/
[GL32]: https://gitlab.com/gitlab-org/gitlab/-/tree/47c3bd8bb0fd1935273ddb1281ea73b838444cbf
[GL33]: https://gitlab.com/gitlab-org/gitlab/-/blob/47c3bd8bb0fd1935273ddb1281ea73b838444cbf/app/models/system_note_metadata.rb
[GL34]: https://gitlab.com/gitlab-org/gitlab/-/tree/47c3bd8bb0fd1935273ddb1281ea73b838444cbf/app/models/work_items/types_framework/system_defined/definitions
[GL35]: https://gitlab.com/gitlab-org/gitlab/-/blob/47c3bd8bb0fd1935273ddb1281ea73b838444cbf/ee/app/graphql/ee/types/issue_type.rb
[GL36]: https://docs.gitlab.com/administration/license/
[GL37]: https://docs.gitlab.com/policy/maintenance/
[GL38]: https://docs.gitlab.com/api/notes/
[GL39]: https://docs.gitlab.com/api/metadata/
[OT1]: https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-links/
[OT2]: https://support.atlassian.com/jira-cloud-administration/docs/configure-issue-linking/
[OT3]: https://community.developer.atlassian.com/t/deprecation-of-the-epic-link-parent-link-and-other-related-fields-in-rest-apis-and-webhooks/54048
[OT4]: https://github.com/linear/linear/blob/master/packages/sdk/src/schema.graphql
[OT5]: https://docs.gitea.com/api/
[OT6]: https://docs.gitea.com/administration/config-cheat-sheet
[OT7]: https://github.com/go-gitea/gitea/blob/main/CHANGELOG-archived.md
[OT8]: https://codeberg.org/api/swagger
[OT9]: https://learn.microsoft.com/en-us/azure/devops/boards/queries/link-type-reference
[OT10]: https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items/get-work-item?view=azure-devops-rest-7.1
