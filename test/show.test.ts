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
import { snapshotStore } from "../src/snapshot/store.ts";
import type { IssueAnswer, IssueRead, OpenIssue, Project, Tracker } from "../src/tracker/tracker.ts";

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
    resolveProject: async () => ({ kind: "cant-tell", reason: "unused" }),
    issue: async () => ({ kind: "cant-tell", reason: "unused" }),
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
  };

  const first = await showMap(deps, tracker, project, { kind: "overview" });
  assert.match(first, /^⏳ 100 of 150 Issues read \(66%\)/m);
  assert.doesNotMatch(first, /Groups|Unlinked/);

  const again = await showMap(deps, tracker, project, { kind: "overview" });
  assert.match(again, /^⏳ 100 of 150 Issues read/m);
  assert.equal(started, 1, "a read already running isn't started again");

  release();
  await reading;
  const map = await showMap(deps, tracker, project, { kind: "overview" });
  assert.match(map, /^\*\*fixture-org\/tools\*\* · 150 open · 2 on the Map · 148 Unlinked$/m);
  assert.equal(started, 1);
});

test("a login the Tracker refuses draws no Map, and says which Tracker refused and why", async () => {
  const store = snapshotStore(mkdtempSync(join(tmpdir(), "issue-map-show-")), { now: Date.now });
  const tracker: Tracker = { ...heldTracker().tracker, viewer: async () => ({ kind: "refused", reason: "not logged in to github.com" }) };
  const text = await showMap({ store, startRead: () => assert.fail("no read without a login"), sleep: async () => {} }, tracker, project, { kind: "overview" });
  assert.equal(text, "No Map of github.com/fixture-org/tools: GitHub refused: not logged in to github.com");
});

describe("opening an Issue card", () => {
  const read: IssueRead = {
    id: "I_2",
    project: project.path,
    ref: `${project.path}#2`,
    title: "Issue 2",
    url: `${project.url}/issues/2`,
    open: true,
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
    });
    const refused = liveTracker([], { kind: "refused", reason: "not logged in to github.com" });
    assert.equal((await showCard(refused, project, "#2")).text, "No card for #2: GitHub refused: not logged in to github.com.");
  });
});
