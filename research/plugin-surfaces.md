# What a Claude Code plugin can show the user to move through

Research for [#4](https://github.com/romtaugranot/issue-map/issues/4). Checked on 2026-09-21 against the code.claude.com docs, the changelog up to Claude Code 2.1.278 (2026-09-19), the official plugin marketplace, and the MCP spec (current version 2026-07-28).

## Short answer

- **None of a plugin's components is a UI surface.** A plugin ships skills, commands, agents, hooks, MCP and LSP servers, output styles, themes, monitors, channels, workflows, `bin/` executables and a `settings.json` that accepts only `agent` and `subagentStatusLine` ([plugins reference](https://code.claude.com/docs/en/plugins-reference#file-locations-reference)). Each one puts text into the conversation or runs a program. None of them can draw a Map inside a Claude Code client.
- **For real navigation, meaning the user selects an Issue and follows its Links without typing another prompt, the plugin has to produce an HTML page.** There are two ways to do that:
  1. **An artifact.** A plugin skill has Claude publish the Map with the built-in Artifact tool, which puts it on a private claude.ai URL. This is the **only interactive surface that reaches every client**: terminal, Desktop, web, mobile and Remote Control. A claude.ai page opens wherever the user is signed in ([artifacts](https://code.claude.com/docs/en/artifacts)).
  2. **A local page.** This is a self-contained HTML file, or a `localhost` page that the plugin serves. It works for the terminal (a browser on the same machine) and in Desktop's Browser pane. It **does not work** from web, mobile or Remote Control, because the file or port sits on the machine running the session.
- **Every other surface is conversational.** The Map is printed as text, and the user picks the next Issue through `AskUserQuestion` or an MCP elicitation form, one question at a time. `AskUserQuestion` works in every client, but each question holds only 2–4 options ([SDK limits](https://code.claude.com/docs/en/agent-sdk/user-input#limitations)). Elicitation is documented only for the terminal.
- **MCP Apps (the MCP UI extension) do not work in Claude Code today.** The docs don't mention them. The extension's client matrix lists Claude web and Claude Desktop but not Claude Code. The 2.1.278 CLI doesn't advertise `io.modelcontextprotocol/ui`. Open reports say widgets render only for claude.ai connectors, never for locally configured servers, and a plugin's MCP server is a locally configured server. Don't build on MCP Apps; keep watching them.
- **The status line is out.** A plugin can't ship one. It is a terminal-only row with clickable links and nothing to select.
- **Artifacts have limits that matter for this project.** They need a claude.ai sign-in on Pro, Max, Team or Enterprise. On Enterprise an admin has to enable them. They are unavailable with an API key, on Bedrock, Vertex or Foundry, and through gateways ([availability](https://code.claude.com/docs/en/artifacts#availability)). An artifact can pull live data **only through the viewer's claude.ai connectors, not local MCP servers** ([connectors](https://code.claude.com/docs/en/artifacts#pull-live-data-with-mcp-connectors)). So a self-hosted GitLab Map would be a snapshot that the session republishes. The Map needs a fallback, either a local page or text.

## Surfaces at a glance

Client columns:

- *Terminal*: the CLI.
- *Desktop*: the Code tab of the Claude Desktop app, running a local session.
- *Web*: a cloud session at claude.ai/code.
- *Mobile*: the Code tab of the Claude app, running a cloud session.
- *RC*: Remote Control, where a browser or the Claude app drives a session running on the user's own machine.

| Surface | What the plugin ships to get it | Can the user select an Issue and follow its Links? | Terminal | Desktop | Web | Mobile | RC |
|---|---|---|---|---|---|---|---|
| **Artifact** (claude.ai page) | A skill, plus an HTML template and a data script. Claude publishes the generated file with the Artifact tool. [Official precedent: `project-artifact`](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/project-artifact) | **Yes, in the page.** Can also refresh live through the viewer's claude.ai connectors | Yes (CLI ≥ 2.1.183; opens the browser) | Yes (app ≥ 1.13576.0) | Yes¹ | Yes, as a claude.ai page in the browser² | Yes. The link lands in the transcript; no tab opens on the host |
| **Local HTML file** | A skill, plus a template and a script that writes one self-contained file and opens it. [Official precedent: `playground`](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/playground) | **Yes, in the page** (a snapshot) | Yes, if the browser is on the same machine | Yes. HTML paths open in the Browser pane | No | No | No |
| **Local web server** (`localhost`) | An MCP server or script that serves the Map and fetches from the Tracker with local credentials | **Yes, in the page.** Can be live, and can send the selection back to Claude through a plugin monitor or a channel | Yes, on the same machine | Yes, in the Browser pane | No | No | No |
| **Transcript text** | A skill or command that prints the Map as Markdown. An output style can shape it | **No.** Read-only. Following a Link takes a new prompt, though Tracker URLs are clickable | Yes | Yes | Yes | Yes | Yes |
| **`AskUserQuestion` picker** | A skill that tells Claude to ask which Issue or Link to follow | **Stepwise.** 1–4 questions × 2–4 options, plus "Other" free text. Each step costs a model turn | Yes (clickable in fullscreen ≥ 2.1.187) | Likely³ | Yes | Yes | Yes (forwarded; stays open) |
| **MCP elicitation form** | An MCP server whose tool loops: a form with a single-select enum of Issues or Links, then the next form | **Stepwise.** The whole loop runs inside one tool call, so steps cost no model turns | Yes (≥ 2.1.76) | Undocumented | Undocumented | Undocumented | Undocumented |
| **Separate TUI** | An executable in `bin/` | **Yes, in the TUI** | Only in a separate terminal or pane (the Bash tool has no TTY) | Maybe, in the integrated terminal pane⁴ | No | No | No |
| **Status line** | Nothing. A plugin can't set `statusLine`. The user has to configure it | **No.** One or more rows with OSC 8 links, no selection | Yes | Undocumented | No | No | No (terminal only) |
| **MCP Apps** (`ui://` widget) | An MCP server with UI resources | Would be yes, but **not rendered** | No | No for plugin (local) servers⁵ | No | No | No |

1. The artifact docs list the CLI, the Desktop app and Claude Tag as publishing surfaces. The changelog also shows the Artifact tool running in cloud and Remote Control sessions: 2.1.273 fixed an Artifact tool upload in a cloud or RC session, and 2.1.257 changed artifact reads in claude.ai cloud sessions ([changelog](https://code.claude.com/docs/en/changelog)).
2. An artifact is a `claude.ai/code/artifact/...` URL. The docs don't describe a viewer inside the Claude mobile app. On a phone, the page opens in a browser signed in to the same account. Private artifacts need that sign-in.
3. Desktop runs "the same underlying engine" as the CLI ([desktop](https://code.claude.com/docs/en/desktop#coming-from-the-cli)), but its docs don't separately describe `AskUserQuestion`.
4. Desktop's terminal pane runs in the session's directory and environment ([desktop](https://code.claude.com/docs/en/desktop#run-commands-in-the-terminal)). Plugin `bin/` is documented as added to the **Bash tool's** `PATH` only.
5. See [MCP Apps](#mcp-apps-the-mcp-ui-extension) below.

## What a plugin can ship

The components are listed in the [plugins reference](https://code.claude.com/docs/en/plugins-reference#plugin-components-reference). Here is what each one could contribute to a Map:

| Component | Can it show a picture? |
|---|---|
| Skills and commands (`skills/`, `commands/`) | Indirectly. They are the entry point, such as `/issue-map`. They tell Claude what to render, where to render it and which script to run |
| Agents (`agents/`), workflows (`workflows/`) | No. They do background work, such as fetching Issues and Links |
| Hooks (`hooks/hooks.json`) | No. They produce text messages and context, and can run scripts, for example to open a browser |
| MCP servers (`.mcp.json`) | Tools, elicitation forms (see below), and they can host a `localhost` web server. They can't render inside the client (see MCP Apps) |
| LSP servers | No |
| Output styles (`output-styles/`) | Shape Claude's text only. From mobile and web, only built-in styles can be *selected*. A custom style has to be selected in the session itself ([RC limitations](https://code.claude.com/docs/en/remote-control#limitations), 2.1.269) |
| Themes (`experimental.themes`) | Colors only |
| Monitors (`experimental.monitors`, since 2.1.105) | No picture. They turn each stdout line of a background command into a notification to Claude, and can be the **return path** from a local page. Interactive CLI only; not on Bedrock, Vertex or Foundry ([monitors](https://code.claude.com/docs/en/plugins-reference#monitors), [Monitor tool](https://code.claude.com/docs/en/tools-reference#monitor-tool)) |
| Channels (`channels`) | No picture. They push events into the running session. Research preview (see below) |
| `bin/` executables (since 2.1.91) | Only on the Bash tool's `PATH`. A TUI there can't be driven by Claude and must run in its own terminal |
| `settings.json` | Only the `agent` and `subagentStatusLine` keys are supported ([plugins reference](https://code.claude.com/docs/en/plugins-reference#file-locations-reference)). So a plugin **cannot** ship a `statusLine` or [`footerLinksRegexes`](https://code.claude.com/docs/en/settings-reference#footerlinksregexes). The latter is user or managed scope only |

In Remote Control and cloud sessions a plugin loads the same way it does locally. RC is the local process ([remote control](https://code.claude.com/docs/en/remote-control)). Cloud sessions install plugins declared in the repository's `.claude/settings.json` or synced from the claude.ai account, but not plugins enabled only in user settings ([cloud environments](https://code.claude.com/docs/en/cloud-environments), [synced plugins](https://code.claude.com/docs/en/plugins-reference#synced-plugins)).

## Surfaces in detail

### Artifact: the only interactive surface in every client

- **What it is.** "A live, interactive web page that Claude Code publishes from your session to a private URL on claude.ai." It updates in place when republished. Each publish is a version ([artifacts](https://code.claude.com/docs/en/artifacts)). It is one HTML or Markdown file with inline JS. CDN scripts are allowed from cdnjs, jsDelivr `/npm/`, Tailwind and jQuery. There is no backend. Relative links don't resolve, so use in-page anchors. The size limit is 16 MiB ([page constraints](https://code.claude.com/docs/en/artifacts#page-constraints)). Drawing Issues and letting the user select one and jump along its Links is ordinary in-page JS.
- **How a plugin gets one.** A plugin can't publish directly, because the Artifact tool is Claude's. A skill tells Claude to call it on a file. The official [`project-artifact`](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/project-artifact) plugin does exactly this. It ships `template.html`, keeps a per-project config in `${CLAUDE_PLUGIN_DATA}` recording the artifact URL so a refresh redeploys to the same address, and notes that the Artifact tool is unavailable in `claude -p`. A script can generate the page from Tracker data, so Claude only publishes it. That avoids spending output tokens on the HTML ([token cost note](https://code.claude.com/docs/en/artifacts#page-constraints)).
- **Across clients.**
  - After the first publish, the browser opens on the machine running the session.
  - If the prompt came through Remote Control from claude.ai, Desktop or mobile, no tab opens on the host. The URL is printed in the transcript, which the device shows. 2.1.260 fixed an extra tab opening in that case.
  - `Ctrl+]` reopens the latest artifact.
  - `/artifacts` (≥ 2.1.208) lists artifacts from any session ([create](https://code.claude.com/docs/en/artifacts#create-an-artifact), [find](https://code.claude.com/docs/en/artifacts#find-an-artifact-again)).
- **Live data.** With CLI ≥ 2.1.209, a page can call **claude.ai connectors** each time it is viewed, as the *viewer's* account, after the viewer consents. It can also offer controls that act through a connector, such as updating an Issue. Local MCP servers, such as those from `.mcp.json` or a plugin, can supply data while Claude builds the page, but "the published page can't call them." A connector-backed page can't be shared publicly ([connectors](https://code.claude.com/docs/en/artifacts#pull-live-data-with-mcp-connectors)).
  - A GitHub Map could therefore refresh itself if the viewer has a GitHub connector.
  - A self-hosted GitLab Map would be a snapshot that the session rebuilds and republishes.
- **Availability limits.** All of these are required ([availability](https://code.claude.com/docs/en/artifacts#availability), [feature availability](https://code.claude.com/docs/en/feature-availability)):
  - A Pro, Max, Team or Enterprise plan. On Enterprise, an Owner must enable artifacts.
  - A claude.ai sign-in. API keys, gateway tokens and cloud-provider credentials can't publish.
  - The Anthropic API. Not Bedrock, Vertex or Foundry.
  - No CMEK, HIPAA or ZDR on the organization.
  - Not in the Agent SDK, GitHub Actions or MCP-server contexts.
  - Users can also turn artifacts off with `enableArtifact: false` or `CLAUDE_CODE_DISABLE_ARTIFACT=1`.

  When a condition fails, "Claude writes a local HTML file or says it cannot publish instead." That is the fallback path in the table.
- **Runtime capabilities (beyond the public docs).** The public docs cover connector calls and downloads. The artifact runtime contract bundled with Claude Code 2.1.278 (contract 0.2.52) also lists these capabilities, though which ones a given account gets varies:
  - `db`: a shared JSON store that Claude can read back.
  - `artifact`: the page publishes its own new version.
  - `comments`, `room` (live presence) and `user`.
  - `sample`: the page asks Claude a question.
  - `mcp` with `host:<name>`: servers on the viewer's device, reachable only when the page is open inside the Claude app, "desktop app first", and only for the artifact's owner.

  The changelog confirms that the artifact database and declared capabilities exist (2.1.269, 2.1.271, 2.1.273). Treat everything beyond connectors and downloads as moving parts to check at build time.

### Local HTML file or local web server: interactive, but only on the host machine

- The official [`playground`](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/playground) plugin is the precedent. It writes a single self-contained HTML file with inline CSS and JS, runs `open <file>.html`, and ends each page with a "copy as prompt" box so the result can come back into the session. Its templates include a concept map and a code map, both of which are clickable node-and-line drawings.
- In **Desktop**, "the Browser pane can also open static HTML files … Click an HTML … path in the chat to open it there." The pane is a tabbed browser for any site, localhost included ([preview](https://code.claude.com/docs/en/desktop#preview-your-app), [browse](https://code.claude.com/docs/en/desktop#browse-external-sites)).
- A **plugin-served `localhost` page** can read the Tracker live with whatever credentials the machine has, which suits self-hosted GitLab. It needs no claude.ai account and works on any provider.
- Neither kind of page is reachable from **web, mobile or RC** devices. RC devices see the conversation, not the host's files or ports ([what connected devices see](https://code.claude.com/docs/en/remote-control#what-connected-devices-see)). A cloud session's files live in a cloud VM.

### Conversational pickers: `AskUserQuestion` and MCP elicitation

- **`AskUserQuestion`** is a built-in tool that asks multiple-choice questions ([tools reference](https://code.claude.com/docs/en/tools-reference#askuserquestion-tool-behavior)). Each call has 1–4 questions with 2–4 options each, plus free-text "Other" ([SDK limits](https://code.claude.com/docs/en/agent-sdk/user-input#limitations)).
  - Remote Control forwards the questions and keeps them open until answered. They are exempt from `dialogExpiry` ([RC limitations](https://code.claude.com/docs/en/remote-control#limitations), [`dialogExpiry`](https://code.claude.com/docs/en/settings-reference#dialogexpiry)).
  - Cloud sessions let you "answer questions" from web or mobile ([cloud](https://code.claude.com/docs/en/claude-code-on-the-web)).
  - In fullscreen, options are clickable (≥ 2.1.187; multi-select ≥ 2.1.208) ([fullscreen](https://code.claude.com/docs/en/fullscreen#use-the-mouse)).
  - It is disabled when `--channels` is active (2.1.83).
  - It fits "which Link next?" because an Issue usually has few Links. It doesn't fit picking one Issue out of a whole Map.
- **MCP elicitation** (≥ 2.1.76) lets an MCP server show "a dialog with form fields" mid-tool-call ([MCP](https://code.claude.com/docs/en/mcp#respond-to-mcp-elicitation-requests)). The spec allows flat forms with single-select and multi-select enums, titled or untitled ([spec 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation)).
  - A plugin tool could loop: pick an Issue, show its Links as the next enum, pick again. No model turn is spent per step.
  - The docs describe this only in the terminal. 2.1.239 fixed tall elicitation forms in fullscreen. No doc says Desktop, web, mobile or RC render elicitation forms.

### Status line: terminal-only, no selection

A status line is a script that prints one or more rows under the prompt. It can use colors and OSC 8 links in terminals that support them ([how it works](https://code.claude.com/docs/en/statusline#how-status-lines-work)). A plugin can't ship one; `subagentStatusLine` is the only related key a plugin can set ([subagent status lines](https://code.claude.com/docs/en/statusline#subagent-status-lines)). Nothing in the Desktop, web or RC docs says it renders there.

### Separate TUI: terminal-only, outside Claude Code

Claude Code's fullscreen renderer is its own and has no plugin extension point ([fullscreen](https://code.claude.com/docs/en/fullscreen)). `!` shell mode captures output into the conversation. It isn't documented as hosting interactive programs ([shell mode](https://code.claude.com/docs/en/interactive-mode#shell-mode-with-prefix)). A plugin-shipped TUI therefore runs beside Claude Code: in another terminal or pane, or after `Ctrl+Z`. That rules it out for Desktop-only, web, mobile and RC users.

### MCP Apps (the MCP UI extension)

- **The spec.** MCP Apps (`io.modelcontextprotocol/ui`, SEP-1865, spec dated 2026-01-26) let a tool declare `_meta.ui.resourceUri` pointing at a `ui://` HTML resource. The host renders it in a sandboxed iframe that can call the server's tools ([overview](https://modelcontextprotocol.io/extensions/apps/overview)). This would be the ideal shape for a Map.
- **Supported clients.** The [client matrix](https://modelcontextprotocol.io/extensions/client-matrix) lists Claude (web) and Claude Desktop, **not Claude Code**.
- **The Claude Code docs.** The MCP page covers tools, resources, prompts, elicitation and channels, and says nothing about Apps or `ui://` ([MCP](https://code.claude.com/docs/en/mcp)).
- **The installed CLI.** A search of a local Claude Code 2.1.278 install finds no `io.modelcontextprotocol/ui` or `ui://` string.
- **Open reports in the Claude Code repository.** [#88881](https://github.com/anthropics/claude-code/issues/88881) says MCP Apps render only for remote connectors on claude.ai and Desktop, never for servers from a config file. That covers a plugin's `.mcp.json`. [#95149](https://github.com/anthropics/claude-code/issues/95149) says the CLI drops the UI and shows the text result. An earlier request, [#23958](https://github.com/anthropics/claude-code/issues/23958), was closed as not planned by inactivity.
- **Conclusion.** Not a surface for this plugin today.

### Getting the selection back into the session

Moving through the Map needs no Claude turn when it happens in a page. Starting work on the chosen Issue does. These are the documented paths back into the session:

- **Copy as prompt.** The page builds a prompt for the user to paste into the terminal. This is the documented artifact pattern ([bring the result back](https://code.claude.com/docs/en/artifacts#bring-the-result-back-to-your-session)) and the `playground` pattern. It works in every client.
- **Artifact comments with "Send to Claude."** Team and Enterprise only, on artifacts shared within the organization. Claude can read comments from ≥ 2.1.221 and replies on its own from ≥ 2.1.228 ([comments](https://code.claude.com/docs/en/artifacts#collect-comments-on-an-artifact)).
- **Plugin monitor tailing a file** that a `localhost` page writes to. Local pages only; interactive CLI only.
- **Channel.** An MCP server pushes events into the session, and the official `fakechat` channel is already a `localhost` web UI ([channels](https://code.claude.com/docs/en/channels#quickstart)). Channels are a research preview. They need `--channels` at launch and an Anthropic-curated allowlist; custom channels need `--dangerously-load-development-channels`. They need admin enablement on Team and Enterprise, and don't run on Bedrock, Vertex or Foundry ([research preview](https://code.claude.com/docs/en/channels#research-preview)).
- **`claude-cli://open?...&q=...` deep links** open a *new* local terminal session with the prompt pre-filled ([deep links](https://code.claude.com/docs/en/deep-links)). Desktop OS only, and the host page must allow custom schemes.

## What this means for the Map (input, not decisions)

- #4 asks for both "move through" and "every client, including Remote Control." Only an artifact meets both. A text Map with `AskUserQuestion` meets "every client" but moves one question at a time.
- An artifact can't be the only surface. Users on API keys, cloud providers or gateways, and Enterprise orgs without artifacts enabled, get no artifact. Self-hosted GitLab has no live refresh inside an artifact. A local HTML page, which is the `playground` shape, and a text Map cover those users.
- One deterministic page generator, fed by the same Tracker fetch, could serve both the artifact and the local file. Claude would only publish or open the result.

## Open questions this raises

- Can an artifact open Tracker URLs, such as a link out to the Issue? The viewer serves pages from a sandboxed `*.claudeusercontent.com` origin under a strict CSP. Outbound navigation isn't documented, so a prototype should test it.
- Do the GitHub (and any GitLab) claude.ai connectors expose the Links the Map needs? That decides whether an artifact Map can refresh live. This overlaps [#2](https://github.com/romtaugranot/issue-map/issues/2).
- Do MCP elicitation forms render in Desktop, web, mobile and RC? The docs don't say. Test before relying on them.
- How usable is a dense Map on a phone-width artifact? The Map spec will need a phone layout if mobile and RC count.

## Sources

- Claude Code docs:
  - [Plugins reference](https://code.claude.com/docs/en/plugins-reference)
  - [Create plugins](https://code.claude.com/docs/en/plugins)
  - [Share session output as artifacts](https://code.claude.com/docs/en/artifacts)
  - [Remote Control](https://code.claude.com/docs/en/remote-control)
  - [Claude Code on mobile](https://code.claude.com/docs/en/mobile)
  - [Desktop application](https://code.claude.com/docs/en/desktop)
  - [Use Claude Code in the cloud](https://code.claude.com/docs/en/claude-code-on-the-web)
  - [Configure cloud environments](https://code.claude.com/docs/en/cloud-environments)
  - [Customize your status line](https://code.claude.com/docs/en/statusline)
  - [Output styles](https://code.claude.com/docs/en/output-styles)
  - [Connect Claude Code to tools via MCP](https://code.claude.com/docs/en/mcp)
  - [Hooks reference](https://code.claude.com/docs/en/hooks)
  - [Tools reference](https://code.claude.com/docs/en/tools-reference)
  - [Handle approvals and user input (Agent SDK)](https://code.claude.com/docs/en/agent-sdk/user-input)
  - [Fullscreen rendering](https://code.claude.com/docs/en/fullscreen)
  - [Interactive mode](https://code.claude.com/docs/en/interactive-mode)
  - [Channels](https://code.claude.com/docs/en/channels)
  - [Channels reference](https://code.claude.com/docs/en/channels-reference)
  - [Launch sessions from links](https://code.claude.com/docs/en/deep-links)
  - [All settings](https://code.claude.com/docs/en/settings-reference)
  - [Feature availability](https://code.claude.com/docs/en/feature-availability)
  - [VS Code](https://code.claude.com/docs/en/vs-code)
  - [What's new, weeks 25, 27, 29, 34 (2026)](https://code.claude.com/docs/en/whats-new/index)
- [Claude Code changelog](https://code.claude.com/docs/en/changelog), generated from [CHANGELOG.md](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md). Versions cited: 2.1.76, 2.1.80, 2.1.83, 2.1.91, 2.1.105, 2.1.129, 2.1.187, 2.1.208, 2.1.209, 2.1.221, 2.1.224, 2.1.228, 2.1.239, 2.1.257, 2.1.260, 2.1.265, 2.1.269, 2.1.271, 2.1.273, 2.1.278.
- Official marketplace, [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official):
  - [`playground`](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/playground)
  - [`project-artifact`](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/project-artifact)
  - [`fakechat`](https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins/fakechat)
- MCP:
  - [MCP Apps overview](https://modelcontextprotocol.io/extensions/apps/overview)
  - [Extension client matrix](https://modelcontextprotocol.io/extensions/client-matrix)
  - [MCP Apps spec repository](https://github.com/modelcontextprotocol/ext-apps)
  - [Elicitation, spec 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation)
- Claude Code issues: [#88881](https://github.com/anthropics/claude-code/issues/88881), [#95149](https://github.com/anthropics/claude-code/issues/95149), [#23958](https://github.com/anthropics/claude-code/issues/23958).
- A local Claude Code 2.1.278 install, inspected read-only: `claude --help`, a string search of the binary, and the bundled artifact runtime contract 0.2.52.
