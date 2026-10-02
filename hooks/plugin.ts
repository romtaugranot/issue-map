/**
 * The plugin's hooks module, one file as the engine follows `$` into no
 * import: the status line (ADR 0011) and `/issue-map` (ADR 0012).
 *
 * The status line is the Home Project's row, pinned under the prompt as this
 * plugin's own line, so nothing is written into the user's settings. The row
 * comes from the plugin's status line process, which reads only what the
 * background refresher keeps, so it never holds anything up.
 *
 * `/issue-map` shows the Map, or one of its views, as the command's output
 * with no model turn; Claude reads the same output. The plugin's
 * `bin/issue-map` draws it, told with `--shown` that this shows it.
 */
import type { EngineInterface, Register } from "claude-code";

/** How often the row is worked out again while nothing else happens: the refresher keeps a new one every 90 s, and its age goes on growing. */
const EVERY_MS = 60_000;

/** What `/issue-map` serves: views only. Writes, and what's printed for Claude to work from, stay with Claude. */
const VIEWS = new Set(["map", "refresh", "unlinked", "groups", "next", "taken", "group", "picture", "issue", "go", "back", "home", "html"]);

const USAGE =
  "`/issue-map` draws the Map; followed by `refresh`, `next`, `taken`, `groups`, `unlinked`, `group <n | ref>`, `picture <n | ref>`, `issue <ref>`, `go [<target>]`, `back`, `home` or `html`, it shows that instead. Ask Claude to assign an Issue, suggest Links or start work.";

/** Pins the row for where the session is, or takes the line away when there is none. */
async function pin($: EngineInterface): Promise<void> {
  const ran = await $.process.run([`${$.plugin.root}/bin/issue-map-status-line`], { cwd: await $.session.cwd(), timeoutMs: 10_000 }).catch(() => null);
  $.ui.status(ran?.stdout.trim() || undefined);
}

/** What `/issue-map` followed by `args` shows. */
async function answer($: EngineInterface, args: string): Promise<string> {
  // ponytail: split on spaces, so `go` can't take a local path with a space in it; quote-aware splitting if someone needs one.
  const argv = args.trim() ? args.trim().split(/\s+/) : ["map"];
  if (!VIEWS.has(argv[0]!) || argv.includes("--artifact")) return USAGE;
  const ran = await $.process
    .run([`${$.plugin.root}/bin/issue-map`, "--shown", ...argv], {
      cwd: await $.session.cwd(),
      // As the Bash tool has it, so this moves along the same trail as the Map Claude draws.
      env: { CLAUDE_CODE_SESSION_ID: await $.session.id() },
      timeoutMs: 60_000,
    })
    .catch((error: unknown) => `Issue Map couldn't run: ${error instanceof Error ? error.message : String(error)}`);
  if (typeof ran === "string") return ran;
  return (ran.exitCode === 0 ? ran.stdout : ran.stderr || ran.stdout).trimEnd();
}

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    await $.command.register({ name: "issue-map", description: "Show the Map of this checkout's Home Project, or one of its views", argumentHint: "[group <n> | issue <ref> | back | …]" });
    void pin($);
    $.clock.every(EVERY_MS, () => pin($));
    return next(e);
  });
  // A turn may have drawn the Map, or moved the session to another checkout.
  on("turn.complete", async ($, e, next) => {
    void pin($);
    return next(e);
  });
  on("command.run", { command: "issue-map" }, async ($, e) => ({ text: await answer($, e.args) }));
};
