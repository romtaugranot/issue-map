---
name: map
description: The Map of this checkout's Project and its open Issues. Use when the user asks for the Map, their Home Project, or which Issue to take next.
---

# The Map

So far the Map names the checkout's **Home Project** — the Project it will be drawn about.

1. Run `issue-map home` in the checkout.
2. Its output ends in one of two ways:
   - **A named Home Project**, or a reason there is none. Relay the text to the user as printed. Done.
   - **Choices, best guess first.** The checkout leads to several Projects with open Issues, and the user picks one. Ask once with `AskUserQuestion`: one option per choice, labelled with the choice's `host/path`, its description as the option's description, and "(Recommended)" after the first label. "Other" takes a Project's URL. Then run `issue-map home --pick <URL>` with the picked choice's URL and relay its output. Done — the pick is saved, so later runs name it without asking. When the output says the pick couldn't be saved, pass the same `--pick <URL>` to every later `issue-map home` this session.

When `AskUserQuestion` isn't available, as under `claude -p`, list the choices for the user and stop: the Home Project stays unpicked, and nothing is saved.
