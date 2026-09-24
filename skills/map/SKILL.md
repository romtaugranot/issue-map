---
name: map
description: The Map of this checkout's Project and its open Issues. Use when the user asks for the Map, their Home Project, a Group or what sits under an Issue, an Issue's card or its Links, their Unlinked Issues, or which Issue to take next; or to move to another Project, `go`, `back` or `home`.
---

# The Map

The Map opens on the checkout's **Home Project**, and every command acts on the Project on screen: the Home Project until the user moves to another. Run every command in the checkout.

- **The Map**: `issue-map map`, the overview of the Project on screen. Run it when the user types `map`.
- **A Group's outline**: `issue-map group <n>`, where `n` is the Group's place in the overview's Group lines, counting from 1 at the top. It lists what sits at the Group's top, one level at a time. When the user picks a Group off the overview, open it by its place, even when they name it by the Issue on its line.
- **The level beneath an Issue**: `issue-map group '<ref>'` with the reference as the outline or overview prints it (`#123`, `owner/name#45`, `group&12` — drop a leading `↗`), or the Issue's URL. Quote it: `#` starts a shell comment. When the user says `more` on an outline, run the same command with `--page <n>` for the next page.
- **An Issue's card**: `issue-map issue '<ref>'`, with the reference as the Map prints it (`#123`, `owner/name#45`, a leading `↗` is fine), or a `#123` the user types. An Issue the user names another way — its URL, or `owner/name#45` typed — is a target to move to (see **Moving to another Project**). Use it when the user opens, shows or asks about one Issue; use `group '<ref>'` only for what sits beneath it. A card is read live from the Tracker, so it opens even while the Map is being read for the first time. When the user says `more` on a card, run the same command with `--page <n>` for the next page of its Links.
- **The Unlinked Issues**, 15 a page, newest first: `issue-map unlinked`, and `issue-map unlinked --page <n>` when the user says `more` or asks for a page.
- **Moving**: `issue-map go`, `issue-map back` and `issue-map home` — see **Moving to another Project**.

Reprint the output in your reply exactly as printed: tool output isn't reliably shown to the user, and the Map is already cut to fit one screen. Don't summarise it, reorder it or add Issues to it.

## Take next

The overview opens with **Take next**: the Unblocked Issues the user could take, in an order a fixed rule gives — how many open Issues wait on each (`▶n`), then the earliest Planned date, then the oldest. It is never your judgement, so it is the same on every draw. When the user asks what to take next, draw the Map and point at that list.

A closed blocker still unblocks, so Take next can hold Unlinked Issues. `unblocked 2d ago` dates when the last of an Issue's blockers closed, from the Tracker's close dates; a blocker that closed as a duplicate or as not planned is named with how it closed. Closed Issues are never drawn in the overview or an outline — only on cards.

When the user asks what *you* would pick, give your opinion in the conversation: say which Issue and why, quoting what the Map or the Issues say. Keep it separate from the list, and never reorder, redraw or trim Take next to match it.

When the output says the Project is being read for the first time, that is all there is to show: the read carries on by itself, and running `issue-map map` again shows how far it has got, then the Map once it's done.

The Map is drawn from a Snapshot, refreshed first when it's more than two minutes old. Drawing it starts a refresher that keeps the Home Project's Snapshot warm in the background, so the Map is usually drawn at once, and a full re-read runs in the background when one is due; the Map is drawn from the Snapshot there meanwhile, so there is never anything to wait for. The overview's header ends with the Project's band: `Promised`, or `Best effort` with a `⚠ Best effort` line saying why the Map is untested there and writes nothing. A `⚠` line may also name a Link kind the Map can't read in the Project, and when it can read none it draws no Map and says why. Reprint those lines as printed. When it opens with a `⚠ read … ago` line, the Tracker couldn't be read and the Map is as old as it says; reprint that line with the rest, and asking again tries again. An Issue card is always read live, so it is never old.

## Moving along Links

A card shows the Issue's name and URL, whether it is Blocked, its Links by kind under the Tracker's own names, its open Closing Requests, and how many other Issues mention it. Reprint the card itself exactly; the **Links to follow** block under it is for you, not the user. The card prints the Issue's URL, so never offer to open it in a browser.

When the card has Links to follow, ask with `AskUserQuestion` which one to follow: up to three of them in the block's order, labelled with the Link's reference and with its description as the option's description, then a fourth option — **More Links** while any are left, otherwise **The Map**. **More Links** asks again with the next three. "Other" takes any target the user types, which `issue-map go '<target>'` moves to. Open the picked Issue's card with `issue-map issue '<label>'`, reprint it, and ask again from there; **The Map** runs `issue-map map`.

An Outside Issue's card has no Links to follow, since the Map hasn't read its Project, but under **Choices** it offers to open that Project's Map. Ask with that choice, labelled as printed, and **The Map**; the choice runs the command under it, which lands on the Issue's card in its own Project's Map, with its Links. A card with nothing to follow and no choices asks nothing. Never offer a Closing Request or a Mention as a choice: a Closing Request isn't an Issue, and a Mention isn't a Link — the card only counts Mentions, which Link Suggestions are for.

When `AskUserQuestion` isn't available, as under `claude -p`, reprint the card and stop.

## Moving to another Project

The user moves by typing a target, or with `go`, `back` and `home` — in the prompt, or in a picker's "Other".

- **A target**: a Project's URL, an Issue's URL, an `owner/repo` or `group/sub/project`, the same with `#n` for an Issue, or a local path. Run `issue-map go '<target>'` with it as the user typed it. A Project lands on its overview, an Issue on its card inside its own Project's Map. A reference the Map printed, such as `#12` or one on a card, opens with `issue` instead, as above.
- **`go` on its own**: run `issue-map go`, adding `--dir '<path>'` for each directory added to this session. It offers up to four nearby Projects under **Choices**; ask with `AskUserQuestion`, one option per choice, and "Other" takes a typed target.
- **`back`**: `issue-map back` retraces this session's trail one step, across Projects.
- **`home`**: `issue-map home` returns to the Home Project's overview. Typed on that overview, it offers the checkout's Projects to pick the Home Project from again, under **Choices**.
- **No Home Project**, when the checkout leads to no Tracker: the Map opens on `go`, so answer a request for the Map with `issue-map go` and its `--dir` flags.
- To say **which Project is home**: away from it, the overview's `⌂ Home:` line names it; at home, it's the Project on screen.

A move that can't open says why and leaves the user where they were; reprint that and ask nothing. Moving never changes the Home Project or what is kept warm for it. Away from home, everything works the same, on that Project's own band and login.

## Choices

When the output ends in **Choices, best first**, ask once with `AskUserQuestion`: one option per choice, labelled with the choice's label, its description as the option's description, and "(Recommended)" after the first label when the output asks which one is the Home Project. Run the command under the picked choice, relay its output, and carry on. When a choice is typed in "Other", run `issue-map go '<what they typed>'`, or, when picking the Home Project, `issue-map home --pick '<URL>'`.

When the checkout leads to several Projects with open Issues, the output asks which one is the Home Project before anything else is drawn. The picked command draws the Home Project's overview; if the user first asked for something else, run that too. The pick is saved, so later runs don't ask. When the output says the pick couldn't be saved, pass the same `--pick <URL>` to every later `issue-map` command this session. When a local path leads to several Projects, the pick is saved in that checkout in the same way.

When `AskUserQuestion` isn't available, as under `claude -p`, list the choices for the user and stop: nothing is picked or saved, and a typed target still moves.
