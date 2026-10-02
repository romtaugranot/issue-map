# Mods spike (2026-10-02)

Throwaway branch, never to be merged. It holds a ~30-line function-hook module (`hooks/register.ts`,
named under `modules` in `hooks/hooks.json` beside the existing MessageDisplay hook) that adds:

- `/issue-map [group N | issue X]`: runs `bin/issue-map` via `$.process.run` and shows its output as the
  command's output, also handed to Claude as `context`. No model turn.
- `$.ui.status(...)`: the status line row, refreshed every 60 s, with no settings.json edit.

Results, on the built release tree:

- `claude plugin validate --strict` passes on Claude Code 2.1.287 and 2.1.152. 2.1.152 prints no
  hooks.json check at all.
- Loaded with `--plugin-dir`, both builds register 23 hooks, the same as main's tree on 2.1.152.
  So a `modules` key doesn't stop an old build loading the plugin. The display hook looks still
  registered, going by that count; it wasn't watched running.
- On 2.1.287 `/issue-map` ran the CLI and printed its output with no model turn.
- `/map` is refused: it collides with the plugin's own skill command `/issue-map:map`.
- In the same container, one run loaded the module, the next said "hooks modules are turned off for
  installed plugins in this process: the rollout switch served off", and the next loaded it again.

The research reports beside this file: `api.md` (what the API allows, with citations), `repo-fit.md`
(what would change in issue-map, the ADRs and issues it touches, the grilling questions), `skeptic.md`
(the case against adopting now).
