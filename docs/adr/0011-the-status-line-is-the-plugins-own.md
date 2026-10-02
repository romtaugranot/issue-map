# The status line is the plugin's own, pinned by a hooks module

ADR 0001 put the Map optionally in the status line. A plugin couldn't declare one then, so a setup command wrote it into the user's Claude Code `settings.json`, wrapping any status line they had (#40, #50, #56). That meant editing a file the user owns, re-pointing it after each update moved the plugin, and telling users to take it out before uninstalling, or their status line would run a command that's gone.

Claude Code now lets a plugin ship a hooks module, a mod, that pins a line of its own under the prompt with `$.ui.status`. So the plugin's module, `hooks/status.ts`, pins the Home Project's row there whenever the plugin is enabled, from the same process the settings status line ran, which reads only what the background refresher keeps. It refreshes the row when a session starts, after each turn, and every minute. Nothing is written to the user's settings, and the line goes when the plugin is disabled or uninstalled.

A status line set up by 0.1.0 is not changed for the user. While one is still in their settings, the row ends by saying how to take it out, and `issue-map statusline --remove` still puts back the status line it wrapped. There is no setup command any more.

## Amends

- **ADR 0001**, whose consequence was that "a setup command has to write it into the user's settings": the plugin pins its own line, and writes no setting.

## Considered Options

- **Keep the settings setup as well, for builds without mods.** The status line is optional, so two ways to install it would double the code for a feature a user can go without.
- **Offer the mod's line only when the user asks for it.** It goes when the plugin is disabled, so a switch of its own can wait until someone asks for one.
- **Take an old setup out for the user when the Map is drawn.** The plugin writes outside its state directory only when the user asks, so it says how instead.

## Consequences

- **Only on Claude Code builds that load hooks modules.** On older builds, under `disableAllHooks`, `allowManagedHooksOnly` or a policy refusing plugins' modules, and under `claude -p`, there is no status line. Nothing else depends on it. The API is marked early access, so a Claude Code update can change it; CI tests the module on the pinned build.
- **A pinned line, not the `statusLine` row.** It sits beside the user's own status line, not in it, and shows only while a session runs.
- **A module that runs a process.** It runs the plugin's own `bin/issue-map-status-line` with `$.process.run`, and nothing else.
