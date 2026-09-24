import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { displayed, keepShown, withLine } from "../src/show/shown.ts";

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

describe("the MessageDisplay hook", () => {
  const plugin = fileURLToPath(new URL("..", import.meta.url));
  const hook = async (stateDir: string, delta: string) => {
    const run = promisify(execFile);
    const child = run(join(plugin, "bin", "issue-map-display"), { env: { ...process.env, ISSUE_MAP_STATE_DIR: stateDir } });
    child.child.stdin!.end(JSON.stringify({ hook_event_name: "MessageDisplay", index: 0, final: true, delta }));
    return (await child).stdout;
  };

  test("is the plugin's, run on every reply as it streams", async () => {
    const { hooks } = JSON.parse(await readFile(join(plugin, "hooks", "hooks.json"), "utf8"));
    assert.equal(hooks.MessageDisplay[0].hooks[0].command, "${CLAUDE_PLUGIN_ROOT}/bin/issue-map-display");
  });

  test("answers a batch holding a line of the Map's with the output shown in its place", async () => {
    const d = await dir();
    const line = await keepShown(d, "**owner/map** · 3 open");
    assert.deepEqual(JSON.parse(await hook(d, `Here it is:\n${line}\n`)), {
      hookSpecificOutput: { hookEventName: "MessageDisplay", displayContent: "Here it is:\n**owner/map** · 3 open\n" },
    });
  });

  test("answers nothing for a batch with none, so it shows as written", async () => {
    assert.equal(await hook(await dir(), "Just a sentence.\n"), "");
  });
});
