/**
 * Time budgets on the largest recorded Project, gitlab-org/gitlab's 48,243
 * open Issues (#75): a draw that refreshes its Snapshot first, and a
 * refresher round. The store is real; the Tracker is a fake that answers at
 * once, so what's timed is the plugin's own work.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { gunzipSync } from "node:zlib";
import { showMap } from "../src/map/show.ts";
import { keepWarm } from "../src/snapshot/refresher.ts";
import { SNAPSHOT_FORMAT, type Snapshot } from "../src/snapshot/snapshot.ts";
import { snapshotStore, type SnapshotKey } from "../src/snapshot/store.ts";
import type { ChangesAnswer, Project, Tracker } from "../src/tracker/tracker.ts";
import { READS_EVERYTHING } from "./fakes/fake-trackers.ts";

/**
 * Generous for a slow or busy runner: here a draw took 0.9 s and a round
 * 0.4 s, where reading the Snapshot again for each step, and rewriting it
 * when nothing changed, had taken 1.9 s and 2.8 s.
 */
const DRAW_MS = 3000;
const ROUND_MS = 1500;

const READ_AT = Date.parse("2026-09-22T00:00:00Z");

/** The recording, saved as a Snapshot this store reads, read in full at `READ_AT`. */
function recorded(): Snapshot {
  const file = new URL("./fixtures/snapshots/gitlab-org__gitlab.json.gz", import.meta.url);
  const saved = JSON.parse(gunzipSync(readFileSync(file)).toString("utf8")) as Snapshot;
  const at = new Date(READ_AT).toISOString();
  return { ...saved, format: SNAPSHOT_FORMAT, readAt: at, fullReadAt: at, changesSince: at, caughtUp: true };
}

const snapshot = recorded();
const project: Project = { id: snapshot.project.id, host: snapshot.tracker, path: snapshot.project.path, url: snapshot.project.url, issues: { open: snapshot.issues.length } };
const key: SnapshotKey = { tracker: snapshot.tracker, project: snapshot.project.id, login: snapshot.login };

/** A store holding the recording, a clock at `ms` after it was read, and a Tracker that finds nothing changed, whose CLI holds another login once anything sleeps. */
function seeded(ms: number) {
  const dir = mkdtempSync(join(tmpdir(), "issue-map-budget-"));
  const at = join(dir, "snapshots", encodeURIComponent(key.tracker), encodeURIComponent(key.project));
  mkdirSync(at, { recursive: true });
  writeFileSync(join(at, `${encodeURIComponent(key.login)}.json`), JSON.stringify(snapshot));
  let now = READ_AT + ms;
  let slept = false;
  const nothing: ChangesAnswer = { kind: "changes", open: [], ends: [], requests: [], caughtUp: true, unread: {} };
  const tracker: Tracker = {
    product: "GitLab",
    host: key.tracker,
    version: null,
    untested: null,
    thread: async () => ({ kind: "cant-tell", reason: "unused" }),
    link: async () => ({ kind: "cant-tell", reason: "unused" }),
    issue: async () => ({ kind: "cant-tell", reason: "unused" }),
    assign: async () => ({ kind: "cant-tell", reason: "unused" }),
    openIssues: async () => ({ kind: "cant-tell", reason: "unused" }),
    capabilities: async () => ({ kind: "capabilities", ...READS_EVERYTHING }),
    viewer: async () => ({ kind: "viewer", login: slept ? "someone-else" : key.login }),
    resolveProject: async () => ({ kind: "project", project, parent: null }),
    changes: async () => nothing,
  };
  return { store: snapshotStore(dir, { now: () => now }), tracker, sleep: async (ms: number) => void ((now += ms), (slept = true)) };
}

test(`a draw of gitlab-org/gitlab that refreshes its Snapshot first takes under ${DRAW_MS} ms`, async () => {
  const { store, tracker, sleep } = seeded(3 * 60_000);
  const started = performance.now();
  const shown = await showMap({ store, startRead: () => assert.fail("no full read"), sleep, startRefresher: async () => {} }, tracker, project, { kind: "overview" });
  const took = performance.now() - started;
  assert.match(shown.text, /^\*\*gitlab-org\/gitlab\*\* · 48,243 open/m);
  assert.ok(took < DRAW_MS, `${Math.round(took)} ms`);
});

test(`a refresher round on gitlab-org/gitlab takes under ${ROUND_MS} ms`, async () => {
  const { store, tracker, sleep } = seeded(60_000);
  const started = performance.now();
  // One round, then it stops: the CLI holds another login.
  await keepWarm({ store, startRead: () => assert.fail("no full read"), sleep }, tracker, project.path, key);
  const took = performance.now() - started;
  const state = await store.state(key);
  assert.equal(state.kind === "ready" && state.ageMs, 90_000, "refreshed in the round");
  assert.ok(took < ROUND_MS, `${Math.round(took)} ms`);
});
