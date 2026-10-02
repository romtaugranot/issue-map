/**
 * A Tracker's CLI that never answers: it's killed once its time is up, and
 * the Tracker reads as unreadable for now, so the Snapshot stands and the
 * next refresh tries again.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CALL_SECONDS, processCli, type Cli } from "../src/tracker/boundary.ts";
import { github } from "../src/tracker/github.ts";
import { snapshotStore } from "../src/snapshot/store.ts";
import type { ProjectResolution, Tracker } from "../src/tracker/tracker.ts";
import { authStatus, ghApi } from "./fakes/fake-gh.ts";
import type { World } from "./contract/tracker-contract.ts";

async function githubWith(cli: Cli): Promise<Tracker> {
  const tracker = await github({ cli, http: async () => ({ kind: "unreachable", reason: "unused" }), env: {} }).recognise("github.com");
  assert.ok(tracker);
  return tracker;
}

test("a CLI that never exits is killed once its time is up, and the Tracker reads as not answering", async () => {
  const pidFile = join(mkdtempSync(join(tmpdir(), "issue-map-hang-")), "pid");
  const hang = `require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000)`;
  const tracker = await githubWith((_command, _args, unset) => processCli(process.execPath, ["-e", hang], unset, 1));
  const started = Date.now();
  assert.deepEqual(await tracker.resolveProject("fixture-org/tools"), { kind: "cant-tell", reason: "github.com didn't answer in 1 s" });
  assert.ok(Date.now() - started < 10_000, `answered after ${Date.now() - started} ms`);
  assert.throws(() => process.kill(Number(readFileSync(pidFile, "utf8")), 0), { code: "ESRCH" }, "the process is gone");
});

test("a refresh that times out leaves the Snapshot in place and says why, and the next one catches up", async () => {
  const world: World = { projects: [{ path: "fixture-org/tools", number: 1, open: 2, issues: [{ number: 1 }, { number: 2 }] }] };
  let hangs = false;
  const tracker = await githubWith(async (_command, args, _unset, seconds = CALL_SECONDS) => {
    if (args[0] === "auth") return authStatus(world, args);
    return hangs ? { kind: "exited", code: 1, stdout: "", stderr: "", timedOut: seconds } : ghApi(world, args);
  });
  const { project } = (await tracker.resolveProject("fixture-org/tools")) as Extract<ProjectResolution, { kind: "project" }>;
  let now = Date.parse("2026-10-01T10:00:00Z");
  const store = snapshotStore(mkdtempSync(join(tmpdir(), "issue-map-hang-")), { now: () => now });
  const key = { tracker: "github.com", project: project.id, login: "fixture-viewer" };
  assert.deepEqual(await store.read(key, tracker, project), { kind: "done" });

  now += 600_000;
  hangs = true;
  const drawn = await store.forDraw(key, tracker, project);
  assert.equal(drawn.kind, "ready");
  const kept = drawn as Extract<typeof drawn, { kind: "ready" }>;
  assert.deepEqual([kept.snapshot.issues.length, kept.ageMs, kept.stale], [2, 600_000, "github.com didn't answer in 60 s"]);

  hangs = false;
  assert.deepEqual(await store.refresh(key, tracker, project), { kind: "done", caughtUp: true });
  const after = await store.state(key);
  assert.equal(after.kind === "ready" && after.ageMs, 0);
});
