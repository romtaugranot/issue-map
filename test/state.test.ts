import { test } from "node:test";
import assert from "node:assert/strict";
import { closeSync, readdirSync, readFileSync, writeSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { declinesOf, lastHomeOf, openBackgroundLog, stateDir } from "../src/state.ts";
import type { Project } from "../src/tracker/tracker.ts";

const dir = () => mkdtemp(join(tmpdir(), "issue-map-state-"));

test("a reader never sees the Home Project record half written", async () => {
  const lastHome = lastHomeOf("/a/checkout", await dir());
  // Large enough that writing it takes more than one go.
  const project: Project = { id: "1", host: "gitlab.com", path: "group/".repeat(200_000), url: "https://gitlab.com/group", issues: { open: 3 } };
  await lastHome.set(project);
  let writing = true;
  const writes = (async () => {
    for (let i = 0; i < 50; i++) await lastHome.set(project);
    writing = false;
  })();
  while (writing) assert.deepEqual(await lastHome.get(), project);
  await writes;
});

test("two sessions declining at the same moment both keep their declines", async () => {
  const d = await dir();
  const key = { tracker: "gitlab.com", project: "1", login: "ana" };
  await Promise.all([declinesOf(d).add(key, ["1 blocks 2"]), declinesOf(d).add(key, ["3 relates 4"])]);
  assert.deepEqual((await declinesOf(d).get(key)).sort(), ["1 blocks 2", "3 relates 4"]);
  await declinesOf(d).add(key, ["1 blocks 2"]);
  assert.deepEqual((await declinesOf(d).get(key)).sort(), ["1 blocks 2", "3 relates 4"], "each kept once");
  assert.deepEqual(await declinesOf(d).get({ ...key, login: "bo" }), [], "kept per login");
});

test("the background log stays under its cap: past a megabyte it's started afresh, the last one kept beside it", async () => {
  const d = await dir();
  const write = (text: string) => {
    const log = openBackgroundLog(d);
    writeSync(log, text);
    closeSync(log);
  };
  write("first\n");
  write("x".repeat(1_000_000));
  write("after\n");
  assert.equal(readFileSync(join(d, "background.log"), "utf8"), "after\n");
  assert.equal(readFileSync(join(d, "background.log.1"), "utf8").startsWith("first\nxxx"), true);
  write("x".repeat(1_000_000));
  write("again\n");
  assert.equal(readdirSync(d).filter((name) => name.startsWith("background.log")).length, 2);
});

test("the state directory is ISSUE_MAP_STATE_DIR, else under XDG_STATE_HOME, else under ~/.local/state", () => {
  assert.equal(stateDir({ ISSUE_MAP_STATE_DIR: "/kept", XDG_STATE_HOME: "/xdg" }), "/kept");
  assert.equal(stateDir({ XDG_STATE_HOME: "/xdg" }), "/xdg/issue-map");
  assert.equal(stateDir({}), join(homedir(), ".local", "state", "issue-map"));
});

test("an empty or relative state variable counts as unset, so private titles never land in the working tree", () => {
  for (const unusable of ["", "state", "./state", "~/state"]) {
    assert.equal(stateDir({ ISSUE_MAP_STATE_DIR: unusable, XDG_STATE_HOME: "/xdg" }), "/xdg/issue-map");
    assert.equal(stateDir({ XDG_STATE_HOME: unusable }), join(homedir(), ".local", "state", "issue-map"));
    assert.equal(stateDir({ ISSUE_MAP_STATE_DIR: unusable, XDG_STATE_HOME: unusable }), join(homedir(), ".local", "state", "issue-map"));
  }
});
