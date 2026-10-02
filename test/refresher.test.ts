/**
 * Seam C again: the refresher that keeps the Home Project's Snapshot warm
 * (ADR 0006), with the real store, an injected clock and sleep, and a fake
 * Tracker whose answers can be scripted round by round.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keepWarm } from "../src/snapshot/refresher.ts";
import { SNAPSHOT_FORMAT } from "../src/snapshot/snapshot.ts";
import { snapshotStore, type SnapshotKey } from "../src/snapshot/store.ts";
import type { ChangesAnswer, OpenIssue, Project, ProjectResolution, Tracker, ViewerAnswer } from "../src/tracker/tracker.ts";
import { READS_EVERYTHING } from "./fakes/fake-trackers.ts";

const project: Project = { id: "github.com#1", host: "github.com", path: "fixture-org/tools", url: "https://github.com/fixture-org/tools", issues: { open: 5 } };
const key: SnapshotKey = { tracker: "github.com", project: project.id, login: "fixture-viewer" };

function issue(n: number): OpenIssue {
  return { id: `I_${n}`, ref: `#${n}`, title: `Issue ${n}`, url: `https://github.com/fixture-org/tools/issues/${n}`, createdAt: new Date(Date.UTC(2026, 0, n)).toISOString(), assignees: [], planned: null, taskLevel: false, links: [], closingRequests: [] };
}

/** A clock that moves only when told to, and counts the refresher's rounds by its sleeps. */
function clock() {
  let now = Date.parse("2026-09-23T10:00:00Z");
  const time = {
    round: 0,
    now: () => now,
    advance: (ms: number) => void (now += ms),
    sleep: async (ms: number) => void (time.advance(ms), time.round++),
  };
  return time;
}

/**
 * A Tracker of five open Issues whose every read takes a second. `viewer`
 * answers round by round, and once its answers run out a different login
 * holds the CLI, which stops the refresher without touching the Snapshot;
 * with no `viewer`, the Snapshot's login holds it throughout.
 */
function fakeTracker(time: ReturnType<typeof clock>, script: { viewer?: ViewerAnswer[]; project?: ProjectResolution; changes?: ChangesAnswer } = {}) {
  const calls = { refreshes: 0, pages: 0 };
  const tracker: Tracker = {
    product: "GitHub",
    host: "github.com",
    version: null,
    thread: async () => ({ kind: "cant-tell", reason: "unused" }),
    link: async () => ({ kind: "cant-tell", reason: "unused" }),
    untested: null,
    capabilities: async () => ({ kind: "capabilities", ...READS_EVERYTHING }),
    issue: async () => ({ kind: "cant-tell", reason: "unused" }),
  assign: async () => ({ kind: "cant-tell", reason: "unused" }),
    viewer: async () => (script.viewer ? (script.viewer[time.round] ?? { kind: "viewer", login: "someone-else" }) : me),
    resolveProject: async () => script.project ?? { kind: "project", project, parent: null },
    async changes() {
      calls.refreshes++;
      time.advance(1000);
      return script.changes ?? { kind: "changes", open: [], ends: [], requests: [], caughtUp: true, unread: {} };
    },
    async openIssues() {
      calls.pages++;
      time.advance(1000);
      return { kind: "page", issues: [1, 2, 3, 4, 5].map(issue), total: 5, next: null, unread: {} };
    },
  };
  return { tracker, calls };
}

const me: ViewerAnswer = { kind: "viewer", login: key.login };
const rounds = (n: number): ViewerAnswer[] => Array.from({ length: n }, () => me);

/** A store, a clock to move on, and deps whose sleep moves it; the store holds a finished read at 10:00:00 unless `read` is false. */
async function warmable(read = true) {
  const time = clock();
  const dir = mkdtempSync(join(tmpdir(), "issue-map-refresher-"));
  const store = snapshotStore(dir, time);
  if (read) await store.read(key, fakeTracker(time).tracker, project);
  const reads: number[] = [];
  const deps = { store, startRead: () => void reads.push(time.now()), sleep: time.sleep };
  return { store, time, deps, reads, dir };
}

test("keeps the Snapshot fresh round after round, so a draw never has to refresh it first", async () => {
  const { store, time, deps } = await warmable();
  const { tracker, calls } = fakeTracker(time, { viewer: rounds(10) });
  await keepWarm(deps, tracker, project.path, key);
  assert.ok(calls.refreshes >= 9, `${calls.refreshes} refreshes in 10 rounds`);
  const drawer = fakeTracker(time);
  const drawn = await store.forDraw(key, drawer.tracker, project);
  assert.equal(drawer.calls.refreshes, 0);
  assert.equal(drawn.kind === "ready" && drawn.ageMs < 120_000, true);
});

test("a refresh that can't prove it caught up starts a full read in the background, once", async () => {
  const { time, deps, reads } = await warmable();
  const behind: ChangesAnswer = { kind: "changes", open: [], ends: [], requests: [], caughtUp: false, unread: {} };
  let running = false;
  const started = { ...deps, startRead: () => void (running || (running = true, reads.push(time.now()))) };
  const { tracker } = fakeTracker(time, { viewer: rounds(3), changes: behind });
  await keepWarm(started, tracker, project.path, key);
  assert.equal(reads.length, 1);
});

test("otherwise it starts a full read a week after the last one started", async () => {
  const { time, deps, reads } = await warmable();
  // Refreshed, round after round, until three minutes short of the week.
  time.advance(7 * 86_400_000 - 181_000);
  await deps.store.refresh(key, fakeTracker(time).tracker, project);
  const { tracker } = fakeTracker(time, { viewer: rounds(5) });
  await keepWarm(deps, tracker, project.path, key);
  const week = Date.parse("2026-09-30T10:00:00Z");
  assert.ok(reads.length > 0, "a read is started");
  // Within a round of the week, whose rounds each take a minute and the second a refresh takes.
  assert.ok(reads[0]! >= week && reads[0]! < week + 62_000, new Date(reads[0]!).toISOString());
});

test("a Project never read is read in full", async () => {
  const { time, deps, reads } = await warmable(false);
  await keepWarm(deps, fakeTracker(time, { viewer: rounds(1) }).tracker, project.path, key);
  assert.equal(reads.length, 1);
});

test("stops once the Tracker refuses the login, wherever it does, and deletes the Snapshot", async () => {
  const refused = "github.com refused this login: Bad credentials";
  const ways = {
    "asked who the viewer is": { viewer: [me, { kind: "refused", reason: refused, login: key.login }] },
    "asked for the Project": { viewer: rounds(3), project: { kind: "refused", reason: refused } },
    "asked what changed": { viewer: rounds(3), changes: { kind: "refused", reason: refused } },
  } satisfies Record<string, Parameters<typeof fakeTracker>[1]>;
  for (const [where, script] of Object.entries(ways)) {
    const { store, time, deps } = await warmable();
    time.advance(60_000);
    const { tracker } = fakeTracker(time, script);
    assert.equal(await keepWarm(deps, tracker, project.path, key), refused, where);
    assert.notEqual((await store.state(key)).kind, "ready", where);
  }
});

test("stops, leaving the Snapshot, once the CLI holds no login at all", async () => {
  const { store, time, deps } = await warmable();
  const { tracker } = fakeTracker(time, { viewer: [me, { kind: "refused", reason: "not logged in to github.com" }] });
  assert.equal(await keepWarm(deps, tracker, project.path, key), "not logged in to github.com");
  assert.equal((await store.state(key)).kind, "ready");
});

test("carries on while the Tracker can't be reached, keeping the Snapshot", async () => {
  const { store, time, deps } = await warmable();
  const offline = { kind: "cant-tell", reason: "couldn't reach github.com" } as const;
  const { tracker } = fakeTracker(time, { viewer: [me, { ...offline, login: key.login }, offline, me], changes: offline });
  assert.equal(await keepWarm(deps, tracker, project.path, key), "github.com now logs in as someone-else");
  assert.equal((await store.state(key)).kind, "ready");
});

test("stops, leaving the Snapshot, once its path leads to another Project", async () => {
  const { store, time, deps } = await warmable();
  const other = { kind: "project", project: { ...project, id: "github.com#2" }, parent: null } as const;
  const { tracker } = fakeTracker(time, { viewer: rounds(3), project: other });
  assert.equal(await keepWarm(deps, tracker, project.path, key), "github.com/fixture-org/tools is now another Project");
  assert.equal((await store.state(key)).kind, "ready");
});

test("one refresher per Tracker, Project and login: a second leaves it to the first", async () => {
  const { store, time, deps } = await warmable();
  let checked = false;
  const { tracker } = fakeTracker(time, { viewer: rounds(3) });
  const sleep = async (ms: number) => {
    await time.sleep(ms);
    if (checked) return;
    checked = true;
    assert.equal(await store.refresherRunning(key), true);
    assert.equal(await keepWarm(deps, fakeTracker(time).tracker, project.path, key), "another refresher keeps it warm");
    assert.equal(await store.refresherRunning({ ...key, login: "someone-else" }), false);
  };
  await keepWarm({ ...deps, sleep }, tracker, project.path, key);
  assert.equal(checked, true);
  assert.equal(await store.refresherRunning(key), false, "once it stops, the next can start");
});

test("a refresher that stopped renewing its claim, as after a reboot hands its pid to another process, doesn't hold it", async () => {
  const { store, time } = await warmable();
  assert.ok(await store.claimRefresher(key));
  time.advance(4 * 60_000);
  assert.equal(await store.refresherRunning(key), true, "a round or two late is still running");
  time.advance(6 * 60_000);
  assert.equal(await store.refresherRunning(key), false);
  assert.ok(await store.claimRefresher(key), "the next refresher takes over");
});

test("a claim left by a live process that isn't its refresher, from before a reboot, or naming this process's pid doesn't hold it (#53)", async () => {
  const leftBehind = {
    "a live process that isn't its refresher, unrenewed for ten minutes": { pid: process.ppid, at: Date.parse("2026-09-23T09:50:00Z") },
    "before a reboot": { pid: process.ppid, boot: "a boot before this one" },
    "this process's pid, which a process before it had": { pid: process.pid },
  };
  for (const [how, holder] of Object.entries(leftBehind)) {
    const dir = mkdtempSync(join(tmpdir(), "issue-map-refresher-"));
    const at = join(dir, "snapshots", "github.com", encodeURIComponent(project.id));
    mkdirSync(at, { recursive: true });
    writeFileSync(join(at, `${key.login}.refresher.lock`), JSON.stringify({ id: "left-behind", at: Date.parse("2026-09-23T10:00:00Z"), boot: null, ...holder }));
    const store = snapshotStore(dir, clock());
    assert.equal(await store.refresherRunning(key), false, how);
    assert.ok(await store.claimRefresher(key), how);
  }
});

test("a refresher whose claim was taken over says so at its next renewal and stops, leaving the claim to the one that took it (#53)", async () => {
  const { store, time, deps } = await warmable();
  let taken: Awaited<ReturnType<typeof store.claimRefresher>> = null;
  const sleep = async (ms: number) => {
    await time.sleep(ms);
    if (taken) return;
    // Held up past the time a claim lasts unrenewed, as a sleeping laptop holds it up.
    time.advance(10 * 60_000);
    taken = await store.claimRefresher(key);
    assert.ok(taken, "the lapsed claim is taken over");
  };
  const why = await keepWarm({ ...deps, sleep }, fakeTracker(time, { viewer: rounds(5) }).tracker, project.path, key);
  assert.equal(why, "another refresher took over keeping it warm");
  assert.equal(await store.refresherRunning(key), true, "the claim it was taken over by is still there");
  assert.equal(await taken!.renew(), true);
});

test("renews its claim every round, for as long as it runs", async () => {
  const { store, time, deps } = await warmable();
  let running = true;
  const sleep = async (ms: number) => {
    await time.sleep(ms);
    running &&= await store.refresherRunning(key);
  };
  await keepWarm({ ...deps, sleep }, fakeTracker(time, { viewer: rounds(20) }).tracker, project.path, key);
  assert.ok(time.now() - Date.parse("2026-09-23T10:00:00Z") > 20 * 60_000, "longer than a claim lasts unrenewed");
  assert.equal(running, true);
});

test("stops once nobody has drawn the Map or looked at its status line for a day", async () => {
  const { store, time, deps } = await warmable();
  const start = time.now();
  // The status line looks for the first two hours, then Claude Code closes.
  const sleep = async (ms: number) => {
    await time.sleep(ms);
    if (time.now() - start < 2 * 3_600_000) await store.glance(key.tracker, key.project);
  };
  const why = await keepWarm({ ...deps, sleep }, fakeTracker(time).tracker, project.path, key);
  assert.equal(why, "nobody has drawn the Map or looked at its status line for a day");
  const hours = (time.now() - start) / 3_600_000;
  assert.ok(hours >= 26 && hours < 26.1, `${hours} hours`);
});

test("a draw counts as a look, as the status line's does", async () => {
  const { store, time, deps } = await warmable();
  const start = time.now();
  let drawn = false;
  const sleep = async (ms: number) => {
    await time.sleep(ms);
    if (!drawn && time.now() - start >= 5 * 3_600_000) {
      drawn = true;
      await store.forDraw(key, fakeTracker(time).tracker, project);
    }
  };
  await keepWarm({ ...deps, sleep }, fakeTracker(time).tracker, project.path, key);
  const hours = (time.now() - start) / 3_600_000;
  assert.ok(hours >= 29 && hours < 29.1, `${hours} hours`);
});

/** Where `key`'s Snapshot and claim are kept under `dir`. */
const keptAt = (dir: string) => join(dir, "snapshots", "github.com", encodeURIComponent(project.id));

test("an old-format refresher meeting a Snapshot a newer version saved stops at once, starting no read, and its store leaves the Snapshot be (#55)", async () => {
  const { store, time, deps, reads, dir } = await warmable();
  const snapshot = join(keptAt(dir), `${key.login}.json`);
  const newer = JSON.stringify({ ...JSON.parse(readFileSync(snapshot, "utf8")), format: SNAPSHOT_FORMAT + 1 });
  // A newer version's full read puts its Snapshot in place after the first round.
  const sleep = async (ms: number) => {
    await time.sleep(ms);
    writeFileSync(snapshot, newer);
  };
  const { tracker, calls } = fakeTracker(time, { viewer: rounds(10) });
  assert.equal(await keepWarm({ ...deps, sleep }, tracker, project.path, key), "a newer version of the plugin keeps its Snapshot");
  assert.equal(time.round, 1);
  // Started again by an old draw, it stops before claiming, so it never takes over from the newer one.
  assert.equal(await keepWarm(deps, tracker, project.path, key), "a newer version of the plugin keeps its Snapshot");
  assert.equal(await store.refresherRunning(key), false);
  // A draw of the old version doesn't read it again either.
  assert.equal((await store.read(key, tracker, project)).kind, "failed");
  assert.deepEqual([reads, calls.pages], [[], 0]);
  assert.equal(readFileSync(snapshot, "utf8"), newer);
});

test("after an update, the next draw of the Home Project ends up with a refresher of the new version (#55)", async () => {
  const { store, time, deps, dir } = await warmable();
  // Left by the version before, whose claims carried no version, by a process still running.
  writeFileSync(join(keptAt(dir), `${key.login}.refresher.lock`), JSON.stringify({ pid: process.ppid, id: "before-the-update", at: time.now(), boot: null }));
  assert.equal(await store.refresherRunning(key), false, "so the draw starts one");
  let running = false;
  const sleep = async (ms: number) => {
    await time.sleep(ms);
    running ||= await store.refresherRunning(key);
  };
  assert.notEqual(await keepWarm({ ...deps, sleep }, fakeTracker(time, { viewer: rounds(3) }).tracker, project.path, key), "another refresher keeps it warm");
  assert.equal(running, true);
});
