# Issue Map

A Claude Code plugin that draws a Project's open Issues as a Map joined by their Links, so the user can see which Issue to take next and move between Projects.

## Language

### Issues and Projects

**Issue**:
One unit of work recorded on a Tracker, whatever the Tracker calls or types it; GitLab's tasks count. A pull or merge request is not an Issue.
_Avoid_: ticket, work item, task

**Task-level child**:
An Issue the Tracker puts at its smallest level, under an ordinary Issue rather than beside it — on GitLab, a task. A Parent whose open children are all task-level children stays in Take next itself; they never stand in for it.
_Avoid_: subtask, checklist item

**Tracker**:
One running system, at one host, that holds Projects' Issues — github.com, a GitHub Enterprise Server, gitlab.com, a self-hosted GitLab, or another. GitHub and GitLab are kinds of Tracker; each Tracker runs its own version.
_Avoid_: forge, provider, platform, instance, deployment

**Project**:
One collection of Issues on a Tracker: the container every Issue belongs to exactly one of. On GitHub it is a repository, on GitLab a project. Not a planning board or an initiative that gathers Issues from several Projects, such as a GitHub Projects board.
_Avoid_: repo (when meaning the Issues' container)

**Band**:
How far the Map stands behind a Project, from what its Tracker shows there (ADR 0003): **Promised**, tested and able to write Link Suggestions; **Best effort**, read-only and marked untested, on a version the Map isn't tested on, or one it can't learn, where it can still read a Link kind; **Refused**, where no Link kind can be read, with why. The Map states the band.
_Avoid_: support level, tier (GitLab's tiers are its paid plans)

**Closing Request**:
A pull or merge request that closes an Issue when it is merged, as the Tracker records it. It is not an Issue, and the Map never follows it.
_Avoid_: linked PR, development link, fix

**Home Project**:
The Project the Map opens on for the local git checkout Claude Code is running in. When the checkout's remotes lead to several Projects with open Issues, it is the one the user picked.
_Avoid_: current repo, default project

### Links

**Link**:
A relationship with a meaning that someone set between two Issues on the Tracker: a Blocks Link, a Parent Link or a Related Link. A relationship the Tracker sets by itself is not a Link.
_Avoid_: dependency, relation, edge

**Blocks Link**:
A Link saying one Issue must be done before another can be; it has a direction.
_Avoid_: dependency, depends on

**Parent Link**:
A Link placing one Issue inside another. An Issue can have more than one parent.
_Avoid_: sub-issue link, epic link, tracked-by

**Related Link**:
A Link saying two Issues belong together, with no direction or order. Any other kind someone set, other than duplicates, counts as a Related Link and keeps the Tracker's own name for it on the Issue card. It is drawn but joins no Group, except between Issues that have no Parent or Blocks Link.
_Avoid_: relates to, relation

**Mention**:
One Issue naming another in its text, which the Tracker notes. A Mention is not a Link. Where a Tracker records Mentions as Related Links, with nothing to tell the two apart, they count as Related Links.
_Avoid_: cross-reference, crosslink

**Link Suggestion**:
A Link Claude proposes from an Issue's text that the Tracker doesn't record. It is never drawn, and it becomes a Link only once the user confirms it and it is written to the Tracker.
_Avoid_: inferred Link, guessed Link, implied Link

**Blocked Issue**:
An open Issue that at least one open Issue, in any Project, Blocks. Being Blocked does not pass along Parent Links.
_Avoid_: dependent

**Waits on**:
An Issue waits on another when that one Blocks it, or Blocks an open Issue it waits on. A Blocked Issue is one that waits on an open Issue.
_Avoid_: depends on, downstream of, behind

**Unblocked Issue**:
An open Issue that no open Issue Blocks, and that has a Link to another open Issue or that a closed Issue Blocks, in a Project whose Blocks Links the Map can read. Where the Map can't read them, because the Project can't record them or the Map can't see them, no Issue is Unblocked.
_Avoid_: ready, available, actionable

### The Map

**Map**:
The drawing of one Project's open Issues joined by their Links, which the user moves through. It never holds another Project's Issues; they appear only as Outside Issues. Not the `wayfinder:map` issue that plans this effort.
_Avoid_: graph, board, tree

**Snapshot**:
The saved copy of one Project's open Issues and Links, as one login last read them from the Tracker. The Map is drawn from it, and it says how old it is once it stops being fresh.
_Avoid_: cache, saved copy

**Outside Issue**:
An open Issue outside the Project that a Link reaches. The Map draws it but does not follow its own Links; the Project's Links to it are still drawn, so it can join Issues into one Group and pass Waits on. An Issue the user can't read is drawn as one without a name.
_Avoid_: stub, foreign issue, external issue

**Unlinked Issue**:
An open Issue with no Link to another open Issue, listed beside the Map rather than drawn in it. It is still Unblocked if a closed Issue Blocks it and no open one does.
_Avoid_: orphan, loose issue

**Group**:
A set of open Issues joined by Parent and Blocks Links, directly, through one another or through an Outside Issue they share, together with the Outside Issues those Links reach. An Issue with neither kind is grouped with the Issues it is Related to that likewise have neither. The Map lists a Project's Groups.
_Avoid_: cluster, component, subgraph

**Take next**:
The Unblocked Issues the viewer could take, in the order the Map suggests taking them: unassigned or their own, and without someone else's open Closing Request. A Parent with open children, other than task-level children, is not in it; its Unblocked children stand in for it. Where the Tracker doesn't record Closing Requests or their authors, none is assumed and the Map says so.
_Avoid_: ready queue, up next, recommendations

**Planned date**:
The date an Issue is planned for, as the Tracker records it — on GitHub and GitLab, its milestone's due date. Take next orders by the earliest one.
_Avoid_: deadline, target date, milestone date

**Issue card**:
What the Map shows about one Issue: its name and URL, whether it is Blocked, its Links by kind, and its open Closing Requests. Moving through the Map goes from one Issue card to the next.
_Avoid_: focus view, detail view, node
