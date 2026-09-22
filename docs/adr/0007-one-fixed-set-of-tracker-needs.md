# The Map reaches every Tracker through one fixed set of needs, and the glossary names shapes rather than Trackers

The Map supports GitHub and GitLab, and adding a third kind of Tracker is a separate effort. To keep that effort possible, this one fixes two things. The plugin reads a Tracker only through the set of needs below, each stated in the Map's own terms rather than in one Tracker's — so a Tracker is added by answering them, not by threading a new shape through the Map. And a glossary definition states the shape a Tracker must have, naming GitHub and GitLab only as examples of it, so a reader can tell what a new Tracker would have to provide without the definition claiming it is supported.

## The needs

**Draw** means the Map cannot be drawn without it. **Order** means Take next is wrong without it, and the Map has to say so. **Act** means a card action or a write, and every one of those is optional and confirmed by the user, as [ADR 0002](0002-draw-only-recorded-links.md) and [ADR 0003](0003-support-by-detected-capability.md) require.

**Reads**

1. **Identify (draw).** At an address, say which kind of Tracker is there and, where it has one, its version — without a login where possible, since the version chooses the band.
2. **Resolve a Project (draw).** Turn a locator into one stable Project identity, and say whether that Project holds Issues and how many are open. A locator is a git remote or a Project the user typed; a Tracker no remote leads to is reached only by the second.
3. **List open Issues (draw).** Page through a Project's open Issues, each with a stable identity, the reference users type, a title, a URL, enough of its type to tell a task-level child apart, its assignees, its creation date and its Planned date.
4. **Read Links (draw).** For each open Issue, its Blocks, Parent and Related Links with their direction, and for the far end of each one a stable identity, whether it is open, whether the viewer can read it, and which Project it is in.
5. **Say which Link kinds are recordable and readable (draw).** Tell "none recorded" apart from "can't record" and from "can't read or can't tell", per kind, and above all for Blocks.
6. **Say who the viewer is (draw).** Take next needs it to tell the viewer's own Issues from other people's.
7. **Read open Closing Requests and their authors (order).** Drafts included. A Tracker that can't give them leaves nothing out of Take next as taken by someone else, and says so.
8. **Read an Issue's body and comments (act).** Start work reads them.

**Writes**

9. **Say whether this login can write a Link or assign (act).** "Can't tell" is an allowed answer; the Map then offers the write and stops at the first refusal.
10. **Write a Link of a kind the Project records (act).**
11. **Assign an Issue to the viewer (act).**

## Considered Options

- **Leave the seam implicit and let the build find it.** Every adapter would be written against GitHub's shape first, and the second Tracker would pay for it — which is how the room this effort claims to leave would quietly disappear.
- **Name every Tracker checked in the glossary**, so a reader sees the whole field. The glossary is the first file a reader opens, and naming Trackers the plugin doesn't support reads as a support claim.
- **Adopt the wording and behaviour changes a third Tracker would need now**, so a future effort is pure addition. Those changes would be written blind, long before anyone builds against them, and two of them cost real behaviour today.
- **Write the seam as an interface in code rather than as a decision.** Nothing to disagree with later, but nothing stops an adapter reaching past it either.

## Consequences

- **A Tracker that no git remote leads to is out of reach for now.** Need 2 admits the shape — a Project the user typed — but [Grilling: which Project the Map opens on when a checkout points at several](https://github.com/romtaugranot/issue-map/issues/11) still drops a saved Home Project once no remote leads to it, and nothing saves a pick that no remote ever led to. An effort adding such a Tracker changes that rule first.
- **A Tracker whose administrators name its Link kinds needs a mapping the Map doesn't have.** [ADR 0003](0003-support-by-detected-capability.md) now rules out reading a kind's meaning from its name, which leaves Blocks as "can't tell" there and nothing Unblocked. Turning that into a usable Map means asking the user to confirm, once per Tracker, which kind means Blocks and in which direction. That is the second thing such an effort adds.
- **The login for a Tracker with no raw-API CLI is an open question.** [ADR 0001](0001-build-new-inside-claude-code.md) borrows the CLI's login, and the candidates where there is no CLI to borrow from — a token the user hands over, or the Tracker's own MCP server, which only the conversation can call and the status line cannot — each break something the plugin currently promises. It is left open rather than guessed.
- **Needs 7 and 9 already have "can't" answers on supported Trackers**, so the Map's wording for them is exercised from day one rather than waiting for a third Tracker.
- **A need is not a method.** Both supported Trackers answer several of these in one request, and nothing here says an adapter must make eleven calls.
