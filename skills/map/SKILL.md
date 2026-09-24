---
name: map
description: The Map of this checkout's Project and its open Issues. Use when the user asks for the Map, their Home Project, a Group or what sits under an Issue, an Issue's card or its Links, their Unlinked Issues, or which Issue to take next.
---

# The Map

The Map is drawn about the checkout's **Home Project**. Run every command in the checkout.

- **The Map**: `issue-map map`.
- **A Group's outline**: `issue-map group <n>`, where `n` is the Group's place in the overview's Group lines, counting from 1 at the top. It lists what sits at the Group's top, one level at a time. When the user picks a Group off the overview, open it by its place, even when they name it by the Issue on its line.
- **The level beneath an Issue**: `issue-map group '<ref>'` with the reference as the outline or overview prints it (`#123`, `owner/name#45`, `group&12` — drop a leading `↗`), or the Issue's URL. Quote it: `#` starts a shell comment. When the user says `more` on an outline, run the same command with `--page <n>` for the next page.
- **An Issue's card**: `issue-map issue '<ref>'`, with the reference as the Map prints it or the user types it (`#123`, `owner/name#45`, a leading `↗` is fine), or the Issue's URL. Use it when the user opens, shows or asks about one Issue; use `group '<ref>'` only for what sits beneath it. A card is read live from the Tracker, so it opens even while the Map is being read for the first time. When the user says `more` on a card, run the same command with `--page <n>` for the next page of its Links.
- **The Unlinked Issues**, 15 a page, newest first: `issue-map unlinked`, and `issue-map unlinked --page <n>` when the user says `more` or asks for a page.
- **Which Project is home**: `issue-map home`.

Reprint the output in your reply exactly as printed: tool output isn't reliably shown to the user, and the Map is already cut to fit one screen. Don't summarise it, reorder it or add Issues to it.

## Take next

The overview opens with **Take next**: the Unblocked Issues the user could take, in an order a fixed rule gives — how many open Issues wait on each (`▶n`), then the earliest Planned date, then the oldest. It is never your judgement, so it is the same on every draw. When the user asks what to take next, draw the Map and point at that list.

A closed blocker still unblocks, so Take next can hold Unlinked Issues. `unblocked 2d ago` dates when the last of an Issue's blockers closed, from the Tracker's close dates; a blocker that closed as a duplicate or as not planned is named with how it closed. Closed Issues are never drawn in the overview or an outline — only on cards.

When the user asks what *you* would pick, give your opinion in the conversation: say which Issue and why, quoting what the Map or the Issues say. Keep it separate from the list, and never reorder, redraw or trim Take next to match it.

When the output says the Project is being read for the first time, that is all there is to show: the read carries on by itself, and running `issue-map map` again shows how far it has got, then the Map once it's done.

The Map is drawn from a Snapshot, refreshed first when it's more than two minutes old. When it opens with a `⚠ read … ago` line, the Tracker couldn't be read and the Map is as old as it says; reprint that line with the rest, and asking again tries again. An Issue card is always read live, so it is never old.

## Moving along Links

A card shows the Issue's name and URL, whether it is Blocked, its Links by kind under the Tracker's own names, its open Closing Requests, and how many other Issues mention it. Reprint the card itself exactly; the **Links to follow** block under it is for you, not the user. The card prints the Issue's URL, so never offer to open it in a browser.

When the card has Links to follow, ask with `AskUserQuestion` which one to follow: up to three of them in the block's order, labelled with the Link's reference and with its description as the option's description, then a fourth option — **More Links** while any are left, otherwise **The Map**. **More Links** asks again with the next three. "Other" takes any reference or URL the user types. Open the picked Issue's card with `issue-map issue '<label>'`, reprint it, and ask again from there; **The Map** runs `issue-map map`. A card with nothing to follow asks nothing. Never offer a Closing Request or a Mention as a choice: a Closing Request isn't an Issue, and a Mention isn't a Link — the card only counts Mentions, which Link Suggestions are for.

When `AskUserQuestion` isn't available, as under `claude -p`, reprint the card and stop.

## When the Home Project is a tie

When the output ends in **choices, best guess first**, the checkout leads to several Projects with open Issues, and the user picks one. Ask once with `AskUserQuestion`: one option per choice, labelled with the choice's `host/path`, its description as the option's description, and "(Recommended)" after the first label. "Other" takes a Project's URL. Then run `issue-map home --pick <URL>` with the picked choice's URL, relay its output, and run the command the user first asked for. The pick is saved, so later runs don't ask. When the output says the pick couldn't be saved, pass the same `--pick <URL>` to every later `issue-map` command this session.

When `AskUserQuestion` isn't available, as under `claude -p`, list the choices for the user and stop: the Home Project stays unpicked, and nothing is saved.
