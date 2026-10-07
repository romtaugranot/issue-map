/**
 * The status line (ADR 0011), run by `claude plugin test` on the
 * release tree with this file copied in: the plugin's status line process is
 * stood in for, and each row it prints is what ends up pinned.
 */
import { expect, mock, test, type Engine } from "claude-code/testing";
import type { On } from "claude-code";

/** Answers each run of the status line process with the next of `outputs`, `null` failing it, and records what ran and what was pinned. */
function world(on: On, outputs: (string | null)[]) {
  const ran: { argv: readonly string[]; cwd?: string }[] = [];
  const pinned: (string | undefined)[] = [];
  on("session.cwd", () => ({ value: "/work/checkout" }));
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  on("turn.complete", (_$, e) => ({ text: e.answer }));
  on("process.run", (_$, e) => {
    ran.push({ argv: e.argv, cwd: e.init?.cwd });
    const stdout = outputs.shift();
    if (stdout === null || stdout === undefined) return { deny: "node: not found" };
    return { value: { exitCode: 0, stdout, stderr: "", isStdoutTruncated: false, isStderrTruncated: false } };
  });
  on("ui.status", (_$, e) => (pinned.push(e.text), { value: undefined }));
  on("command.register", (_$, e) => ({ value: { command: e.name } }));
  return { ran, pinned };
}

const start = ($: Engine) => $.session.start({ cwd: "/work/checkout", surface: "terminal", isInteractive: true });
const turnEnds = ($: Engine) => $.turn.complete({ answer: "", durationMs: 1, isAborted: false, turnId: "t1", reason: "answer" });

test("pins the Home Project's row as a session starts, from the plugin's own status line process, where the session is", async ($, on) => {
  const clock = mock.clock(on);
  const { ran, pinned } = world(on, ["◆ o/r · Take next: #1 First\n"]);
  await start($);
  await clock.settle();
  expect(ran.length).toBe(1);
  expect(ran[0]!.argv.length).toBe(1);
  expect(ran[0]!.argv[0]).toMatch(/^(\/|[A-Za-z]:\\).*\/bin\/issue-map-status-line$/);
  expect(ran[0]!.cwd).toBe("/work/checkout");
  expect(pinned).toEqual(["◆ o/r · Take next: #1 First"]);
});

test("works the row out again every minute, and takes the line away when there is no row", async ($, on) => {
  const clock = mock.clock(on);
  const { pinned } = world(on, ["◆ o/r · Take next: #1 First\n", "◆ o/r · Take next: #2 Second\n", ""]);
  await start($);
  await clock.settle();
  await clock.advance(59_999);
  expect(pinned).toEqual(["◆ o/r · Take next: #1 First"]);
  await clock.advance(1);
  await clock.advance(60_000);
  expect(pinned).toEqual(["◆ o/r · Take next: #1 First", "◆ o/r · Take next: #2 Second", undefined]);
});

test("works the row out again after each turn, which may have drawn the Map", async ($, on) => {
  const clock = mock.clock(on);
  const { pinned } = world(on, ["◆ o/r · No Home Project yet · ask for the Map\n", "◆ o/r · Take next: #1 First\n"]);
  await start($);
  await clock.settle();
  await turnEnds($);
  await clock.settle();
  expect(pinned).toEqual(["◆ o/r · No Home Project yet · ask for the Map", "◆ o/r · Take next: #1 First"]);
});

test("takes the line away when the process can't run, rather than leaving an old row", async ($, on) => {
  const clock = mock.clock(on);
  const { pinned } = world(on, ["◆ o/r · Take next: #1 First\n", null]);
  await start($);
  await clock.settle();
  await clock.advance(60_000);
  expect(pinned).toEqual(["◆ o/r · Take next: #1 First", undefined]);
});
