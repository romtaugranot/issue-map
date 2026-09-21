# Issue Map

A Claude Code plugin that draws a Project's open Issues as a Map joined by their Links, so the user can see which Issue to take next and move between Projects.

## Language

### Issues and Projects

**Issue**:
One unit of work recorded on a Tracker, whatever the Tracker calls or types it; GitLab's tasks count. A pull or merge request is not an Issue.
_Avoid_: ticket, work item, task

**Tracker**:
The system that holds a Project's Issues — GitHub, GitLab (gitlab.com or self-hosted, any tier), or another.
_Avoid_: forge, provider, platform

**Project**:
One collection of Issues on a Tracker — a GitHub repository or a GitLab project. Not a GitHub Projects planning board.
_Avoid_: repo (when meaning the Issues' container)

**Home Project**:
The Project behind the local git checkout Claude Code is running in; the Map opens on it.
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

**Blocked Issue**:
An open Issue that at least one open Issue, in any Project, Blocks. Being Blocked does not pass along Parent Links.
_Avoid_: waiting, dependent

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
