---
name: map
description: The Map of this checkout's Project and its open Issues. Use when the user asks for the Map, their Home Project, their Unlinked Issues, or which Issue to take next.
---

# The Map

The Map is drawn about the checkout's **Home Project**. Run every command in the checkout.

- **The Map**: `issue-map map`.
- **The Unlinked Issues**, 15 a page, newest first: `issue-map unlinked`, and `issue-map unlinked --page <n>` when the user says `more` or asks for a page.
- **Which Project is home**: `issue-map home`.

Reprint the output in your reply exactly as printed: tool output isn't reliably shown to the user, and the Map is already cut to fit one screen. Don't summarise it, reorder it or add Issues to it.

When the output says the Project is being read for the first time, that is all there is to show: the read carries on by itself, and running `issue-map map` again shows how far it has got, then the Map once it's done.

## When the Home Project is a tie

When the output ends in **choices, best guess first**, the checkout leads to several Projects with open Issues, and the user picks one. Ask once with `AskUserQuestion`: one option per choice, labelled with the choice's `host/path`, its description as the option's description, and "(Recommended)" after the first label. "Other" takes a Project's URL. Then run `issue-map home --pick <URL>` with the picked choice's URL, relay its output, and run the command the user first asked for. The pick is saved, so later runs don't ask. When the output says the pick couldn't be saved, pass the same `--pick <URL>` to every later `issue-map` command this session.

When `AskUserQuestion` isn't available, as under `claude -p`, list the choices for the user and stop: the Home Project stays unpicked, and nothing is saved.
