/**
 * Asking for the Map: a first read shows progress and no Map until the
 * Snapshot is complete, then the Map. The store is real; the Tracker is a
 * fake whose read can be held part-way.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { showCard, showMap } from "../src/map/show.ts";
import { snapshotStore, type SnapshotKey } from "../src/snapshot/store.ts";
import type { ChangesAnswer, IssueAnswer, IssueRead, OpenIssue, Project, Tracker } from "../src/tracker/tracker.ts";
import { READS_EVERYTHING } from "./fakes/fake-trackers.ts";

const project: Project = { id: "github.com#1", host: "github.com", path: "fixture-org/tools", url: "https://github.com/fixture-org/tools", issues: { open: 150 } };

function issue(n: number): OpenIssue {
  return { id: `I_${n}`, ref: `#${n}`, title: `Issue ${n}`, url: `https://github.com/fixture-org/tools/issues/${n}`, createdAt: new Date(Date.UTC(2026, 0, n)).toISOString(), assignees: [], planned: null, taskLevel: false, links: [], closingRequests: [] };
}

/** 150 open Issues, #1 the Parent of #2; the second page waits until `release` is called. */
function heldTracker() {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const all = Array.from({ length: 150 }, (_, i) => issue(i + 1));
  all[0]!.links.push({ role: "child", to: { id: "I_2", readable: true, open: true, project: project.path, ref: `${project.path}#2`, title: "Issue 2", url: all[1]!.url } });
  all[1]!.links.push({ role: "parent", to: { id: "I_1", readable: true, open: true, project: project.path, ref: `${project.path}#1`, title: "Issue 1", url: all[0]!.url } });
  const tracker: Tracker = {
    product: "GitHub",
    host: "github.com",
    version: null,
    untested: null,
    capabilities: async () => ({ kind: "capabilities", ...READS_EVERYTHING }),
    resolveProject: async () => ({ kind: "cant-tell", reason: "unused" }),
    changes: async () => ({ kind: "cant-tell", reason: "unused" }),
    issue: async () => ({ kind: "cant-tell", reason: "unused" }),
  assign: async () => ({ kind: "cant-tell", reason: "unused" }),
    viewer: async () => ({ kind: "viewer", login: "fixture-viewer" }),
    async openIssues(_, after) {
      if (after === null) return { kind: "page", issues: all.slice(0, 100), total: 150, next: "100", unread: {} };
      await held;
      return { kind: "page", issues: all.slice(100), total: 150, next: null, unread: {} };
    },
  };
  return { tracker, release };
}

test("a first read shows progress and no Map until the Snapshot is complete, then the Map", async () => {
  const store = snapshotStore(mkdtempSync(join(tmpdir(), "issue-map-show-")), { now: () => Date.parse("2026-09-23T10:00:00Z") });
  const { tracker, release } = heldTracker();
  let reading: Promise<unknown> | undefined;
  let started = 0;
  const deps = {
    store,
    startRead: () => {
      started++;
      reading = store.read({ tracker: "github.com", project: project.id, login: "fixture-viewer" }, tracker, project);
    },
    sleep: () => new Promise<void>((resolve) => setImmediate(resolve)),
    startRefresher: async () => {},
  };

  const first = (await showMap(deps, tracker, project, { kind: "overview" })).text;
  assert.match(first, /^⏳ 100 of 150 Issues read \(66%\)/m);
  assert.doesNotMatch(first, /Groups|Unlinked/);

  const again = (await showMap(deps, tracker, project, { kind: "overview" })).text;
  assert.match(again, /^⏳ 100 of 150 Issues read/m);
  assert.equal(started, 1, "a read already running isn't started again");

  release();
  await reading;
  const map = (await showMap(deps, tracker, project, { kind: "overview" })).text;
  assert.match(map, /^\*\*fixture-org\/tools\*\* · 150 open · 2 on the Map · 148 Unlinked · Promised$/m);
  assert.equal(started, 1);
});

test("says whether it drew a Map, a first read's progress, or nothing, so a move that draws nothing can leave the user where they were", async () => {
  const store = snapshotStore(mkdtempSync(join(tmpdir(), "issue-map-show-")), { now: () => Date.parse("2026-09-23T10:00:00Z") });
  const { tracker, release } = heldTracker();
  let reading: Promise<unknown> | undefined;
  const deps = {
    store,
    startRead: () => void (reading = store.read({ tracker: "github.com", project: project.id, login: "fixture-viewer" }, tracker, project)),
    sleep: () => new Promise<void>((resolve) => setImmediate(resolve)),
    startRefresher: async () => {},
  };
  assert.equal((await showMap(deps, tracker, project, { kind: "overview" })).drew, "progress");
  release();
  await reading;
  assert.equal((await showMap(deps, tracker, project, { kind: "overview" })).drew, "map");
  const refused: Tracker = { ...tracker, viewer: async () => ({ kind: "refused", reason: "not logged in to github.com" }) };
  assert.equal((await showMap(deps, refused, project, { kind: "overview" })).drew, "nothing");
});

test("a login the Tracker refuses draws no Map, and says which Tracker refused and why", async () => {
  const store = snapshotStore(mkdtempSync(join(tmpdir(), "issue-map-show-")), { now: Date.now });
  const tracker: Tracker = { ...heldTracker().tracker, viewer: async () => ({ kind: "refused", reason: "not logged in to github.com" }) };
  const text = (await showMap({ store, startRead: () => assert.fail("no read without a login"), sleep: async () => {}, startRefresher: async () => assert.fail("nothing kept warm without a login") }, tracker, project, { kind: "overview" })).text;
  assert.equal(text, "No Map of github.com/fixture-org/tools: GitHub refused: not logged in to github.com");
});

test("a Project where the Map can read no Link kind is Refused before any read starts, with every kind named and why (ADR 0003)", async () => {
  const store = snapshotStore(mkdtempSync(join(tmpdir(), "issue-map-show-")), { now: Date.now });
  const cantRecord = (reason: string) => ({ kind: "cant-record", reason }) as const;
  const tracker: Tracker = {
    ...heldTracker().tracker,
    untested: "GHES 3.16.0 is older than 3.18, the oldest release GitHub still supports",
    capabilities: async () => ({
      kind: "capabilities",
      links: { blocks: cantRecord("GHES 3.16.0 can't record Blocks Links"), parent: cantRecord("GHES 3.16.0 can't record Parent Links"), related: cantRecord("GitHub records no Related Links") },
      write: { kind: "can" },
    }),
  };
  const text = (await showMap({ store, startRead: () => assert.fail("nothing to read"), sleep: async () => {}, startRefresher: async () => {} }, tracker, project, { kind: "overview" })).text;
  assert.equal(
    text,
    "No Map of github.com/fixture-org/tools: Refused — the Map can read no Link kind here. Blocks: GHES 3.16.0 can't record Blocks Links. Parent: GHES 3.16.0 can't record Parent Links. Related: GitHub records no Related Links.",
  );
});

describe("drawing from a Snapshot that's been read (ADR 0006)", () => {
  const key = { tracker: "github.com", project: project.id, login: "fixture-viewer" };
  const noRead = () => assert.fail("a Snapshot that's been read isn't read again in full");

  /** A store holding a finished read of the 150 Issues, read at 10:00, and a clock to move on. */
  async function readStore() {
    let now = Date.parse("2026-09-23T10:00:00Z");
    const store = snapshotStore(mkdtempSync(join(tmpdir(), "issue-map-show-")), { now: () => now });
    const { tracker, release } = heldTracker();
    release();
    await store.read(key, tracker, project);
    return { store, tracker, later: (ms: number) => (now += ms) };
  }
  const deps = (store: ReturnType<typeof snapshotStore>) => ({ store, startRead: noRead, sleep: async () => {}, startRefresher: async () => {} });

  test("a Snapshot under two minutes old is drawn as it is", async () => {
    const { store, tracker, later } = await readStore();
    later(60_000);
    const map = (await showMap(deps(store), { ...tracker, changes: async () => assert.fail("no refresh") }, project, { kind: "overview" })).text;
    assert.match(map, /^\*\*fixture-org\/tools\*\* · 150 open · 2 on the Map · 148 Unlinked · Promised$/m);
    assert.doesNotMatch(map, /⚠/);
  });

  test("an older one is refreshed first, so the Map shows what changed", async () => {
    const { store, tracker, later } = await readStore();
    later(3 * 60_000);
    const closed: ChangesAnswer = { kind: "changes", open: [], ends: [{ id: "I_2", readable: true, open: false, project: project.path, ref: `${project.path}#2`, title: "Issue 2", url: `${project.url}/issues/2` }], requests: [], caughtUp: true, unread: {} };
    const map = (await showMap(deps(store), { ...tracker, changes: async () => closed }, project, { kind: "overview" })).text;
    assert.match(map, /^\*\*fixture-org\/tools\*\* · 149 open · 0 on the Map · 149 Unlinked · Promised$/m);
    assert.doesNotMatch(map, /⚠/);
  });

  test("when the Tracker can't be reached, the old Snapshot is drawn with how old it is and why", async () => {
    const { store, tracker, later } = await readStore();
    later(3 * 3_600_000);
    const offline = { ...tracker, changes: async () => ({ kind: "cant-tell", reason: "couldn't reach github.com" }) as const };
    const map = (await showMap(deps(store), offline, project, { kind: "overview" })).text;
    assert.match(map, /^⚠ read 3h ago — couldn't refresh it: couldn't reach github.com\n\*\*fixture-org\/tools\*\* · 150 open/);
  });

  test("drawing it keeps it warm in the background, for this login", async () => {
    const { store, tracker } = await readStore();
    const kept: SnapshotKey[] = [];
    (await showMap({ ...deps(store), startRefresher: async (key) => void kept.push(key) }, tracker, project, { kind: "overview" })).text;
    assert.deepEqual(kept, [key]);
  });

  test("a refresh that can't prove it caught up starts a full read in the background, and the Map is drawn meanwhile", async () => {
    const { store, tracker, later } = await readStore();
    later(3 * 60_000);
    let started = 0;
    const behind: Tracker = { ...tracker, changes: async () => ({ kind: "changes", open: [], ends: [], requests: [], caughtUp: false, unread: {} }) };
    const map = (await showMap({ ...deps(store), startRead: () => void started++ }, behind, project, { kind: "overview" })).text;
    assert.match(map, /^\*\*fixture-org\/tools\*\* · 150 open · 2 on the Map · 148 Unlinked · Promised$/m);
    assert.doesNotMatch(map, /⚠/);
    assert.equal(started, 1);
  });

  test("offline, with no Tracker to say who the viewer is, the login the CLI holds draws its old Snapshot", async () => {
    const { store, tracker, later } = await readStore();
    later(3 * 3_600_000);
    const offline: Tracker = {
      ...tracker,
      viewer: async () => ({ kind: "cant-tell", reason: "couldn't reach github.com", login: "fixture-viewer" }),
      changes: async () => ({ kind: "cant-tell", reason: "couldn't reach github.com" }),
    };
    const map = (await showMap(deps(store), offline, project, { kind: "overview" })).text;
    assert.match(map, /^⚠ read 3h ago — couldn't refresh it: couldn't reach github.com\n\*\*fixture-org\/tools\*\* · 150 open/);
    const someoneElse = { ...offline, viewer: async () => ({ kind: "cant-tell", reason: "couldn't reach github.com", login: "someone-else" }) as const };
    assert.doesNotMatch((await showMap({ ...deps(store), startRead: () => {} }, someoneElse, project, { kind: "overview" })).text, /150 open · 2 on the Map/, "never another login's");
  });

  test("a login the Tracker refuses outright has its Snapshot deleted too", async () => {
    const { store, tracker } = await readStore();
    const refused = { ...tracker, viewer: async () => ({ kind: "refused", reason: "github.com refused this login: Bad credentials", login: "fixture-viewer" }) as const };
    const text = (await showMap(deps(store), refused, project, { kind: "overview" })).text;
    assert.equal(text, "No Map of github.com/fixture-org/tools: GitHub refused: github.com refused this login: Bad credentials. What was kept of it is deleted.");
    assert.notEqual((await store.state(key)).kind, "ready");
  });

  test("once the Tracker refuses the login, no Map is drawn and its Snapshot is deleted", async () => {
    const { store, tracker, later } = await readStore();
    later(3 * 60_000);
    const refused = { ...tracker, changes: async () => ({ kind: "refused", reason: "github.com refused this login: Bad credentials" }) as const };
    const text = (await showMap(deps(store), refused, project, { kind: "overview" })).text;
    assert.equal(text, "No Map of github.com/fixture-org/tools: github.com refused this login: Bad credentials. What was kept of it is deleted.");
    assert.notEqual((await store.state(key)).kind, "ready");
  });
});

describe("opening an Issue card", () => {
  const read: IssueRead = {
    id: "I_2",
    project: project.path,
    ref: `${project.path}#2`,
    title: "Issue 2",
    url: `${project.url}/issues/2`,
    open: true,
    assignees: [],
    closedAs: null,
    links: [{ role: "parent", name: "Parent issue", to: { id: "I_1", readable: true, open: true, project: project.path, ref: `${project.path}#1`, title: "Issue 1", url: `${project.url}/issues/1` } }],
    closingRequests: [],
    mentionedBy: [],
    unread: {},
  };
  /** A Tracker holding only #2, that notes what each read asked for. */
  const liveTracker = (asked: string[], answer?: IssueAnswer): Tracker => ({
    ...heldTracker().tracker,
    async issue(locator) {
      asked.push(locator);
      if (answer) return answer;
      return locator === read.ref || locator === read.url ? { kind: "issue", issue: read } : { kind: "not-found", reason: `no Issue ${locator} on github.com that this login can read` };
    },
  });

  test("reads the Issue live every time, whether it's named by its reference, after the Project's path, by URL, or as the Map marks it", async () => {
    const asked: string[] = [];
    const tracker = liveTracker(asked);
    for (const typed of ["#2", "fixture-org/tools#2", `${project.url}/issues/2`, " #2 "]) {
      const card = await showCard(tracker, project, typed);
      assert.match(card.text, /^\*\*#2 Issue 2\*\*$/m, typed);
      assert.deepEqual(card.choices, [{ label: "#1", description: "Parent issue · Issue 1" }]);
    }
    assert.deepEqual(asked, [read.ref, read.ref, read.url, read.ref]);
  });

  test("an Outside Issue is read by its reference as the Map marks it", async () => {
    const asked: string[] = [];
    await showCard(liveTracker(asked), project, "↗fixture-org/plans#7");
    assert.deepEqual(asked, ["fixture-org/plans#7"]);
  });

  test("says why a card can't open, and offers nothing to follow", async () => {
    assert.deepEqual(await showCard(liveTracker([]), project, "#99"), {
      text: "No card for #99: no Issue fixture-org/tools#99 on github.com that this login can read.",
      choices: [],
      opened: false,
    });
    const refused = liveTracker([], { kind: "refused", reason: "not logged in to github.com" });
    assert.equal((await showCard(refused, project, "#2")).text, "No card for #2: GitHub refused: not logged in to github.com.");
  });

  test("an Issue in another Project this login can't read still offers to open that Project's Map, which it may be able to read", async () => {
    const card = await showCard(liveTracker([]), project, "fixture-org/plans#99");
    assert.equal(card.opened, false);
    assert.deepEqual(card.move, { label: "Open fixture-org/plans's Map", description: "its overview, since this Issue couldn't be read", target: "github.com/fixture-org/plans" });
    assert.equal((await showCard(liveTracker([]), project, "#99")).move, undefined, "not for an Issue in the Project on screen");
  });
});
