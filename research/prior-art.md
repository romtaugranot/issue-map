# Prior art: what already maps Issues by their Links

Research for [#3](https://github.com/romtaugranot/issue-map/issues/3). Checked 2026-09-21 against each tool's own repository, docs or marketplace listing. Terms follow [`CONTEXT.md`](../CONTEXT.md). When a tool's own word for something differs (GitHub's `blocked by`, GitLab's `linked items`, Beads' `bead`), it appears in code style.

## Short answer

- **Nothing found covers the whole brief.** No tool reads Links from both GitHub and GitLab (self-hosted and Free tier included), reads private Projects, *and* draws a Map you can move through. Each Tracker has its own partial answer:
  - **GitHub:** [`vanilla-bar/gh-issue-graph`](https://github.com/vanilla-bar/gh-issue-graph) is a `gh` extension. It reads private Projects and GitHub Enterprise Server through `gh`. [`martonpaulo/issues-graph`](https://github.com/martonpaulo/issues-graph) has the most careful Map design, but it refuses to read private Projects by design ([product.md](https://github.com/martonpaulo/issues-graph/blob/main/docs/product.md)).
  - **GitLab:** [`ngruychev/issue-graph`](https://gitlab.com/ngruychev/issue-graph) is the only current Map of GitLab Links. It works on self-hosted instances and private Projects through `glab`. It is an editor, it has one author, and its first public commit is from September 2026.
  - **Both Trackers:** only [Beads](https://github.com/gastownhall/beads) touches both. It syncs Issues from GitHub and GitLab *into its own store*. It imports GitLab Links, but it does not import GitHub's own `blocked by` Links ([`internal/github/mapping.go`](https://github.com/gastownhall/beads/blob/main/internal/github/mapping.go) always returns an empty list).
- **Neither Tracker draws its own Map.**
  - GitHub records `blocked by`/`blocking` and sub-issues. It shows them one Issue at a time and marks blocked Issues in lists. It does not draw them ([changelog](https://github.blog/changelog/2025-08-21-dependencies-on-issues/)).
  - GitLab records `relates to`/`blocks`/`is blocked by`, but `blocks` needs Premium or Ultimate ([docs](https://docs.gitlab.com/user/project/issues/related_issues/)). Its request for a drawn view has been open since 2018 ([gitlab-org/gitlab#8358](https://gitlab.com/gitlab-org/gitlab/-/issues/8358)).
  - Jira's `Dependencies` view draws Links, but only on Premium/Enterprise plans ([docs](https://support.atlassian.com/jira-software-cloud/docs/what-is-the-dependencies-report-in-advanced-roadmaps/)). Linear draws blocking Links only between projects on its timeline ([docs](https://linear.app/docs/project-dependencies)).
- **"Which Issue is unblocked" is answered as a list, not a Map.** Examples: GitHub search `is:open -is:blocked` (tested below), `bd ready` (Beads), `bv --robot-next` (beads_viewer), `depviz query ready`, `trck ready`.
- **Unlinked Issues get one of three treatments. No tool lists them beside the Map the way this project plans to:**
  - hidden: Jira's `Dependencies` view, GitLab's own CS-team `issue-graph`, and `ngruychev/issue-graph` with its `linked only` toggle
  - collected into one "Independent" frame on the canvas: `issues-graph`
  - each drawn as its own one-Issue component: `bd graph --all`, `next-issues`
- **Extend or build? Build, and borrow a lot.**
  - The strongest candidate to extend is `martonpaulo/issues-graph`. It is MIT-licensed, tested against captured API fixtures, and aims at the same question ("what should I start next"). Its layout and grouping module is pure, with no network, React or DOM code. But it covers GitHub only and public Projects only, and it will never take a token. That rules out contributing upstream: it would be a fork of a static web app, or a lift of its pure module.
  - `ngruychev/issue-graph` shows how to load a GitLab namespace's open Issues with their Links in one paged GraphQL query.
  - `gh-issue-graph` shows the runtime shape: a local page that borrows the `gh` login.

## Comparison

"Self-hosted GitLab" means a GitLab instance other than gitlab.com. "Maintained" means the last commit or activity seen on 2026-09-21. "?" means the tool's docs don't say.

| Tool | Kind | Trackers (self-hosted GitLab?) | Private Projects | Unlinked Issues | How you move through it | Licence | Maintained |
|---|---|---|---|---|---|---|---|
| **GitHub itself** (Issues, Projects) | Tracker UI | GitHub.com; GHES 3.19+ for `blocked by` | Yes | n/a (lists show everything) | Per-Issue `Relationships` sidebar; `Blocked` icon in lists and Projects; `is:blocked`/`is:blocking` filters; Projects hierarchy view (sub-issues only) | Proprietary | Active |
| **GitLab itself** (linked items) | Tracker UI | gitlab.com, self-managed, Dedicated. `relates to` on Free; `blocks` needs Premium+ | Yes | n/a | Per-Issue `Linked items` block; blocked icon in lists and boards; no drawing (requests open since 2018/2020) | Proprietary + MIT core | Active |
| **Jira Cloud** Plans `Dependencies` view, timeline | Tracker UI | Jira | Yes | **Excluded** from `Dependencies` | Tiles with arrows and filters (Premium/Enterprise); lines or badges on the timeline, `Blocks` Links in one space only | Proprietary | Active |
| **Linear** | Tracker UI | Linear | Yes | n/a | Sidebar flags per Issue; lines between *projects* on the timeline; no drawing of Issue Links | Proprietary | Active |
| [`martonpaulo/issues-graph`](https://github.com/martonpaulo/issues-graph) | Static web page | GitHub.com only | **No, by design** | Drawn in one `Independent` frame on the canvas | Pan/zoom canvas; keys `F` fit, `D`/`R` dim/restore, `Enter` opens on GitHub; every card states its Links in words; a table of Links; share link carries the Map in the URL fragment | MIT | 2026-09-17 (created 2026-08) |
| [`vanilla-bar/gh-issue-graph`](https://github.com/vanilla-bar/gh-issue-graph) | `gh` extension serving a local page | GitHub.com + GHES (`-hostname`) | Yes (via `gh`) | No special handling documented | One fold-able lane per repository; sub-issues form the trunk, pull requests hang off it; click a card for a side panel; hovering dims unrelated lines; `ready` badge | MIT | 2026-08-26 (v0.2.1) |
| [`kmtym1998/gh-issue-treefier`](https://github.com/kmtym1998/gh-issue-treefier) | `gh` extension serving a local page | GitHub (scoped to a GitHub Projects board) | Presumably (via `gh`), not stated | ? | Drawing of sub-issues and `blocked by`; drag to edit Links; filter by owner, status and project fields | None (no licence file) | 2026-03-01 |
| [`ngruychev/issue-graph`](https://gitlab.com/ngruychev/issue-graph) | Local web app (Bun) | gitlab.com + **self-hosted** (`GITLAB_HOST`); `blocks` Links and epics need Premium+ | Yes (via `glab`); confidential Issues hidden by default | Shown and packed one component at a time; the `linked only` toggle hides them | Left-to-right layers; search with Enter/Shift+Enter; filters; group by epic with collapse; edits Links and Issues, then Apply/Discard | MIT | 2026-09-17 |
| [`gitlab-cs-tools/issue-graph`](https://gitlab.com/gitlab-com/cs-tools/gitlab-cs-tools/issue-graph) | Hosted page | gitlab.com, hard-wired to `gitlab-org/gitlab` | No (non-confidential only) | **Excluded** ("unlinked issues are not included") | Search by text, `group::` label or `#IID`; click to see linked Issues | MIT | 2026-06-11 |
| [`Feanya/gitlab-issue-visualizer`](https://github.com/Feanya/gitlab-issue-visualizer) | Python + Graphviz, static SVG | GitLab, any server URL, one group | Yes (token) | Drawn, and the README names "issues not connected to anything" as a use | Static SVG; every node links to GitLab | MIT | 2024-12-31 |
| [`moul/depviz`](https://github.com/moul/depviz) v4 | CLI + local web app | GitHub via `gh` (v3's GitLab/Jira stayed "planned") | Yes (via `gh`) | ? | `depviz brief`, `query ready`, static HTML export, `depviz live` | Apache-2.0 or MIT | **Unmaintained** (commit on 2026-09-19 says so) |
| [`build-issue-dependencies-graph`](https://github.com/maxim-lobanov/build-issue-dependencies-graph) | GitHub Action | GitHub | Yes (Actions token) | Only the children of one root Issue are drawn | Mermaid drawing written into the root Issue's body; nodes clickable | MIT | 2024-04-08 |
| [Beads `bd`](https://github.com/gastownhall/beads) | Agent-oriented Tracker (own store) + CLI | Own store. Syncs with GitHub (+GHE) **without its Links**, and with GitLab (+**self-hosted**) **with** its Links; also Jira, Linear | Yes (token) | `bd ready` lists them; `bd graph --all` draws each as its own one-node component, after bigger ones | `bd ready`; `bd graph` as terminal layers, box, tree, DOT, or HTML with D3 | MIT | Very active (v1.3.0, 2026-09-15) |
| [`beads_viewer` (`bv`)](https://github.com/Dicklesworthstone/beads_viewer) | Terminal UI + agent JSON | Beads only | n/a (local) | Counted as `isolated_nodes` in its statistics | TUI with a drawing view (`g`), insights (PageRank, critical path), kanban; `--robot-*` JSON; HTML export | **MIT + rider denying all rights to OpenAI/Anthropic and anyone acting for them** | 2026-09-19 |
| Other Beads viewers with a drawing: [Bead Me Up Scotty](https://github.com/brendan-appstart/bead-me-up-scotty), [perles](https://github.com/zjrosen/perles), [beads.nvim](https://github.com/tomfordweb/beads.nvim), [BeadSpec](https://github.com/boardthatpowder/BeadSpec) | Web / TUI / Neovim / desktop | Beads only | n/a | ? | Varies; see the [community list](https://github.com/gastownhall/beads/blob/main/docs/community-tools.md) | MIT (first three) | Active (Aug–Sep 2026) |
| [`shdennlin/issue-graph`](https://github.com/shdennlin/issue-graph) | Self-hosted web app | Linear (Jira/Plane/GitHub Projects "future") | Yes (API key) | ? | Blocking, mixed and per-project views; filters; keys `c` isolate chain, `h` sub-issues, Cmd/Ctrl-F find; saved views | MIT | 2026-09-21 |
| [`christensson/issuedepyt`](https://github.com/christensson/issuedepyt) | YouTrack app | YouTrack | Yes | n/a (starts from one Issue) | Upstream/downstream drawing from one Issue, as a tree or free layout; due-date timeline | MIT | 2026-09-13 |
| [`yannikzz/next-issues`](https://github.com/yannikzz/next-issues) | Claude Code skill | GitHub via `gh`; Links **parsed from Issue text**, not from the Tracker | Yes (via `gh`) | Each gets a one-Issue lane | Self-contained HTML map; pan/zoom; hover lights up a whole upstream/downstream path; "start here" flag; ranked list | MIT | 2026-06-11 |
| [`mmyslin/sideboard`](https://github.com/mmyslin/sideboard) | Claude Code plugin | GitHub via `gh`; ordering kept in a sidecar file, not Tracker Links | Yes | n/a (kanban) | Kanban page on localhost, pinned in Claude Code desktop's preview pane; hooks follow the active Project | MIT | 2026-08-20 |
| [`github/github-mcp-server`](https://github.com/github/github-mcp-server) | Official MCP server | GitHub.com, GHES, ghe.com | Yes | n/a | Agent tools only. Reads sub-issues and parent; **no `blocked by` tools** in its README | MIT | 2026-09-16 |
| [GitLab MCP server](https://docs.gitlab.com/user/model_context_protocol/mcp_server/) | Official MCP server (beta) | gitlab.com, self-managed, Dedicated; Free from GitLab 19.2 | Yes | n/a | Agent tools only. `link_work_items` writes Links; reading Links isn't documented ([tools](https://docs.gitlab.com/user/model_context_protocol/mcp_server_tools/)) | Ships with GitLab | Active |
| [`zereight/gitlab-mcp`](https://github.com/zereight/gitlab-mcp) | Community MCP server | gitlab.com + **self-hosted** | Yes | n/a | Agent tools, including `list_issue_links` | MIT | 2026-09-20 |
| [`chuks-qua/github-issues-mcp-server`](https://github.com/chuks-qua/github-issues-mcp-server) | Community MCP server | GitHub | Yes | n/a | `github_get_blocked_by`, `github_get_blocking`, sub-issue tools | None | 2026-01-28 |
| `gh` / `glab` CLIs | CLI | `gh`: GitHub + GHES. `glab`: GitLab + self-hosted | Yes | n/a | `gh issue create/edit --blocked-by/--blocking` since v2.94.0 ([release](https://github.com/cli/cli/releases/tag/v2.94.0)). `glab issue create --linked-issues --link-type` writes Links; no `glab` command lists them | MIT | Active |
| [`jwilger/gh-issue-ext`](https://github.com/jwilger/gh-issue-ext) | `gh` extension | GitHub | Yes | n/a | Text only: `blocking list`, `sub list` | None | 2026-07-05 |
| Official VS Code extensions for GitHub and GitLab | Editor | GitHub / GitLab | Yes | n/a | No view of Issue Links in either changelog ([GitHub](https://github.com/microsoft/vscode-pull-request-github/blob/main/CHANGELOG.md), [GitLab](https://gitlab.com/gitlab-org/gitlab-vscode-extension/-/blob/main/CHANGELOG.md)) | MIT | Active |

## Notes per tool

### The Trackers themselves

**GitHub.**
- **What it records:**
  - `blocked by` / `blocking` Links became generally available on 2025-08-21, with up to 50 Issues per Link type ([changelog](https://github.blog/changelog/2025-08-21-dependencies-on-issues/)).
  - They are readable over REST at `/repos/{owner}/{repo}/issues/{n}/dependencies/blocked_by` and `/blocking`, 100 per page ([REST docs](https://docs.github.com/en/rest/issues/issue-dependencies)).
  - GraphQL `Issue` has `blockedBy`, `blocking`, `issueDependenciesSummary`, `parent`, `subIssues` and `subIssuesSummary` (confirmed by introspection). `issueDependenciesSummary` separates open blockers (`blockedBy`) from all blockers (`totalBlockedBy`).
  - GHES documents the REST endpoints from 3.19; the 3.18 page returns 404. `gh`'s v2.94.0 notes say "relationships require GHES 3.19+".
- **What it shows:**
  - Links appear per Issue in the sidebar, and a `Blocked` icon appears in lists and Projects ([docs](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-issue-dependencies)).
  - Search supports `is:blocked`, `is:blocking`, `blocked-by:` and `blocking:`.
  - Projects gained a hierarchy view for sub-issues, generally available in March 2026 ([changelog](https://github.blog/changelog/2026-03-19-hierarchy-view-in-github-projects-is-now-generally-available/)).
  - There is no drawing of `blocked by` Links anywhere.
- **Tested here:** the REST search `is:issue is:open -is:blocked` with `advanced_search=true` works, and splits a Project exactly:

  | Project | `is:blocked` | `-is:blocked` | Total open |
  |---|---|---|---|
  | `microsoft/vscode` | 6 | 18,551 | 18,557 |
  | `cli/cli` | 0 | 1,026 | 1,026 |

  That gives a one-request count of "unblocked" Issues. It also shows how rarely large public Projects record `blocked by` Links today.

**GitLab.**
- **What it records:**
  - Linked items are `relates to`, `blocks` and `is blocked by`. They work across Projects and on gitlab.com, self-managed and Dedicated. But "blocking issues" (`blocks` / `is blocked by`) are **Premium and Ultimate only** ([docs](https://docs.gitlab.com/user/project/issues/related_issues/), [work items](https://docs.gitlab.com/user/work_items/linked_items/)).
  - On a Free instance, the only Link is the undirected `relates to`. Users confirm that self-managed Free rejects `/block` ([forum](https://forum.gitlab.com/t/creating-a-blocking-issue-on-self-managed-instance/100110)). Beads handles the matching API error ("Blocked issues not available for current license") as an expected skip ([`internal/gitlab/links.go`](https://github.com/gastownhall/beads/blob/main/internal/gitlab/links.go)).
  - REST: `GET /projects/:id/issues/:iid/links` returns `link_type` ([API](https://docs.gitlab.com/api/issue_links/)).
- **What it shows:** no drawing. The requests are still open in the backlog:
  - [#8358](https://gitlab.com/gitlab-org/gitlab/-/issues/8358) "View blocking and related issues in a graph", opened 2018
  - [#223035](https://gitlab.com/gitlab-org/gitlab/-/issues/223035) "Dependency Visualization for Epics", opened 2020
  - [#273597](https://gitlab.com/gitlab-org/gitlab/-/issues/273597) "Have a visual issue dependency graph", opened 2020
- **`glab`:** it can write Links when creating an Issue, but no `glab issue` command reads them, and `glab work-items` is experimental ([docs](https://docs.gitlab.com/cli/issue/create/), [work-items](https://docs.gitlab.com/cli/work-items/)).

**Jira Cloud.**
- The Plans `Dependencies` view draws tiles with arrows, and "only shows work items in your plan that have dependencies". It is only on Premium and Enterprise ([docs](https://support.atlassian.com/jira-software-cloud/docs/what-is-the-dependencies-report-in-advanced-roadmaps/)).
- The timeline draws only `Blocks` Links, and only within one space ([docs](https://support.atlassian.com/jira-software-cloud/docs/manage-dependencies-between-epics-on-the-timeline/)).

**Linear.**
- Issues can be marked blocked, blocking, related or duplicate. When a blocker is resolved, the Link "moves under Related" ([docs](https://linear.app/docs/issue-relations)).
- Blocking Links are drawn only between *projects*, on the timeline ([docs](https://linear.app/docs/project-dependencies)).

### GitHub-side Maps

**`martonpaulo/issues-graph`: the closest match in intent.**
- **Runtime:** a static page (React, React Flow, elkjs) on GitHub Pages. It reads the public REST API from the browser and draws open Issues, `blocked by` Links (solid) and sub-issue Links (dashed).
- **What it refuses:** its [product definition](https://github.com/martonpaulo/issues-graph/blob/main/docs/product.md) lists "Read private repositories" under "What it will never do". A token only raises the rate limit.
- **Layout ([`src/graph.ts`](https://github.com/martonpaulo/issues-graph/blob/main/src/graph.ts)):**
  - The module is pure: no network, React or DOM code.
  - It groups the drawing into frames. `chain` is a connected set of blocking Links. `breakdown` is a set joined only by sub-issues. `free` holds everything with no Link, labelled "Independent" and packed in a grid below.
  - Each card carries a state derived from Tracker facts (`ready`, `unassigned`, `blocked`, `in progress`, `in review`). An Issue counts as blocked only while its *open*-blocker count, `issue_dependencies_summary.blocked_by`, is above zero. "Unassigned" is kept apart from "ready".
  - Issues from other Projects become "external" cards.
- **Reading the Map:** closed blockers sit behind a switch. Reads are priced against the rate limit before they are spent, and cached per browser with their age shown.
- **Words beside the picture:** every card states its Links in words, and a table lists every drawn Link. Both come from the same data as the canvas.
- **Tests** run against captured API fixtures.

**`vanilla-bar/gh-issue-graph`: the right runtime shape.**
- **Runtime:** a Go `gh` extension that serves a page on `127.0.0.1` and makes every call through `gh api graphql`, "so your token never leaves `gh`". That gives it private Projects and GHES (`-hostname`).
- **What it draws:** sub-issues are the trunk, and pull requests hang off the leaves. `blocked by` is a red dashed arrow and duplicates a faint dotted line.
- **Certainty of lines:** every non-trunk line carries a text label. Lines guessed from text ("`#123` in the title with no keyword") are marked as "the only kind that can be wrong".
- **Scope:** the Issues you are assigned to, authored or were mentioned in, or a whole repository. Issues pulled in only to complete a Link get a dashed border and the words `for context`.
- **`ready` badge:** shown only when something else on the canvas is blocked.
- **Limits:** caps at 500 Issues, with a warning when it hits the cap.
- **Maturity:** one star, one author, created 2026-08-25.

**`kmtym1998/gh-issue-treefier`.**
- A `gh` extension that draws sub-issue and `blocked by` Links for the Issues in a GitHub Projects board, and lets you edit them by dragging. It works across repositories.
- It has no licence file, which means all rights are reserved.

**Mermaid in an Issue body ([`build-issue-dependencies-graph`](https://github.com/maxim-lobanov/build-issue-dependencies-graph)).**
- An Action that parses "Depends on …" lines from Issue text and rewrites a mermaid drawing into the root Issue.
- It is an example of the "generated file that goes stale" pattern that `issues-graph` was written to avoid.

**`moul/depviz`.**
- It started as a "dependency visualizer for GitHub & GitLab", but its v3 README lists GitLab and Jira as "planned".
- v4 syncs GitHub through `gh issue list` and **parses Links from Issue text** with a verb regex (`blocked by`, `depends on`, `blocks`, …) ([`internal/core/github.go`](https://github.com/moul/depviz/blob/master/internal/core/github.go)).
- It answers `query ready`. A 2026-09-19 commit disables automation because the "repo is unmaintained".

### GitLab-side Maps

**`ngruychev/issue-graph`: the only current GitLab Map.**
- **Loading ([`src/api.ts`](https://gitlab.com/ngruychev/issue-graph/-/blob/main/src/api.ts)):** a group or project path is loaded as `namespace.workItems(state: opened, first: 100)`. Each page brings the `WorkItemWidgetLinkedItems` Links, the hierarchy parent, labels and assignees together, so there is no request per Issue. Auth goes through `glab`.
- **Layout:**
  - Links run left to right, drawn with dagre: red `blocks`, grey dashed `relates to`, blue dotted epic membership.
  - "Disconnected items are laid out per connected component and shelf-packed into rows". The README explains that a single layout pass "turns a mostly unlinked backlog into one unusable column".
  - `linked only` hides Unlinked Issues because "most of a backlog has none".
  - Confidential Issues are hidden by default, and the count of hidden ones is shown.
- **Risks:** it writes to the Tracker, including Links, titles, labels and new Issues. Its local proxy "accepts any path and method".
- **Maturity:** created on gitlab.com on 2026-09-17, one author, zero stars.

**GitLab's own `gitlab-cs-tools/issue-graph`.** A hosted drawing of `gitlab-org/gitlab`'s public Issues, built from `related issues` and from references in Issue text. "Unlinked issues are not included."

**`Feanya/gitlab-issue-visualizer`.**
- Downloads one group through the API (with a server URL and a private token) and renders Graphviz SVGs of blocking and `relates to` Links, clustered by epic.
- Epic-to-epic Links are parsed from text because GitLab restricts them to Ultimate. Its last commit is from 2024.

Older GitLab attempts, [`gitlab-issue-explorer`](https://gitlab.com/ldoguin/gitlab-issue-explorer) (2020) and [`gitlab2dot`](https://gitlab.com/vates/gitlab2dot) (2017), are abandoned.

### Agent-oriented Trackers and their viewers

**Beads (`bd`).**
- **What it is:** a Tracker of its own. It stores Issues (`beads`) in a Dolt database under `.beads/`. Its core loop is `bd ready`, which lists "tasks with no open blockers" ([README](https://github.com/gastownhall/beads)).
- **`bd graph`:** draws terminal layers, box or tree layouts, DOT, or a self-contained D3 HTML page. With `--all` it groups open Issues "by connected component", largest first, so an Unlinked Issue becomes a one-node component near the end ([`cmd/bd/graph.go`](https://github.com/gastownhall/beads/blob/main/cmd/bd/graph.go)).
- **Syncing with GitHub:** `bd github sync` supports GitHub Enterprise through `github.url`, but it imports no Links. The GitHub mapper returns an empty list, and nothing under `internal/github` reads `blocked_by`.
- **Syncing with GitLab:** `bd gitlab sync` supports self-hosted instances through `gitlab.url`, and group-level sync. It maps `blocks`/`is_blocked_by` into blocking Links and `relates_to` into related ones. On push it treats a Free-tier licence refusal as an expected skip ([`internal/gitlab/links.go`](https://github.com/gastownhall/beads/blob/main/internal/gitlab/links.go)).
- **Other syncs:** Jira, Linear, Azure DevOps and Notion.

**`beads_viewer` (`bv`).**
- A terminal UI over the Beads JSONL export: a drawing view, insights (PageRank, betweenness, critical path, cycles), kanban, and `--robot-*` JSON outputs for agents (`--robot-next` gives the single top pick).
- Its [LICENSE](https://github.com/Dicklesworthstone/beads_viewer/blob/main/LICENSE) adds a rider to MIT. The rider grants no rights to OpenAI, Anthropic, their affiliates, or anyone acting "for the benefit of" them. It also counts incorporating the software into "pipeline[s] for machine learning or other automated systems" as use. **Borrow ideas only; copy no code.**

**Other Beads viewers.** The community list ([docs](https://github.com/gastownhall/beads/blob/main/docs/community-tools.md)) has several that draw Beads' Links: Bead Me Up Scotty, BeadSpec (React Flow and Cytoscape), BeadBoard, beads.nvim and perles. The Lista Beads VS Code extension adds a drawing plus sync with GitHub, GitLab, Jira, Linear and Azure DevOps. All of them read Beads, not a Tracker's own Links.

**Others with their own store.**
- [Task Master](https://github.com/eyaltoledano/claude-task-master): "next task". Licence is MIT plus the Commons Clause.
- [Backlog.md](https://github.com/MrLesk/Backlog.md): shows what an Issue waits on. MIT.
- [trck](https://github.com/leonkacowicz/trck): `ready` and `next` weigh what an Issue unblocks, and `graph` draws a layered SVG. MIT.
- None of them reads GitHub or GitLab Links.

### Other Trackers

- **[`shdennlin/issue-graph`](https://github.com/shdennlin/issue-graph)** (Linear). A self-hosted, read-only Map with blocking, mixed and per-project views.
  - It has good keyboard navigation (`c` isolates a chain) and saved views on the server.
  - Its source adapter is pluggable: "Linear in v1; Jira / Plane / GitHub Projects in future". There is no GitLab.
  - It ships with no authentication.
- **[`christensson/issuedepyt`](https://github.com/christensson/issuedepyt)** (YouTrack). Starts from one Issue and draws everything upstream and/or downstream of it, as a tree or a free layout, with a due-date timeline.

### Claude Code plugins, skills and MCP servers

- **`next-issues`** is a Claude Code skill.
  - It splits the job into layers: a script pulls and ranks the Issues deterministically, the model writes the prose, and a template renders one self-contained HTML map.
  - Its Links come from Issue *text* ("Blocked by #…", "Depends on #…"), not from the Tracker.
  - Hovering a card lights up its whole upstream and downstream path. An isolated Issue gets "a one-issue lane".
- **Sideboard** is a Claude Code plugin.
  - It serves a local page that Claude Code's desktop app can pin in its preview pane.
  - Session and prompt hooks tell the page which Project is active.
  - Its ordering lives in a committed sidecar file, not in Tracker Links.
- **[`dgutson/roadmap-github`](https://github.com/dgutson/roadmap-github)** keeps a local `ISSUES.md` with its own `Blocked-by` field. It never reads Tracker Links.
- **The official plugins** in Anthropic's marketplace only wrap MCP servers ([marketplace](https://github.com/anthropics/claude-plugins-official)):
  - `github` points at GitHub's remote MCP server.
  - `gitlab` points at gitlab.com's MCP server, so self-hosted instances need their own URL.
- **GitHub's MCP server** has no `blocked by` tools. **GitLab's official MCP server** can write Links but doesn't document reading them. **`zereight/gitlab-mcp`** has `list_issue_links` and supports self-hosted instances.

## Ideas worth borrowing

**Getting the Links**

1. **Read Links from the Tracker on demand and leave nothing in the Project.** `issues-graph`'s product definition argues this well: a generated drawing file goes stale and has to be maintained. This matches the project's constraint.
2. **Load a page of Issues with their Links in one query.**
   - GitHub: GraphQL `Issue.blockedBy` / `blocking` / `issueDependenciesSummary` / `subIssues` / `parent`.
   - GitLab: `namespace.workItems(state: opened)` with the `LINKED_ITEMS` widget, as `ngruychev/issue-graph` does.
   - Compare `issues-graph`'s REST approach, which costs one request per 100 Issues plus one per Issue that has blockers.
3. **Decide "unblocked" without fetching closed blockers.**
   - GitHub's `issueDependenciesSummary.blockedBy` counts only *open* blockers.
   - A search for `is:open -is:blocked` gives a one-request count.
4. **Borrow the `gh`/`glab` login, as `gh-issue-graph`, `ngruychev/issue-graph`, `depviz` and Sideboard do.** It brings private Projects, GHES and self-hosted GitLab hosts for free, and no token is ever stored. It also connects to #5 (finding the Home Project's Tracker).
5. **Treat GitLab Free as a normal case, not an error.**
   - Free instances hold only undirected `relates to` Links.
   - Writing a `blocks` Link on Free fails with "Blocked issues not available for current license", which Beads records as a counted skip.

**Laying out the Map**

6. **Draw chains left to right, and lay out each connected part separately.** `ngruychev/issue-graph` found that one layout pass stacks every Unlinked Issue into one column. `issues-graph` frames each connected part and names it (`chain`, `breakdown`, `Independent`).
7. **Draw "blocks" and "part of" in different styles.** `issues-graph`, `gh-issue-graph` and `shdennlin/issue-graph` all separate ordering Links from containment. `ngruychev/issue-graph` draws `relates to` as grey dashes.
8. **Mark Issues from other Projects as context.** `gh-issue-graph` gives them a dashed `for context` border; `issues-graph` makes them "external" cards. This feeds "Moving between Projects" in #1.

**Reading the Map**

9. **Say it in words as well as pictures.** `issues-graph` gives each card a sentence ("Blocked by #23 and #24. Blocks #31.") and adds a table of every Link. Beads (`--json`) and `bv` (`--robot-*`) show the agent-facing version of the same idea. A Map inside Claude Code should be readable by Claude too.
10. **Put a card's state in plain words, derived from Tracker facts.**
    - "Unassigned" is not "ready" (`issues-graph`).
    - Show `ready` only when something else on the canvas is blocked (`gh-issue-graph`).
    - Keep closed blockers behind a switch, since they explain why something is now unblocked (`issues-graph`, for "Closed Issues" in #1).
11. **Focus on one path.** Hovering a card lights up its upstream and downstream chain (`next-issues`, `gh-issue-graph`). `c` isolates a chain (`shdennlin`). `issuedepyt` offers a view rooted at a single Issue.
12. **Rank "what next" by what an Issue unblocks.** Examples: `bv`'s PageRank and critical path, and `trck next`, which weighs what an Issue unblocks. This feeds "Choosing the next Issue" in #1.

**Trust and limits**

13. **Label guessed Links as guesses.** `gh-issue-graph` draws Links guessed from text as faint dotted lines, "the only kind that can be wrong". `depviz`, `next-issues` and the mermaid Action all parse text. This is evidence for #8.
14. **Be honest about limits.**
    - Price a read against the rate limit before spending it, and show how old a cached copy is (`issues-graph`).
    - Cap the Map at a size and warn when the cap is hit (`gh-issue-graph`, 500 Issues).
    - Hide confidential Issues by default and show how many are hidden (`ngruychev/issue-graph`).
15. **Ways to show a Map inside Claude Code, from #4's side.**
    - Sideboard: a localhost page in Claude Code desktop's preview pane, with hooks that follow the active Project.
    - `next-issues`: a single self-contained HTML file.
    - Beads: text layers in the terminal.

## Close enough to extend?

**No, not as a whole.** Build a new plugin and lift pieces. For each candidate:

- **`martonpaulo/issues-graph`: strongest candidate, but only as a fork or a code lift.**
  - *For:* it has the closest intent, an MIT licence, a pure and tested layout and grouping module, and the most thoughtful reading aids.
  - *Against:*
    - It covers GitHub only.
    - It is public-only by design and "will never" read private repositories, so the owner won't accept an upstream change.
    - It is a static web page rather than a plugin.
    - Its REST read is chatty.
  - *Best use:* adopt its grouping rules and card-state rules. Lift the pure module under MIT, keeping the copyright notice.
- **`vanilla-bar/gh-issue-graph`: an architecture reference.**
  - *For:* a `gh` extension, a localhost page, the `gh` login, private Projects and GHES.
  - *Against:* its trunk is sub-issues plus pull requests and its scope is "the Issues you touch". It covers GitHub only, and has one author and 3 weeks of history.
- **`ngruychev/issue-graph`: a GitLab reference.**
  - *For:* the only current Map of GitLab Links; self-hosted instances and `glab` auth; the right query.
  - *Against:* it is an editor that writes to the Tracker, with no guard on its local proxy. Its first public commit is days old and it has one author.
  - *Best use:* read its query and layout code; don't take it on as a dependency.
- **Beads: not an extension target.**
  - Adopting it means copying Issues into another Tracker, and its GitHub sync drops GitHub's own Links.
  - Its GitLab Link mapping (MIT) is a good reference for directions and licence refusals.
- **`beads_viewer`:** ideas only, because of the licence rider.
- **`depviz`:** unmaintained, and reads Links from text.
- **MCP servers:** candidates for data access, not things to extend.
  - GitHub's official server lacks `blocked by` tools.
  - GitLab's official server is beta, and Free only from 19.2.
  - `zereight/gitlab-mcp` reads Links on self-hosted instances.

## Sources

Trackers:
- GitHub:
  - [Dependencies on issues, changelog 2025-08-21](https://github.blog/changelog/2025-08-21-dependencies-on-issues/)
  - [Creating issue dependencies](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-issue-dependencies)
  - [REST issue dependencies](https://docs.github.com/en/rest/issues/issue-dependencies) and [GHES 3.19 version](https://docs.github.com/en/enterprise-server@3.19/rest/issues/issue-dependencies)
  - [gh v2.94.0 release notes](https://github.com/cli/cli/releases/tag/v2.94.0)
  - [gh CLI sub-issues and dependencies, changelog 2026-06-10](https://github.blog/changelog/2026-06-10-manage-sub-issues-types-and-dependencies-from-github-cli/)
  - [Projects hierarchy view GA, changelog 2026-03-19](https://github.blog/changelog/2026-03-19-hierarchy-view-in-github-projects-is-now-generally-available/)
- GitLab:
  - [Linked issues](https://docs.gitlab.com/user/project/issues/related_issues/)
  - [Linked items (work items)](https://docs.gitlab.com/user/work_items/linked_items/)
  - [Issue links API](https://docs.gitlab.com/api/issue_links/)
  - [`glab issue create`](https://docs.gitlab.com/cli/issue/create/), [`glab work-items`](https://docs.gitlab.com/cli/work-items/)
  - Open requests: [#8358](https://gitlab.com/gitlab-org/gitlab/-/issues/8358), [#223035](https://gitlab.com/gitlab-org/gitlab/-/issues/223035), [#273597](https://gitlab.com/gitlab-org/gitlab/-/issues/273597)
  - [Forum: blocking on self-managed](https://forum.gitlab.com/t/creating-a-blocking-issue-on-self-managed-instance/100110)
  - [MCP server](https://docs.gitlab.com/user/model_context_protocol/mcp_server/) and [its tools](https://docs.gitlab.com/user/model_context_protocol/mcp_server_tools/)
- Jira:
  - [Dependencies view](https://support.atlassian.com/jira-software-cloud/docs/what-is-the-dependencies-report-in-advanced-roadmaps/)
  - [Timeline dependencies](https://support.atlassian.com/jira-software-cloud/docs/manage-dependencies-between-epics-on-the-timeline/)
- Linear:
  - [Issue relations](https://linear.app/docs/issue-relations)
  - [Project dependencies](https://linear.app/docs/project-dependencies)

Tools (READMEs, source files and licences read on 2026-09-21):
- GitHub Maps and extensions:
  - [martonpaulo/issues-graph](https://github.com/martonpaulo/issues-graph): [product.md](https://github.com/martonpaulo/issues-graph/blob/main/docs/product.md), [src/graph.ts](https://github.com/martonpaulo/issues-graph/blob/main/src/graph.ts)
  - [vanilla-bar/gh-issue-graph](https://github.com/vanilla-bar/gh-issue-graph) ([English README](https://github.com/vanilla-bar/gh-issue-graph/blob/main/README.en.md))
  - [kmtym1998/gh-issue-treefier](https://github.com/kmtym1998/gh-issue-treefier)
  - [jwilger/gh-issue-ext](https://github.com/jwilger/gh-issue-ext)
  - [maxim-lobanov/build-issue-dependencies-graph](https://github.com/maxim-lobanov/build-issue-dependencies-graph)
  - [moul/depviz](https://github.com/moul/depviz): [v3 README](https://github.com/moul/depviz/blob/v3/README.md), [internal/core/github.go](https://github.com/moul/depviz/blob/master/internal/core/github.go)
- GitLab Maps:
  - [ngruychev/issue-graph](https://gitlab.com/ngruychev/issue-graph): [src/api.ts](https://gitlab.com/ngruychev/issue-graph/-/blob/main/src/api.ts)
  - [gitlab-cs-tools/issue-graph](https://gitlab.com/gitlab-com/cs-tools/gitlab-cs-tools/issue-graph)
  - [Feanya/gitlab-issue-visualizer](https://github.com/Feanya/gitlab-issue-visualizer)
  - [ldoguin/gitlab-issue-explorer](https://gitlab.com/ldoguin/gitlab-issue-explorer), [vates/gitlab2dot](https://gitlab.com/vates/gitlab2dot)
- Beads and its viewers:
  - [gastownhall/beads](https://github.com/gastownhall/beads): [community tools](https://github.com/gastownhall/beads/blob/main/docs/community-tools.md), [cmd/bd/graph.go](https://github.com/gastownhall/beads/blob/main/cmd/bd/graph.go), [cmd/bd/github.go](https://github.com/gastownhall/beads/blob/main/cmd/bd/github.go), [cmd/bd/gitlab.go](https://github.com/gastownhall/beads/blob/main/cmd/bd/gitlab.go), [internal/gitlab/links.go](https://github.com/gastownhall/beads/blob/main/internal/gitlab/links.go), [internal/github/mapping.go](https://github.com/gastownhall/beads/blob/main/internal/github/mapping.go)
  - [Dicklesworthstone/beads_viewer](https://github.com/Dicklesworthstone/beads_viewer) and its [LICENSE](https://github.com/Dicklesworthstone/beads_viewer/blob/main/LICENSE)
  - [brendan-appstart/bead-me-up-scotty](https://github.com/brendan-appstart/bead-me-up-scotty), [zjrosen/perles](https://github.com/zjrosen/perles), [tomfordweb/beads.nvim](https://github.com/tomfordweb/beads.nvim), [boardthatpowder/BeadSpec](https://github.com/boardthatpowder/BeadSpec)
- Other agent-oriented Trackers: [eyaltoledano/claude-task-master](https://github.com/eyaltoledano/claude-task-master), [MrLesk/Backlog.md](https://github.com/MrLesk/Backlog.md), [leonkacowicz/trck](https://github.com/leonkacowicz/trck)
- Other Trackers' Maps: [shdennlin/issue-graph](https://github.com/shdennlin/issue-graph), [christensson/issuedepyt](https://github.com/christensson/issuedepyt)
- Claude Code plugins and skills:
  - [yannikzz/next-issues](https://github.com/yannikzz/next-issues), [mmyslin/sideboard](https://github.com/mmyslin/sideboard), [dgutson/roadmap-github](https://github.com/dgutson/roadmap-github)
  - [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official)
- MCP servers: [github/github-mcp-server](https://github.com/github/github-mcp-server), [zereight/gitlab-mcp](https://github.com/zereight/gitlab-mcp), [chuks-qua/github-issues-mcp-server](https://github.com/chuks-qua/github-issues-mcp-server)
- Editor extensions: [VS Code GitHub Pull Requests and Issues, CHANGELOG](https://github.com/microsoft/vscode-pull-request-github/blob/main/CHANGELOG.md), [GitLab Workflow for VS Code, CHANGELOG](https://gitlab.com/gitlab-org/gitlab-vscode-extension/-/blob/main/CHANGELOG.md)
