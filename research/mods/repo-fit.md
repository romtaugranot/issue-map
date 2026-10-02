# issue-map and Claude Code function-hook plugins ("mods"): what would change, and what it would cost

This is read-only research against `main` at `7bc5f0d`. The mod API facts come from the `plugin-authoring` skill and the declaration file Claude Code 2.1.287 writes (`types/claude-code.d.ts`, which is marked **EARLY ACCESS: may change between releases without notice**). One probe was run, in a scratch folder rather than the repo: `claude plugin validate` (2.1.287) accepted a `hooks/hooks.json` that holds both the current classic `MessageDisplay` command hook and `"modules": ["./register.ts"]`. The module in that probe hooked `session.start`, `tool.check` and `ui.render{ToolResult}`, and called `$.tool.register`, `$.command.register` and `$.ui.status`. So the two kinds of hook can live in one plugin on the build CI already pins (`CLAUDE_CODE: 2.1.287` in `.github/workflows/contract.yml`).

Mod facts this report relies on:
- **Drawing tool rows.** `ui.render` can draw a tool's row: `ToolUse` and `ToolResult`, keyed by `tool`, including a plugin's own `mcp__<plugin>__<name>` tools. It can also draw a slash command's `CommandOutput` row, an `AbovePrompt` band and a `Pane`, with a `Markdown` element, `Button`s that have hotkeys, and on the terminal `Raster`/`Image` (no `Svg`) where desktop has `Svg`.
- **Status line.** `$.ui.status(text)` is one pinned line per plugin under the prompt, beside the engine's notices. It is not the user's `statusLine` setting.
- **Slash commands.** `$.command.register` adds one. `command.run` answers `{ text, context?, exitCode? }`. `text` is shown and read by the model, `context` is read by the model only, and `exitCode` applies under `claude -p "/cmd"`.
- **Tools.** `$.tool.register` declares `mcp__<plugin>__<name>`, which a `tool.call` hook serves. A `tool.check` hook can answer `allow`, `ask` or `deny`.
- **Asking the user.** `$.ui.ask` opens the engine's own AskUserQuestion dialog from plugin code. It rejects under `-p` and when dismissed.
- **What a module can and can't do.** The module runs with no Node and no DOM. It reaches the host through `$.process.run` (argv, no shell, 30 s default, 10 min max), `$.process.spawn` (the child is killed when the loop ends or the module unloads), `$.fs`, `$.http` and `$.env.set`. `$.env.set` sets a variable for the Claude Code process and everything it starts afterwards. `$.plugin.root` gives the plugin's folder.
- **Timers.** `$.clock.every` and `$.clock.after` live until the module reloads or the session ends.
- **`claude -p`.** A headless run loads mods fresh, but has no surface: `$.ui.ask` rejects and nothing is drawn.
- **Hooks off.** The reference speaks of "a run no plugin may shape (one started with the settings hooks off …)". So **with `disableAllHooks`, mods very likely don't run either.** This is inferred from the wording, not verified.

---

## 1. The user-facing surfaces today

### 1a. How output reaches the user (ADR 0009 display hook, plus the #60 reprint fallback)

**Current mechanism**
1. Each command prints through `console.log(render(await shown(answer)))` (`src/cli.ts:188`). `shown()` calls `withLine()` (`src/show/shown.ts`). That keeps the text in `<state>/shown/<id>.md`, mode 0600 and pruned after a month, and appends: "write this line on its own in your reply: `⟦issue-map <id>⟧`".
2. The skill (`skills/map/SKILL.md`, "Show every output by its line") tells Claude to write that line and nothing more.
3. `hooks/hooks.json` registers a `MessageDisplay` command hook on every reply. `bin/issue-map-display` is a bash check that leaves at once, without starting Node, when the reply has no `⟦issue-map `. Otherwise `src/display.ts` → `displayed()` swaps each whole line for the kept output, returns it as `displayContent`, and writes `<id>.seen`.
4. **The #60 fallback.** The next command reads that session's record in `shown/<sha256(session)>.json`. If the previous output has no `.seen` marker, none before it was marked, and it was kept more than `JUDGED_AFTER_MS = 30_000` ms before this command started, the output switches to reprint mode for the rest of the session (`REPRINT` + `TELL`).
5. `start` and `suggest` skip all of this: their output is for Claude only.

**Known failure modes**
- **Claude doesn't reprint faithfully.** It summarises the output, most of all before a picker or when asked for several outputs at once. This is why ADR 0009 exists. Rewording the skill was tried three times and failed; `systemMessage`, `updatedToolOutput` and a picker `preview` were all rejected.
- **The hook doesn't run.** Causes: `disableAllHooks`, `allowManagedHooksOnly`, no Node 22.18 on the hook's PATH, or Claude Code older than 2.1.152 (README Requirements). Detection is a heuristic (#60, merged in `deb5ce5`) with a stated ceiling in the `ponytail:` comment in `shown.ts`:
  - the fallback can come one output late;
  - a session's first turn whose commands run more than 30 s apart with no text between them is misread as "hook not running".
- **"Claude omitted the line" can't be told apart from "hook not running".** Both leave no `.seen`, so one forgotten line switches the whole session to reprinting for good. This follows from `withLine`'s logic; no issue tracks it.
- **`claude -p`.** The hook can't change what's printed, so the skill falls back to reprinting.
- **Path quoting.** A plugin path with a space broke the hook command (#61, fixed in `5080623`).
- **Expired outputs.** An output kept past a month shows "no longer kept: ask for it again".
- **Ordering.** The output is drawn inside Claude's reply. If Claude puts the line in the wrong place, the Map shows up there.

**A mod alternative**
- Register the read commands as tools, `mcp__issue-map__map`, `…__issue`, `…__group` and so on. Their `tool.call` hook runs `$.process.run([$.plugin.root + "/bin/issue-map", verb, ...args], { cwd })`.
- A `ui.render` hook on `{ component: "ToolResult", tool: /^mcp__issue-map__/ }` draws the output as `<Markdown>` in the tool's own row. The user sees the exact output whatever Claude writes, and no kept file or line is needed.
- For the CLI-only path, a `ToolUse`/`ToolResult` hook on `Bash` calls whose command starts with `issue-map` can do the same. Matching on a shell string is weaker, and the `ToolGroup` fold has to be expanded.
- **A session handshake replaces the 30 s heuristic.** In `session.start` the mod calls `$.env.set("ISSUE_MAP_SHOWN_BY", "mod")`, which every Bash child inherits. When the variable is set, `withLine` returns the text without keeping it and without a line. Under `-p` the mod sets `reprint` instead.
- **What stays:** the `-p` reprint, and the #60 path for sessions where hooks are off. Mods are probably off there too.

### 1b. The status line

**Current mechanism**
- `issue-map statusline --setup` (`src/status/install.ts`) writes `statusLine` into `~/.claude/settings.json` (or `$CLAUDE_CONFIG_DIR`) with `refreshInterval: 60`. A status line the user already has is wrapped as `'<entry>' --wrap '<theirs>' 2>/dev/null || sh -c '<theirs>'`.
- Every `map` draw re-points the entry after an update (`repointStatusLine`, #56).
- `--remove` restores the wrapped status line (#50).
- `bin/issue-map-status-line` runs `src/status-line.ts`. That runs the user's own command alongside, and prints the Home Project's row from the line the store keeps beside the Snapshot (`src/status/line.ts`). It never reads a Tracker.

**Known failure modes (ADR 0001 Consequences, spec #25 Further Notes)**
- A plugin can't declare a status line, so the plugin has to write the user's settings, and a user has only one status line.
- After an update moves the plugin, the entry is stale until the next draw. The `|| sh -c theirs` fallback (#56) keeps the user's own rows meanwhile.
- Uninstalling before `--remove` leaves the status line running a command that's gone (README Uninstall step 1).
- A hand-edited command can't be removed safely.
- Claude Code cancels the status line on every message.
- It shows on the terminal only.
- Below Node 22.18 the Map's row is dropped.

**A mod alternative**
- `$.ui.status(row)` is a line the plugin owns. It needs no settings write, no wrapping, no re-pointing after updates, no removal step, and disappears with the plugin.
- Fed by `$.clock.every(60_000)`, reading the saved row (`$.process.run([root+"/bin/issue-map", "statusline"])`, or `$.fs` on the row file), and refreshed after each Map tool call.
- Richer option: an `AbovePrompt` band with Take next's first pick as a `Button` that opens its card.
- Visible wherever the mod draws, desktop included.
- It is still optional. The plugin should show it only after the user opts in, which is a question for the grilling (section 5).

### 1c. Interactive choices (AskUserQuestion)

**Current mechanism**
- The CLI's `render()` (`src/cli.ts:322`) appends three blocks: `Links to follow`, `Choices, best first` (each with the command to run) and `To confirm` (numbered).
- The skill choreographs how Claude turns each into `AskUserQuestion`: the order, three Links plus a fourth option, More Links, multiSelect groups of at most four and never one alone, the "(Recommended)" Home pick, and "Other" as a `go` target.
- Under `-p`, Claude lists the choices and stops.

**Known failure modes**
- It depends on Claude following a long choreography (about a third of `SKILL.md`).
- Every step of the walk costs a model turn and output tokens (spec #25 Surfaces: "every line costs output tokens").
- Issue text could imitate a **Choices** block. The skill warns about this, and #51 cleans titles.
- Confirming a write (assign, confirm) rests on the model asking first. The permission prompt is the planned second layer (#78).

**A mod alternative**
- The mod asks with `$.ui.ask(question, { options, header, multiSelect })` itself, inside the tool or command, so the order and caps are code.
- For writes, the mod's `tool.call` for `assign` or `confirm` calls `$.ui.ask` and runs the CLI only on a yes. The engine-drawn dialog becomes the confirmation, whatever the model does.
- Card navigation can be `Button`s in a `CommandOutput` row or a `Pane`. Pressing one runs `issue-map issue '<ref>'` and redraws, with no model turn.
- `$.ui.ask` rejects under `-p`, so the CLI's text blocks stay as the fallback.

### 1d. Permissions

**Current mechanism**
- Each `issue-map …` Bash call goes through the normal permission flow.
- #78 plans an `allowed-tools` list on the skill, covering read-only commands only, while assign, confirm and status-line setup keep prompting. It also asks to "check it is honoured for plugin skills on the minimum Claude Code version".
- The README tells sandbox users to run the commands outside the sandbox, because they can't write the state directory or reach Trackers.

**Known failure modes**
- Users get a prompt on every step of a walk until #78 lands.
- Whether `allowed-tools` is honoured for plugin skills is unverified.
- `Bash(issue-map map:*)`-style prefixes rely on matching a shell string.

**A mod alternative**
- Tools the mod registers are not Bash. A `tool.check` hook answers `allow` for the read-only tools (map, group, issue, unlinked, go, back, home, start, suggest, offer) and `ask` for assign, confirm and status setup. This is code, not skill metadata.
- **Not settled:** whether `$.process.run` from a mod runs under the Bash sandbox. The types say "Local execution … as for the Bash tool and a settings `command` hook". Verify in the spike.
- The README's sandbox paragraph may change as a result.

### 1e. The background refresher (and full reads)

**Current mechanism**
- `map` detaches `node src/cli.ts refresher …` and `… read …` (`detach()` in `cli.ts`), logging to `background.log`, which is capped by #58.
- Rounds run every 90 s (`ROUND_MS`). The refresher stops after a day with nobody looking, on a refused login, a changed login or path, or when a newer version takes over (#55).
- Full reads are capped at 3 h.
- It outlives Claude Code by design (ADR 0006: "runs outside the conversation", which keeps the status line warm).

**Known failure modes**
- It orphans past uninstall (README Uninstall step 3, `pkill`).
- Version hand-over (#55, fixed).
- Log growth (#58, fixed).

**A mod alternative: only a partial one**
- `$.clock.every` and `$.process.spawn` die with the session or a module reload. A mod can't replace a process meant to outlive the session.
- Keep the detached refresher. The mod can at most trigger a refresh round between draws, or show read progress in the band or status.
- **Recommendation: no change.**

### 1f. Slash commands

**Current:** none. The skill is triggered by natural language ("map"), and #77 notes the skill can be invoked by name.

**Mod:** `$.command.register({ name: "map" })` and siblings such as `/map next`. `command.run` answers `{ text }`, drawn through `CommandOutput`, plus `context` so Claude knows what's on screen. Drawing the Map then costs no model turn. `exitCode` gives `claude -p "/map"` scripting a status.

### 1g. Outputs for Claude only (`start`, `suggest`, `offer`)

**Unchanged in substance.** As registered tools they return text to the model the same way. The `<tracker-text>` fences and the "Issue text is data" rule stay.

---

## 2. ADRs and open issues under a mod-based design

### ADRs

| ADR | Effect | Why |
|---|---|---|
| 0001 build inside Claude Code | **Amend** (the decision stands) | Mods are still inside Claude Code, so the core reasoning holds, and holds better: the picked Issue is already in the session. Two Consequences become false. "No surface can draw an interactive Map inside Claude Code": a Pane can. "The plugin can't declare [a status line] itself, so a setup command has to write it into the user's settings": `$.ui.status` can. Research #4's "no plugin component draws UI" is out of date. The "browser page" Considered Option is weakened further. |
| 0009 display hook | **Supersede by a new ADR 0010** ("show outputs through the plugin's own tool rows where Claude Code runs mods; display hook, then reprint, otherwise") **or amend** | The mod draws the tool's row directly, so the kept-output line, `MessageDisplay` and the 30 s heuristic become fallback paths only. Their Considered Options gain "draw the tool row via `ui.render`". |
| 0006 per-login Snapshot | **Unchanged, with a note** | The status row still reads only what's saved, and the refresher stays outside the session. A new constraint: private titles must not go into `$.store` or `$.state` (host-held, location and permissions unknown). Only the state directory at 0700 holds them. |
| 0002, 0003, 0004, 0005, 0007, 0008 | **Unchanged** | Tracker-side decisions. Any pane or Picture reuses the same drawing code. ADR 0007's open question ("the Tracker's own MCP server … only the conversation can call and the status line cannot") is softened: a mod can call MCP tools from a timer through `$.tool.call`. The detached refresher still can't, so the question stays open. |
| *(new)* 0010 | **Needed** | Records (a) the rendering tiers; (b) the minimum Claude Code version and how an early-access API is "promised", by analogy with ADR 0004; (c) whether Panes count as "the conversation" for ADR 0001. Note that #84 already reserves the number 0010 for the browser Picture, so the two must be merged or renumbered. |

### Open issues

| Issue | Effect | Why |
|---|---|---|
| #78 pre-allow read-only commands | **Reshaped** (or obsoleted under a full adoption) | Registered tools plus `tool.check` give the read/write split in code, with no reliance on plugin-skill `allowed-tools`. Writes become stronger still via `$.ui.ask` inside the tool. Under a spike that keeps Bash, #78 stays as written. |
| #81 Picture: whole Group as a text tree | **Unaffected in its core, reshaped in surface** | The tree is drawing code, and is needed for `-p` and the conversation anyway. Under a mod it can render in a Pane sized to `bodyColumns` rather than a fixed 64–72 columns, and "kept and shown through the display hook" becomes "drawn in the tool row". |
| #82 Picture around one Issue | **Unaffected in its core** | The "Picture around #n" card choice becomes a Button. |
| #83 Mermaid/DOT export | **Unaffected** | It is export text for pasting into Trackers, and still needs its ADR 0001 note. It is somewhat less motivated if a Pane shows Groups whole. |
| #84 grilling + ADR 0010 browser Picture | **Reshaped** | The grilling should first ask "Pane inside Claude Code, or a browser?". A terminal Pane answers the SSH/VPS question, since it works over SSH, and the "way back into the session" question, since a Button acts in the session. ADR 0010 might become the Pane ADR. |
| #85 local HTML Picture | **Likely obsoleted or deferred** | A Pane gives tile-map navigation in-session: `Raster` for tiles on the terminal, `Svg` on desktop. It would remain only for Claude Code versions without mods, or for a whole-Map view on a big screen. |
| #86 publish as a claude.ai Artifact | **Likely obsoleted** | Its only reason is SSH users who can't open a local file, which a Pane covers. That also removes its clash with ADR 0006's privacy rule. |
| #69 Group listing | **Unaffected** | Drawing code. A Pane could scroll instead of paging, but the conversation still pages. |
| #70 Unblocked counts | **Unaffected** | Drawing code. |
| #74 paged Take next | **Unaffected** | Drawing code. |
| #73 refresh command | **Slightly reshaped** | It is a natural `/map refresh` command or band Button. Its core is unchanged. |
| #71 Group URL match and head check | **Partly reshaped** | Buttons carry the Group's identity rather than its place, so the reorder race the skill-side head check guards against disappears on that path. The URL-shape half is unaffected. |
| #77 troubleshooting and privacy | **Reshaped** | "A bare output line means the display hook isn't running" changes. Privacy text adds Pane drawings reaching remote surfaces (desktop, mobile), the same exposure as the conversation. |
| #79 bug template | **Minor** | Add whether the mod is loaded, and its version. |
| #62 CI hygiene | **Minor** | Add a `claude plugin test` step, with a timeout, next to `plugin validate --strict`, which already installs Claude Code 2.1.287. |
| #87 release 0.1.0 | **Unaffected unless the owner gates on mods** | Recommend releasing 0.1.0 without mods. Its "status line can be removed" criterion is about settings removal (#50), which a mod would later make unnecessary. |
| #47 owner checklist | **Minor** | SECURITY.md's scope list (it names the `MessageDisplay` hook and `bin/issue-map-status-line`) gains the hooks module. The closing comments on #25 and #1 should name ADR 0010. |
| #25 spec, #1 map | **Annotate** | The "Surfaces" paragraph and the Out of Scope "a TUI in its own pane" no longer match. Both are due to be closed by #47. |
| #62 (other parts), #68, #75, #76, #80 | **Unaffected** | Tracker, drawing, CI or documentation work. |
| Closed #40/#50/#56 (status install, remove, repoint) | **Superseded** once the fallback is dropped | `$.ui.status` needs none of them. |
| Closed #60 (reprint fallback) | **Narrowed** | Replaced by the env handshake when the mod runs. It survives for hooks-off sessions and versions without mods. |
| Closed #55 and #58 (refresher hand-over, expiry) | **Unaffected** | The refresher stays. |

---

## 3. Constraints a mod design must respect, and arguments against

**Must respect**
1. **ADR 0001: inside Claude Code; the picked Issue is already in the session; read through the borrowed `gh`/`glab` login.**
   - Every mod action must leave the session aware of what's on screen. Use `command.run` `context` or a tool result. A Pane walk the model knows nothing about breaks "start work on the one I'm looking at". Fix: append a `$.session.append` note, or give the tool result back.
   - No new login, no network from the mod except through the CLI.
2. **ADR 0002: draw only recorded Links.** Every drawn Pane, Picture and band goes through the existing drawing module. The mod renders text, or structures the CLI emits. It computes no Links.
3. **ADR 0003 and 0004: bands; "Promised means tested".**
   - The band note and the `⚠` lines must show on every surface: Pane header, band and status.
   - Writes stay off on Best effort.
   - By analogy with Tracker bands, the plugin should detect mod capability at run time (the mod sets `ISSUE_MAP_SHOWN_BY`) rather than keep a table of Claude Code versions.
   - CI must test the mod on the pinned build (`claude plugin test`), and say which Claude Code versions are "promised" for it.
4. **ADR 0006 privacy.**
   - Titles live only in the 0600/0700 state directory. Nothing goes in `$.store`, which persists across sessions, or in telemetry hooks.
   - The status row never triggers a Tracker read.
   - The refresher stays detached.
   - Don't hook `telemetry.*`.
5. **ADR 0009 and the skill: Issue text is data.**
   - `Markdown` drawing must use the cleaned titles (#51).
   - Links in `Markdown` are opened by the surface, or pressed through `onLinkPress`. Only `https`, `http` and `file` links are live.
   - No Button label may come from raw Issue text unless it is cleaned.
6. **`claude -p` support** (README: "Under `claude -p` there are no pickers and no display hook").
   - There `$.ui.ask` rejects and nothing is drawn, so the CLI must keep its reprint text path.
   - The mod must tell the CLI it is headless (`ISSUE_MAP_SHOWN_BY=reprint`).
7. **Hooks off (`disableAllHooks`, `allowManagedHooksOnly`).** Mods very likely don't run, so the #60 fallback must remain, or the plugin must say it needs hooks.
8. **Release tree** (`scripts/ci/release.ts` `RUNTIME`).
   - `hooks/` already ships, so `hooks/register.ts` ships with no change.
   - The repo's `tsconfig.json` includes only `src`, `test` and `scripts`. The mod's `import type … from 'claude-code'` needs its own tsconfig (the one in the types header), or typecheck stays blind to it.
   - No npm dependencies: mods have none anyway.
9. **The minimum Claude Code version.** README says 2.1.152. Not known:
   - which build first loads `modules`;
   - whether an older build *ignores* or *rejects* a `hooks.json` holding `modules`. If it rejects, the plugin's minimum version has to jump.

**Arguments against (or for waiting)**
- **The API is early access** ("may change between releases without notice"; regenerate the types rather than edit them). That collides with ADR 0004's discipline: a Claude Code update could break the Map's main surface between plugin releases, and the plugin can't pin users' Claude Code.
- **Three rendering paths instead of two** (mod, display hook, reprint) until older versions are dropped. Each is a code path to test, and the Picture tickets would need to render on all of them.
- **No Node in the module.** The drawing code can't be imported (`src/map/text.ts` imports `node:crypto`), so the mod shells out to the CLI on every action. That is about one Node start per click, the same cost as today but now on a Button press.
- **No help for the refresher**, and probably none for hooks-off sessions.
- **A larger security surface.** A mod with `$.process`, `$.fs`, `$.http` and `$.env`, and a `tool.check` that auto-allows, is more to review in SECURITY.md than one bash hook. A Bash-prefix auto-allow in particular would be an injection risk, so only the plugin's own registered tools should ever be auto-allowed.
- **Panes need width** to open unasked (144 columns, 110 once asked). On narrow terminals the conversation stays the primary surface anyway.

---

## 4. Minimal migration shape

**What stays**
- The Node CLI as the engine: all of `src/`, the state directory, Snapshots, the drawing module, adapters, the detached refresher and full reads.
- `start`, `suggest` and `offer` as text for Claude.
- The skill, trimmed.
- The display hook and reprint as fallbacks.

**The mod layer**
- `hooks/hooks.json` gains `"modules": ["./register.ts"]` beside `MessageDisplay`. Strict validation of both together passed on 2.1.287 (probe above).
- `hooks/register.ts`:
  1. **`session.start`:**
     - `$.env.set("ISSUE_MAP_SHOWN_BY", hasSurface ? "mod" : "reprint")`;
     - `$.tool.register` for each read command, or one tool taking `{ verb, ref?, page? }`;
     - `$.command.register({ name: "map" })`;
     - start `$.clock.every(60_000)` that pushes `$.ui.status(row)`.
  2. **`tool.call` on `mcp__issue-map__*`:** `$.process.run([$.plugin.root + "/bin/issue-map", ...argv], { cwd: await $.session.cwd() })` → `{ result: { text } }`. For `assign` and `confirm`, `$.ui.ask` first.
  3. **`tool.check`:** `allow` for the read tools, `ask` for the write tools.
  4. **`ui.render` on `ToolResult` for those tools:** `<Markdown>` of the text. Same for `CommandOutput` on `map`.
  5. **`command.run` on `map`:** run the CLI, return `{ text, context: [what is on screen] }`.
- **CLI:** `shown()` in `src/cli.ts` (or `withLine`) returns the text unchanged when `ISSUE_MAP_SHOWN_BY=mod`. Status setup (`statusline --setup`) says it isn't needed when the mod runs.
- **Skill:** "When `mcp__issue-map__*` tools are listed, call them and don't write a line or reprint; the user sees the output in the tool row." The current rules stay as the fallback.

**Fallback for Claude Code without mods:** today's behaviour unchanged: Bash `issue-map …`, display hook, #60 fallback, `-p` reprint, settings status line. This holds only if older builds ignore the unknown `modules` key. Otherwise the minimum version rises and the display-hook path can be deleted outright.

**Size estimates**

| | Files | Lines (approx.) | What |
|---|---|---|---|
| **Spike** (1–2 days) | `hooks/hooks.json` (+1), `hooks/register.ts` (new, ~150–200), `src/cli.ts` or `src/show/shown.ts` (+~10), `hooks/register.test.ts` (new, ~60–100, `claude plugin test`), `skills/map/SKILL.md` (+~8), a tsconfig for the module (~15) | **~250–350 added, 0 deleted** | Read tools drawn in their rows, the env handshake, the status pushed via `$.ui.status`, `tool.check` allow for reads. Answers the "verify" items in section 5. |
| **Full adoption** (1.5–3 weeks with docs) | the module split into ~4–6 files under `hooks/` (tools, render and pane, band and status, asks, commands), ~600–900; tests ~400–600; ADR 0010 (~30); amendments to ADR 0001 and 0009 (~10 each); README (Requirements, status line, What it writes, Uninstall, Troubleshooting, Security; ~40–60 changed); SKILL.md (−60/+30); SECURITY.md (+3); a CI `claude plugin test` step (+3) | **~1,100–1,600 added** | Adds Buttons for card navigation, `$.ui.ask` for writes and Home picks, a Picture Pane (taking over #85/#86's role), an AbovePrompt band, and slash commands. |
| **Deletions once fallback is dropped** (needs minimum Claude Code ≥ the first build with mods, and hooks-off declared unsupported) | `src/status/install.ts` (133), `src/status-line.ts` (59), `bin/issue-map-status-line` (11), `src/display.ts` (14), `bin/issue-map-display` (15), the `withLine` heuristic in `shown.ts` (~45 of 78), `status-setup` and `shown` tests, the AskUserQuestion choreography in the skill | **~280 src + ~300 test + ~60 skill lines removed** | `src/status/line.ts` stays (it builds the row). The `-p` reprint text stays. |

---

## 5. Questions for a grilling session

1. **Timing.** Adopt mods before or after 0.1.0 (#87)? Is an early-access API acceptable as the Map's *primary* surface, or only as an opt-in extra, while the display hook stays primary?
2. **Minimum Claude Code version.** Keep 2.1.152 with three rendering tiers, or move to the first build with mods (which build?) and delete the display hook and settings status line? To verify first: does 2.1.152 ignore or reject a `hooks.json` with `modules`?
3. **What "Promised" means for Claude Code.** Is the pinned CI build enough? Should the plugin test a window of Claude Code versions, as it does for GitLab minors? What happens when an update breaks the mod: a patch release, or a run-time detection that falls back to the display hook?
4. **Hooks off.** If `disableAllHooks` also turns off mods (to verify), keep the #60 fallback forever, or declare hooks required?
5. **Tools versus Bash.** Do read commands become registered `mcp__issue-map__*` tools, which makes #78 a `tool.check`, or stay Bash with the Bash row redrawn by a `ToolResult` hook? Does `$.process.run` run under the Bash sandbox (to verify)?
6. **Who confirms writes.** Should `assign` and `confirm` ask through `$.ui.ask` inside the tool, so confirmation is the engine's and not the model's? Does the permission prompt then still matter (#78's "second layer")?
7. **Navigation without the model.** May a card walk happen through Buttons with no model turn? If so, how is the session told what's on screen: `command.run` `context`, `$.session.append`, or nothing until the user speaks? This is ADR 0001's "the Issue is already in the session".
8. **Panes and the Picture tickets.** Does a Pane count as "the conversation" under ADR 0001? Does it replace the browser Picture (#84 reshaped, #85 and #86 closed), or sit beside it? Is ADR 0010 the Pane ADR, the rendering-tier ADR, or one ADR for both?
9. **Status line.** Should `$.ui.status` replace the settings status line outright, or be offered only on opt-in (a `/map status on` command, a `userConfig` option)? Does it show by default once the plugin is installed, given ADR 0001 says "optionally in the status line"? Should an existing settings status line be migrated or left alone?
10. **Slash commands.** Which ones: `/map`, `/map next`, `/map refresh` (#73)? Should they bypass the model entirely?
11. **Privacy.** Confirm no titles in `$.store` or `$.state`. Should Pane drawings that reach remote surfaces (desktop, mobile, Remote Control) be covered in the #77 privacy paragraph?
12. **Refresher.** Keep it detached (recommended), or tie its life to the session now that the status could be pushed by the mod? That would weaken ADR 0006's warm Snapshot between sessions.
13. **Security scope.** Is a hooks module with `$.process`, `$.fs` and `$.env` acceptable in SECURITY.md's scope? Is an auto-allow limited strictly to the plugin's own registered read tools?
