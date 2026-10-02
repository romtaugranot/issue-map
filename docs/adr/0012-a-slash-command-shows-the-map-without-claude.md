# A slash command shows the Map without Claude

ADR 0009 got the Map on screen exactly as printed by having Claude write a line naming each kept output, and a display hook show the output in its place. That still takes a model turn, and Claude still has to write the line.

Claude Code now lets a plugin's hooks module register a slash command and answer it itself, with no model turn. So the plugin's hooks module, `hooks/plugin.ts`, also serves `/issue-map`: on its own it draws the Map, and followed by a view's command, `/issue-map group 2`, `/issue-map issue 7`, `/issue-map back`, it shows that view. It runs the plugin's own `bin/issue-map` with `--shown`, and its answer is the command's output row, which the user sees exactly as printed and Claude reads too, so the Issue is already in the session (ADR 0001).

`--shown` says the caller shows the output, so the command prints it plain: nothing kept, no line, nothing telling Claude to write or reprint it. It also leaves the session's record alone, so a `/issue-map` neither counts as an output the display hook failed to show nor as proof that the hook runs.

The module passes the session's id to `bin/issue-map`, as the Bash tool does, so `/issue-map` moves along the same trail as the Map Claude draws: `back` after either retraces both.

Only views are served. `assign`, Link Suggestions and `start` stay with Claude, which asks before writing and works from what they print; `html --artifact` prints a question for Claude.

## Amends

- **ADR 0009**: an output need not reach the screen through Claude's line. `/issue-map` shows it as the command's output; the display hook, and the reprint fallback, stay for everything Claude draws.

## Considered Options

- **`/map`**: collides in the typeahead with the skill's `/issue-map:map`.
- **Keep the output and mark it shown**: the same result as `--shown`, with a file written for nothing.
- **Strip the line from the output in the module**: leaves the session's record holding an output nobody shows, so the next command Claude runs would read the display hook as not running and reprint for the rest of the session.
- **Hand Claude the output again as `context`**: Claude already reads the command's output row.

## Consequences

- **Only on Claude Code builds that load hooks modules**, as the status line (ADR 0011). Elsewhere `/issue-map` doesn't exist, and asking Claude for the Map works as before.
- **Choices are printed, not asked.** A Home Project tie, `go` on its own and a card's Links list what to run next; the user types the next `/issue-map`, or asks Claude, who picks up from the output it read.
- **Arguments split on spaces**, so a local path with a space in it can't follow `go`; ask Claude to go there.
