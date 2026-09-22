# Issue Map

A Claude Code plugin that draws a Project's open Issues as a Map joined by their Links, so the user can see which Issue to take next and move between Projects.

## Language

### Issues and Projects

**Issue**:
One unit of work recorded on a Tracker, whatever the Tracker calls or types it; GitLab's tasks count. A pull or merge request is not an Issue.
_Avoid_: ticket, work item, task

**Tracker**:
One running system, at one host, that holds Projects' Issues — github.com, a GitHub Enterprise Server, gitlab.com, a self-hosted GitLab, or another. GitHub and GitLab are kinds of Tracker; each Tracker runs its own version.
_Avoid_: forge, provider, platform, instance, deployment

**Project**:
One collection of Issues on a Tracker — a GitHub repository or a GitLab project. Not a GitHub Projects planning board.
_Avoid_: repo (when meaning the Issues' container)

**Closing Request**:
A pull or merge request that closes an Issue when it is merged. It is not an Issue, and the Map never follows it.
_Avoid_: linked PR, development link, fix

**Home Project**:
The Project the Map opens on for the local git checkout Claude Code is running in. When the checkout's remotes lead to several Projects with open Issues, it is the one the user picked.
_Avoid_: current repo, default project

### Links

**Link**:
A relationship with a meaning that someone set between two Issues on the Tracker: a Blocks Link, a Parent Link or a Related Link.
_Avoid_: dependency, relation, edge

**Blocks Link**:
A Link saying one Issue must be done before another can be; it has a direction.
_Avoid_: dependency, depends on

**Parent Link**:
A Link placing one Issue inside another. An Issue can have more than one parent.
_Avoid_: sub-issue link, epic link, tracked-by

**Related Link**:
A Link saying two Issues belong together, with no direction or order.
_Avoid_: relates to, relation

**Mention**:
One Issue naming another in its text, which the Tracker notes. A Mention is not a Link.
_Avoid_: cross-reference, crosslink

**Link Suggestion**:
A Link Claude proposes from an Issue's text that the Tracker doesn't record. It is never drawn, and it becomes a Link only once the user confirms it and it is written to the Tracker.
_Avoid_: inferred Link, guessed Link, implied Link

**Blocked Issue**:
An open Issue that at least one open Issue, in any Project, Blocks. Being Blocked does not pass along Parent Links.
_Avoid_: dependent

**Waits on**:
An Issue waits on another when that one Blocks it, or Blocks an Issue it waits on. A Blocked Issue is one that waits on an open Issue.
_Avoid_: depends on, downstream of, behind

**Unblocked Issue**:
An open Issue with at least one Link that no open Issue Blocks, in a Project whose Blocks Links the Map can read. Where the Map can't read them, because the Project can't record them or the Map can't see them, no Issue is Unblocked.
_Avoid_: ready, available, actionable

### The Map

**Map**:
The drawing of a Project's open Issues joined by their Links, which the user moves through. Not the `wayfinder:map` issue that plans this effort.
_Avoid_: graph, board, tree

**Outside Issue**:
An Issue outside the Project that a Link reaches; the Map draws it but does not follow its Links. An Issue the user can't read is drawn as one without a name.
_Avoid_: stub, foreign issue, external issue

**Unlinked Issue**:
An open Issue with no Link to another open Issue, listed beside the Map rather than drawn in it.
_Avoid_: orphan, loose issue

**Group**:
A set of open Issues joined by Links, directly or through one another, together with the Outside Issues those Links reach. The Map lists a Project's Groups.
_Avoid_: cluster, component, subgraph

**Take next**:
The Unblocked Issues the viewer could take, in the order the Map suggests taking them: unassigned or their own, and without someone else's open Closing Request. A Parent with open children, other than GitLab tasks, is not in it; its Unblocked children stand in for it.
_Avoid_: ready queue, up next, recommendations

**Issue card**:
What the Map shows about one Issue: its name and URL, whether it is Blocked, its Links by kind, and its open Closing Requests. Moving through the Map goes from one Issue card to the next.
_Avoid_: focus view, detail view, node
