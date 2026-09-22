# Does the domain model fit Trackers beyond GitHub and GitLab?

Research note for [#17](https://github.com/romtaugranot/issue-map/issues/17): would the Map's domain model, and the seam between the Map and a Tracker, fit a third kind of Tracker without changes shaped only by GitHub and GitLab? This checks that the design leaves room for other Trackers. It is not a plan to support them. Terms follow [`CONTEXT.md`](../CONTEXT.md).

Researched 2026-09-22. Trackers checked:

- **Gitea and Forgejo.** Like GitHub and GitLab, they are reached from a git remote.
- **Jira Cloud and Linear.** A git remote never leads to them.
- **Azure Boards,** in a lighter pass. It sits in the middle: an Azure Repos remote names the Azure DevOps project that holds the Boards.

Sources were read at these snapshots:

- Gitea source at `main` commit `8164130` (2026-09-22; latest release 1.27.3 [GT11]). Forgejo's API as served by codeberg.org, version `16.0.0-dev-753-6bcc6da0+gitea-1.22.0`. `tea` at `9c12138` (v0.16.0). `forgejo-cli` at `be2a16f` (after v0.6.0). `jira-cli` at `e74646e` (after v1.7.0).
- Jira Cloud's published OpenAPI descriptions: the REST v3 spec at `1001.0.0-SNAPSHOT-44cdd07c` and the Jira Software (agile) spec.
- Linear's public GraphQL schema at `linear/linear` commit `3addb24b` (2026-09-16).
- Atlassian, Linear and Microsoft docs as served on 2026-09-22.

Live checks were anonymous, read-only requests to public Projects on codeberg.org and gitea.com [LV1]. **Nothing was written to any Tracker, and no account or trial was requested.**

The earlier notes are cited, not redone:

- [TL]: how Trackers record Links. Its "Other Trackers" section and table rows 19–23 already list the Link kinds of Jira Cloud, Linear, Gitea/Forgejo and Azure Boards.
- [HP]: finding the Home Project's Tracker.
- [CAP]: what the Map can detect and write.

The grilling resolutions this note checks against are [G7] (which Links are drawn), [G11] (Home Project), [G12] (Take next), [G13] (Issue card, Closing Request) and [G18] (one Project per Map).

## Short answer

- **The model holds.** No glossary term has to be replaced.
  - Seven terms fit unchanged on every Tracker checked: Issue, Tracker, Parent Link, Outside Issue, Map, Group and Unlinked Issue.
  - Blocked Issue, Waits on and Unblocked Issue change only where Blocks Link does, on Jira.
- **Gitea and Forgejo fit almost unchanged.** They are the mirror image of GitLab Free: they record **Blocks Links only**, with no Parent or Related Link [TL]. The model already handles a Project that can't record some kinds.
  - A Project is a repository, and the remote leads to it.
  - A login without admin rights reads whether the Project can record Blocks from one field, `internal_tracker.enable_issue_dependencies`. It is visible even anonymously [GT1] [GT2] [LV1].
  - Closing Requests and their authors are in the Issue timeline [GT6] [GT7] [LV1].
  - `tea api` is a raw, authenticated API call like `gh api` [GT13] [GT14].
- **Jira and Linear break five assumptions that GitHub and GitLab share:**
  1. **"A remote leads to the Project."** For Jira and Linear it never does. The Home Project can only be one the user picked and saved. [G11] currently drops a saved Project that no remote leads to.
  2. **"The Tracker says what a Link kind means."** Jira's link types are named by admins, and nothing in the API marks one as blocking [JI1]. Jira's own Plans need an admin setting to decide which types count as dependencies [JI3]. So Blocks can only be identified by a mapping someone confirms.
  3. **"A Mention is not a Related Link."** Linear turns a reference in a description or comment into a `related` relation [LN2]. Nothing in the record tells the two apart [LN1].
  4. **"The Tracker records which pull request closes an Issue, and who wrote it."**
     - Jira only counts linked pull requests, through JQL, and gives no author [JI5].
     - Linear keeps the "closes" kind and the author in fields it marks `[Internal]` [LN1].
     - Azure decides at merge time whether a linked pull request completes the work item [AZ4].
  5. **"There is a CLI login with a raw API call to borrow."**
     - `tea api` (Gitea) and `az devops invoke` (Azure) fill that role [GT13] [AZ3].
     - Jira's official `acli` has fixed commands only, though they include listing and creating links [JI7].
     - Linear has no official CLI, only an official MCP server [LN6].
- **Take next's inputs exist on every Tracker checked, but two of its words are GitHub/GitLab words.**
  - "Milestone due date": Jira plans by version release date or sprint end, Linear by cycle end or project milestone target date, and Azure by iteration finish date.
  - "GitLab tasks": Jira subtasks and Azure Tasks are the same kind of task-level child.
- **What would change:**
  - Glossary: **Project**, **Home Project**, **Link** / **Related Link**, **Mention**, **Closing Request** and **Take next**.
  - ADRs: **ADR 0001** (the login), **ADR 0002** (one line) and **ADR 0003** (Blocks by a confirmed mapping where admins name the Link kinds).
  - ADR 0004 and ADR 0005 need no change. See [section 3](#3-glossary-terms-and-adrs-that-would-have-to-change).
- **The seam is small.** Six reads draw the Map. One more read orders Take next correctly. Everything else is optional: the Issue body for Start work, a write-access check, a Link write and an assign. See [section 2](#2-the-smallest-tracker-interface).

## 1. Glossary term × Tracker

**fits**: the term means the same thing there as on GitHub and GitLab. **fits with a change**: the idea holds, but a definition, rule or ADR has to change. **doesn't fit**: the Tracker has nothing that plays that part. The Azure Boards column is a lighter pass, and "not checked" marks what wasn't read.

| Term | Gitea / Forgejo | Jira Cloud | Linear | Azure Boards |
|---|---|---|---|---|
| **Issue** | **fits**: repository Issues. Pull requests share the numbering, and `type=issues` leaves them out [GT12] | **fits**: every work item of any type, subtasks included. Jira now calls Issues "work items" [JI10] | **fits**: every issue, sub-issues included [LN1] | **fits**: work items of every type [AZ1] |
| **Tracker** | **fits**: each server at its own host. `GET /api/v1/version` answers without a login, and Forgejo's version carries `+gitea-…` [GT8] [LV1] | **fits**: one site at `*.atlassian.net`, always on the current release (`deploymentType` is always `Cloud`). OAuth and scoped tokens reach it through `api.atlassian.com/ex/jira/{cloudId}` [JI1] [JI8] | **fits**: one service at linear.app. A workspace is part of a Project's address, like a GitHub owner [LN1] | **fits**: `dev.azure.com`, with the organisation as the first path segment. Azure DevOps Server is self-hosted and versioned [AZ2] |
| **Project** | **fits**: a repository, `owner/repository`, as on GitHub. Gitea's own "projects" are planning boards, like GitHub Projects [GT10] | **fits**: a Jira space, which the API still calls `project`. "Atlassian Projects" are a different thing [JI10] [JI11] | **fits with a change**: the unit is the **team**. Every issue belongs to exactly one team, whose key prefixes its identifier. Linear's own "projects" span teams [LN1] | **fits**: an Azure DevOps project, which holds many repositories and one set of Boards [AZ2] |
| **Home Project** | **fits**: the remote names the host and `owner/repository`. Detection needs one more probe, `/api/v1/version` [GT8] | **fits with a change**: no remote leads to a Jira space. The Home Project can only be the user's saved pick, and [G11] would drop it | **fits with a change**: as for Jira. Branch names carry the issue identifier, which is a hint [LN5] | **fits**: a remote such as `dev.azure.com/{org}/{project}/_git/{repo}` names the Project [AZ2] |
| **Closing Request** | **fits**: a pull request that uses a closing keyword. The Issue's timeline has a `pull_ref` item with `ref_action: "closes"`, and the pull request and its author are in `ref_issue` [GT6] [GT7] [LV1] | **doesn't fit**: pull requests reach Jira only as development information from connected tools. JQL can count open ones, but gives no author, and merging closes nothing by itself [JI5] | **fits with a change**: linked pull requests are public attachments, but "closes" and the author are `[Internal]` fields [LN1] [LN5] | **fits with a change**: any linked pull request completes the work item if its completer ticks an option at merge time [AZ4] |
| **Link** | **fits**: Blocks is the only kind [TL] | **fits with a change**: admins name the link types. The defaults include clones, duplicates, implements, reviews, causes, merged into and idea, besides Blocks and Relates [JI2] | **fits with a change**: four types. `similar` has no documented meaning, and Linear's only "similar issues" feature is AI detection [LN1] [LN3] | **fits with a change**: system types also include Duplicate, Tested By, Affects and Remote Related. Azure DevOps Server allows custom types [AZ1] |
| **Blocks Link** | **fits**: `…/dependencies` lists blockers and `…/blocks` lists Blocked Issues. Gitea won't close an Issue while a blocker is open [GT3] [GT5] | **fits with a change**: only a type's name says "blocks", and admins can rename or add types. `IssueLinkType` has no field for its meaning [JI1] [JI2] | **fits**: `blocks`. `relations` holds the Issues it blocks, and `inverseRelations` holds its blockers [LN1] | **fits**: Predecessor/Successor (`System.LinkTypes.Dependency`), which is acyclic. The predecessor completes first [AZ1] |
| **Parent Link** | **fits**: not recorded. The Map's note names the kind as missing (ADR 0003) | **fits**: the `parent` field, one parent per work item. Subtasks are at hierarchy level −1 [JI1] [TL] | **fits**: `parent` / `children`, one parent [LN1] | **fits**: Parent/Child, one parent [AZ1] |
| **Related Link** | **fits**: not recorded | **fits**: the Relates type ("relates to") [JI2] | **fits with a change**: `related`, but a reference in a description or comment becomes one automatically [LN2] | **fits**: Related, which has no direction and may cross projects [AZ1] |
| **Mention** | **fits**: `issue_ref`, `comment_ref` and `pull_ref` timeline items with `ref_action: "none"` [GT7] | not checked | **doesn't fit**: a reference becomes a `related` relation, with nothing to tell it apart [LN1] [LN2] | not checked |
| **Link Suggestion** | **fits**: written with `POST …/dependencies` or `…/blocks` [GT3] | **fits with a change**: `POST /issueLink` needs a type that has been mapped to a kind. A parent is set by editing the work item [JI1] | **fits**: `issueRelationCreate`, or `issueUpdate` with `parentId` [LN1] | **fits**: `az boards work-item relation add` [AZ3] |
| **Blocked Issue**, **Waits on**, **Unblocked Issue** | **fits**: whether the Project records Blocks is one readable field. An unreadable blocker comes back as a placeholder with no state (see [Gitea detail](#gitea-and-forgejo)) [GT2] [GT3] | **fits with a change**: they follow the Blocks mapping | **fits** | **fits** |
| **Outside Issue** | **fits**: Blocks Links may cross repositories (on by default) [GT3] [GT4] | **fits**: links cross spaces within a site. Remote links to other sites are URLs, not Links [JI1] | **fits**: the schema doesn't limit a relation or parent to one team [LN1] | **fits**: Links cross projects, and Remote links reach other organisations [AZ1] |
| **Map**, **Group**, **Unlinked Issue** | **fits**: derived from Links | **fits** | **fits** | **fits** |
| **Take next** | **fits**: `assignees`, milestone `due_on`, `created_at`, and Closing Requests with authors [GT7] [GT10] | **fits with a change**: one assignee. The planned date is a version's `releaseDate` (a work item can have several), a sprint's `endDate` or `duedate`. No Closing Request author. Subtasks play the part of GitLab tasks [JI1] [JI4] | **fits with a change**: one `assignee` (plus an agent `delegate`). The planned date is `cycle.endsAt`, `projectMilestone.targetDate` or `dueDate`. The Closing Request author is `[Internal]` [LN1] | **fits with a change**: `System.AssignedTo`. The planned date is the team iteration's `finishDate`. Tasks under a backlog item play the part of GitLab tasks [AZ5] [AZ6] |
| **Issue card** | **fits** | **fits with a change**: it can show only a count of open pull requests, and Links carry the admin's own type names | **fits with a change**: it can show linked pull requests, but not "closes it" | not checked |

## 2. The smallest Tracker interface

What the Map needs from any Tracker, in Tracker-neutral terms. "Draw" means the Map can't be drawn without it. "Order" means Take next is wrong without it, and the Map has to say so. "Act" means a card action or a write, which is optional.

**Reads**

1. **Identify (draw).** At an address, say which kind of Tracker it is and, if it has one, its version. Do it without credentials where possible (ADR 0003 bands).
2. **Resolve a Project (draw).** Turn a locator (a git remote or a Project URL) into a stable Project identity. Say whether the Project holds Issues and how many are open ([G11] narrowing).
3. **List open Issues (draw).** Page through a Project's open Issues. For each one, read:
   - a stable identity, the reference users type (`#12`, `ENG-12`, `PROJ-12`), the title and the URL
   - enough of its type to tell task-level children apart
   - its assignees and creation date, and the date it is planned for
   - its labels and comment count (for the Issue card)
4. **Read Links (draw).** For each open Issue, read its Blocks Links (at least who Blocks it), its Parent Links (parent and children) and its Related Links, each with its direction. For the far end, read:
   - a stable identity
   - whether it is open
   - whether the viewer can read it, and its Project (for Outside Issues)
5. **Say which Link kinds are recordable and readable (draw).** Tell apart "none recorded", "can't record" and "can't read or can't tell" for each kind, and above all for Blocks (ADR 0003).
6. **Say who the viewer is (draw).** Needed for `yours` and "assigned to others".
7. **Read open Closing Requests (order).** For each Unblocked Issue, read its open Closing Requests, drafts included, and each one's author ([G13]). If the Tracker can't give them, Take next can't leave anything out as taken by others, and has to say so.
8. **Read the Issue's body and comments (act).** Start work reads them ([G13]).

**Writes** (Promised band only, and each one confirmed by the user, as ADR 0002 and ADR 0003 require)

9. **Say whether this login can write a Link or assign (act).** The answer may be "can't tell". Then the Map offers the write and stops at the first refusal (ADR 0003).
10. **Write a Link of a kind the Project records (act).**
11. **Assign an Issue to the viewer (act)** ([G13]).

How each Tracker covers it:

| Need | Gitea / Forgejo | Jira Cloud | Linear | Azure Boards |
|---|---|---|---|---|
| 1 Identify | `GET /api/v1/version`, anonymous. Forgejo adds `/api/forgejo/v1/version` [GT8] [LV1] | `GET /rest/api/3/serverInfo`, anonymous [JI1] | Fixed host `api.linear.app/graphql` [LN4] | Org URL. Azure DevOps Server not checked |
| 2 Resolve a Project | `GET /repos/{o}/{r}`: `has_issues`, `internal_tracker` / `external_tracker` [GT1] | `GET /rest/api/3/project/{key}` [JI1] | `team(id)` / `Team.key` [LN1] | Remote URL → org and project [AZ2] |
| 3 Open Issues | `GET /repos/{o}/{r}/issues?state=open&type=issues` [GT12] | JQL search (`project = KEY AND statusCategory != Done`) [JI1] | `team.issues` [LN1] | WIQL query [AZ5] |
| 4 Links | Two REST reads per Issue: `/dependencies`, `/blocks` [GT3] | `fields.issuelinks` and `parent` in the search result [JI1] | `relations`, `inverseRelations`, `parent`, `children` in one GraphQL query [LN1] | `$expand=relations` [TL] |
| 5 Recordable kinds | `internal_tracker.enable_issue_dependencies` [GT1] | Link types and `issueLinkingEnabled` are readable, but **which type means Blocks isn't stated** [JI1] | Nothing to detect: the schema has no switch for relations [LN1] | `workitemrelationtypes`, with `topology` and `enabled` [AZ1] |
| 6 Viewer | `GET /user` [GT12] | `GET /rest/api/3/myself` [JI1] | `viewer` [LN1] | not checked |
| 7 Closing Requests + author | Timeline `pull_ref` + `ref_action: "closes"` + `ref_issue.user` [GT7] [LV1] | **No**: count only (`development[pullrequests].open`) [JI5] | **Partly**: attachments. "Closes" and the author are `[Internal]` [LN1] | **Partly**: any linked pull request; author from the Git API [AZ4] |
| 8 Body and comments | yes | yes | yes | not checked |
| 9 Can write | Role partly (`permissions.push` is about code, not Issues). Token: **can't tell** [GT2] [GT8] [GT9] | `mypermissions`: `LINK_ISSUES`, `EDIT_ISSUES`, `ASSIGN_ISSUES`. OAuth scopes from `accessible-resources` [JI1] [JI8] | Role from `viewer { admin guest }`. The API key's limits: **can't tell** [LN1] [LN4] | not checked |
| 10 Write a Link | `POST …/dependencies` or `…/blocks` [GT3] | `POST /rest/api/3/issueLink`; parent via `PUT /issue` [JI1] | `issueRelationCreate`; `issueUpdate(parentId)` [LN1] | `az boards work-item relation add` [AZ3] |
| 11 Assign | `PATCH …/issues/{index}` with `assignees` [GT12] | `PUT …/assignee` (Assign issues permission) [JI1] | `issueUpdate(assigneeId)` [LN1] | not checked |

## 3. Glossary terms and ADRs that would have to change

Each item says what breaks and suggests a change. None has been decided.

### Glossary ([`CONTEXT.md`](../CONTEXT.md))

1. **Project.** The definition names only "a GitHub repository or a GitLab project".
   - Suggested: "…a GitHub or Gitea repository, a GitLab project, a Jira space, a Linear team or an Azure DevOps project: the container every Issue belongs to exactly one of."
   - Widen "Not a GitHub Projects planning board" to "Not a planning board or initiative that groups Issues across Projects (GitHub Projects, Gitea projects, Linear projects, Atlassian Projects)".
   - Why the Linear team is the Project: every Linear issue has exactly one team [LN1]. A Linear project spans teams and holds only some Issues.
2. **Home Project.** Today it is "the Project the Map opens on for the local git checkout", and a pick happens only "when the checkout's remotes lead to several Projects".
   - Suggested: add "When no remote leads to a Tracker that holds Issues, as with Jira and Linear, it is the Project the user picked for this checkout."
   - Consequence for [G11]: detail 5 drops a saved Project that is no longer among the remotes' candidates. It has to keep a pick that no remote ever led to.
   - Hints can seed that one picker:
     - an Issue key in the branch name, which both Jira and Linear tell users to include [JI5] [LN5]
     - a Gitea or Forgejo repository's `external_tracker` URL, which anyone who can read the repository can read [GT1] [GT2]
   - GitHub autolinks and GitLab's Jira integration also name a Jira site, but only admins and Maintainers can read them [GH1] [GL1].
3. **Link / Related Link.** The glossary lists three kinds, and [G7] rules out duplicates. Jira, Linear and Azure record other kinds that someone set on purpose: clones, causes, implements, reviews, merged into, Tested By, Affects [JI2] [AZ1]. They fit the definition of **Link** ("a relationship with a meaning that someone set") but none of the three kinds.
   - Suggested: add "Any other kind someone set, except duplicates, counts as a Related Link and keeps the Tracker's own name on the Issue card."
   - Suggested: add "A kind the Tracker sets by itself, such as Linear's `similar`, is not a Link."
   - Otherwise, a Jira Project that uses only "causes" and "clones" would show every Issue as an Unlinked Issue.
4. **Mention.** "A Mention is not a Link" assumes the Tracker keeps them apart. On Linear, a referenced Issue "will automatically become a related issue" [LN2], and `IssueRelation` has no field saying who or what created it [LN1].
   - Suggested: add "Where the Tracker turns Mentions into Related Links, as Linear does, the Map counts them as Related Links, since it can't tell them apart."
   - This is low-risk: Related Links never decide Blocked or Unblocked.
5. **Closing Request.** It assumes the Tracker records which pull or merge request closes an Issue, and who wrote it.
   - Suggested: add "as the Tracker records it".
   - Suggested for **Take next**: "Where the Tracker doesn't record Closing Requests or their authors, none is assumed, and Take next says so."
   - Jira has no author and no "closes" [JI5]. Linear keeps both `[Internal]` [LN1]. Azure only knows at merge time [AZ4].
6. **Take next.** "A Parent with open children, other than GitLab tasks, …" names one Tracker.
   - Suggested: "other than task-level children (GitLab tasks, Jira subtasks)". A Jira subtask has `subtask: true` and hierarchy level −1 [JI1].
   - The order in [G12] uses "earliest milestone due date". It needs a Tracker-neutral "the date the Issue is planned for", with one source per Tracker: a milestone's due date, a Jira version's `releaseDate` or sprint `endDate`, a Linear cycle's `endsAt` or project milestone's `targetDate`, or an Azure iteration's `finishDate` [JI4] [LN1] [AZ6].
   - Jira allows several fix versions per work item, so "earliest" still works.
7. **Tracker.** No change is needed. Jira Cloud and Linear are single hosted services like github.com, and a Linear workspace or Azure organisation is part of a Project's address, as a GitHub owner is. One wording note: for Jira, the API host can differ from the site's host [JI8].

### ADRs

1. **[ADR 0001](../docs/adr/0001-build-new-inside-claude-code.md)** says the plugin "reads the Trackers itself using the `gh`/`glab` logins the machine already has". That carries to Gitea (`tea api`, v0.12.0+ [GT14]) and Azure (`az devops invoke`, GA [AZ3]). It doesn't carry to the others:
   - Jira's official `acli` has fixed commands and no raw API call [JI7].
   - Forgejo's `fj` has neither [GT15].
   - Linear has no official CLI [LN6].
   - Suggested: "borrow the Tracker's own CLI login where it offers a raw API call". The fallback for Trackers without one is left open (see [Open questions](#open-questions)).
2. **[ADR 0002](../docs/adr/0002-draw-only-recorded-links.md)** says a confirmed suggestion "is written to the Tracker through `gh`/`glab`". Suggested: "through the borrowed login". Also, "a Link Suggestion is only made for a kind the Tracker can record" means, on Jira, a kind whose link type has been mapped.
3. **[ADR 0003](../docs/adr/0003-support-by-detected-capability.md)** checks "which Link kinds it can read there". That works where the Tracker defines its kinds:
   - Gitea: one field [GT1].
   - Linear: always all four [LN1].
   - Azure: the relation-type list gives `topology`, `directional` and `enabled` [AZ1].

   It doesn't work on Jira, where a type's name is the only sign of its meaning [JI1] [JI2]. Guessing Blocks from a name is the mistake ADR 0002 calls the worst.
   - Suggested: "Where Link kinds are named by the Tracker's admins, the Map reads the link types, and the user confirms once per Tracker which type is Blocks, and in which direction. Until then, Blocks counts as 'can't tell', and no Issue is Unblocked."
   - Jira's own Plans work the same way: an administrator picks the dependency types and can swap their direction [JI3]. The Plans REST API needs the Administer Jira permission, so the Map can't read that setting [JI1].
4. **[ADR 0004](../docs/adr/0004-promised-means-run-or-stood-in.md): no change.** Jira Cloud and Linear are hosted-only, like github.com, so they would be tested live on fixture Projects. Gitea and Forgejo publish images that could run in CI (not checked here).
5. **[ADR 0005](../docs/adr/0005-one-project-per-map.md): no change.** Links that reach other repositories, spaces, teams or organisations are Outside Issues. The "stable identity" rule already covers Gitea's placeholder for an unreadable blocker (below).

## Detail

### Gitea and Forgejo

**Tracker and version.** `GET /api/v1/version` sits in Gitea's "Misc (public accessible)" route group [GT8].
- codeberg.org, a Forgejo server, answered `16.0.0-dev-753-6bcc6da0+gitea-1.22.0` [LV1].
- Forgejo also answers `/api/forgejo/v1/version`, while gitea.com returned 404 for that path [LV1].
- So one anonymous request identifies the kind and version. It can join the probes in [HP] step 3, which today files Gitea and Forgejo under "something else".
- The Blocks API exists from Gitea 1.20 [TL], which gives ADR 0003 a natural floor. Forgejo is based on Gitea 1.22 and has the same paths [GT12].

**Project.** A repository, keyed `owner/repository`, as on GitHub. The repository object carries:
- `has_issues`
- `internal_tracker { enable_time_tracker, allow_only_contributors_to_track_time, enable_issue_dependencies }`
- `external_tracker { external_tracker_url, external_tracker_format, external_tracker_style, … }`
- `permissions { admin, push, pull }`

`internal_tracker` is filled when the Issues unit is on, and `external_tracker` when the repository sends its Issues to another Tracker [GT1] [GT2]. The converter checks no permission for either. Anonymous reads of `forgejo/forgejo` returned `internal_tracker` with `enable_issue_dependencies: true` [LV1]. Gitea's own "projects" (the `projects` field on an Issue) are planning boards [GT10].

**Blocks Links.**
- `GET …/issues/{index}/dependencies` lists "all issues that block this issue". `GET …/issues/{index}/blocks` lists the Issues it blocks [GT3] [GT12].
- Both return 404 when the repository has dependencies off [GT3].
- The per-repository switch defaults from `DEFAULT_ENABLE_DEPENDENCIES` (true). Links across repositories need `ALLOW_CROSS_REPOSITORY_DEPENDENCIES`, which also defaults to true; a write that crosses repositories when it is off gets a 400 [GT3] [GT4].
- Anonymous reads of both lists on a public Forgejo Issue returned 200 [LV1].
- Gitea gives Blocks real force: while dependencies are on, closing an Issue that has an open blocker fails with `ErrDependenciesLeft` [GT5].
- The setting's own description says "Enable dependencies for issues and pull requests" [GT1]. So a pull request can block or be blocked. It is not an Issue ([G7]), so that Link is outside the model. Whether an Issue whose only blocker is an open pull request is Blocked is an open question.

**Unreadable blockers.** When the viewer can't read a blocker's repository, the answer turns on whether the viewer can write the Issue [GT3]:
- **Viewer can't write:** the blocker comes back as a placeholder titled `HIDDEN`, with no number, repository or state.
- **Viewer can write:** its number, title, state and repository are given.

The glossary already draws "an Issue the user can't read … as one without a name". But the placeholder has no stable identity and no state, so under ADR 0005 it joins nothing. It also isn't clear whether it is open. Counting it as an open blocker is the reading that keeps ADR 0003's rule ("can't read" counts the same as "can't record").

**Writing.**
- `POST …/dependencies` and `…/blocks` take `{ owner, repo, index }` [GT3] [GT12].
- They need issue write on the target's repository and read on the other end. Every permission refusal is a 404 [GT3].
- `permissions.push` on the repository object describes the Code unit, not Issues [GT2]. Teams can grant access unit by unit (`units_map`), and issue writes check the Issues unit (`CanWriteIssuesOrPulls`) [GT9]. So `push` is only a proxy.
- A token needs the `write:issue` scope for any POST in the Issues category [GT8]. The endpoint that lists a user's tokens, `GET /users/{username}/tokens`, needs basic authentication (username and password) [GT8]. So a token can't learn its own scopes. Only a refused request names them ("token does not have at least one of required scope(s), … token scope=…") [GT8].
- So write access is "can't tell", and ADR 0003's rule already covers it: offer, and stop at the first refusal.

**Closing Requests.**
- Closing keywords (default `close, closes, closed, fix, fixes, fixed, resolve, resolves, resolved`, configurable) take effect only from a pull request to an Issue [GT6].
- The Issue's timeline then holds a `pull_ref` item with `ref_action: "closes"`. `ref_issue` is the pull request as an Issue object, with `user` (the author), `state` and `pull_request` [GT7].
- On merge, Gitea closes the Issue [GT6].
- Live: public Forgejo Issue `forgejo/forgejo#14383` had two `pull_ref`/`closes` items, one pull request closed and one still open, each with an author. `#14346` had `pull_ref` items with `ref_action: "none"`, which are Mentions from pull requests [LV1].

**Take next inputs.** An Issue has `assignees` (several), `milestone.due_on`, `created_at`, its own `due_date`, `labels` and `comments` [GT10].

**Login.**
- **`tea`**, Gitea's CLI, gained `tea api` in v0.12.0 (2026-02-19) [GT14]. It sends an authenticated request to any API path, prefixes `/api/v1/`, and fills `{owner}` and `{repo}` from the current repository [GT13].
  - It picks its login by matching a remote URL to a saved login [GT13].
  - It also accepts `GITEA_TOKEN` with `GITEA_INSTANCE_URL` [GT13].
  - Since v0.13.0 it keeps OAuth tokens in the OS keyring [GT14].
  - Its README doesn't mention Forgejo, so Forgejo support is untested.
- **`fj`** (forgejo-cli) has `fj issue depend add|remove|list` and `fj issue block add|remove|list` on its main branch. They aren't in v0.6.0 (2026-07-19) [GT15].
  - It has no raw API command.
  - It keeps logins, as a token or an OAuth token with a refresh token, in a `keys.json` file in the user's data directory [GT15].
  - [HP] advises against reading credential files directly.

### Jira Cloud

**Tracker.** A site such as `example.atlassian.net`. `GET /rest/api/3/serverInfo` answers anonymously, and its `deploymentType` "is always returned as *Cloud*" [JI1]. There are no releases to band by, as with github.com. Scoped API tokens and OAuth 2.0 (3LO) tokens call `https://api.atlassian.com/ex/jira/{cloudId}/…`, not the site's host [JI8] [JI9].

**Project.** Jira calls the container a "space" in its interface, and calls Issues "work items" [JI10]. The REST API and JQL still say `project` and `issue` [JI1]. "Atlassian Projects" are something else: "strategic initiative trackers … different from Jira spaces" [JI11]. That is the same collision the glossary already notes for GitHub Projects.

**Home Project.** No git remote names a Jira space. Jira links development work by putting the work item key in branch names, commit messages and pull request titles (`git checkout -b JRA-123-<branch-name>`) [JI5]. So the current branch can suggest a space, but only as a hint for the user's pick.
- A Gitea or Forgejo repository can name an external tracker URL, which anyone can read [GT1].
- GitHub's autolinks are "only available to repository administrators" [GH1].
- GitLab's Jira integration settings need Maintainer or Owner [GL1].

**Link kinds.**
- Each Link in `fields.issuelinks` has a `type` and either an `outwardIssue` or an `inwardIssue`. It is labelled with the type's `outward` or `inward` text [JI1] [TL].
- So on work item X, an entry with type Blocks and `outwardIssue: Y` reads "X blocks Y".
- `IssueLinkType` has only `id`, `name`, `inward`, `outward` and `self` [JI1]. Nothing marks a type as blocking, directed or hierarchical.
- The default set is "is blocked by / blocks", "is cloned by / clones", "is duplicated by / duplicates", "added to idea / is idea for", "is implemented by / implements", "merged into / merged from", "is reviewed by / reviews", "is caused by / causes" and "relates to" [JI2].
- Jira admins can add, rename and delete types, and can switch linking off [JI2] [TL].

Mapping:
- **Blocks Link:** the "Blocks" type, but only once confirmed (section 3, ADR 0003).
- **Related Link:** "Relates".
- **Not Links:** duplicates ([G7]).
- **The rest:** Related, if glossary change 3 is taken.
- **Parent Link:** the `parent` field, one per work item. It replaced Epic Link and Parent Link [TL]. Issue types carry `hierarchyLevel` and `subtask` [JI1].
- **Remote links** (`/issue/{key}/remotelink`) point at URLs and other applications, not at Issues in `issuelinks` [JI1]. So they are not Links.

**Jira's own answer to "which type is Blocks".** In Plans, "by default, dependencies in your plan treat all work item links as though they have the Blocks work item link type". A Jira administrator configures which link types count, and can swap their direction [JI3]. The Plans REST operations need the Administer Jira permission [JI1].

**Capability check without admin rights.**
- `GET /rest/api/3/issueLinkType` "can be accessed anonymously" with Browse projects in any project. It returns 404 when linking is off [JI1].
- `GET /rest/api/3/configuration` returns `issueLinkingEnabled` and `subTasksEnabled` to any user who can use Jira [JI1].
- Link types are site-wide, so every space can record every type, and the only question is what each type means.
- `GET /rest/api/3/mypermissions?projectKey=…&permissions=LINK_ISSUES,EDIT_ISSUES,ASSIGN_ISSUES` returns `havePermission` [JI1].
  - Writing a Link needs Link issues on the outward work item's space and Browse on both [JI1].
  - Setting a parent is an issue edit, which needs Edit issues [JI1].
  - Assigning needs Assign issues [JI1].
  - Jira warns that a permission based on issue data can show as held for the space "but may not have the permission for any or all issues". Per-issue checks (`issueKey=`) avoid that [JI1].
- For OAuth tokens, `GET https://api.atlassian.com/oauth/token/accessible-resources` lists each site's granted `scopes` [JI9]. Classic API tokens act with the user's own permissions. Scoped API tokens exist, and they expire after one day to one year [JI8].

**Closing Request.**
- Linked pull requests reach Jira as development information from a connected tool [JI5].
- JQL can search `development[pullrequests].all` and `.open` [JI5]. That is a count, with no author.
- The linking docs describe no status change when a pull request is merged. "Smart commits" are an admin-enabled extra [JI5].
- Jira itself therefore records no Closing Request in the glossary's sense. The Map would have to read the pull requests' own Tracker, which the glossary's "the Map never follows it" doesn't rule out, but that would cost a second Tracker and a second login per Project.

**Take next inputs.**
- `assignee` holds one user [JI1].
- There is no milestone. Candidates for the planned date are:
  - `fixVersions[].releaseDate` (a work item can have several versions) [JI1]
  - the sprint's `endDate`, from the agile API, whose issue resource includes "sprint, closedSprints, flagged, and epic" [JI4]
  - the work item's own `duedate`
- `created` is the creation date [JI1].

**Login.**
- **Atlassian CLI (`acli`, official).** `acli jira auth login` uses a browser (`--web`, OAuth) or `--site`/`--email`/`--token`. There are also `auth status`, `auth switch` and `auth logout`. No command prints a token [JI7].
  - `acli jira workitem link` has `create`, `delete`, `list` and `type`, and `list` supports `--json` [JI7].
  - No raw REST command is documented. So the plugin could read and write Links through `acli`, but other reads (JQL search with fields, `mypermissions`) only through whatever fixed commands exist.
- **`jira-cli`** (community). It has no raw API command either. It reads the token from its config, `.netrc`, the OS keyring (service `jira-cli`) or `JIRA_API_TOKEN` [JI6].
- **Atlassian's MCP server** (`mcp.atlassian.com`) uses OAuth 2.1 and is set up in Claude Code with `/mcp` [JI12]. Only Claude can call it, not the plugin's own code or its status line.

### Linear

**Tracker and Project.**
- The API is one GraphQL endpoint, `https://api.linear.app/graphql` [LN4].
- "Every issue must belong to exactly one team" [LN1]. `Team.key` is "used as a prefix in issue identifiers (e.g., 'ENG' in 'ENG-123')" [LN1]. So the **team** is the Project.
- A Linear **project** "can span multiple teams" [LN1], so it is a grouping like GitHub Projects.
- Teams can have sub-teams (`Team.parent`) [LN1]. Whether a parent team's Map should include its sub-teams' Issues is open.

**Link kinds.**
- `IssueRelationType` is `blocks | duplicate | related | similar` [LN1].
- `IssueRelation { issue, relatedIssue, type, createdAt, updatedAt, archivedAt, id }` has no field for who or what created it. Its description lists only "blocks, duplicate, and related" [LN1].
- `relations` holds the relations where this Issue is the source, and `inverseRelations` those where it is the target [LN1]. So "blocked by" is `inverseRelations` with `type: blocks`.
- The docs [LN2]:
  - "When you reference issues in a description or comment, they'll automatically become a related issue."
  - "Once the blocking issue has been resolved, the relationship moves under *Related*." Whether the stored `type` changes, or only the display, wasn't checked. Either way a closed blocker no longer blocks.
- `similar` is undocumented. The product feature of that name "use[s] AI to surface existing issues … that may be duplicates or related issues" [LN3]. Triage Intelligence (Business and Enterprise plans) shows a suggestion "to accept the relation" [LN3]. The schema's `IssueSuggestion`, with type `similarIssue`, is `[Internal]` [LN1].
- So the Map can't show that a `similar` relation was set by a person. It is closer to a Link Suggestion made by the Tracker, and shouldn't be drawn.
- `parent` holds one parent, and `children` its sub-issues [LN1].

**Capability check.**
- Neither `Team` nor `Organization` has a switch for relations [LN1], so every team can record every kind.
- The viewer's role is `viewer { admin guest owner }`, and team membership is `viewer.teams` [LN1]. Guests "take the same actions as Members within" the teams they are added to (Business and Enterprise plans) [LN7].
- A personal API key can be limited to "Read, Write, Admin, Create issues, Create comments" and to specific teams [LN4]. The schema has no type that reads a key's own limits back [LN1]. So write access is "can't tell", as with GitHub fine-grained tokens [CAP].

**Closing Request.**
- Pull requests link by branch name, title or "magic words" [LN5]:
  - Closing words ("close, closes, …, fix, …, resolve, …, complete, …, implement, …") move the Issue to Done when the pull request merges.
  - "ref, part of, contributes to, …" move it through earlier statuses only.
  - "relates to" only links.
- In the public schema, a linked pull request is an `Attachment` with `sourceType` (for example `github`) and an untyped `metadata` object [LN1]. Its `creator` is whoever created the attachment [LN1].
- The typed `PullRequest` (with `creator`) and `GitLinkKind { closes, contributes, links }` are both marked `[Internal]` [LN1].
- So telling a Closing Request apart from a "contributes" link, and naming its author, relies on fields Linear doesn't promise.

**Take next inputs.**
- `assignee` (one user), and `delegate`, "the agent user that is delegated to work on this issue" [LN1].
- Planned date: `cycle.endsAt`, `projectMilestone.targetDate` or `dueDate` [LN1].
- `createdAt` [LN1].

**Login.** No official Linear CLI turned up; the CLIs found are community projects. Linear's official MCP server (`https://mcp.linear.app/mcp`, with a read-only variant) uses OAuth 2.1 and is added to Claude Code with `claude mcp add --transport http linear-server https://mcp.linear.app/mcp` [LN6]. As with Jira, only Claude can call it.

### Azure Boards (light pass)

- **Link kinds** [AZ1]:
  - Parent/Child is a tree: "A work item can have only one Parent."
  - Predecessor/Successor (`System.LinkTypes.Dependency`) is directional. Creating a cycle is an error. "Choose **Predecessor** when linking to a work item that should complete before the current item." That is a Blocks Link.
  - Related is a network: no direction, and it may cross projects.
  - Duplicate, Tested By and Affects are process- or system-defined.
  - Remote links (Consumes From/Produced For, Remote Related) reach other organisations "as long as the same Microsoft Entra ID manages" them.
  - Custom link types exist only on Azure DevOps Server (`witadmin`).
- **Capability check.** The relation-type list (`az boards work-item relation list-type`, or the REST list) returns `topology`, `directional`, `acyclic`, `enabled` and `remote` for every type [AZ1]. This is the one Tracker checked that states a Link kind's shape in machine-readable form. Shape isn't meaning, though: Tested By also has dependency topology. So Blocks is still the one system type, `System.LinkTypes.Dependency`.
- **Home Project.**
  - The project URL is `dev.azure.com/{organization}/{project}`, and clone URLs look like `https://…@dev.azure.com/{org}/{project}/_git/{repo}` [AZ2].
  - The older `visualstudio.com` form is still accepted [AZ2].
  - `az` commands can detect the organisation from git config (`--detect`) [AZ3].
- **Closing Request.** Pull requests are artifact links on the work item. At completion, "Complete associated work items after merging" (`--transition-work-items`) moves every linked work item on [AZ4]. So any open linked pull request may close the Issue, and none is known to until it merges.
- **Take next inputs.**
  - `System.AssignedTo` holds one person, and `System.CreatedDate` is the creation date [AZ5].
  - The planned date comes from the work item's `System.IterationPath` and the team's iteration settings, which give `attributes.finishDate` [AZ5] [AZ6].
- **Login.**
  - `az devops login` stores a personal access token per organisation [AZ3].
  - `az devops invoke` (GA) calls "any DevOps area and resource", the way `gh api` does [AZ3].
  - `az devops` commands are "not supported for Azure DevOps Server" [AZ3].

## Open questions

- **The fallback login for Trackers with no raw-API CLI** (Jira, Linear, Forgejo). The options are:
  - a token the user gives the plugin (against [HP]'s "borrow, don't collect")
  - the Tracker's official MCP server (only Claude can call it, so the status line can't draw from it)
  - `acli`'s fixed commands

  This belongs with ADR 0001.
- **Pull requests in Gitea's Blocks Links.** Is an Issue whose only open blocker is a pull request Blocked? Gitea itself won't let the Issue close until the pull request closes [GT5].
- **Gitea's `HIDDEN` placeholder.** It has no identity or state. Counting it as an open blocker is the reading that keeps ADR 0003's rule, but no decision has been made.
- **Linear sub-teams.** Is a parent team's Project its own Issues only, or also its sub-teams' Issues?
- **Jira: where to read the pull request author.** It could come from the pull requests' own Tracker, or Take next could simply say "Closing Requests unknown" on Jira.
- **Mentions on Jira and Azure** weren't checked. Only the Issue card's count line uses them.

## Sources

Earlier notes and decisions:

- **TL** — How Trackers record Links between Issues — <https://github.com/romtaugranot/issue-map/blob/research/tracker-links/research/tracker-links.md>
- **HP** — Finding the Home Project's Tracker from a local checkout — <https://github.com/romtaugranot/issue-map/blob/research/home-project/research/home-project.md>
- **CAP** — What the Map can detect and write — <https://github.com/romtaugranot/issue-map/blob/research/capabilities/research/capabilities.md>
- **G7** — Grilling: which Links become lines on the Map — <https://github.com/romtaugranot/issue-map/issues/7>
- **G11** — Grilling: which Project the Map opens on when a checkout points at several — <https://github.com/romtaugranot/issue-map/issues/11>
- **G12** — Grilling: how the Map orders the Unblocked Issues to take next — <https://github.com/romtaugranot/issue-map/issues/12>
- **G13** — Grilling: what an Issue card offers besides its Links — <https://github.com/romtaugranot/issue-map/issues/13>
- **G18** — Grilling: can one Map hold Issues from several Projects? — <https://github.com/romtaugranot/issue-map/issues/18>
- **GH1** — GitHub REST, autolinks ("only available to repository administrators") — <https://docs.github.com/en/rest/repos/autolinks>
- **GL1** — GitLab Project integrations API (Maintainer or Owner; `GET /projects/:id/integrations/jira`) — <https://docs.gitlab.com/api/project_integrations/>

Live checks, anonymous and read-only, 2026-09-22:

- **LV1** — codeberg.org (Forgejo) and gitea.com:
  - `GET /api/v1/version` on both. `GET /api/forgejo/v1/version` returned 200 on codeberg.org and 404 on gitea.com.
  - `GET /api/v1/repos/forgejo/forgejo`: `internal_tracker`, `external_tracker: null`, `permissions { pull: true }`.
  - The open-Issue list: `assignees`, `milestone`, `created_at`, `due_date`.
  - `…/issues/14526/dependencies` and `…/blocks`: 200 with an empty list.
  - Timelines of recently closed Issues: `#14383` and `#14372` had `pull_ref` with `ref_action: "closes"`, the pull request's `user` present, and its `state`. `#14346` had `pull_ref` with `ref_action: "none"`.
  - Author names were not recorded.

Gitea and Forgejo (Gitea source at <https://github.com/go-gitea/gitea/tree/8164130349836e75d35471fd056cb449310e5548>):

- **GT1** — `modules/structs/repo.go` L20–49: `Permission`, `InternalTracker` (`enable_issue_dependencies`: "Enable dependencies for issues and pull requests"), `ExternalTracker` — <https://github.com/go-gitea/gitea/blob/8164130349836e75d35471fd056cb449310e5548/modules/structs/repo.go#L20-L49>
- **GT2** — `services/convert/repository.go` L40–82: `permissions` computed from the Code unit; `internal_tracker` / `external_tracker` filled from the repository's units — <https://github.com/go-gitea/gitea/blob/8164130349836e75d35471fd056cb449310e5548/services/convert/repository.go#L40-L82>
- **GT3** — `routers/api/v1/repo/issue_dependency.go`: 404 when dependencies are off (L58–62); `HIDDEN` placeholder vs. confidential details (L108–135); cross-repository check (L493–500); write rules (L533–557) — <https://github.com/go-gitea/gitea/blob/8164130349836e75d35471fd056cb449310e5548/routers/api/v1/repo/issue_dependency.go>
- **GT4** — `models/repo/issue.go` L52–60 and `modules/setting/service.go` L209–210 (`DEFAULT_ENABLE_DEPENDENCIES`, `ALLOW_CROSS_REPOSITORY_DEPENDENCIES`, both default true) — <https://github.com/go-gitea/gitea/blob/8164130349836e75d35471fd056cb449310e5548/modules/setting/service.go#L209-L210>
- **GT5** — `models/issues/issue_update.go` L61–72: closing fails with `ErrDependenciesLeft` while a blocker is open — <https://github.com/go-gitea/gitea/blob/8164130349836e75d35471fd056cb449310e5548/models/issues/issue_update.go#L61-L72>
- **GT6** — Closing keywords: `models/issues/issue_xref.go` L190–232 (close actions only from a pull request to an Issue), `services/pull/merge.go` L329–352 (close on merge), `modules/references/references.go` L54–73, `modules/setting/repository.go` L201 (default keywords) — <https://github.com/go-gitea/gitea/blob/8164130349836e75d35471fd056cb449310e5548/models/issues/issue_xref.go#L190-L232>
- **GT7** — Timeline: `modules/structs/issue_comment.go` L51–99 (`TimelineComment`: `type`, `ref_issue`, `ref_action`, `dependent_issue`), `services/convert/issue_comment.go` L33–140, comment types in `models/issues/comment.go` L73–76 and L129–145 — <https://github.com/go-gitea/gitea/blob/8164130349836e75d35471fd056cb449310e5548/modules/structs/issue_comment.go#L51-L99>
- **GT8** — `routers/api/v1/api.go`: `tokenRequiresScopes` (L327–372, scope level from the HTTP method, error text naming the token's scopes); `/version` in "Misc (public accessible)" (L1090–1092); user token list behind `reqBasicOrRevProxyAuth` (L1145–1149); dependency routes (L1727–1734) — <https://github.com/go-gitea/gitea/blob/8164130349836e75d35471fd056cb449310e5548/routers/api/v1/api.go>
- **GT9** — `models/perm/access/repo_permission.go` L159–164 (`CanWriteIssuesOrPulls` checks the Issues unit); `modules/structs/org_team.go` L38 (`units_map`) — <https://github.com/go-gitea/gitea/blob/8164130349836e75d35471fd056cb449310e5548/models/perm/access/repo_permission.go#L159-L164>
- **GT10** — `modules/structs/issue.go` L49–86 (`assignees`, `milestone`, `projects`, `created_at`, `due_date`), `modules/structs/issue_milestone.go` (`due_on`) — <https://github.com/go-gitea/gitea/blob/8164130349836e75d35471fd056cb449310e5548/modules/structs/issue.go#L49-L86>
- **GT11** — Gitea changelog (1.27.3, 2026-08-29) — <https://github.com/go-gitea/gitea/blob/8164130349836e75d35471fd056cb449310e5548/CHANGELOG.md>
- **GT12** — Forgejo API as served by codeberg.org (OpenAPI, version `16.0.0-dev-753-6bcc6da0+gitea-1.22.0`): issue list `type` filter, dependency and blocks paths, `Issue`, `InternalTracker`, `/users/{username}/tokens` — <https://codeberg.org/swagger.v1.json>
- **GT13** — `tea` source at `9c12138` (v0.16.0): `cmd/api.go` L68–93 (`tea api`), `modules/context/context_repo.go` L72–81 (login matched to a remote URL), `modules/context/context_login.go` L15–35 (`GITEA_TOKEN`, `GITEA_INSTANCE_URL`) — <https://gitea.com/gitea/tea/src/commit/9c12138d6273ba8feb6e7578833cc330c0cd6461>
- **GT14** — `tea` releases (`tea api` added in v0.12.0, 2026-02-19; OAuth tokens in the OS keyring from v0.13.0) — <https://gitea.com/gitea/tea/releases>
- **GT15** — `forgejo-cli` source at `be2a16f`: `src/issues.rs` L150–156 and L270–320 (`issue depend`, `issue block`), `src/keys.rs` L20–60 and L127–138 (`keys.json`, stored token types); tag `v0.6.0` (2026-07-19) has no `IssueDependCommand` — <https://codeberg.org/forgejo-contrib/forgejo-cli/src/commit/be2a16f5cbbe9df795382607582744c06b86dc5b>

Jira Cloud:

- **JI1** — Jira Cloud REST v3 OpenAPI (`1001.0.0-SNAPSHOT-44cdd07c`): `GET/POST /rest/api/3/issueLinkType`, `POST /rest/api/3/issueLink` (permissions, 404, 413), `IssueLinkType`, `IssueLink`, `GET /rest/api/3/configuration` (`issueLinkingEnabled`, `subTasksEnabled`), `GET /rest/api/3/mypermissions`, `GET /rest/api/3/serverInfo` (`deploymentType`), `GET /rest/api/3/myself`, `PUT /rest/api/3/issue/{key}` (Edit issues), `PUT …/assignee` (Assign issues), `…/remotelink`, `IssueTypeDetails` (`hierarchyLevel`, `subtask`), `Version` (`releaseDate`), `/rest/api/3/plans/plan/{planId}` (Administer Jira) — <https://developer.atlassian.com/cloud/jira/platform/swagger-v3.v3.json>
- **JI2** — Link work items (default link types; "can be configured by Jira admins") — <https://support.atlassian.com/jira-software-cloud/docs/link-issues/>; Configure work item linking (deactivate; inward/outward descriptions) — <https://support.atlassian.com/jira-cloud-administration/docs/configure-issue-linking/>
- **JI3** — Configure Dependencies in Jira for your plan (administrator only; all links treated as Blocks by default; swap direction) — <https://support.atlassian.com/jira-software-cloud/docs/configure-dependencies-in-jira-for-advanced-roadmaps/>
- **JI4** — Jira Software Cloud REST OpenAPI: `GET /rest/agile/1.0/issue/{issueIdOrKey}` ("include Agile fields, like sprint, closedSprints, flagged, and epic"), `SprintBean.endDate` — <https://developer.atlassian.com/cloud/jira/software/swagger.v3.json>
- **JI5** — Reference work items in your development work (keys in branch names, commits, pull request titles; smart commits admin-enabled) — <https://support.atlassian.com/jira-software-cloud/docs/reference-issues-in-your-development-work/>; JQL developer status (`development[pullrequests].all`/`.open`) — <https://support.atlassian.com/jira-software-cloud/docs/jql-developer-status/>
- **JI6** — `jira-cli` source at `e74646e`: `api/client.go` L30–42 (token from config, `.netrc`, keyring), `internal/cmd/root/root.go` (`JIRA_API_TOKEN`); command list in `internal/cmd/` has no raw API command — <https://github.com/ankitpokhrel/jira-cli/tree/e74646e604c38f0855a71137e1e626b3a0ab8913>
- **JI7** — Atlassian CLI reference: `acli jira auth login` — <https://developer.atlassian.com/cloud/acli/reference/commands/jira-auth-login/>; `acli jira workitem` — <https://developer.atlassian.com/cloud/acli/reference/commands/jira-workitem/>; `acli jira workitem link` — <https://developer.atlassian.com/cloud/acli/reference/commands/jira-workitem-link/>; `link list --json` — <https://developer.atlassian.com/cloud/acli/reference/commands/jira-workitem-link-list/>
- **JI8** — Manage API tokens for your Atlassian account (scoped tokens call `api.atlassian.com/ex/jira/{cloudId}`; expiry one day to one year) — <https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/>
- **JI9** — OAuth 2.0 (3LO) apps (`accessible-resources` with `scopes`; `api.atlassian.com/ex/jira/{cloudid}`) — <https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/>
- **JI10** — What is a Jira space? (work items and work types, formerly issues and issue types; the space key prefixes work item keys) — <https://support.atlassian.com/jira-software-cloud/docs/what-is-a-jira-software-project/>
- **JI11** — Use the Atlassian Project field in Jira ("Atlassian Projects … are different from Jira spaces") — <https://support.atlassian.com/jira-software-cloud/docs/use-the-atlassian-project-field-in-jira/>
- **JI12** — Getting started with the Atlassian Rovo MCP Server — <https://support.atlassian.com/atlassian-rovo-mcp-server/docs/getting-started-with-the-atlassian-remote-mcp-server/>

Linear:

- **LN1** — Linear public GraphQL schema at `3addb24b` (2026-09-16): `Issue` (L17247; `team` "exactly one team", `parent`, `children`, `relations`, `inverseRelations`, `assignee`, `delegate`, `cycle`, `projectMilestone`, `dueDate`, `createdAt`, `attachments`), `IssueRelation` (L20669), `IssueRelationCreateInput` (L20710), `IssueRelationType` (L20772), `IssueSuggestion` (L21982, `[Internal]`), `Attachment` (L4453), `Cycle.endsAt` (L8963), `ProjectMilestone.targetDate` (L35201), `Project` (L33333, "can span multiple teams"), `PullRequest` (L38011, `[Internal]`), `GitLinkKind` (L13633, `[Internal]`), `Team` (L45786; `key`, `parent`), `User` (L48561; `admin`, `guest`, `owner`) — <https://github.com/linear/linear/blob/3addb24bdf771700da1c050742e70e645cc7e36a/packages/sdk/src/schema.graphql>
- **LN2** — Issue relations (shortcuts; "When you reference issues in a description or comment, they'll automatically become a related issue"; resolved blockers move under Related) — <https://linear.app/docs/issue-relations>
- **LN3** — Similar Issues changelog (2023-08-03) — <https://linear.app/changelog/2023-08-03-similar-issues>; Triage Intelligence (suggestions "to accept the relation"; Business and Enterprise) — <https://linear.app/docs/triage-intelligence>
- **LN4** — Linear GraphQL API getting started (endpoint, API key header) — <https://linear.app/developers/graphql>; API and webhooks (API key permissions "Read, Write, Admin, Create issues, Create comments", team limits) — <https://linear.app/docs/api-and-webhooks>
- **LN5** — GitHub integration (linking by branch name, title and magic words; closing vs. non-closing words; status on merge) — <https://linear.app/docs/github>
- **LN6** — Linear MCP server (URLs, OAuth 2.1, Claude Code command) — <https://linear.app/docs/mcp>
- **LN7** — Members and roles (guests act as Members within their teams; Business and Enterprise) — <https://linear.app/docs/members-roles>

Azure Boards:

- **AZ1** — Link types reference (topologies, one Parent, Predecessor semantics, Remote link types, custom types only on Azure DevOps Server, `list-type` attributes) — <https://learn.microsoft.com/en-us/azure/devops/boards/queries/link-type-reference>
- **AZ2** — Clone an existing Git repo (project URL `dev.azure.com/{organization}/{project}`; example clone URL; `visualstudio.com` still supported) — <https://learn.microsoft.com/en-us/azure/devops/repos/git/clone>
- **AZ3** — `az devops` reference (`invoke` GA, `login` with a PAT per organisation, `--detect`; not supported for Azure DevOps Server) — <https://learn.microsoft.com/en-us/cli/azure/devops?view=azure-cli-latest>
- **AZ4** — Complete, abandon, or revert pull requests ("Complete associated work items after merging", `--transition-work-items`) — <https://learn.microsoft.com/en-us/azure/devops/repos/git/complete-pull-requests>
- **AZ5** — List work item fields and attributes (`System.AssignedTo`, `System.CreatedDate`, `System.IterationPath`) — <https://learn.microsoft.com/en-us/azure/devops/boards/work-items/work-item-fields?view=azure-devops>
- **AZ6** — Iterations - List (`attributes.finishDate`) — <https://learn.microsoft.com/en-us/rest/api/azure/devops/work/iterations/list?view=azure-devops-rest-7.1>

[TL]: https://github.com/romtaugranot/issue-map/blob/research/tracker-links/research/tracker-links.md
[HP]: https://github.com/romtaugranot/issue-map/blob/research/home-project/research/home-project.md
[CAP]: https://github.com/romtaugranot/issue-map/blob/research/capabilities/research/capabilities.md
[G7]: https://github.com/romtaugranot/issue-map/issues/7
[G11]: https://github.com/romtaugranot/issue-map/issues/11
[G12]: https://github.com/romtaugranot/issue-map/issues/12
[G13]: https://github.com/romtaugranot/issue-map/issues/13
[G18]: https://github.com/romtaugranot/issue-map/issues/18
[GH1]: https://docs.github.com/en/rest/repos/autolinks
[GL1]: https://docs.gitlab.com/api/project_integrations/
[LV1]: #sources
[GT1]: https://github.com/go-gitea/gitea/blob/8164130349836e75d35471fd056cb449310e5548/modules/structs/repo.go#L20-L49
[GT2]: https://github.com/go-gitea/gitea/blob/8164130349836e75d35471fd056cb449310e5548/services/convert/repository.go#L40-L82
[GT3]: https://github.com/go-gitea/gitea/blob/8164130349836e75d35471fd056cb449310e5548/routers/api/v1/repo/issue_dependency.go
[GT4]: https://github.com/go-gitea/gitea/blob/8164130349836e75d35471fd056cb449310e5548/modules/setting/service.go#L209-L210
[GT5]: https://github.com/go-gitea/gitea/blob/8164130349836e75d35471fd056cb449310e5548/models/issues/issue_update.go#L61-L72
[GT6]: https://github.com/go-gitea/gitea/blob/8164130349836e75d35471fd056cb449310e5548/models/issues/issue_xref.go#L190-L232
[GT7]: https://github.com/go-gitea/gitea/blob/8164130349836e75d35471fd056cb449310e5548/modules/structs/issue_comment.go#L51-L99
[GT8]: https://github.com/go-gitea/gitea/blob/8164130349836e75d35471fd056cb449310e5548/routers/api/v1/api.go
[GT9]: https://github.com/go-gitea/gitea/blob/8164130349836e75d35471fd056cb449310e5548/models/perm/access/repo_permission.go#L159-L164
[GT10]: https://github.com/go-gitea/gitea/blob/8164130349836e75d35471fd056cb449310e5548/modules/structs/issue.go#L49-L86
[GT11]: https://github.com/go-gitea/gitea/blob/8164130349836e75d35471fd056cb449310e5548/CHANGELOG.md
[GT12]: https://codeberg.org/swagger.v1.json
[GT13]: https://gitea.com/gitea/tea/src/commit/9c12138d6273ba8feb6e7578833cc330c0cd6461
[GT14]: https://gitea.com/gitea/tea/releases
[GT15]: https://codeberg.org/forgejo-contrib/forgejo-cli/src/commit/be2a16f5cbbe9df795382607582744c06b86dc5b
[JI1]: https://developer.atlassian.com/cloud/jira/platform/swagger-v3.v3.json
[JI2]: https://support.atlassian.com/jira-software-cloud/docs/link-issues/
[JI3]: https://support.atlassian.com/jira-software-cloud/docs/configure-dependencies-in-jira-for-advanced-roadmaps/
[JI4]: https://developer.atlassian.com/cloud/jira/software/swagger.v3.json
[JI5]: https://support.atlassian.com/jira-software-cloud/docs/reference-issues-in-your-development-work/
[JI6]: https://github.com/ankitpokhrel/jira-cli/tree/e74646e604c38f0855a71137e1e626b3a0ab8913
[JI7]: https://developer.atlassian.com/cloud/acli/reference/commands/jira-workitem-link/
[JI8]: https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/
[JI9]: https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/
[JI10]: https://support.atlassian.com/jira-software-cloud/docs/what-is-a-jira-software-project/
[JI11]: https://support.atlassian.com/jira-software-cloud/docs/use-the-atlassian-project-field-in-jira/
[JI12]: https://support.atlassian.com/atlassian-rovo-mcp-server/docs/getting-started-with-the-atlassian-remote-mcp-server/
[LN1]: https://github.com/linear/linear/blob/3addb24bdf771700da1c050742e70e645cc7e36a/packages/sdk/src/schema.graphql
[LN2]: https://linear.app/docs/issue-relations
[LN3]: https://linear.app/changelog/2023-08-03-similar-issues
[LN4]: https://linear.app/docs/api-and-webhooks
[LN5]: https://linear.app/docs/github
[LN6]: https://linear.app/docs/mcp
[LN7]: https://linear.app/docs/members-roles
[AZ1]: https://learn.microsoft.com/en-us/azure/devops/boards/queries/link-type-reference
[AZ2]: https://learn.microsoft.com/en-us/azure/devops/repos/git/clone
[AZ3]: https://learn.microsoft.com/en-us/cli/azure/devops?view=azure-cli-latest
[AZ4]: https://learn.microsoft.com/en-us/azure/devops/repos/git/complete-pull-requests
[AZ5]: https://learn.microsoft.com/en-us/azure/devops/boards/work-items/work-item-fields?view=azure-devops
[AZ6]: https://learn.microsoft.com/en-us/rest/api/azure/devops/work/iterations/list?view=azure-devops-rest-7.1
