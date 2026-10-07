# A pane draws the Map beside the conversation

The Map lives in the conversation, where each move scrolls the last away, and the HTML Picture lives outside Claude Code. Claude Code now lets a plugin's hooks module open a pane beside the transcript and draw it. So `/issue-map pane` opens the Issue Map pane, drawn by the hooks module, `hooks/plugin.tsx`, with no model turn.

It is drawn from what `issue-map pane` prints: the HTML Picture's own data (ADR 0010), with each of the Project's own Issues' Links and whether it's assigned, as one line of JSON, from the same Snapshot the Map is drawn from. So it never disagrees with the Map on Take next or the Groups. It is read again when the pane opens, after each turn, and every two minutes while it's open. During a Project's first read, when there's no Map to draw yet, `issue-map pane` prints how far the read has got instead, and the pane asks again every few seconds, so the Map draws as soon as the read finishes.

It is made of screens that lead one to another, each fitting the pane with no scroll bar:

- **Map**: the Project, a share line ("15 to take next, 34 waiting, 228 other Unlinked"), the Issue to start with, the Groups as a sea chart that fills the rest, and buttons for Take next, the Groups and the Unlinked list. A Project with no Group to draw lists its Unlinked Issues in the chart's place, beside Suggest Links ↗.
- **Island**: a Group opened in place. It grows into the chart while the others sink, and its Issues stand as one outline, as the HTML Picture draws a narrow screen (ADR 0013). A red arrow is a Blocks Link and a dotted line a Parent Link, and no line crosses a box. Each box says its state in a word: "1st in Take next", "Unblocked", "Blocked" or "Outside".
- **Issue**: its title and state, Brief me ↗, Assign to me ↗, a link to the Tracker, and its Links to go on to.
- **Take next, Groups and Unlinked**: one list each, paged to fit.

The way up goes up the Map's own levels and names where it leads: an Issue to its island, or in none to the Unlinked list; an island or a list to the Map. No trail of presses is kept, and screens name Issues by reference, so a screen still names the same Issue once the data is read again.

Nothing in the drawing explains it in words. The state words name the colours, the red arrow lands on a box that says "Blocked", indentation shows what sits under what, and pointing at an island names it. Every label in the chart is fitted to its room from a table of the system faces' widths, since the hooks module has no canvas to measure with.

Writes stay with Claude (ADR 0012). Brief me ↗ and Suggest Links ↗ send Claude a prompt; Assign to me ↗ fills the prompt box for the user to send, since it writes. Issue links never leave the pane; the Tracker is reached only through its own link.

## Building it

- **The chart takes no presses of its own.** A desktop `Svg` is an image, and whatever is drawn over a `Client` region keeps the pointer from it, so no region can take presses through the chart. So the pane writes each island's number and size over the chart as Buttons, which take a press wherever they're drawn, and draws each Issue's box itself, a frame round its reference and its title as Buttons, so the words always fit their box. The chart is drawn on the pane's grid of cells, so what the pane writes at a cell lands where the chart left room for it. Each island's label is a hover scope: pointing at it shows the island's name card over the chart's foot, with no round trip to the hooks module.
- **On the desktop a link is a `Client` region.** A press on a Markdown link there reaches no plugin, so each link in a list is a region that draws its text and posts the screen it leads to.
- **The terminal has no `Svg`.** There the numbered Groups stand in for the chart, an opened Group is an indented list, and each row's Button takes a hotkey.
- **On Windows the CLI is run through Node.** `bin/issue-map` is a bash script, which a process started with no shell can't run, so there the hooks module runs `node src/cli.ts` itself, for the pane, `/issue-map` and the status line alike. Every process the CLI starts is started hidden: a read runs detached, with no console, so each `gh` or `git` it ran opened a window of its own.

## Considered Options

The look was drawn from the recorded Snapshots of opentofu and playwright and the README's fixture, at three pane widths and in both themes, on a throwaway branch (`prototype/pane-look`).

- **Start here**: led with one decision, the Issue to take next.
- **Board**: answered "you can start", "waiting" and "not linked".
- **Chart**: the HTML Picture's sea, in the pane. Chosen, with Start here's first Issue and Board's share line.
- **Open an island below the chart**, rather than in place.
- **One view holding everything**: it needed scroll bars, and captions to explain the drawing, so it became screens that lead one to another.
- **Back along the presses made**, rather than up a level.

## Consequences

- **Only on Claude Code builds that open panes from hooks modules**, as the status line (ADR 0011) and `/issue-map` (ADR 0012). The pane opens only when asked for; it never opens by itself.
- **The chart's labels are placed by measure.** A cell was measured at 10 by 24 pixels, and the pane's text at 15 pixels, on one desktop. Where a desktop sets them far from that, labels sit off their islands and boxes. Every island and Issue is also reached from the lists.
- **Escape can't go up.** In a pane it hands the keys back to the prompt; the way up is the "←" button.
- **The chart's look is checked by eye.** The suite checks its geometry, that labels fit and that no line crosses a box; screenshots checked how it looks.
