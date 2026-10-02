import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { displayed, keepShown, withLine } from "../src/show/shown.ts";
import { releaseTree } from "../scripts/ci/release.ts";

const dir = () => mkdtemp(join(tmpdir(), "issue-map-shown-"));

test("a kept output is shown, exactly as printed, where its line stands in a reply", async () => {
  const d = await dir();
  const map = "**owner/map** · 3 open · Promised\n\n**Take next: 1** — most waited on first\n- #1 Lay the foundation — ▶2 wait on it";
  const line = await keepShown(d, map);
  assert.match(line, /^⟦issue-map [0-9a-f]{12}⟧$/);
  assert.equal(await displayed(d, `Here's the Map:\n${line}\nOpen a Group next.\n`), `Here's the Map:\n${map}\nOpen a Group next.\n`);
});

test("several lines in one reply each show their own output, in turn", async () => {
  const d = await dir();
  const [a, b] = [await keepShown(d, "the overview"), await keepShown(d, "a card")];
  assert.equal(await displayed(d, `${a}\n\n${b}`), "the overview\n\na card");
});

test("text with no line of the Map's is left alone, so the reply shows as Claude wrote it", async () => {
  const d = await dir();
  assert.equal(await displayed(d, "Nothing of the Map's here.\n"), null);
  const line = await keepShown(d, "the overview");
  assert.equal(await displayed(d, `See ${line} above.\n`), null, "only a line of its own stands for an output");
});

test("a line whose output is gone says so, rather than show the bare line", async () => {
  const d = await dir();
  assert.equal(await displayed(d, "⟦issue-map 0123456789ab⟧\n"), "_This output of the Map's is no longer kept: ask for it again._\n");
});

test("outputs untouched for a month are deleted when another is kept", async () => {
  const d = await dir();
  const old = await keepShown(d, "an old overview");
  const id = /⟦issue-map (\w+)⟧/.exec(old)![1]!;
  const month = new Date(Date.now() - 31 * 86_400_000);
  await utimes(join(d, "shown", `${id}.md`), month, month);
  await keepShown(d, "a new one");
  assert.deepEqual((await readdir(join(d, "shown"))).length, 1);
});

test("an output ends by telling Claude the line that shows it, and that line shows it all", async () => {
  const d = await dir();
  const card = "#7 [p4] Proofread the release notes\nNot Blocked · unassigned";
  const lines = (await withLine(d, card)).split("\n");
  assert.deepEqual(lines.slice(0, 3), ["#7 [p4] Proofread the release notes", "Not Blocked · unassigned", ""]);
  assert.equal(lines[3], "To show the user all of the above, exactly as printed, write this line on its own in your reply:");
  assert.equal(await displayed(d, lines[4]!), card);
});

test("`--shown`, for a caller that shows the output itself, prints it plain, and keeps nothing that would sway the session's judgement of the hook", async () => {
  const d = await dir();
  await withLine(d, "the overview", "session-1");
  const before = await readdir(join(d, "shown"));
  const bin = fileURLToPath(new URL("../bin/issue-map", import.meta.url));
  const { stdout } = await promisify(execFile)(bin, ["map", "--shown"], { cwd: tmpdir(), env: { ...process.env, ISSUE_MAP_STATE_DIR: d, CLAUDE_CODE_SESSION_ID: "session-1" } });
  assert.match(stdout, /^No Home Project: .* isn't inside a git checkout\./);
  assert.doesNotMatch(stdout, /⟦issue-map|To show the user|reprint/);
  assert.deepEqual(await readdir(join(d, "shown")), before);
});

describe("when the display hook isn't running, as with hooks disabled", () => {
  /** When a command run a while after the last, as on the user's next ask, started. */
  const nextAsk = () => Date.now() + 31_000;

  test("the next output in the session, its previous one never shown, has Claude reprint it and tell the user why, once", async () => {
    const d = await dir();
    assert.match(await withLine(d, "the overview", "session-1"), /⟦issue-map [0-9a-f]{12}⟧$/);
    const second = await withLine(d, "**owner/map** · 3 open", "session-1", nextAsk());
    assert.ok(second.startsWith("**owner/map** · 3 open\n\n"));
    assert.doesNotMatch(second, /⟦issue-map/);
    assert.match(second, /reprinting it exactly as printed, and every output of the Map's from now on/);
    assert.match(second, /Tell the user once.*display hook isn't running.*hooks are disabled.*only managed hooks are allowed.*Node isn't on the hook's PATH/s);
    const third = await withLine(d, "a card", "session-1", nextAsk());
    assert.match(third, /^a card\n\n.*reprinting it exactly as printed/s);
    assert.doesNotMatch(third, /⟦issue-map|Tell the user/);
  });

  test("another session still shows its outputs by their lines", async () => {
    const d = await dir();
    await withLine(d, "the overview", "session-1");
    assert.doesNotMatch(await withLine(d, "the overview", "session-1", nextAsk()), /⟦issue-map/);
    assert.match(await withLine(d, "the overview", "session-2"), /⟦issue-map [0-9a-f]{12}⟧$/);
  });

  test("an output kept just before, as by a command run earlier in the same turn, is not judged, so nothing is added", async () => {
    const d = await dir();
    await withLine(d, "the overview", "session-1");
    for (const text of ["Take next", "a card"]) {
      const lines = (await withLine(d, text, "session-1", Date.now() + 5_000)).split("\n");
      assert.deepEqual(lines.slice(0, 3), [text, "", "To show the user all of the above, exactly as printed, write this line on its own in your reply:"]);
      assert.equal(lines.length, 4);
    }
  });
});

describe("the MessageDisplay hook", () => {
  const plugin = fileURLToPath(new URL("..", import.meta.url));
  const hook = async (stateDir: string, delta: string) => {
    const run = promisify(execFile);
    const child = run(join(plugin, "bin", "issue-map-display"), { env: { ...process.env, ISSUE_MAP_STATE_DIR: stateDir } });
    child.child.stdin!.end(JSON.stringify({ hook_event_name: "MessageDisplay", index: 0, final: true, delta }));
    return (await child).stdout;
  };

  test("is the plugin's, run on every reply as it streams, from a plugin path that contains a space", async () => {
    const root = join(await dir(), "plugins cache", "issue-map");
    releaseTree(plugin, "0.0.0", root);
    const { hooks } = JSON.parse(await readFile(join(root, "hooks", "hooks.json"), "utf8"));
    const command: string = hooks.MessageDisplay[0].hooks[0].command;
    const d = await dir();
    const line = await keepShown(d, "**owner/map** · 3 open");
    const run = promisify(execFile);
    // As Claude Code runs it: the placeholder put in, then the command run by the shell.
    const child = run("sh", ["-c", command.replaceAll("${CLAUDE_PLUGIN_ROOT}", root)], { env: { ...process.env, ISSUE_MAP_STATE_DIR: d } });
    child.child.stdin!.end(JSON.stringify({ hook_event_name: "MessageDisplay", index: 0, final: true, delta: line }));
    assert.equal(JSON.parse((await child).stdout).hookSpecificOutput.displayContent, "**owner/map** · 3 open");
  });

  test("answers a batch holding a line of the Map's with the output shown in its place", async () => {
    const d = await dir();
    const line = await keepShown(d, "**owner/map** · 3 open");
    assert.deepEqual(JSON.parse(await hook(d, `Here it is:\n${line}\n`)), {
      hookSpecificOutput: { hookEventName: "MessageDisplay", displayContent: "Here it is:\n**owner/map** · 3 open\n" },
    });
  });

  test("marks what it shows, so the session's next outputs are shown by their lines, nothing else added, even several run before their lines are written", async () => {
    const d = await dir();
    const first = (await withLine(d, "the overview", "session-1")).split("\n").at(-1)!;
    await hook(d, `${first}\n`);
    for (const text of ["a card", "an outline", "another card"]) {
      const lines = (await withLine(d, text, "session-1")).split("\n");
      assert.deepEqual(lines.slice(0, 3), [text, "", "To show the user all of the above, exactly as printed, write this line on its own in your reply:"]);
      assert.match(lines[3]!, /^⟦issue-map [0-9a-f]{12}⟧$/);
      assert.equal(lines.length, 4);
    }
  });

  test("answers nothing for a batch with none, so it shows as written", async () => {
    assert.equal(await hook(await dir(), "Just a sentence.\n"), "");
  });
});
