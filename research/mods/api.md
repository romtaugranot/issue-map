# Could issue-map use function-hook plugins ("mods")? API facts for Claude Code 2.1.287

Sources (all under `/tmp/claude-0/bundled-skills/2.1.287/b3c0d3f7480d2b33001a9fb952d6f604/plugin-authoring/`):
- **R** = `reference.md`
- **T** = `types/claude-code.d.ts` (its first line reads "Written by Claude Code 2.1.287"; it also says "EARLY ACCESS: this surface may change between releases without notice", T:4)
- **EX** = `examples/*`
- **CLI** = `claude --version` gave `2.1.287`. **VAL** = `claude plugin validate` run on a throwaway plugin in the scratchpad. **BIN** = strings found in `/opt/claude-code/bin/claude`. These come from the binary itself, not from the docs, so treat them as weaker evidence.

---

## 1. One hooks.json with both `modules` and command hooks; older versions; version gate

- **Both in one file: yes, this build accepts it.** VAL: a hooks.json with `"modules": ["mod.ts"]` and a `MessageDisplay` command hook side by side gives "√ Validation passed" and lists `mod.ts hooks: session.start, command.run{command=map}, …`. R:12-13 says the module is what "`hooks/hooks.json` names under `modules` (one path, relative to that file)". The docs never say in words that the two kinds may share a file. The validator accepts it.
- **Exact shape:** `modules` must be a **one-element array**.
  - VAL with a string: "modules: Invalid input: expected array, received string".
  - VAL with two entries: "hooks.json `modules` names one hooks module per plugin; a second entry is refused".
- **Older Claude Code with no mod support: not stated.** Two weak signs it would be ignored rather than break:
  - `claude plugin validate --help` says `--strict` catches "unrecognized fields … that the runtime tolerates".
  - VAL: an unknown key (`fooBar`) in hooks.json passed with no warning.
  - Both describe only this build's tolerance. They prove nothing about older builds.
- **Version gate:** no minimum version, and no `engines`-style field in the manifest, is stated in R or T. A mod can read the running version with `$.session.version()` (T:2627-2642).
- **Runtime gate (BIN, not in the docs):**
  - "hooks modules are turned off for installed plugins in this process: the rollout switch served off; built-in plugins load regardless".
  - "hooks modules are turned off here (disableAllHooks, allowManagedHooksOnly or a policy)".
  - An env var `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` exists. What it does is not documented.
  - Whether the command hooks in the same file still run when modules are switched off: **not stated**.

## 2. Slash command from a mod that shows output without a model turn

- **Yes.** Register with `$.command.register({ name, description, argumentHint?, immediate? })` (T:2856-2870, `CommandSpec` T:1700-1730). Serve it with `on('command.run', { command: 'map' }, …)`, which returns a `CommandRunResult` `{ text?, context?, exitCode? }` (T:1654).
- **How the output shows:**
  - T:1645-1650: "A hook's own answer without `next` runs no command: its `text` is shown as the command's output, under the names of the plugins hooking the command …, and its `context` is recorded after it."
  - It is drawn as the `CommandOutput` row. Its `text` is "markdown, as the row draws it" (T:9330-9350).
  - The docs never say "no model turn" in those words. The output is a transcript row, like the output of a built-in local command such as `/cost`.
- **Does the model see it? Yes.**
  - R:103: "`text` the row the model also reads, `context` notes only the model reads".
  - T:1665 on `context`: "What the model reads after the command's output and the person never sees".
- **Way to show more than the model stores:** hook `ui.render { component: 'CommandOutput', props: { command: 'map' } }`. T:9323-9325: "A rewrite of `text` draws there and the stored row keeps what the model reads; a hook's own tree draws in the row's place, the transcript's width."
  - Caveat: R:103 / T:9333 say the row is drawn "under the names of the plugins hooking the command".

## 3. Panes (`$.ui.open` plus `ui.render` on `Pane`)

- **Markdown: yes.** `Markdown` is an element on every surface.
  - T:3573: "All carry `Box`, `Text`, `Button`, `Link`, `Code`, `Markdown`".
  - T:8911 `type: 'Markdown'`. R:95: "Model-style text (headings, lists, tables, code fences, links …) is one `Markdown`, drawn as an assistant reply is".
  - `MarkdownProps` (T:5362) are `{ key?, text, dimColor?, onLinkPress?, pressableLinks? }`. `text` is "At most 10000 characters". Links whose scheme is not `https:`, `http:` or `file:` draw as plain text. It is "Not drawn around the approval dialog".
  - A whole tree is bounded at "20,000 nodes, 32 deep, 100,000 characters serialized" (T:1231-1232, said of `Client` trees as "every tree's bounds"). A larger Map can be split across several `Markdown` leaves.
  - Clicking a link can call the plugin (`onLinkPress` raises `ui.press`) only where the surface reports clicks (the fullscreen terminal).
- **Surfaces:**
  - `Pane` is "Raised on every surface" (T:9599).
  - Element tables differ: mobile has no `Input` or `Select`, vscode has no `Client` (T:3613-3640).
  - Remote surfaces place panes only "A remote surface that reports it places panes … the mobile app reports `false`" (T:9693-9696).
  - On an older desktop that places nothing, `isPlaced` stays `false` (T:13145).
  - The `AbovePrompt` band is terminal and desktop only (T:9545).
- **Width rules (T:2275-2280, T:6896-6900, T:13116-13125):**
  - A pane the person asked for (a command they typed, a prompt they entered, a press) "is placed at any width". It docks beside the transcript in fullscreen from 110 columns, otherwise it sits inline above the prompt.
  - An unasked pane (a timer, `session.start`) is placed only "from 144 terminal columns (110 for an id the person opened from this plugin before …)". Below that it "waits undrawn".
  - A tree sizes itself to `e.props.bodyColumns` (T:9619).
- **Scrolling:** `Pane.scroll: SiteScroll { offset, bodyRows }` is "engine-owned, moved by the person's keys while the pane is focused" (T:9625-9628, T:11128). `$.ui.scroll` moves it under program control (T:2310).
- **Buttons:** `<Button key label hotkey variant role onPress>` (`ButtonProps` T:899). A press raises `ui.press`, and its bottom calls `onPress`. A `hotkey` is "One digit … or one lowercase letter". A pane opened with `focus, closeOnEscape, holdToasts` "behaves as a dialog" (R:103). EX `band.tsx` shows `onPress={() => update($, isHidden, () => true)}`.
- **State:** keep drawing state in `$.state` or atoms (R:88), not in module variables. A hot reload loses module variables.

## 4. `$.process.run`

- **Argv only: yes.** "Runs a command on the host by its argument vector (no shell)" (T:3276-3291).
- Signature: `run(argv, { cwd, env, stdin, timeoutMs })`.
- **Timeout:** 30 s by default, "ten minutes at most". The call rejects when the command is still running at the timeout.
- **Output limits:** stdout and stderr each keep their "first 4194304 bytes", flagged by `isStdoutTruncated` / `isStderrTruncated` (T:7534-7547).
- **cwd and env:** `cwd` defaults to the session's directory. `env` is "Variables set over the host process's own environment" (T:7507-7526).
- The noun is labelled "CLI only" (T:3268). What that excludes is not stated.
- **Running `node` or the plugin's own bin:** nothing forbids it. Any executable works as `argv[0]`. Whether the plugin's `bin/` is on PATH for this call is not stated, so use the absolute path.
- **Finding the plugin root:** `$.plugin.root`, "The plugin's directory (the one holding plugin.json), absolute" (T:2135-2143). Example at T:3013-3014: `` `${$.plugin.root}/hooks/weights.bin` ``. So `$.process.run([`${$.plugin.root}/bin/issue-map`, 'map'])`.
- **Caveat:** the module itself has "no DOM, no Node" (R:23, T:18-19). It cannot import issue-map's Node-based `src/` and run it in-process. It has to shell out.
- `$.process.spawn` streams output instead (T:3293-3328).

## 5. `$.ui.status(text)`

- **Where it shows:** "Pins `text` as this plugin's status line under the prompt, beside the engine's own pinned notices, until the next call replaces it. One per plugin; `undefined` removes it." (T:2259-2269).
- **Length or line limits:** not stated.
- **Coexisting with the user's `statusLine` setting:** not stated. The doc says only "beside the engine's own pinned notices". This is a separate per-plugin line, and editing settings.json is not needed.
- **Update rate:** not stated for `status`. The 10-per-second limit at T:2165 applies to `$.ui.invalidate` redraws only.
- **Timer refresh: yes.** `$.clock.every(ms, fn)`: "Calls `fn` every `ms` milliseconds (at least 1) until `cancel()`" (T:3232-3239). The example on that page is literally `$.clock.every(1000, () => $.ui.status("polling"))`.
  - Timers end when the module reloads (R:131).
  - Long-running work starts from `session.start` (R:128).
- **Surfaces** (desktop, mobile, vscode) where status shows: not stated.
- The status-line figures (`$.session.usage`) are also available to a mod (T:2606-2614).

## 6. Auto-allow read-only `issue-map …` Bash calls

- **Yes, with `tool.check`.** It fires "after the `tool.call` and PreToolUse hooks and before the mode settles an ask". Return `{ decision: 'allow' | 'ask' | 'deny', reason? }` (T:3726-3736, `ToolCheckResult` T:12100).
  - T: "A hook may answer any verdict in either direction; the last word up the chain is the decision."
  - Example: `on("tool.check", { tool: "Read" }, () => ({ decision: "allow" }))`.
  - For writes, return `next(e)` and the normal prompt stays.
  - `e.input` is `{ command }` for Bash (T:12080).
- **Alternative:** `classic.PreToolUse` returning `PreToolUseDecision` `{ allow: true }` / `{ ask }` / `{ deny }`: "Lets the call run without a permission prompt" (T:7448-7475).
- **Ordering that can override it:**
  - The tiers are `["prepend", "user", "append", "builtin", "core"]`, outermost first: "earlier is outer is more authority" (T:11860-11875). An admin's `prepend` plugin sits above an installed (`user`) plugin.
  - On `tool.call`: "The managed-settings hooks run first: their deny is the call's result" (T:3722).
  - The classic chain is "[managed settings hooks, ...hooks modules, the other settings hooks as core], so a managed block ends it above every module" (T:1073-1074).
  - Admins can also refuse user modules outright: `on("plugin.register", { tier: "user" }, () => ({ refuse: "managed only" }))` (T:4145).
- **Caveat:** the hook must parse the Bash string itself. Compound commands (`;`, `&&`, pipes) are the plugin's problem, and the docs give no helper for them.

## 7. `$.tool.register`: model-callable tools whose result the user sees drawn

- **Register: yes.** `$.tool.register({ name, description, inputSchema? })` lists the tool as `mcp__<plugin>__<name>`. Serve it from `tool.call { tool: 'mcp__issue-map__map' }` returning `{ result }` (T:2815-2830 (rejects-before-bind at T:2821), `ToolSpec` T:12306, R:139-143).
  - It "Rejects until the session binds, at `session.start`".
  - How a plugin tool's `result` is mapped for the model when it has no output schema: not stated. The doc says core "maps it for the model with the tool's own mapper" (T:11984).
- **Drawn for the user: yes, through render hooks.**
  - `ToolUse` and `ToolResult` are "Raised on every surface", and `tool` can be "a plugin's tool" (T:9188-9260).
  - On `ToolResult`, "a rewrite is drawn … The stored result is untouched". A hook's own tree, such as `<Markdown text=…/>`, draws in its place (R:96: "Return a tree, or `next({ ...e, props })`…").
- **The same works for the existing Bash calls:** hook `ToolResult` where `tool === 'Bash'` and the input command starts with `issue-map`, and draw `output.stdout` as Markdown.
  - Folded runs are a `ToolGroup` ("Read 3 files, ran 2 shell commands"). A hook that sets `isExpanded` "unfolds the group where it is, and each row it unfolds into is a `ToolUse`" (T:9280-9290).
  - This goes after ADR 0009's root problem (tool output collapsed to "Ran 1 shell command"), not its workaround.
  - Not stated: whether a plugin `mcp__` tool row is folded into a `ToolGroup`.

## 8. Replacing the MessageDisplay line swap

- **`ui.render { component: 'AssistantMessage' }`: yes, and more robust.**
  - "One text block of an assistant reply in the transcript; a rewrite changes the drawing and leaves the stored message alone (ctrl+o). Raised on every surface." `props.text` is the block's whole markdown (T:9157-9170).
  - The hook sees the finished block rather than streamed line batches, and it can return its own tree, so several `Markdown` leaves are possible.
  - Display-only.
- **`classic.MessageDisplay` hooked from a mod: possible.**
  - Classic events fire "whether or not any settings hook is configured" (T:1062-1064).
  - Its result field is `displayContent` (T:1168, T:1201).
  - Input is `{ turn_id, message_id, index, final, delta }`, described as "Display-only: the stored message and what the model sees are untouched" (T:5711-5735).
  - It runs in-process and does not start Node.
- **`ui.message`: not relevant.** It fires when a `Client` surface module posts data (T:3783-3790, T:13063).
- **`session.append`: stored, not display.**
  - It is the real append: "what the transcript file stores and what the next request sends are all the row as the chain answered it" (R:107).
  - A rewrite there changes what the model reads. That is the wrong tool for a display swap.
  - `$.session.append` adds a user row (`isMeta`, read by the model) or a system notice ("the model never reads it") (R:115).
- **Unknown:** how the `AssistantMessage` render hook and a still-present command `MessageDisplay` hook interact if both are active (ordering, double swap). Not stated.

## 9. Headless `claude -p`

- **Mods load:** "A headless `claude -p` always loads fresh" (R:69). A module that fails to load is named once on stderr (R:74).
- **No surfaces:**
  - `$.session.surfaces()` is "Empty in a plain -p run" (T:2590).
  - `session.start` gives `surface: null` and `isInteractive: false` (T:10958-10963).
  - Panes: "a `-p` run places all" (T:2280), but with nothing attached nothing draws.
  - `ui.copy` gives `no-surface` (T:12855).
  - `$.ui.ask` "Rejects … in a `-p` run" (T:2234).
  - `$.ui.log` reaches the host as `ui_log` (T:2216).
  - `command.run` can set `exitCode` for `claude -p "/cmd"` (T:1671).
- `$.ui.status` and `ui.render` under `-p`: not stated beyond "draw nowhere yet" (T:10958). ADR 0009's reprint fallback is still needed.

## 10. Distribution, validate rules, `userConfig`

- **Marketplace plugins can carry mods.**
  - `PluginRegisterInput.provenance` is "`<name>@<marketplace>` installed, `<name>@inline` by `--plugin-dir`, `<name>@builtin` bundled" (T:7194-7196).
  - Installed plugins are tier `user` (T:11866).
  - Caveat (BIN): the rollout switch can turn modules off "for installed plugins" while built-in ones still load. Org policy (`disableAllHooks`, `allowManagedHooksOnly`, the `plugin.register` refuse) can also block them.
- **Validate and load rules:**
  - One module, given as an array (§1).
  - Files must be `.ts/.tsx/.jsx/.js/.mjs/.cjs/.mts/.cts` and are ES modules. There is no `require`. "A module holding `import()` does not load" (R:14, T:19-24).
  - "a module that spells `on`, `$`, `$.env` or a `$.state` reference other than literally does not load" (T:7228-7229).
  - A `Client` module path must be a string literal (T:3588-3594).
  - `claude plugin validate --strict` turns warnings into errors.
  - `claude plugin test <folder>` runs `*.test.ts` against the engine (R:75).
- **`userConfig`:** its values arrive as `register(on, options)`. Each non-secret field is a `/config` row, and changing it reloads the module. A `string` field with `options` becomes a picker (R:15, R:70). The type is `PluginOptions` (T:7156-7166).
- **Dependencies:** whether a module may import npm packages from `node_modules`: not stated. Only "every file it imports from the plugin" is.
