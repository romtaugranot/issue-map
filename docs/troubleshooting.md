# Troubleshooting

[← Docs](README.md) · [README](../README.md)

### Claude's reply shows a bare line such as `⟦issue-map 3f9a0c1b2d4e⟧` instead of the output

The display hook isn't running. It needs all of these:

- Claude Code 2.1.152 or later;
- hooks not turned off (`disableAllHooks`) or limited to managed ones (`allowManagedHooksOnly`);
- Node.js 22.18 or later on the `PATH` Claude Code runs hooks with, which isn't always your shell's.

The next command notices, and from then on Claude reprints each output.

### There's no status line

The plugin pins the status line through a hooks module. That needs a Claude Code build that loads hooks modules, and hooks that aren't turned off (`disableAllHooks`), limited to managed ones (`allowManagedHooksOnly`) or refused by a policy. There's no status line under `claude -p`.

### There's no `/issue-map` command

Like the status line, `/issue-map` needs a Claude Code build that loads plugins' hooks modules. Without one, the command doesn't exist, and you ask Claude for the Map instead. The skill's own `/issue-map:map` is always there.

### The first Map of a large Project takes minutes

The first read pages through every open Issue and its Links, and the Map draws only once it's done. Meanwhile, asking for the Map shows how far the read has got and about how long is left.

That read, and the full read each Snapshot gets weekly or sooner, spend your login's API rate limit. When the limit runs out, the Map says so. Asking again later resumes the read where it stopped.

### A command stops with a line naming the state directory

Claude Code's Bash sandbox is stopping the Map's commands from writing their [state directory](privacy.md#on-your-machine). [Run them outside the sandbox](../README.md#requirements).

### Something in the background seems stuck or silent

The full reads and the refresher print to `background.log` in the [state directory](privacy.md#on-your-machine). [Privacy and data](privacy.md#in-the-background) says how to stop either one.

### Claude doesn't pick the Map up from what you say

Invoke its skill by name: `/issue-map:map`, followed by what you want.

### Anything else

[Report a bug](https://github.com/romtaugranot/issue-map/issues/new?template=bug_report.yml). Its form asks for what it takes to diagnose one.
