import type { Register } from 'claude-code'

// Spike: the Map as a slash command, and the status line row without editing settings.json.
// The Node CLI stays the engine; this only runs it.
const LINE_HINT = /\n\nTo show the user all of the above[\s\S]*$/

export const register: Register = on => {
  const cli = async ($: Parameters<Parameters<typeof on>[1]>[0], args: string[]) => {
    const ran = await $.process.run([`${$.plugin.root}/bin/issue-map`, ...args], { cwd: await $.session.cwd(), timeoutMs: 60_000 })
    return (ran.exitCode === 0 ? ran.stdout : ran.stderr || ran.stdout).replace(LINE_HINT, '').trimEnd()
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'map', description: "Draw the Map of this checkout's Home Project (args: group N | issue X)" })
    const refresh = async () => $.ui.status((await cli($, ['statusline'])) || undefined)
    void refresh()
    $.clock.every(60_000, refresh)
    return next(e)
  })

  // Shown as the command's output, and handed to Claude as context: the user and Claude read the same output.
  on('command.run', { command: 'map' }, async ($, e) => {
    const text = await cli($, e.args.trim() ? e.args.trim().split(/\s+/) : ['map'])
    return { text, context: [text] }
  })
}
