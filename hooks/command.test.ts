/**
 * `/issue-map` (ADR 0012), run by `claude plugin test` on the
 * release tree with this file copied in: `bin/issue-map` is stood in for,
 * and what it prints is what the command shows.
 */
import { expect, mock, test, type Engine } from "claude-code/testing";
import type { On, ProcessRunResult } from "claude-code";

/**
 * What the plugin's CLI was run with: its own `bin/issue-map`, or on
 * Windows, where a bash script can't be started without a shell, Node on its
 * `src/cli.ts`; `null` for anything else.
 */
const cliArgs = (argv: readonly string[]) => (/^\/.*\/bin\/issue-map$/.test(argv[0]!) ? argv.slice(1) : argv[0] === "node" && /^[A-Za-z]:[\\/].*\/src\/cli\.ts$/.test(argv[1] ?? "") ? argv.slice(2) : null);

/** Answers each run of the plugin's CLI with `result`, `null` failing it, and records what ran and what was registered. */
function world(on: On, result: Partial<ProcessRunResult> | null = { stdout: "**owner/map** · 3 open\n" }) {
  const ran: { argv: readonly string[]; cwd?: string; env?: Record<string, string> }[] = [];
  const registered: string[] = [];
  on("session.cwd", () => ({ value: "/work/checkout" }));
  on("session.id", () => ({ value: "session-1" }));
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  on("command.register", (_$, e) => (registered.push(e.name), { value: { command: e.name } }));
  mock.clock(on);
  on("ui.status", () => ({ value: undefined }));
  on("process.run", (_$, e) => {
    // The status line's own process runs too; only the plugin's CLI is this command's.
    const args = cliArgs(e.argv);
    if (!args) return { value: { exitCode: 0, stdout: "", stderr: "", isStdoutTruncated: false, isStderrTruncated: false } };
    ran.push({ argv: args, cwd: e.init?.cwd, env: e.init?.env });
    if (result === null) return { deny: "node: not found" };
    return { value: { exitCode: 0, stdout: "", stderr: "", isStdoutTruncated: false, isStderrTruncated: false, ...result } };
  });
  return { ran, registered };
}

const start = ($: Engine) => $.session.start({ cwd: "/work/checkout", surface: "terminal", isInteractive: true });
const command = ($: Engine, args: string) => $.command.run({ command: "issue-map", args, origin: { kind: "composer" }, presentation: { isFullscreen: false, columns: 100 } });

test("registers /issue-map as a session starts", async ($, on) => {
  const { registered } = world(on);
  await start($);
  expect(registered).toEqual(["issue-map"]);
});

test("on its own draws the Map, from the plugin's own bin/issue-map, where the session is, on its trail, and shows it as printed", async ($, on) => {
  const { ran } = world(on);
  await start($);
  const { text } = await command($, "");
  expect(ran.length).toBe(1);
  expect(ran[0]!.argv).toEqual(["--shown", "map"]);
  expect(ran[0]!.cwd).toBe("/work/checkout");
  expect(ran[0]!.env).toEqual({ CLAUDE_CODE_SESSION_ID: "session-1" });
  expect(text).toBe("**owner/map** · 3 open");
});

test("followed by a view's command, shows that view", async ($, on) => {
  const { ran } = world(on);
  await start($);
  await command($, " group  2 ");
  await command($, "issue owner/map#7");
  await command($, "back");
  expect(ran.map((r) => r.argv)).toEqual([
    ["--shown", "group", "2"],
    ["--shown", "issue", "owner/map#7"],
    ["--shown", "back"],
  ]);
});

test("leaves writes and what's printed for Claude to Claude, saying what it does serve", async ($, on) => {
  const { ran } = world(on);
  await start($);
  for (const args of ["assign 7", "confirm 1", "start 7", "suggest", "refresher --host h --path p --login l", "html --artifact", "bogus"]) {
    expect((await command($, args)).text).toMatch(/^`\/issue-map` draws the Map;.*Ask Claude to assign/s);
  }
  expect(ran).toEqual([]);
});

test("shows why when bin/issue-map fails or can't run", async ($, on) => {
  world(on, { exitCode: 2, stdout: "", stderr: "usage: issue-map map | …\n" });
  await start($);
  expect((await command($, "group")).text).toBe("usage: issue-map map | …");
});

test("says so when bin/issue-map can't run at all", async ($, on) => {
  world(on, null);
  await start($);
  expect((await command($, "")).text).toMatch(/^Issue Map couldn't run: .*node: not found/);
});
