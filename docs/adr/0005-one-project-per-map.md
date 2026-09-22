# A Map is one Project; Outside Issues join it but aren't followed

A Map holds the open Issues of one Project. An Issue in another Project that a Link reaches is an Outside Issue: it is drawn, but its own Links are never read. The Links that the Project's Issues have to it are all read, though. So an Outside Issue can join two of the Project's Issues into one Group, for example as a GitLab epic that parents both, and Waits on can pass through it (#5 Blocks X, X Blocks #9, so #9 waits on #5). Neither needs an extra read. Blocked stays correct across Projects without widening the Map, because an Issue's blockers are read wherever they live. Other Projects are reached by moving to them, never by merging them into one Map.

## Considered Options

- **A Map of a GitLab group or a GitHub owner.** Epics would become ordinary Issues on the Map, and GitLab can list a group's Issues in one paged read. But GitHub can list an owner's Issues only through search, which stops at 1,000 results. Take next, the Home Project and the status line would all have to mean something new across Projects.
- **A Map of a set of Projects the user picks**, such as a frontend and a backend that block each other. This needs a saved set, and Take next would need a rule across Projects and across support bands.
- **Follow Outside Issues one step.** The edge is arbitrary, and it costs reads on every draw. The Outside Issues already joining Groups gives most of the benefit.

## Consequences

- **Take next never holds an Outside Issue.** Its own Blocks aren't read, so it can't be called Unblocked.
- **`▶n wait on it` counts Outside Issues** that wait on an Issue, directly or through another Outside Issue.
- **An Outside Issue joins Issues only when both Links name the same Issue** as the Tracker identifies it. A closed one joins nothing.
- **One widely shared Outside Issue**, such as a large epic, can merge many Issues into one big Group.
- **A team that plans with GitLab epics across Projects** sees each Project's part of an epic, not the whole epic.
