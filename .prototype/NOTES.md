# The Issue Map pane: design

PROTOTYPE — throwaway, on branch `prototype/pane-look`. The design here was approved on 2026-10-07. The next step is to build it for real in the plugin's hooks module. When building, rewrite it properly rather than promoting the prototype's code, then delete `.prototype/`.

**The question it answered:** what should the Issue Map look like as a pane in the Claude desktop app's Code tab, so it's simple to understand?

## Run it

```sh
node .prototype/pane.ts     # builds pane.html (and round 1's pane.round1.html) from the recorded Snapshots
node .prototype/serve.ts    # http://localhost:4173
```

The URL takes `?project=small|opentofu|playwright&width=340|420|520&theme=light|dark`, and the floating bar sets the same. Data is real, built through `pageData`: the README's small fixture, opentofu (277 open) and playwright (176 open, no Links). Round 1's three variants are at `/pane.round1.html`.

## The design

### Screens

Each screen holds one thing, and each fits the pane's height with no scroll bar.

| Screen | Holds | Leads to | Up (← names it) |
|---|---|---|---|
| **Map** (home) | Project name (owner dim, name strong), the share bar with "15 to take next, 34 waiting, 228 other Unlinked", the "Start with" row, the sea chart filling the rest, and the buttons "15 Take next", "12 Groups", "233 Unlinked" | an island, the "Start with" Issue, a list | — |
| **Island** | Opens in place from the chart. Its Issues form an outline, paged inside the island with "n more" and "Earlier". The island is as tall as what it holds. | an Issue | Map |
| **Issue** | Title, state ("Blocked by #1. Unassigned. 3rd in Take next."), Brief me ↗, Assign to me ↗, Open on GitHub, then its Links one per line (kind, Issue, state), paged | another Issue | its island, paged to it and outlined; Unlinked list if in no Group |
| **Take next / Groups / Unlinked** | One list each, paged with "Earlier" and "More". Take next and Groups are numbered, since both are orders. | an Issue or an island | Map |

- **Up, not back.** The button goes up the Map's own levels and names where it leads; Escape does the same. There's no trail of presses.
- **Issue links never leave the pane.** In the real pane that's `Markdown` with `onLinkPress`. GitHub is reached only through its own button.

### The chart

- **Islands.** Each island is a Group, packed into the chart's width and height from the largest out.
  - Each shows its number (largest first) and Issue count, with a ring of shallow water around it.
  - Its green ring fills with the share Unblocked.
  - An amber lantern marks an island holding an Issue in Take next. It's larger on the island holding the "Start with" Issue, tying the two together.
- **Names on hover.** Pointing at an island names it in a strip over the bottom of the chart, with its counts.
- **Opening an island.** The island grows into the chart while the others sink, and its Issues rise in with their lines drawing in, as the HTML Picture does (ADR 0013). This is the only motion, and it's dropped under reduced motion.
- **An opened island** is drawn the way the HTML Picture draws a Group below 560px: one column, each Issue indented under the one it was first reached from, with a line running down the left into it. A red arrow means Blocks; a dotted line means Parent. Lines never cross a box.
- **Issue boxes** have a calm outline, with state as a colored dot plus a word at the right: "1st in Take next", "Unblocked", "Blocked" or "Outside". An Outside Issue's box is dashed. The Issue just left is outlined in ink.

### No captions

Nothing explains the drawing in words: the drawing says it.
- The state words name what the colors mean.
- The red arrow lands on a box that says "Blocked".
- Indentation shows what sits under what.
- Hovering names an island.

Copy keeps only data ("4 wait on its parent #3414"), never instructions or legends.

### Fitting

Every label in the chart is fitted to its measured width. Titles wrap to 2 lines, or to 1 where that fits more rows. Lists and the island outline measure how many rows fit, with their pager in place.

The prototype's checks covered 558 views and more: 3 heights, 3 widths and 3 Projects, every screen, island, Issue and second page. They found no scroll bar, no clipped text, no line crossing a box, and no pane wider than its window.

### Look

The look is the HTML Picture's sea chart (ADR 0013), set for light and dark:

| Token | Light | Dark | For |
|---|---|---|---|
| water | `#e7f0f4` | `#0f2536` | chart ground |
| shallow | `#d7e7ee` | `#14304a` | ring round each island |
| land | `#fbfcfb` | `#16334a` | islands, the opened island |
| coast | `#a9c6d1` | `#2d5470` | dotted shore, box outlines |
| go | `#0e8a76` | `#5fd0b9` | Unblocked |
| stop | `#cf4f3a` | `#ff8a72` | Blocks, Blocked |
| pick | `#a8720a` | `#f2c45c` | Take next, the lantern |
| pick-wash | `#fbf1d8` | `#2e2a1a` | the "Start with" row, the Issue just left in a list |
| ink / muted / faint | `#10242f` / `#4c6573` / `#86a0ad` | `#e4edf1` / `#9fb3bf` / `#627d8e` | text |

Type is the app's own UI face. There's one heading per screen and bold for names; numbers use tabular figures.

### Hand-offs

↗ marks a step handed to Claude.
- **Brief me ↗ and Suggest Links ↗** send a prompt (`start work on #n`, `suggest Links`).
- **Assign to me ↗** fills the prompt box for the person to send, since it writes.
- **Writes** stay with Claude, which asks before each (ADR 0012).

## Building it in the plugin

What the real pane needs, from the plugin-authoring API (Claude Code 2.1.289, early access; check the types again when building):

- **Opening.**
  - The hooks module (`hooks/plugin.ts`) opens a pane with `$.ui.open({ id, title })`.
  - It draws through a `ui.render` hook on `{ component: 'Pane', requestId }`, with elements from `$.ui.resolve(e)`.
  - The screen shown lives in `$.state`, declared in a `types/index.d.ts` contract.
- **Data.** The hooks module has no Node, so it reaches the CLI through `$.process.run`. It needs a new CLI verb that prints one screen's data as JSON, built from `pageData` (`src/map/page.ts`) and an Issue's Links, so it can never disagree with the Map. Navigation is by level, so the pane keeps no trail.
- **Elements.**
  - Text, `Markdown` (Issue links through `onLinkPress`), native `Button`s, one `Svg` per screen, and `Box` hover styles for rows.
  - Large type comes only from a Markdown heading.
  - Desktop `$.ui.copy` doesn't work yet.
- **Size.**
  - The pane's room is `Pane` props `bodyColumns` and `scroll.bodyRows`, in cells. The `Svg` is sized from them, and converting cells to pixels is an estimate.
  - The CLI draws the chart in Node, which has no canvas, so text fitting needs a width table for the system face, set wide enough that a label never overflows.
- **Motion and hover.** In an `Svg` with `isInteractive`, SMIL animates the opening and CSS `:hover` shows the island names.
- **Terminal fallback.** The terminal has no `Svg`, so the numbered Group list stands in for the chart, and Buttons take hotkeys.

### Unproven: try these first

1. **Clicking the chart.** A desktop `Svg` takes no clicks. Clickable islands and Issue boxes need a `Client` region laid over the chart (`Box position: "absolute"`). Its `onPointer` reports the cell under the pointer, the module posts it to the hooks module, and that hit-tests it against the layout it drew. If that can't work, the numbered lists open islands and Issues instead.
2. **Inside the pane's `Svg`.** Check that `isInteractive` really keeps SMIL and `:hover` there, and that the chart's colors follow the app's light or dark theme (`prefers-color-scheme` inside the `Svg`).
3. **Native Windows.** `bin/issue-map` is a bash script, and the plugin says it's untested on Windows, so `$.process.run` may not start it here. Calling `node src/cli.ts` directly would.

### Still to decide

- **When the pane opens:** only on `/issue-map pane`, or also on its own as a sidebar where the app docks one?
- **Paperwork:** an ADR (0014) for the pane, and any new words for `CONTEXT.md`.

## How we got here

1. **Round 1:** three variants. A, "Start here", led with one decision. B, "Chart", was the HTML Picture's sea in the pane. C, "Board", answered "you can start / waiting / not linked". Picked: B, with more from A and C, and every island opening as it does in the HTML.
2. **Round 2:** B's chart, A's "Start with" and C's share bar. Two ways to open an island: zoom in place, or open below. Picked: zoom in place.
3. **Text running out of view:** labels were cut to guessed lengths. They're now fitted to measured widths, with two-line titles.
4. **Text still drifting:** two causes. The pane never scrolled, and wrapped layers sent lines behind boxes. The opened island became the HTML's narrow-screen outline.
5. **No scroll bar, no captions:** these led to screens that lead one to another, each fitting the pane, with the drawing carrying the meaning.
6. **Back went by history:** it now goes up the Map's own levels.
7. **Polish:**
   - a lantern row for "Start with", and shallow water round the islands
   - calm Issue boxes with state dots
   - Links on one line, and numbered lists
   - a fix for a narrow window, where a long title widened the pane past it
