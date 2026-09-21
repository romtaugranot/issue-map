# Issue Map

A Claude Code plugin that draws a Project's open Issues as a Map joined by their Links, so the user can see which Issue to take next and move between Projects.

## Language

**Issue**:
One unit of work recorded on a Tracker, whatever the Tracker calls it.
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

**Link**:
A relationship between two Issues that the Tracker records.
_Avoid_: dependency, relation, edge

**Map**:
The drawing of a Project's open Issues joined by their Links, which the user moves through. Not the `wayfinder:map` issue that plans this effort.
_Avoid_: graph, board, tree

**Unlinked Issue**:
An open Issue with no Link, listed beside the Map rather than drawn in it.
_Avoid_: orphan, loose issue
