# Usage

[← Docs](README.md) · [README](../README.md)

Run Claude Code in a git checkout. The Map opens on the checkout's **Home Project**, the Project its remotes lead to. When the remotes lead to several Projects with open Issues, it asks you to pick one and remembers your pick. Then say what you want in plain words, and Claude runs the plugin's commands for you.

On GitLab Free and CE, and on GHES 3.18, the Tracker records no Blocks Links, so there is no Take next. Groups from Parent Links and Link Suggestions still work ([Supported Trackers](../README.md#supported-trackers)).

## What you can say

### The Map

| You say | What happens |
|---|---|
| `map` | The overview of the Project |
| `refresh the Map` | The overview, with its Snapshot refreshed now even if it's under two minutes old, so a Link you just recorded in the browser shows |
| `what should I take next?` | The overview, pointing at Take next. If you ask what Claude would pick, it answers separately and leaves the list's order alone |
| `list Take next` | Every Issue in Take next, 15 a page, in its order, including the ones the overview leaves out |
| `who has the ones taken by others?` | The Unblocked Issues left out of Take next because someone else has them, each with its assignees or its Closing Request's author, 15 a page |
| `list the Groups` | Every Group, 15 a page, largest first, numbered the way `open group <n>` takes them |
| `list the Unlinked Issues` | The Issues with no Link to another open Issue, 15 a page, newest first |
| `more` | The next page of an outline, a card's Links, the Group list, Take next's list, those taken by others, or the Unlinked list |

### Groups and Issues

| You say | What happens |
|---|---|
| `open group 1` | The outline of the first Group on the overview |
| `what's under #5?` | The level beneath an Issue in its Group |
| `open #2` | That Issue's card, read live, then a picker of its Links |
| `draw group 1` | The first Group drawn whole if it holds about 25 Issues or fewer, each Issue on a row under its Parent or the Issue that Blocks it. A larger Group opens as its outline instead |
| `picture around #5` | That Issue marked in the middle. What it waits on and its Parents are above it, and what waits on it and its children are beneath, about three steps each way, with the rest counted. This works even in a Group too large to draw whole |

### Pictures to share

| You say | What happens |
|---|---|
| `group 1 as Mermaid` | That Group's Picture, or the Picture around an Issue, as a Mermaid block to paste where GitHub or GitLab render it, such as a comment on the Group's head Issue. It draws one box per Issue, with Blocks as arrows toward the Issue that waits. `as DOT` gives Graphviz's DOT instead. Nothing is written to the Tracker |
| `show the whole Map in a browser` | One read-only HTML page of the whole Map: the Issue to start with, every Group as an island to open, and lists of Take next, every Group and the Unlinked Issues. Each Issue has a copy button for its URL, which you paste back into the conversation to open its card. The page opens in your browser. Over SSH, it prints the path and an `scp` command to fetch it. In a cloud or Remote Control session, it says the page can't reach your device |
| `publish the whole Map as an Artifact` | The same page as a private claude.ai Artifact, for a session the local page can't reach. It asks before every publish, naming the Project and what is sent, and never shares it. Not offered under `claude -p`, with an API key, on Bedrock, Vertex or Foundry, or where Artifacts are turned off |

### Acting on an Issue

| You say | What happens |
|---|---|
| `assign #2 to me` | Asks once, then assigns the Issue to you |
| `start work on #2` | Claude reads the Issue's body and comments and briefs you in about a dozen lines. It makes no branch, no checkout and no code |
| `suggest Links` | Link Suggestions for the Issues on screen, each quoting the words it stands on, for you to tick |

### Moving around

| You say | What happens |
|---|---|
| `go owner/repo`, `go <URL>`, `go ../other-checkout` | Moves to another Project, or to an Issue in its Project's Map. If more than one Tracker holds it, the Map asks which. `go` alone offers nearby Projects |
| `back` | One step back along this session's trail |
| `home` | Back to the Home Project's overview. If you're already on it, it offers to pick the Home Project again |
| `take the Map out of my status line` | Removes the status line 0.1.0 wrote into your settings, and puts back any status line you already had |

If Claude doesn't pick up the Map from what you say, invoke its skill by name: `/issue-map:map`, followed by what you want.

## `/issue-map`: the Map without waiting for Claude

Type `/issue-map` for the Map, or `/issue-map` followed by a view, such as `/issue-map group 1`, `/issue-map issue 2` or `/issue-map back`. It shows the output at once, with no reply to wait for. Claude reads it too, so you can carry on by asking ([ADR 0012](adr/0012-a-slash-command-shows-the-map-without-claude.md)). Assigning, briefings and Link Suggestions are still asked of Claude.

It needs a Claude Code build that loads plugins' hooks modules.

## The Issue Map pane

`/issue-map pane` opens the Map in a pane beside the conversation ([ADR 0014](adr/0014-a-pane-draws-the-map-beside-the-conversation.md)). It opens on the Map: the Project, how many Issues are there to take next, waiting and Unlinked, the Issue to start with, and each Group as an island, its ring filling with the share Unblocked and a lantern on one holding an Issue in Take next. Point at an island to name it, and select it to open it. Its Issues stand in one column, each under the one it was reached from: a red arrow is a Blocks Link and a dotted line a Parent Link.

Select an Issue for its screen: its state, its Links to go on to, a link to the Tracker, **Brief me ↗**, which asks Claude to start work on it, and **Assign to me ↗**, which puts the request in the prompt box for you to send. The "←" button goes up a level and names where: an Issue to its Group, or in none to the Unlinked list, and a Group or a list to the Map. Take next, the Groups and the Unlinked list each have a button on the Map.

On the terminal, where no chart is drawn, the Groups are a numbered list, and each row's number presses it while the pane has the keys. The pane reads the Map again after each turn, and every two minutes while it's open. On a Project's first read it shows how far the read has got, and draws the Map as soon as it finishes. It needs a Claude Code build that opens plugins' panes.

## The status line

The plugin pins a status line of its own under the prompt, beside yours, with nothing to set up. It shows the Home Project's first Issue in Take next ([example](../README.md#usage)) and never reads the Tracker itself. It needs a Claude Code build that loads plugins' hooks modules ([ADR 0011](adr/0011-the-status-line-is-the-plugins-own.md)).

## How the output reaches the screen

Claude doesn't retype the Map. Each output ends with a line such as `⟦issue-map 3f9a0c1b2d4e⟧`. Claude writes that line in its reply, and the plugin's display hook shows the output in its place, exactly as printed ([ADR 0009](adr/0009-show-output-through-a-display-hook.md)).

In some sessions the display hook doesn't run: hooks are disabled, only managed hooks are allowed, or Node isn't on the hook's `PATH`. The next command notices, Claude says so once, and from then on it reprints each output.

Under `claude -p` there are no pickers and no display hook. Claude reprints each output instead, and asks nothing.
