# The Map reaches the screen through a display hook, not through Claude retyping it

Claude Code doesn't show a tool's output to the user; it collapses it to "Ran 1 shell command". So the Map, an outline or a card reached the user only when Claude reprinted it, and the skill told Claude to reprint each exactly. Trying the Map by hand, Claude often didn't: it put the overview, an outline and a card each in a sentence of its own, most of all when asked for several at once and right before a picker. Moving the rule to the top of the skill, naming those cases and switching off a short-answer output style changed nothing.

So what the Map prints no longer depends on Claude retyping it. Each output the user should see is kept in the state directory under an id and ends with a line naming it, `⟦issue-map <id>⟧`. Claude writes that one line in its reply, and the plugin's `MessageDisplay` hook, which runs as a reply streams to the screen, shows the kept output in its place, exactly as printed. The transcript and what Claude sees keep the line, so Claude still works from the output it read. What `start` and `suggest` print has no line: it's for Claude to work from.

This is still inside Claude Code, in the conversation, as ADR 0001 has it.

## Considered Options

- **Reword the skill**: tried three times, with the rule first and the failing cases named; Claude still summarised.
- **A hook's `systemMessage`**: reaches Claude only; the user never sees it.
- **Replace the tool's output** (`updatedToolOutput`): the user still sees only the collapsed line.
- **Put the card in the picker's `preview`**: Claude would still retype it, and only a card has a picker.

## Consequences

- The hook runs on every reply in every session the plugin is enabled in, so it leaves at once, without starting Node, on a reply with no line of the Map's.
- Where the hook doesn't run — under `claude -p`, where it can't change what is printed — the skill has Claude reprint the output instead, as before.
- The hook can also not run in a session: hooks disabled, only managed hooks allowed, or no Node on the hook's PATH. So the hook marks each output it shows, and a command whose session's previous output went unmarked, with none marked before it, tells Claude to reprint every output from then on, as under `claude -p`, and to tell the user once why. An output kept less than 30 seconds before is judged by nothing, as Claude may run several commands in a turn before writing their lines, so with hooks disabled the fallback can come one output late. Once the hook has marked an output in a session it is trusted there, so only a session's first turn, running commands more than 30 seconds apart with no text between them, can be misread as the hook not running.
- An output is kept a month, readable only by this OS user, like the trails beside it. A line whose output is gone shows a note saying to ask again, not the bare line.
