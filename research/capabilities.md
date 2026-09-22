# What the Map can detect and write: Blocks support, Link writes and write access

Research note for three questions. First, how can a login without admin rights tell whether a Project can record Blocks Links (and epics)? Second, which API call writes each kind of Link, on which deployment and from which version, and do `gh` and `glab` have a native command for it? Third, how can the plugin tell whether the login can write Links without trying a write? Terms follow [`CONTEXT.md`](../CONTEXT.md).

Researched 2026-09-22. Sources were read at these snapshots:

- GitLab source and docs at `master` commit `b64a7e48` (`19.5.0-pre`). Older behaviour comes from the same files at release tags (`vX.Y.0-ee`), named with each claim.
- `gh` at commit `5e5cd85e` (after v2.101.0), `glab` at commit `a2be5a12` (latest release v1.118.0), and GitHub's docs source at commit `1d0d9a86` (2026-09-21).

Live checks were read-only and used public Projects only: anonymous GraphQL and REST on gitlab.com and on two public self-managed GitLab instances, and `gh api` on github.com ([LV1]–[LV3]). **Nothing was written to any Tracker**, so what happens on a write comes from source and docs only. Facts that the earlier notes settle are cited rather than re-checked: [TL] (how Trackers record Links) and [HP] (finding the Home Project's Tracker).

## Short answer

- **GitLab EE without the licence answers the Blocks fields with empty values, not errors.** `blocked` is `false`, the counts are `0`, and `blockedByIssues` and `linkedItems(filter: BLOCKED_BY)` are empty. These reads count stored rows and never check the licence. So **a Free Project on an EE build looks exactly like a licensed Project with no Blocks Links** (seen live). On CE these fields don't exist, so asking for them is a query error.
- **On recent GitLab a normal login can ask about the licence directly**, even anonymously on public Projects:
  - `availableFeatures.hasBlockedIssuesFeature` on the Project's namespace (18.3+, CE and EE)
  - `Project.licensedFeatureAvailability` (EE, 18.11+)
  - `WorkItemPermissions.blockedWorkItems` (EE, 17.10+)

  Older EE versions have only a proxy: REST includes an Issue's `weight` key only where the Blocks tier is licensed. The plan name needs the Owner role, and on gitlab.com it misleads anyway, because public Projects in Free groups can have the features. Epics work the same way: `hasEpicsFeature` and `hasSubepicsFeature` from 18.1, and the REST `epic` key before that.
- **Writing:**
  - **GitHub:** Parent through `addSubIssue`, on every supported GHES release. REST works only on github.com and GHEC. Blocks through `addBlockedBy` or REST, on GHES from 3.19. There is no Related Link. `gh` has native flags from v2.94.0.
  - **GitLab:**
    - Related through REST links (Free from 13.4) or `workItemAddLinkedItems` (on by default from 16.7, GA in 17.0).
    - Blocks through the same calls with `blocks`, which needs Premium.
    - Issue → task only through GraphQL `hierarchyWidget` (15.2+).
    - Epic → Issue through REST `epic_id` or `hierarchyWidget` (Premium).
  - `glab` can link Issues only in `issue create`. Everything else needs `glab api`.
- **Write access:**
  - **GitHub** needs the triage role, which `permissions.triage` and `viewerPermission` show. It also needs a token that can write. A classic or OAuth token lists its scopes in `X-OAuth-Scopes`, but **a fine-grained token's grants can't be read** without trying a write.
  - **GitLab** needs Guest membership: from 17.0 for Links, from 17.2 for task parents, and Reporter before those versions. Per-Issue `userPermissions` show the role but ignore the token's scope. `GET /personal_access_tokens/self` (15.5+) shows whether the token has the `api` scope.

## A. GitLab: can this Project record Blocks Links and epics?

### What the Blocks fields return, by build and licence

| Where | `Issue { blocked blockedByCount blockingCount blockedByIssues }` | `WorkItemWidgetLinkedItems { blocked blockedByCount blockingCount linkedItems(filter: BLOCKED_BY) }` | Writing a Blocks Link |
|---|---|---|---|
| **CE**, any version | The fields don't exist, so the query fails validation [TL] | `BLOCKED_BY`/`BLOCKS` are not in the CE enum, which has only `RELATED`, so the query fails validation [GL5] | REST: 400, since `link_type` accepts only `relates_to`. GraphQL: validation error [TL] [GL5] |
| **EE without the licence** (self-managed without a licence; gitlab.com Free) | `false`, `0`, `0`, empty. **No error** | `false`, `0`, `0`, empty. **No error** | REST: 403 "Blocked issues not available for current license". GraphQL: 403-style error "Blocked work items are not available for the current subscription tier" [GL6] |
| **EE licensed** (Premium/Ultimate; gitlab.com Bronze, Premium, Ultimate, trials, open source) | Real values | Real values | Allowed |

**Why EE without the licence reads as empty.** None of the read paths checks the licence:

- `blocked` and `blockedByCount` go through `LazyLinksAggregate`, which counts `blocks` rows in `issue_links`.
- `blockedByIssues` returns the Issues behind those rows.
- The linked-items resolver calls `WorkItem.linked_items_for`, which EE extends with a plain `blocks` join.

Only the write paths check the licence: `feature_available?(:blocked_issues)` for REST and `licensed_feature_available?(:blocked_work_items)` for GraphQL [GL4] [GL6].

Two consequences follow:

1. **A Free Project on EE is indistinguishable from a licensed one with no Blocks Links** if you only read Links. Checked live on gitlab.com:
   - `sequoia-pgp/sequoia` (Free) returned `blocked: false`, zero counts and empty lists.
   - `gitlab-org/gitlab` (Ultimate) returned exactly the same for its open Issues with no blockers.

   Only the licence fields below told them apart [LV1].
2. **The reverse also holds, by the same source reading.** Take a Project whose licence lapsed, or a gitlab.com namespace that was downgraded. It still reads back the Blocks Links it recorded while licensed, but it can't record new ones. So having Blocks Links does not prove the Project can record them. No such Project turned up in a scan of 6 public Free gitlab.com Projects (240 work items each; only `relates_to` Links) [LV1], so this is untested.

### Fields a normal (non-admin) login can read

| # | Field | Build | From | What it answers | Notes |
|---|---|---|---|---|---|
| 1 | `namespace(fullPath: "group/project") { availableFeatures { hasBlockedIssuesFeature } }` | CE and EE | 18.3 (both `availableFeatures` and this flag) | Whether this Project can record Blocks Links | The type lives in CE code, and CE always answers `false`. A Project path resolves to the Project's own namespace (`Namespaces::ProjectNamespace`), which asks the Project, so it includes the gitlab.com public-Project grant below. Marked Experiment. Worked anonymously [GL1] [GL8] [LV1] |
| 2 | Same type: `hasEpicsFeature`, `hasSubepicsFeature`, `hasLinkedItemsEpicsFeature`, `hasOkrsFeature` | CE and EE | 18.1, on `licensedFeatures`; `availableFeatures` from 18.3, and `licensedFeatures` is kept until the frontend moves over | Epics, multi-level epics, Links to epics, OKRs | 18.1 and 18.2 have no Blocks flag [GL1] |
| 3 | `project(fullPath:) { licensedFeatureAvailability(feature: BLOCKED_ISSUES) { available requiredPlan } }` (also on `Namespace`) | EE only | 18.11 | Any licensed feature. `requiredPlan` names the lowest tier: `starter` for Blocks, `premium` for `EPICS`, `ultimate` for `SUBEPICS` | Marked Experiment. Not in the CE schema [GL2] [LV1] |
| 4 | `workItem { userPermissions { blockedWorkItems } }` | EE only | 17.10 | Whether Blocks Links between work items are licensed here | Needs a work item to ask on, so the Project must have at least one Issue [GL3] |
| 5 | `group(fullPath:) { epicsEnabled }` | EE only | 17.5, and deprecated in the same release | Whether epics are licensed on the group | [GL11] |
| 6 | `namespace { workItemTypes { widgetDefinitions { … on WorkItemWidgetDefinitionHierarchy { allowedParentTypes allowedChildTypes } } } }` | CE and EE | Licence-filtered from 17.9; the fields exist from 16.x | Epics: Issue lists Epic as a parent only where epics are licensed. Epic lists Epic as a child only where multi-level epics are licensed | Live on an Ultimate group (`gitlab-org`), a Premium group (`LinaroLtd`) and a Free group (`sequoia-pgp`), all as expected, with one quirk: on the Free group, Ticket still listed Epic as a parent. Tells nothing about Blocks, because the linked-items widget isn't a licensed widget [GL12] [LV1] |
| 7 | REST `GET /projects/:id/issues` → key `weight` present or absent | EE only | Checked at 13.8, 14.0, 16.0 and today | Present only where `issue_weights` is licensed. That feature has shared a tier with Blocks since 12.8: `issue_weights` with `related_issues` in 12.8–13.2, then with `blocked_issues` from 13.3. So it works as a **proxy for Blocks** | A proxy, not a statement. Absent on incidents. Live: absent on `sequoia-pgp/sequoia`, present (as `null`) on `gitlab-org/gitlab` [GL7] [GL10] [LV1] |
| 8 | REST Issue keys `epic` / `epic_iid` present or absent | EE only | Same | Present only when the Project sits in a group that has epics licensed | Proxy for epics [GL10] |

These don't answer the question:

- **The plan name.** REST `/namespaces/:id` exposes `plan` and `trial` only to users with `admin_namespace` (the group Owner). GraphQL `Namespace.plan` (18.2) has the same guard [GL9].
- **`/version` and `/metadata`.** They give the edition (`enterprise`), not the licence [HP].
- **The REST Issue key `blocking_issues_count`.** It is present on every EE build, licensed or not, so it identifies EE only [LV1].
- **GraphQL introspection.** It shows the build's schema, never the licence. It is also heavy: 7.6–8.2 MB. From 18.9 it is served from a static file shipped with the package [GL13]. Anonymous introspection on salsa.debian.org and gitlab.gnome.org returned schemas with the EE Blocks fields [LV3]. That shows the fields exist there; it says nothing about their licence.

### gitlab.com: plans, and why to ask the Project rather than the group

- **Which plans carry which feature:**
  - Blocks: Bronze (legacy), Premium, Ultimate, both trials and the open-source plan.
  - Epics: Premium and up.
  - Multi-level epics: Ultimate, the Ultimate trials and open source.

  Source: [GL7].
- **Public Projects can have the features while their group doesn't.** On gitlab.com, a public Project in a public namespace also gets licensed features when its project setting `legacy_open_source_license_available` is on [GL8]. This is visible live. Of 18 public Projects that reported Blocks, 4 sat in top-level groups that reported none. And 37 of 50 recently active public group Projects reported every feature [LV1]. **Ask the Project** (row 1 or 3 above), not its group and not the plan.

### Epics and multi-level epics

- Epics belong to groups, so ask the Project's group: rows 2, 3 and 5, and row 8 on older versions. A Project in a personal namespace has no epics at all. CE has no epic type, because Epic is one of the EE-only base types [GL12].
- On EE, reading an epic needs the epics licence. `IssuePolicy` prevents everything on an epic work item where epics aren't licensed. So the epic parents of an unlicensed group read as **absent, not as an error**, the same trap as with Blocks [GL14].
- Multi-level epics: `hasSubepicsFeature` (18.1+), `licensedFeatureAvailability(feature: SUBEPICS)` (18.11+), or whether Epic lists Epic among its allowed children (row 6, 17.9+). Before those versions no REST proxy for Ultimate was found. Today `health_status` is the REST key gated on an Ultimate feature, but its tier history wasn't checked.

## B. Writing each Link kind

| Link kind | Deployment | Call | From | Tier | Native CLI |
|---|---|---|---|---|---|
| **Parent** (sub-issue) | github.com, GHEC | REST `POST /repos/{o}/{r}/issues/{n}/sub_issues` with `sub_issue_id` (the child's `id`, not its number) and `replace_parent`. GraphQL `addSubIssue(input: {issueId, subIssueId \| subIssueUrl, replaceParent})`; `createIssue(input: {parentIssueId})` | GraphQL mutation 2024-12-02; GA 2025-04-09 [TL] | All plans | `gh` ≥ v2.94.0 (2026-06-10): `gh issue create --parent`, `gh issue edit --parent / --remove-parent / --add-sub-issue / --remove-sub-issue` |
| **Parent** | GHES | GraphQL only: `addSubIssue` and `createIssue(parentIssueId)`, present in every supported schema from 3.17 to 3.22. There is no REST path | 3.17 (user docs from 3.18) [TL] | — | Same `gh` flags. `gh` assumes every supported GHES release has sub-issues |
| **Blocks** | github.com, GHEC | REST `POST /repos/{o}/{r}/issues/{n}/dependencies/blocked_by` with `issue_id` (the blocker's `id`). GraphQL `addBlockedBy(input: {issueId, blockingIssueId})` | GraphQL mutation 2025-07-30; GA 2025-08-21 [TL] | All plans | `gh issue create --blocked-by / --blocking`, `gh issue edit --add-blocked-by / --add-blocking` (and `--remove-…`) |
| **Blocks** | GHES | Same REST and GraphQL calls | 3.19 | — | Same flags. `gh` introspects `Issue.blockedBy` only in `issue view`. On an older GHES release the create and edit flags still send `addBlockedBy`, which that schema doesn't have |
| **Related** | GitHub | None. GitHub has no Related Link [TL] | — | — | — |
| **Related** | GitLab, all builds including CE | REST `POST /projects/:id/issues/:iid/links` with `target_project_id`, `target_issue_iid` and `link_type: relates_to` | Free and CE from 13.4; Starter from 9.4 [TL] | Free | `glab issue create --linked-issues <iids> --link-type relates_to`, for new Issues only |
| **Related** | GitLab | GraphQL `workItemAddLinkedItems(input: {id, workItemsIds, linkType: RELATED})`, at most 10 per call | 16.3 behind the `linked_work_items` flag (off by default), on by default from 16.7, flag removed in 17.0. Still labelled Experiment | Free | None; use `glab api graphql` |
| **Blocks** | GitLab EE, licensed | The same two calls with `link_type: blocks \| is_blocked_by` or `linkType: BLOCKS \| BLOCKED_BY`. `is_blocked_by` is stored as `blocks` with the ends swapped [TL] | REST parameter 12.7 behind a flag [GL14], 12.8 [TL]; GraphQL as above | Premium | `glab issue create --link-type blocks \| is_blocked_by` |
| **Parent**: Issue → task | GitLab, all builds including CE | GraphQL `workItemUpdate(input: {id: <task>, hierarchyWidget: {parentId: <issue>}})`, or `hierarchyWidget: {childrenIds}` on the parent; `workItemCreate(… hierarchyWidget: {parentId})`; `workItemHierarchyAddChildrenItems` (18.2, Experiment). **No REST path** | 15.2 (tasks on by default from 15.3) | Free | None; use `glab api graphql` |
| **Parent**: epic → Issue | GitLab EE, licensed | REST `PUT /projects/:id/issues/:iid` with `epic_id` (also accepted on create). REST `POST /groups/:id/epics/:epic_iid/issues/:issue_id` (deprecated in 17.0, still served, no removal date). GraphQL `epicAddIssue` (deprecated in 17.5). GraphQL `workItemUpdate(hierarchyWidget: {parentId: <epic work item>})` | The REST calls were already present at 10.5 and 12.10, older than any version the Map targets. Epics as work items: 17.2 behind a flag, on by default on self-managed from 17.7, GA in 18.1 | Premium | `glab issue create --epic <id>`, for new Issues only |
| **Parent**: epic → epic | GitLab EE, licensed | `hierarchyWidget`, or the deprecated epic-links REST API [TL] | — | Ultimate | None |

Notes:

- **GitHub allows one parent per Issue.** Adding a child that already has a parent needs `replace_parent` / `replaceParent: true`. `gh issue edit --parent` and `--add-sub-issue` always pass `true`, so they silently move an Issue away from its current parent [GH3] [CLI1]. Sub-issues must share the parent's repository owner; dependencies can cross owners [TL].
- **`gh`'s flags are thin wrappers.** They resolve numbers or URLs to node IDs and call the GraphQL mutations above [CLI1]. Before v2.94.0, write through `gh api` [CLI2].
- **`glab` has no command that links existing Issues.** `glab issue update` and `glab work-items update` have no flags for Links, parents or epics, and `glab issue create --linked-issues` runs REST issue links only after creating the Issue [CLI3]. So anything else goes through `glab api` (REST) or `glab api graphql`.
- **GitLab errors by build:**
  - CE rejects Blocks with a 400 (REST) or a validation error (GraphQL).
  - EE without the licence rejects it with a 403-style message.
  - A Link that already exists gives 409 (REST) [GL6] [GL14].

## C. Can this login write Links?

### GitHub

**Role.** Sub-issues and dependencies both need at least **triage** on the repository [GH1] [GH2]. Three fields show it without a write:

- REST `GET /repos/{o}/{r}` returns `permissions {admin, maintain, push, triage, pull}` for the authenticated user.
- GraphQL `Repository.viewerPermission` returns `READ`, `TRIAGE`, `WRITE`, `MAINTAIN` or `ADMIN`. It is `null` for a GitHub App [GH6].
- On github.com and GHEC only, `Issue.viewerCanUpdateMetadata` (added 2026-07-16) checks for "triage-level (or higher) access". It "reflects the viewer's base repository role and does not account for individual fine-grained permissions granted via custom repository roles". Every GHES schema lacks it [GH6] [GH7].

`Issue.viewerCanUpdate` is the wrong check, because it is about editing the Issue itself. Live, with a login that has no role on `cli/cli`: `permissions` showed `pull` only, `viewerPermission` was `READ`, `viewerCanUpdateMetadata` was `false` and `viewerCannotUpdateReasons` was `INSUFFICIENT_ACCESS` [LV2].

**Token.**

- **Fine-grained tokens** need `Issues: write` for both POST endpoints; the GET endpoints need `Issues: read` [GH5].
- **Classic and OAuth tokens** list their scopes in `X-OAuth-Scopes` [GH9]. `repo` covers writing. Live, `gh`'s OAuth login returned the header, and the issue endpoint asked for `X-Accepted-OAuth-Scopes: repo` [LV2].
- **Fine-grained and GitHub App tokens** have no header or endpoint that lists what they were granted. `X-Accepted-GitHub-Permissions` names what the called endpoint *needs*, not what the token *has* [GH8]. `gh` itself treats an empty `X-OAuth-Scopes` as "an integration token" and skips its scope check [CLI1]. The token's prefix (`github_pat_`, `ghp_`, `gho_`, `ghu_`, `ghs_`) tells what kind of token it is [CLI1], but not its grants.

**So on GitHub, a fine-grained token with only `Issues: read` can't be told apart from one with `Issues: write` without trying a write.** The failure is a 403, "Resource not accessible by personal access token" [GH8].

### GitLab

**Role, per kind of write and version.** Non-members can't write Links even on a public Project, because both policies require membership [GL14] [GL15]. The Planner role (17.7+) sits above Guest and can do everything below.

| Write | Ability | Minimum role |
|---|---|---|
| REST issue links (Related, Blocks) | `admin_issue_link` | Reporter up to 16.11; any member (Guest+) from 17.0. Docs: a role in **both** Projects [GL14] [GL22] |
| GraphQL linked items | `admin_work_item_link` | Any member who can read the item, since 16.3 [GL15] |
| Task parent (and other `hierarchyWidget` parents) | `admin_parent_link` | Reporter up to 17.1; any member who can read the item from 17.2 [GL15] |
| Issue → epic | `admin_issue_relation` + `read_epic` | Guest on the Issue's Project from 15.8 (Reporter before). Current docs need no role in the epic's group [GL16] [GL22] |

**Reading the role without a write:**

- **Per Issue.** `workItem(id:) { userPermissions { adminWorkItemLink adminParentLink } }`: `adminParentLink` since 15.11, `adminWorkItemLink` since 16.4. `Issue.userPermissions.adminIssueRelation` is the one EE checks, together with `read_epic`, before adding an Issue to an epic. `setWorkItemMetadata` (16.0) is Planner-level metadata that Links don't need [GL16] [GL19]. In 16.4–16.11 a Guest sees `adminWorkItemLink: true` although the REST links call still needs Reporter, so on those versions write through GraphQL.
- **Per Project.** GraphQL `Project.maxAccessLevel { integerValue stringValue }` (16.9) is the effective maximum. Guest is 10, Planner 15, Reporter 20. REST `GET /projects/:id` returns `permissions.project_access` (direct membership) and `group_access` (the highest level in the ancestor groups). These miss access that comes through a shared group [GL20].
- **None of these reflect the token.** Permission fields resolve as `Ability.allowed?(current_user, ability, object)`, with no look at the token's scope [GL19]. A member using a `read_api` token still sees `adminWorkItemLink: true`.

**Reading the token.** `read_api` "grants read access"; writing needs `api` [GL21].

- `GET /personal_access_tokens/self` (15.5+) accepts a token of any scope and returns its `scopes`. From 19.2 it also returns `granular_scopes` for fine-grained tokens. It answers 400 unless the token is a personal access token [GL21].
- OAuth tokens: `GET /oauth/token/info` returns `scope` [GL21].
- `glab`'s own logins, personal token or OAuth, carry `api` [HP]. CI job tokens can't touch Issues [HP].

## What this means for the Map

| Deployment | (1) Can Blocks-recordability be detected reliably? | (2) Link kinds it can write, from | (3) How write access is detected |
|---|---|---|---|
| **github.com, GHEC** | Yes: every plan records Blocks | Parent (REST and GraphQL) and Blocks (REST and GraphQL); no Related. Natively with `gh` ≥ 2.94.0, otherwise `gh api` | Role: `permissions.triage`, `viewerPermission` ≥ `TRIAGE`, or `viewerCanUpdateMetadata`. Token: `X-OAuth-Scopes` for classic and OAuth tokens. **Fine-grained: not detectable**; offer the write and handle a 403 |
| **GHES** | Yes: 3.19+ records Blocks. Read `installed_version` from the anonymous `/api/v3/meta` [HP], or check for `Issue.blockedBy` in the schema as `gh` does | Parent through GraphQL only (3.17+); Blocks from 3.19 (REST and GraphQL) | As above, without `viewerCanUpdateMetadata` |
| **GitLab CE** | Yes: CE can never record Blocks. `enterprise: false` from `/version` or `/metadata` (needs a token), or `hasBlockedIssuesFeature: false` (18.3+) | Related (REST 13.4+; GraphQL on by default from 16.7, GA 17.0); Issue → task (GraphQL 15.2+). No Blocks, no epics | Role fields (C) plus `/personal_access_tokens/self` |
| **GitLab EE self-managed, 18.3+** | Yes: `hasBlockedIssuesFeature` on the Project's namespace (anonymous for public Projects); also `licensedFeatureAvailability` from 18.11 | CE's kinds, plus Blocks (Premium) and epic → Issue (Premium; `hierarchyWidget` from 18.1 GA, or REST `epic_id`) | Same |
| **GitLab EE, 17.10–18.2** | Yes if the Project has at least one Issue: `userPermissions.blockedWorkItems` | Same | Same |
| **GitLab EE, before 17.10** | Only through a proxy: the REST `weight` key (same tier since 12.8). Otherwise unknown. **Never read "no Blocks Links" as "can't record them"** | Same kinds; the older role rules apply (Reporter for REST links before 17.0, and for task parents before 17.2) | Same; `maxAccessLevel` from 16.9, otherwise REST `permissions` |
| **gitlab.com** | Yes: as EE 19.x, **asked of the Project** (row 1 or 3 in A), not of its group or plan | Free: Related, Issue → task. Premium: + Blocks and epics. Ultimate: + multi-level epics | Same |

What follows for the design:

- **"A Project that can record Blocks Links", which the glossary's Unblocked depends on, is detectable almost everywhere.** The gap is EE before 17.10, where the Map either trusts the `weight` proxy or says it doesn't know. Recorded Blocks Links don't prove the Project can still record them, because the licence may have lapsed.
- **ADR 0002's "a login that can't write" has a third state on GitHub: can't tell.** For fine-grained tokens the Map has to offer the write and handle a 403. On GitLab both halves are readable: the role from `userPermissions` or `maxAccessLevel`, the token from `/personal_access_tokens/self`.
- **On GitLab, writing through GraphQL covers every kind.** Task parents and work-item epics have no REST path, and `glab` has no native command for them, so the plugin will call `glab api graphql` for most writes. Before 16.7 the linked-items mutation is behind a flag that is off by default, so Related and Blocks writes on older instances need REST.
- **On GitHub, `gh` ≥ 2.94.0 covers every writable kind natively.** Its `replaceParent: true` default can move an Issue from its current parent. The Map should check `parent` first and ask before moving.

## Open questions

- **GitHub, across repositories.** When the child or the blocker is in another repository, which permission is needed on that repository? The docs state triage only for "a repository" [GH1] [GH2]. This can't be settled without a write.
- **GitHub, fine-grained tokens and roles.** Do `permissions`, `viewerPermission` and `viewerCanUpdateMetadata` reflect a fine-grained token's own limits, or only the user's role? No such token was available to check, and none was created.
- **GitHub, `public_repo`.** Is a classic token's `public_repo` scope enough for sub-issues and dependencies on public Projects? The endpoint docs list only the fine-grained permission.
- **GitLab, project and group access tokens.** Does `GET /personal_access_tokens/self` answer for them? It requires the token type to be `PersonalAccessToken`, and whether these tokens count as one wasn't checked.
- **`glab issue create --linked-issues`** sends `target_project_id` as `null` [CLI3]. Whether current GitLab accepts that wasn't checked.
- **Quick actions as a write path.** `/relate`, `/blocks` and `/set_parent` posted as a note (for example with `glab issue note`) could write Links without `glab api` [TL]. How the Notes API reports the result, and what the note leaves behind, wasn't checked.
- **Tier history of `health_status`.** It would be an Ultimate proxy for multi-level epics before 18.1 only if it has always been Ultimate. This wasn't checked.

## Sources

Earlier notes:

- **TL** — How Trackers record Links between Issues — <https://github.com/romtaugranot/issue-map/blob/research/tracker-links/research/tracker-links.md>
- **HP** — Finding the Home Project's Tracker from a local checkout — <https://github.com/romtaugranot/issue-map/blob/research/home-project/research/home-project.md>

Live checks, read-only, 2026-09-22:

- **LV1** — gitlab.com, anonymous:
  - GraphQL `namespace(fullPath:)` with `availableFeatures` / `licensedFeatures` on `gitlab-org/gitlab` (a `Namespaces::ProjectNamespace`, all `true`), `sequoia-pgp/sequoia` (all `false`), the groups `gitlab-org`, `LinaroLtd` (Blocks and epics without sub-epics) and `sequoia-pgp`, with their `workItemTypes` hierarchy definitions.
  - `project.licensedFeatureAvailability` on `gitlab-org/gitlab` (`starter`/`premium`/`ultimate`, all available) and `sequoia-pgp/sequoia` (not available).
  - EE Blocks fields and `userPermissions` on open Issues of both Projects.
  - REST `/projects/:id/issues` keys (`weight`, `epic_iid`, `blocking_issues_count`) on both.
  - Samples of public group Projects: 50 recently active, 71 most-starred, and 18 compared at Project and group level.
  - A scan of 6 Free Projects (`sequoia-pgp/sequoia`, `gitterHQ/webapp`, `volian/nala`, `commento/commento`, `ClearURLs/ClearUrls`, `Isleward/isleward`), 240 work items each, for stored Link types.
- **LV2** — github.com through `gh api` with an OAuth login that has no role on `cli/cli`:
  - `repos/cli/cli` headers and `permissions`.
  - GraphQL `viewerPermission` and `Issue` `viewerCan*` fields on `cli/cli#12438`.
  - Headers of `cli/cli#12438` and its sub-issue and blocked-by list endpoints. The OAuth token got `X-OAuth-Scopes`; `X-Accepted-OAuth-Scopes` was `repo` on the Issue and empty on both lists; `X-Accepted-GitHub-Permissions` was absent.
  - `cli/cli` release notes.
- **LV3** — salsa.debian.org and gitlab.gnome.org, anonymous GraphQL introspection (served as the full schema, 7.6 MB each).

GitLab (source at <https://gitlab.com/gitlab-org/gitlab/-/tree/b64a7e488809e53ff3e5c157a824f646d33c4b24>; "at vX.Y" means the same path at tag `vX.Y.0-ee`):

- **GL1** — `app/graphql/types/namespaces/available_features_type.rb`, `app/graphql/types/namespace_type.rb`. `licensedFeatures` absent at 18.0 and present at 18.1. `availableFeatures` and `hasBlockedIssuesFeature` absent at 18.2 and present at 18.3. At 18.1 the type was `licensed_features_type.rb`, with epic flags and no Blocks flag.
- **GL2** — `ee/app/graphql/ee/types/project_type.rb`, `ee/app/graphql/ee/types/namespace_type.rb`, `ee/app/graphql/types/concerns/gitlab_subscriptions/licensed_feature_availability.rb`, `ee/app/graphql/types/gitlab_subscriptions/licensed_feature_enum.rb`. `licensedFeatureAvailability` absent at 18.10 and present at 18.11.
- **GL3** — `ee/app/graphql/ee/types/permission_types/work_item.rb` (`blocked_work_items`). The file is absent at 17.9 and present at 17.10.
- **GL4** — Blocks reads without a licence check: `ee/app/graphql/ee/types/issue_type.rb`, `ee/app/graphql/ee/types/work_items/widgets/linked_items_type.rb`, `ee/lib/gitlab/graphql/aggregations/issuables/lazy_links_aggregate.rb`, `app/graphql/resolvers/work_items/linked_items_resolver.rb`, `app/models/work_item.rb`, `ee/app/models/ee/work_item.rb`, `ee/app/models/ee/issue.rb`.
- **GL5** — `app/graphql/types/work_items/related_link_type_enum.rb` (CE: `RELATED`) and `ee/app/graphql/ee/types/work_items/related_link_type_enum.rb` (EE adds `BLOCKED_BY`, `BLOCKS`; present at 16.3).
- **GL6** — Licence checks on write: `ee/app/services/ee/issue_links/create_service.rb`, `ee/app/services/ee/work_items/related_work_item_links/create_service.rb`, `app/services/issuable_links/create_service.rb` (403/404/409).
- **GL7** — `ee/app/models/gitlab_subscriptions/features.rb` (tiers; `LICENSE_PLANS_TO_SAAS_PLANS`); `ee/app/models/license.rb` at 12.8 and 13.0 (`issue_weights` and `related_issues` in `EES_FEATURES`) and at 13.3 (`blocked_issues` in `EES_FEATURES`); `features.rb` at 15.0 and 16.0 (`blocked_issues`, `issue_weights` in `STARTER_FEATURES`; `blocked_work_items` from 16.3).
- **GL8** — `ee/app/models/ee/project.rb` (`load_licensed_feature_available`, `open_source_license_granted?`), `ee/app/models/ee/namespaces/project_namespace.rb`, `ee/app/models/ee/namespace.rb`; CE `false` in `app/models/namespace.rb` and `app/models/project.rb`.
- **GL9** — `ee/lib/ee/api/entities/namespace.rb` (`plan` if `admin_namespace`); `ee/app/graphql/ee/types/namespace_type.rb` (`plan`, `authorize: :admin_namespace`, 18.2); Namespaces API — <https://docs.gitlab.com/api/namespaces/>.
- **GL10** — `ee/lib/ee/api/entities/issue_basic.rb` (`weight` if `weight_available?`; `blocking_issues_count`), `ee/lib/ee/api/entities/issue.rb` (`epic`, `epic_iid`, `health_status` gating); same gating at 13.8, 14.0 and 16.0.
- **GL11** — `ee/app/graphql/ee/types/group_type.rb` (`epics_enabled`): absent at 17.4, present and deprecated at 17.5.
- **GL12** — `app/graphql/types/work_items/widget_definitions/hierarchy_type.rb` (`authorize: true` absent at 17.8, present at 17.9); `app/models/work_items/types_framework/system_defined/definitions/issue.rb` (`licenses_for_parent`); `ee/app/models/work_items/types_framework/system_defined/definitions/epic.rb`; `ee/app/models/ee/work_items/types_framework/system_defined/type.rb` (EE base types); `ee/app/models/ee/work_items/types_framework/system_defined/widget_definition.rb` (`WIDGETS_WITH_LICENSE`, no linked items).
- **GL13** — `app/controllers/graphql_controller.rb` (`load_static_schema`): absent at 18.8, present at 18.9.
- **GL14** — `lib/api/issue_links.rb` (and `ee/lib/api/issue_links.rb` at 12.7, where `link_type` sat behind the `issue_link_types` flag), `app/services/issue_links/create_service.rb`, `app/policies/issue_policy.rb`, `config/authz/roles/guest.yml`; `app/policies/project_policy.rb` at 16.11 (`admin_issue_link` under `reporter_access`) and `issue_policy.rb` at 17.0 (guest, project member).
- **GL15** — `app/policies/work_item_policy.rb`: `admin_work_item_link` for members at 16.3; `admin_parent_link` under `reporter_access` at 17.1 and for members at 17.2.
- **GL16** — Epic writes: `ee/lib/api/epic_issues.rb` (present at 10.5), `ee/lib/ee/api/helpers/issues_helpers.rb` (`epic_id`, present at 12.10), `ee/app/services/ee/issues/base_service.rb` (`read_epic` + `admin_issue_relation`), `ee/app/graphql/mutations/epics/add_issue.rb` (present at 12.10); Epic Issues API — <https://docs.gitlab.com/api/epic_issues/>; Migrate epic APIs to work items — <https://docs.gitlab.com/api/graphql/epic_work_items_api_migration_guide/>.
- **GL17** — Linked-items mutation: `app/graphql/mutations/work_items/linked_items/add.rb` and `base.rb` (present at 16.3; flag check until 16.11, gone at 17.0); `config/feature_flags/development/linked_work_items.yml` (`default_enabled: false` at 16.6, `true` at 16.7).
- **GL18** — Hierarchy writes: `app/graphql/mutations/work_items/update.rb`, `create.rb`, `app/graphql/types/work_items/widgets/hierarchy_update_input_type.rb`, and at 15.2 `app/graphql/mutations/concerns/mutations/work_items/update_arguments.rb` (`hierarchy_widget` and the input type absent at 15.1, present at 15.2).
- **GL19** — `app/graphql/types/permission_types/base_permission_type.rb`, `work_item.rb` (`admin_parent_link` present at 15.11, `set_work_item_metadata` at 16.0, `admin_work_item_link` at 16.4), `issue.rb` (`admin_issue_relation`).
- **GL20** — `app/graphql/types/project_type.rb` (`max_access_level`: absent at 16.8, present at 16.9); `lib/api/entities/project_with_access.rb`.
- **GL21** — `lib/api/personal_access_tokens/self_information.rb` (absent at 15.4, present at 15.5); Personal access tokens API — <https://docs.gitlab.com/api/personal_access_tokens/>; OAuth 2.0 token info — <https://docs.gitlab.com/api/oauth2/>; Token scopes — <https://docs.gitlab.com/security/tokens/access_token_scopes/>.
- **GL22** — User docs: Linked issues (Guest from 17.0) — <https://docs.gitlab.com/user/project/issues/related_issues/>; Tasks — <https://docs.gitlab.com/user/tasks/>; Child items — <https://docs.gitlab.com/user/work_items/child_items/>; Manage epics at 16.11 (Guest from 15.8) — <https://gitlab.com/gitlab-org/gitlab/-/blob/v16.11.0-ee/doc/user/group/epics/manage_epics.md>; GraphQL reference (`workItemAddLinkedItems` 16.3 Experiment, `workItemHierarchyAddChildrenItems` 18.2, `epicAddIssue` deprecated 17.5) — <https://docs.gitlab.com/api/graphql/reference/>.

GitHub (docs source at <https://github.com/github/docs/tree/1d0d9a86ebdba79d8a290f81a086727dc2d815f3>):

- **GH1** — Adding sub-issues ("People with at least triage permissions") — <https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues>
- **GH2** — Creating issue dependencies ("at least triage permissions") — <https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-issue-dependencies>
- **GH3** — REST sub-issues (`sub_issue_id`, `replace_parent`, same owner; `Issues: write`) — <https://docs.github.com/en/rest/issues/sub-issues>
- **GH4** — REST issue dependencies (`issue_id`; `Issues: write`) — <https://docs.github.com/en/rest/issues/issue-dependencies>
- **GH5** — Fine-grained token permissions per endpoint: `src/github-apps/data/{fpt,ghes-3.19}-2022-11-28/fine-grained-pat-permissions.json` in the docs source.
- **GH6** — GraphQL schemas per version: `src/graphql/data/{fpt,ghec}/schema.docs.graphql` and `ghes-3.17…3.22/schema.docs-enterprise.graphql` in the docs source (`addSubIssue` in all; `addBlockedBy` from 3.19; `CreateIssueInput.parentIssueId` in all; `viewerCanUpdateMetadata` in fpt/ghec only). Reference: <https://docs.github.com/en/graphql/reference/mutations>
- **GH7** — GraphQL changelog (`addSubIssue` and `parentIssueId` 2024-12-02, `addBlockedBy` 2025-07-30, `viewerCanSetFields` 2025-08-26, `viewerCanUpdateMetadata` 2026-07-16) — <https://docs.github.com/en/graphql/overview/changelog>
- **GH8** — Troubleshooting the REST API ("Resource not accessible", `X-Accepted-GitHub-Permissions`) — <https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api>
- **GH9** — Scopes for OAuth apps (`X-OAuth-Scopes`, `X-Accepted-OAuth-Scopes`) — <https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps>

CLIs:

- **CLI1** — `gh` source at `5e5cd85e`: `pkg/cmd/issue/create/create.go`, `pkg/cmd/issue/edit/edit.go`, `api/queries_issue.go` (`AddSubIssue`, `AddBlockedBy`, `DeferredUpdateIssue`), `internal/featuredetection/feature_detection.go` (`IssueRelationshipsSupported`), `pkg/cmd/auth/shared/oauth_scopes.go` (empty scopes means an integration token), `pkg/cmd/auth/status/status.go` (token prefixes) — <https://github.com/cli/cli/tree/5e5cd85ea40988abf5c15ec83d90f545151d220e>
- **CLI2** — `gh` v2.94.0 release notes, "Issue types, sub-issues, and relationships in `gh issue`" — <https://github.com/cli/cli/releases/tag/v2.94.0>
- **CLI3** — `glab` source at `a2be5a12`: `internal/commands/issue/create/issue_create.go` (`--linked-issues`, `--link-type`, `--epic`), `internal/commands/issue/update/issue_update.go`, `internal/commands/workitems/` — <https://gitlab.com/gitlab-org/cli/-/tree/a2be5a1275711082a3c1168d6bd4f24186160ec1>; client library `issue_links.go` at v3.12.0 — <https://gitlab.com/gitlab-org/api/client-go/-/blob/v3.12.0/issue_links.go>

[TL]: https://github.com/romtaugranot/issue-map/blob/research/tracker-links/research/tracker-links.md
[HP]: https://github.com/romtaugranot/issue-map/blob/research/home-project/research/home-project.md
[LV1]: #sources
[LV2]: #sources
[LV3]: #sources
[GL1]: https://gitlab.com/gitlab-org/gitlab/-/blob/b64a7e488809e53ff3e5c157a824f646d33c4b24/app/graphql/types/namespaces/available_features_type.rb
[GL2]: https://gitlab.com/gitlab-org/gitlab/-/blob/b64a7e488809e53ff3e5c157a824f646d33c4b24/ee/app/graphql/types/concerns/gitlab_subscriptions/licensed_feature_availability.rb
[GL3]: https://gitlab.com/gitlab-org/gitlab/-/blob/b64a7e488809e53ff3e5c157a824f646d33c4b24/ee/app/graphql/ee/types/permission_types/work_item.rb
[GL4]: https://gitlab.com/gitlab-org/gitlab/-/blob/b64a7e488809e53ff3e5c157a824f646d33c4b24/ee/lib/gitlab/graphql/aggregations/issuables/lazy_links_aggregate.rb
[GL5]: https://gitlab.com/gitlab-org/gitlab/-/blob/b64a7e488809e53ff3e5c157a824f646d33c4b24/ee/app/graphql/ee/types/work_items/related_link_type_enum.rb
[GL6]: https://gitlab.com/gitlab-org/gitlab/-/blob/b64a7e488809e53ff3e5c157a824f646d33c4b24/ee/app/services/ee/work_items/related_work_item_links/create_service.rb
[GL7]: https://gitlab.com/gitlab-org/gitlab/-/blob/b64a7e488809e53ff3e5c157a824f646d33c4b24/ee/app/models/gitlab_subscriptions/features.rb
[GL8]: https://gitlab.com/gitlab-org/gitlab/-/blob/b64a7e488809e53ff3e5c157a824f646d33c4b24/ee/app/models/ee/project.rb
[GL9]: https://gitlab.com/gitlab-org/gitlab/-/blob/b64a7e488809e53ff3e5c157a824f646d33c4b24/ee/lib/ee/api/entities/namespace.rb
[GL10]: https://gitlab.com/gitlab-org/gitlab/-/blob/b64a7e488809e53ff3e5c157a824f646d33c4b24/ee/lib/ee/api/entities/issue_basic.rb
[GL11]: https://gitlab.com/gitlab-org/gitlab/-/blob/v17.5.0-ee/ee/app/graphql/ee/types/group_type.rb
[GL12]: https://gitlab.com/gitlab-org/gitlab/-/blob/b64a7e488809e53ff3e5c157a824f646d33c4b24/app/graphql/types/work_items/widget_definitions/hierarchy_type.rb
[GL13]: https://gitlab.com/gitlab-org/gitlab/-/blob/b64a7e488809e53ff3e5c157a824f646d33c4b24/app/controllers/graphql_controller.rb
[GL14]: https://gitlab.com/gitlab-org/gitlab/-/blob/b64a7e488809e53ff3e5c157a824f646d33c4b24/app/policies/issue_policy.rb
[GL15]: https://gitlab.com/gitlab-org/gitlab/-/blob/b64a7e488809e53ff3e5c157a824f646d33c4b24/app/policies/work_item_policy.rb
[GL16]: https://docs.gitlab.com/api/epic_issues/
[GL17]: https://gitlab.com/gitlab-org/gitlab/-/blob/b64a7e488809e53ff3e5c157a824f646d33c4b24/app/graphql/mutations/work_items/linked_items/add.rb
[GL18]: https://gitlab.com/gitlab-org/gitlab/-/blob/b64a7e488809e53ff3e5c157a824f646d33c4b24/app/graphql/types/work_items/widgets/hierarchy_update_input_type.rb
[GL19]: https://gitlab.com/gitlab-org/gitlab/-/blob/b64a7e488809e53ff3e5c157a824f646d33c4b24/app/graphql/types/permission_types/base_permission_type.rb
[GL20]: https://gitlab.com/gitlab-org/gitlab/-/blob/b64a7e488809e53ff3e5c157a824f646d33c4b24/lib/api/entities/project_with_access.rb
[GL21]: https://docs.gitlab.com/api/personal_access_tokens/
[GL22]: https://docs.gitlab.com/user/project/issues/related_issues/
[GH1]: https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues
[GH2]: https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-issue-dependencies
[GH3]: https://docs.github.com/en/rest/issues/sub-issues
[GH4]: https://docs.github.com/en/rest/issues/issue-dependencies
[GH5]: https://github.com/github/docs/tree/1d0d9a86ebdba79d8a290f81a086727dc2d815f3/src/github-apps/data
[GH6]: https://github.com/github/docs/tree/1d0d9a86ebdba79d8a290f81a086727dc2d815f3/src/graphql/data
[GH7]: https://docs.github.com/en/graphql/overview/changelog
[GH8]: https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api
[GH9]: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps
[CLI1]: https://github.com/cli/cli/tree/5e5cd85ea40988abf5c15ec83d90f545151d220e
[CLI2]: https://github.com/cli/cli/releases/tag/v2.94.0
[CLI3]: https://gitlab.com/gitlab-org/cli/-/tree/a2be5a1275711082a3c1168d6bd4f24186160ec1
