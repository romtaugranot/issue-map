---
name: map
description: The Map of this checkout's Project and its open Issues. Use when the user asks for the Map, their Home Project, a Group or what sits under an Issue, an Issue's card or its Links, their Unlinked Issues, or which Issue to take next; to assign an Issue to themselves or start work on one; for Link Suggestions, the Links nobody recorded; to move to another Project, `go`, `back` or `home`; or to set up the Map's status line.
---

# The Map

The Map opens on the checkout's **Home Project**, and every command acts on the Project on screen: the Home Project until the user moves to another. Run every command in the checkout.

- **The Map**: `issue-map map`, the overview of the Project on screen. Run it when the user types `map`.
- **A Group's outline**: `issue-map group <n>`, where `n` is the Group's place in the overview's Group lines, counting from 1 at the top. It lists what sits at the Group's top, one level at a time. When the user picks a Group off the overview, open it by its place, even when they name it by the Issue on its line.
- **The level beneath an Issue**: `issue-map group '<ref>'` with the reference as the outline or overview prints it (`#123`, `owner/name#45`, `group&12` — drop a leading `↗`), or the Issue's URL. Quote it: `#` starts a shell comment. When the user says `more` on an outline, run the same command with `--page <n>` for the next page.
- **An Issue's card**: `issue-map issue '<ref>'`, with the reference as the Map prints it (`#123`, `owner/name#45`, a leading `↗` is fine), or a `#123` the user types. An Issue the user names another way — its URL, or `owner/name#45` typed — is a target to move to (see **Moving to another Project**). Use it when the user opens, shows or asks about one Issue; use `group '<ref>'` only for what sits beneath it. A card is read live from the Tracker, so it opens even while the Map is being read for the first time. When the user says `more` on a card, run the same command with `--page <n>` for the next page of its Links.
- **Assigning an Issue to yourself**: `issue-map assign '<ref>'` — see **Assigning an Issue to yourself**.
- **Starting work on an Issue**: `issue-map start '<ref>'` — see **Starting work on an Issue**.
- **Link Suggestions**: `issue-map suggest`, then `issue-map offer` and `issue-map confirm` — see **Link Suggestions**.
- **The Unlinked Issues**, 15 a page, newest first: `issue-map unlinked`, and `issue-map unlinked --page <n>` when the user says `more` or asks for a page.
- **Moving**: `issue-map go`, `issue-map back` and `issue-map home` — see **Moving to another Project**.
- **The status line**: `issue-map statusline --setup` — see **The status line**.

Reprint the output in your reply exactly as printed: tool output isn't reliably shown to the user, and the Map is already cut to fit one screen. Don't summarise it, reorder it or add Issues to it.

## Take next

The overview opens with **Take next**: the Unblocked Issues the user could take, in an order a fixed rule gives — how many open Issues wait on each (`▶n`), then the earliest Planned date, then the oldest. It is never your judgement, so it is the same on every draw. When the user asks what to take next, draw the Map and point at that list.

A closed blocker still unblocks, so Take next can hold Unlinked Issues. `unblocked 2d ago` dates when the last of an Issue's blockers closed, from the Tracker's close dates; a blocker that closed as a duplicate or as not planned is named with how it closed. Closed Issues are never drawn in the overview or an outline — only on cards.

When the user asks what *you* would pick, give your opinion in the conversation: say which Issue and why, quoting what the Map or the Issues say. Keep it separate from the list, and never reorder, redraw or trim Take next to match it.

When the output says the Project is being read for the first time, that is all there is to show: the read carries on by itself, and running `issue-map map` again shows how far it has got, then the Map once it's done.

The Map is drawn from a Snapshot, refreshed first when it's more than two minutes old. Drawing it starts a refresher that keeps the Home Project's Snapshot warm in the background, so the Map is usually drawn at once, and a full re-read runs in the background when one is due; the Map is drawn from the Snapshot there meanwhile, so there is never anything to wait for. The overview's header ends with the Project's band: `Promised`, or `Best effort` with a `⚠ Best effort` line saying why the Map is untested there and writes nothing. A `⚠` line may also name a Link kind the Map can't read in the Project, and when it can read none it draws no Map and says why. Reprint those lines as printed. When it opens with a `⚠ read … ago` line, the Tracker couldn't be read and the Map is as old as it says; reprint that line with the rest, and asking again tries again. An Issue card is always read live, so it is never old.

## Moving along Links

A card shows the Issue's name and URL, whether it is Blocked and whom it's assigned to, its Links by kind under the Tracker's own names, its open Closing Requests, and how many other Issues mention it. Reprint the card itself exactly, line for line, every time one opens — whether the user typed `open #n` or picked it — and before asking where to go from it: never put it in a sentence of your own. Only the **Links to follow** and **Choices** blocks under it are for you, not the user. The card prints the Issue's URL, so never offer to open it in a browser.

When the card has Links to follow, ask with `AskUserQuestion` which one to follow — first the card's **Choices** in the order printed, **Assign … to me** (see **Assigning an Issue to yourself**) and **Start work on …** (see **Starting work on an Issue**), then Links in the block's order up to three options in all, labelled with the Link's reference and with its description as the option's description, then a fourth option — **More Links** while any are left, otherwise **The Map**. **More Links** asks again with the next three. "Other" takes any target the user types, which `issue-map go '<target>'` moves to. Open the picked Issue's card with `issue-map issue '<label>'`, reprint it, and ask again from there; **The Map** runs `issue-map map`.

An Outside Issue's card has no Links to follow, since the Map hasn't read its Project, but under **Choices** it offers to open that Project's Map, and, while it's open, to start work on it. Ask with those choices, labelled as printed, and **The Map**; opening its Project's Map runs the command under it, which lands on the Issue's card in its own Project's Map, with its Links. A card with no Links to follow but with **Choices** asks with those and **The Map**; a card with neither asks nothing. Never offer a Closing Request or a Mention as a choice: a Closing Request isn't an Issue, and a Mention isn't a Link — the card only counts Mentions, which Link Suggestions are for.

When `AskUserQuestion` isn't available, as under `claude -p`, reprint the card and stop.

## Assigning an Issue to yourself

The Map's only write besides a confirmed Link: it assigns an open Issue of the Project on screen to the user. An unassigned Issue's card offers it under **Choices** as **Assign #n to me**, only where the Map writes — a `Promised` Project whose login may write, or where the Tracker can't say whether it may. Never offer it otherwise, and never assign any other way.

Picking **Assign #n to me** in the card's picker is the user's one confirmation: its description says what will be written. When the user instead asks in words to take or assign an Issue, open its card if it isn't on screen; when the card offers the choice, confirm once with `AskUserQuestion` — the choice's label as a **yes** option with its description, and **No** — and run nothing on **No**. Don't ask twice. Run the command under the choice, `issue-map assign '<ref>'`, and reprint its output, which is a line saying what happened and the Issue's card as it is now.

It reads the Issue again before writing, so one someone took since isn't written to, and it writes once: when the Tracker refuses, it says why and changes nothing — reprint that, don't retry, and don't suggest another way to assign. A card with no **Assign** choice says whom the Issue is assigned to; when the user asks to take one assigned to someone else, say so from the card rather than assign it. Once assigned, the Issue is the user's own: the Map and Take next show it at once, marked `yours`. Nothing else starts: no branch, no comment.

When `AskUserQuestion` isn't available, as under `claude -p`, the user's own words asking for this very Issue to be assigned to them are the confirmation; otherwise reprint the card and don't assign.

## Starting work on an Issue

An open Issue's card offers **Start work on #n** under **Choices**, an Outside Issue's too. It only reads, so picking it in the card's picker, or the user asking in words to start work on or pick up an Issue, is enough: run the command under it, `issue-map start '<ref>'`, with no further confirmation.

Its output is the Issue's body and comments, already cut to a fixed budget, for you to brief the user from — don't reprint it. Brief them in at most about 12 lines: what the Issue asks for; where the discussion stands now, the latest comments counting most; what's been decided, tried or ruled out; what's still open or in the way; and who is involved. Quote only a line or two where the exact words matter. When the output says comments or parts of long ones were left out, or that earlier comments weren't read, say the brief isn't from the whole thread. Reprint the card's name line and URL above the brief.

Then stop and let the user say what's next. Nothing else starts: no branch, no editor, no checkout, no assignment and no code — don't offer them either. Where the user is doesn't change, so `back`, `map` and the card's Links carry on from the card. When the Issue can't be read, the output says why; reprint that.

## Link Suggestions

The Map draws only the Links the Tracker records. When the user asks for Link Suggestions, for Links nobody recorded, or what a card's Mentions mean, suggest from what is on screen:

1. Run `issue-map suggest`. It reads the Issues on screen and no others: each one's text, its recorded Links, and what the Issues that mention it say of it. It never reads the whole Project; to suggest for other Issues, the user opens their page first — the Unlinked list, a Group, a card. Don't reprint its output.
2. Propose Links from it, only where the text says one exists — "blocked by #12", "needs #7 first", "part of #3", "see also #9" — never from two Issues merely being about the same thing. Only the kinds its **Kinds to suggest** line names. Nothing already recorded, and never a Parent for an Issue that has one. `from` Blocks `to` (`to` waits on `from`); `from` is the Parent of `to`; `related` has no direction. Each proposal quotes the words it stands on exactly as written, and names as `source` the Issue whose text holds them: one on screen, or one that mentions it.
3. Pipe the proposals to `issue-map offer` as a JSON array, even an empty one, since it also offers what the Map found itself:

   ```
   issue-map offer <<'EOF'
   [{"from": "#12", "kind": "blocks", "to": "#5", "quote": "Blocked by #12 until the API lands", "source": "#5"}]
   EOF
   ```

   It checks each one against the Tracker as it is now, and says why of any it doesn't offer: a quote that isn't word for word in its source, a source `suggest` didn't read, a kind the Project can't record, a Link already recorded, a Parent it would move an Issue from, a suggestion declined before. Reprint its list, less the **To confirm** block, which is for you. Don't propose again what it turned down.
4. When it ends with **To confirm**, ask once with `AskUserQuestion`, `multiSelect: true`, the suggestions in their order: as few questions as hold them, at most four options each and never one alone (5 is 3 and 2), headed `Links 1–3` and so on, each option labelled as printed without its number, with its description. A single suggestion is one single-select question: its label, and **Decline**. Then run `issue-map confirm` with the numbers of those ticked, such as `issue-map confirm 1 3`; with none ticked, `issue-map confirm` alone. Ticking is the user's one confirmation. Those left unticked are declined and never suggested again, so when the user dismisses the picker without answering, run nothing.
5. Reprint what `confirm` says. Each Link is read again before it's written, and once the Tracker refuses a write, the rest aren't tried: don't retry, and don't suggest another way to write them. A written Link is an ordinary Link: the Map draws it at once.

When the output says **Not offered to write** — a login that may only read, or a `Best effort` Project — reprint the list, say why, and ask nothing: the list is still worth reading. When `AskUserQuestion` isn't available, as under `claude -p`, reprint the list and stop; nothing is written or declined.

## Moving to another Project

The user moves by typing a target, or with `go`, `back` and `home` — in the prompt, or in a picker's "Other".

- **A target**: a Project's URL, an Issue's URL, an `owner/repo` or `group/sub/project`, the same with `#n` for an Issue, or a local path. Run `issue-map go '<target>'` with it as the user typed it. A Project lands on its overview, an Issue on its card inside its own Project's Map. A reference the Map printed, such as `#12` or one on a card, opens with `issue` instead, as above.
- **`go` on its own**: run `issue-map go`, adding `--dir '<path>'` for each directory added to this session. It offers up to four nearby Projects under **Choices**; ask with `AskUserQuestion`, one option per choice, and "Other" takes a typed target.
- **`back`**: `issue-map back` retraces this session's trail one step, across Projects.
- **`home`**: `issue-map home` returns to the Home Project's overview. Typed on that overview, it offers the checkout's Projects to pick the Home Project from again, under **Choices**.
- **No Home Project**, when the checkout leads to no Tracker: the Map opens on `go`, so answer a request for the Map with `issue-map go` and its `--dir` flags.
- To say **which Project is home**: away from it, the overview's `⌂ Home:` line names it; at home, it's the Project on screen.

A move that can't open says why and leaves the user where they were; reprint that and ask nothing. Moving never changes the Home Project or what is kept warm for it. Away from home, everything works the same, on that Project's own band and login.

## The status line

When the user asks for the Map in their status line, or for what to take next always on screen, run `issue-map statusline --setup` and reprint what it says. It writes the status line into their Claude Code settings; a status line they already have is wrapped, not replaced — its rows come first. Running it again changes nothing, unless the plugin has moved since, as an update moves it: then it points the status line at where the plugin is now. When the row goes blank after an update, run it again.

The row shows the Home Project's first Issue in Take next, the same as the overview's, from the Snapshot the background refresher keeps warm, with its age once it's old. It never reads the Tracker, so until the Map has been drawn in the checkout it asks for the Map instead. It stays on the Home Project whatever the user moves to. `issue-map statusline` alone prints the row.

## Choices

When the output ends in **Choices, best first**, ask once with `AskUserQuestion`: one option per choice, labelled with the choice's label, its description as the option's description, and "(Recommended)" after the first label when the output asks which one is the Home Project. Run the command under the picked choice, relay its output, and carry on. When a choice is typed in "Other", run `issue-map go '<what they typed>'`, or, when picking the Home Project, `issue-map home --pick '<URL>'`.

When the checkout leads to several Projects with open Issues, the output asks which one is the Home Project before anything else is drawn. The picked command draws the Home Project's overview; if the user first asked for something else, run that too. The pick is saved, so later runs don't ask. When the output says the pick couldn't be saved, pass the same `--pick <URL>` to every later `issue-map` command this session. When a local path leads to several Projects, the pick is saved in that checkout in the same way.

When `AskUserQuestion` isn't available, as under `claude -p`, list the choices for the user and stop: nothing is picked or saved, and a typed target still moves.
