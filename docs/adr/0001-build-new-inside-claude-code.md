# Build a new plugin that shows the Map only inside Claude Code

Every existing Map of Issue Links is a web page or a separate app, and none of them covers GitHub and GitLab (self-hosted and Free tier included) with private Projects. So we build a new Claude Code plugin rather than adopt, wrap, fork or contribute to one. The plugin shows the Map only inside Claude Code: in the conversation, through pickers, and optionally in the status line. The Issue the user picks is then already in the session, and the user never has to leave the terminal. We take ideas from prior art but copy no code, and the plugin reads the Trackers itself by borrowing the login of the Tracker's own CLI, wherever that CLI offers a raw API call — `gh` and `glab` today. A Tracker whose CLI offers no raw call, or has no CLI, needs a login the plugin doesn't yet have a way to get; that is left to whoever adds one.

## Considered Options

- **Adopt as-is** (`vanilla-bar/gh-issue-graph` for GitHub, `ngruychev/issue-graph` for GitLab): two tools, one per Tracker, and neither runs inside a session.
- **Contribute upstream or fork** `martonpaulo/issues-graph`: it has the closest intent and is MIT-licensed. But it refuses private Projects by design, covers GitHub only, and is a static web page.
- **Wrap** existing Maps or MCP servers at runtime: GitHub's official MCP server has no tools for `blocked by` Links, and each wrapped tool adds a third-party dependency.
- **A browser page** (an artifact or a local page) alongside the in-session Map: it shows a large Map whole, but brings availability limits and needs a way to send the chosen Issue back into the session.

## Consequences

- No surface can draw an interactive Map inside Claude Code. The Map is text in the conversation, and the user moves through it with pickers, so a large Project can't be seen whole at once and has to be summarised.
- A status line is terminal-only, and a user has just one. The plugin can't declare one itself, so a setup command has to write it into the user's settings.

_Amended by ADR 0010: a read-only HTML Picture of the Map may be opened outside Claude Code, beside it._

_Amended for #83: a Picture may also be printed as Mermaid or DOT text, for the user to paste where GitHub or GitLab render it. It is still printed in the conversation and the plugin writes it nowhere; only its use is outside._
