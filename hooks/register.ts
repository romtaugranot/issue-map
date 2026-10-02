import type { Engine, Register } from 'claude-code'

// Spike: the Map as a slash command, and the status line row without editing settings.json.
// The Node CLI stays the engine; this only runs it.
const LINE_HINT = /\n\nTo show the user all of the above[\s\S]*$/

async function cli($: Engine, args: string[]): Promise<string> {
  const ran = await $.process.run([`${$.plugin.root}/bin/issue-map`, ...args], { cwd: await $.session.cwd(), timeoutMs: 60_000 })
  return (ran.exitCode === 0 ? ran.stdout : ran.stderr || ran.stdout).replace(LINE_HINT, '').trimEnd()
}

async function refreshStatus($: Engine): Promise<void> {
  $.ui.status((await cli($, ['statusline'])) || undefined)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'issue-map', description: "Draw the Map of this checkout's Home Project (args: group N | issue X)" })
    void refreshStatus($)
    $.clock.every(60_000, () => refreshStatus($))
    return next(e)
  })

  // Shown as the command's output, and handed to Claude as context: the user and Claude read the same output.
  on('command.run', { command: 'issue-map' }, async ($, e) => {
    const text = await cli($, e.args.trim() ? e.args.trim().split(/\s+/) : ['map'])
    return { text, context: [text] }
  })
}
