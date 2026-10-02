/**
 * The three launchers on a Node too old to read the source, or with none on
 * the PATH (#59): the CLI says so in one line and fails; the display hook
 * and the status line say it only on standard error and fail nothing. And
 * the CLI's unexpected failures, such as a state directory it can't write.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const bin = (name: string) => fileURLToPath(new URL(`../bin/${name}`, import.meta.url));

/** A PATH holding only what the launchers run before Node, and a `node` reporting `version` when there is one. */
function pathWith(version: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), "issue-map-path-"));
  for (const tool of ["bash", "sh", "cat"]) symlinkSync(execFileSync("which", [tool], { encoding: "utf8" }).trim(), join(dir, tool));
  if (version !== null) writeFileSync(join(dir, "node"), `#!/bin/sh\necho ${version}\n`, { mode: 0o755 });
  return dir;
}

function run(name: string, args: string[], env: Record<string, string>, input = "") {
  const { status, stdout, stderr } = spawnSync(bin(name), args, { env: { ...process.env, ...env }, input, encoding: "utf8" });
  return { status, stdout, stderr };
}

for (const [found, version] of [["v20.11.0", "v20.11.0"], ["v22.17.1", "v22.17.1"], ["none", null]] as const) {
  describe(`on a PATH with Node ${found}`, () => {
    const env = { PATH: pathWith(version) };
    const message = `Issue Map needs Node.js 22.18 or later; found ${found}\n`;

    test("the CLI prints the one-line version message and fails", () => {
      assert.deepEqual(run("issue-map", ["map"], env), { status: 1, stdout: "", stderr: message });
    });

    test("the display hook leaves the reply as written, failing nothing", () => {
      const delta = JSON.stringify({ delta: "⟦issue-map 3f9a0c1b2d4e⟧" });
      assert.deepEqual(run("issue-map-display", [], env, delta), { status: 0, stdout: "", stderr: message });
    });

    test("the status line prints no row, failing nothing", () => {
      assert.deepEqual(run("issue-map-status-line", [], env, "{}"), { status: 0, stdout: "", stderr: message });
    });
  });
}

test("a state directory that can't be written gives one line naming it and the override, not a stack trace", () => {
  const file = join(mkdtempSync(join(tmpdir(), "issue-map-state-")), "a-file");
  writeFileSync(file, "");
  const state = join(file, "state");
  const { status, stderr } = spawnSync(bin("issue-map"), ["map"], { cwd: tmpdir(), env: { ...process.env, ISSUE_MAP_STATE_DIR: state }, encoding: "utf8" });
  assert.equal(status, 1);
  assert.match(stderr, /^Issue Map failed: ENOTDIR: [^\n]*\. Its state directory is [^\n]*; set ISSUE_MAP_STATE_DIR to use another\.\n$/);
  assert.ok(stderr.includes(state));
});
