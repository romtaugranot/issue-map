/**
 * Seam C: the Snapshot store, with an injected clock and a fake Tracker that
 * can be told to fail, so ADR 0006's rules are asserted directly.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { snapshotStore, type SnapshotKey, type SnapshotState } from "../src/snapshot/store.ts";
import type { CapabilitiesAnswer, ChangesAnswer, FarEnd, IssuePage, Link, OpenIssue, Project, Tracker, Unread } from "../src/tracker/tracker.ts";
import { READS_EVERYTHING } from "./fakes/fake-trackers.ts";

const project: Project = { id: "github.com#1", host: "github.com", path: "fixture-org/tools", url: "https://github.com/fixture-org/tools", issues: { open: 250 } };
const key: SnapshotKey = { tracker: "github.com", project: project.id, login: "fixture-viewer" };

function issue(n: number): OpenIssue {
  return { id: `I_${n}`, ref: `#${n}`, title: `Issue ${n}`, url: `https://github.com/fixture-org/tools/issues/${n}`, createdAt: new Date(Date.UTC(2026, 0, n)).toISOString(), assignees: [], planned: null, taskLevel: false, links: [], closingRequests: [] };
}

/** A clock that moves only when told to. */
function clock(start = Date.parse("2026-09-23T10:00:00Z")) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

interface FakeTracker {
  tracker: Tracker;
  /** The `after` of every page asked for. */
  asked: (string | null)[];
  /** What every refresh asked for. */
  refreshes: { since: string; outside: string[] }[];
  /** How many times it was asked what the Project records. */
  capabilitiesAsked(): number;
}

/**
 * `count` open Issues in pages of 100. Each page takes `pageMs` on the clock;
 * `fail` makes the page at that `after` answer with a failure instead, once;
 * `unread` says what the page at each `after` couldn't hold.
 */
function fakeTracker(
  count: number,
  options: {
    time?: ReturnType<typeof clock>;
    pageMs?: number;
    fail?: { at: string | null; answer: IssuePage };
    onPage?: () => Promise<void>;
    unread?: Record<string, Unread>;
    /** What a refresh answers; by default, that nothing changed. */
    changes?: ChangesAnswer;
    /** Changes each open Issue before it's listed. */
    shape?: (issue: OpenIssue) => OpenIssue;
    /** The login the CLI holds; by default, the Snapshot's. */
    login?: string;
    /** What it says of the Project's Link kinds and writes; by default, that it reads every kind and the login can write. */
    capabilities?: CapabilitiesAnswer;
    /** Why the Map isn't tested on its version; by default, it is. */
    untested?: string;
  } = {},
): FakeTracker {
  const asked: (string | null)[] = [];
  let capabilitiesAsked = 0;
  const refreshes: { since: string; outside: string[] }[] = [];
  let fail = options.fail;
  const all = Array.from({ length: count }, (_, i) => (options.shape ?? ((i) => i))(issue(i + 1)));
  const tracker: Tracker = {
    product: "GitHub",
    host: "github.com",
    version: null,
    untested: options.untested ?? null,
    async capabilities() {
      capabilitiesAsked++;
      return options.capabilities ?? { kind: "capabilities", ...READS_EVERYTHING };
    },
    resolveProject: async () => ({ kind: "cant-tell", reason: "unused" }),
    issue: async () => ({ kind: "cant-tell", reason: "unused" }),
    viewer: async () => ({ kind: "viewer", login: options.login ?? key.login }),
    async changes(_, since, outside) {
      refreshes.push({ since, outside });
      options.time?.advance(options.pageMs ?? 1000);
      return options.changes ?? { kind: "changes", open: [], ends: [], requests: [], caughtUp: true, unread: {} };
    },
    async openIssues(_, after) {
      asked.push(after);
      options.time?.advance(options.pageMs ?? 1000);
      if (fail && fail.at === after) {
        const answer = fail.answer;
        fail = undefined;
        return answer;
      }
      await options.onPage?.();
      const start = after === null ? 0 : Number(after);
      const next = start + 100 < count ? String(start + 100) : null;
      return { kind: "page", issues: all.slice(start, start + 100), total: count, next, unread: options.unread?.[String(after)] ?? {} };
    },
  };
  return { tracker, asked, refreshes, capabilitiesAsked: () => capabilitiesAsked };
}

const scratch = () => mkdtempSync(join(tmpdir(), "issue-map-store-"));

describe("the Snapshot store (ADR 0006)", () => {
  test("holds no Snapshot for a Project never read", async () => {
    assert.deepEqual(await snapshotStore(scratch(), clock()).state(key), { kind: "none" });
  });

  test("a first read hands over progress, never a partial Snapshot, until it finishes", async () => {
    const time = clock();
    const store = snapshotStore(scratch(), time);
    const seen: SnapshotState[] = [];
    const { tracker } = fakeTracker(250, { time, pageMs: 2000, onPage: async () => void seen.push(await store.state(key)) });
    assert.deepEqual(await store.read(key, tracker, project), { kind: "done" });
    assert.deepEqual(
      seen.map((s) => s.kind === "reading" && [s.read, s.total]),
      [[0, 250], [100, 250], [200, 250]],
    );
    assert.equal(seen.every((s) => s.kind === "reading" && s.running), true, "the read in progress holds the Snapshot");
    const done = await store.state(key);
    assert.equal(done.kind, "ready");
  });

  test("progress says how long the read has spent so far", async () => {
    const time = clock();
    const store = snapshotStore(scratch(), time);
    let state: SnapshotState | undefined;
    const { tracker } = fakeTracker(250, { time, pageMs: 3000, onPage: async () => void (state = await store.state(key)) });
    await store.read(key, tracker, project);
    // The last look was during the third page: two pages done, 6 s spent.
    assert.deepEqual(state?.kind === "reading" && [state.read, state.elapsedMs], [200, 6000]);
  });

  test("a finished read holds exactly the Project's open Issues, as this login read them", async () => {
    const time = clock();
    const store = snapshotStore(scratch(), time);
    const { tracker } = fakeTracker(250, { time });
    await store.read(key, tracker, project);
    time.advance(45_000);
    const state = await store.state(key);
    assert.equal(state.kind, "ready");
    const { snapshot, ageMs } = state as Extract<SnapshotState, { kind: "ready" }>;
    // The read took 3 s, and it's as old as its first page.
    assert.equal(ageMs, 48_000);
    assert.deepEqual(snapshot, {
      format: 6,
      tracker: "github.com",
      project: { id: project.id, path: project.path, url: project.url },
      login: "fixture-viewer",
      readAt: "2026-09-23T10:00:00.000Z",
      fullReadAt: "2026-09-23T10:00:00.000Z",
      // The next refresh reads what changed from when this read started, less a minute.
      changesSince: "2026-09-23T09:59:00.000Z",
      caughtUp: true,
      issues: Array.from({ length: 250 }, (_, i) => issue(i + 1)),
      unread: {},
      support: { untested: null, links: READS_EVERYTHING.links },
    });
  });

  test("a full read keeps what the Tracker said of its version and of the Project's Link kinds, a Blocks kind it can't read counting as unread, but not whether the login can write, which isn't drawn", async () => {
    const store = snapshotStore(scratch(), clock());
    const blocks = { kind: "cant-read", reason: "GitLab doesn't say whether fixture-org/tools can record Blocks Links" } as const;
    const said = { links: { ...READS_EVERYTHING.links, blocks }, write: { kind: "cant-tell", reason: "this login's token doesn't say" } } as const;
    const untested = "GitLab 15.4.0 is older than 16.0, the oldest the Map is tested on";
    const { tracker } = fakeTracker(150, { capabilities: { kind: "capabilities", ...said }, untested });
    await store.read(key, tracker, project);
    const state = await store.state(key);
    assert.deepEqual(state.kind === "ready" && [state.snapshot.support, state.snapshot.unread], [{ untested, links: said.links }, { blocks: blocks.reason }]);
  });

  test("a Tracker that can't say what the Project records stops a first read before its first page; one that refuses the login keeps nothing", async () => {
    const store = snapshotStore(scratch(), clock());
    const unsure = fakeTracker(150, { capabilities: { kind: "cant-tell", reason: "couldn't reach github.com" } });
    assert.deepEqual(await store.read(key, unsure.tracker, project), { kind: "failed", reason: "couldn't reach github.com" });
    assert.deepEqual(unsure.asked, []);
    const stopped = await store.state(key);
    assert.deepEqual(stopped.kind === "reading" && stopped.stopped, "couldn't reach github.com");
    const refused = fakeTracker(150, { capabilities: { kind: "refused", reason: "github.com refused this login" } });
    assert.deepEqual(await store.read(key, refused.tracker, project), { kind: "refused", reason: "github.com refused this login" });
  });

  test("a resumed read doesn't ask again what the Project records", async () => {
    const store = snapshotStore(scratch(), clock());
    const failing = fakeTracker(250, { fail: { at: "100", answer: { kind: "cant-tell", reason: "couldn't reach github.com" } } });
    await store.read(key, failing.tracker, project);
    const again = fakeTracker(250);
    await store.read(key, again.tracker, project);
    assert.deepEqual([failing.capabilitiesAsked(), again.capabilitiesAsked()], [1, 0]);
  });

  test("a Snapshot keeps what the Tracker couldn't give on any page, and why", async () => {
    const store = snapshotStore(scratch(), clock());
    const { tracker } = fakeTracker(250, { unread: { "100": { closingRequests: "this login can't read pull requests" } } });
    await store.read(key, tracker, project);
    const state = await store.state(key);
    assert.deepEqual(state.kind === "ready" && state.snapshot.unread, { closingRequests: "this login can't read pull requests" });
  });

  test("an interrupted first read resumes from its last page", async () => {
    const store = snapshotStore(scratch(), clock());
    const failing = fakeTracker(350, { fail: { at: "200", answer: { kind: "cant-tell", reason: "couldn't reach github.com" } } });
    assert.deepEqual(await store.read(key, failing.tracker, project), { kind: "failed", reason: "couldn't reach github.com" });
    const stopped = await store.state(key);
    assert.deepEqual(stopped.kind === "reading" && [stopped.read, stopped.running, stopped.stopped], [200, false, "couldn't reach github.com"]);

    const again = fakeTracker(350);
    assert.deepEqual(await store.read(key, again.tracker, project), { kind: "done" });
    assert.deepEqual(again.asked, ["200", "300"]);
    const state = await store.state(key);
    assert.equal(state.kind === "ready" && state.snapshot.issues.length, 350);
  });

  test("a refused login stops the read, says so, and keeps none of what it read", async () => {
    const dir = scratch();
    const time = clock();
    const store = snapshotStore(dir, time);
    const { tracker } = fakeTracker(250, { fail: { at: "100", answer: { kind: "refused", reason: "github.com refused this login" } } });
    assert.deepEqual(await store.read(key, tracker, project), { kind: "refused", reason: "github.com refused this login" });
    const stopped = await store.state(key);
    assert.deepEqual(stopped.kind === "reading" && [stopped.read, stopped.stopped], [0, "github.com refused this login"]);
    assert.deepEqual(titlesIn(dir), []);
    // Once the login is let in again, the read starts over.
    time.advance(3_600_000);
    const again = fakeTracker(250);
    await store.read(key, again.tracker, project);
    assert.deepEqual(again.asked, [null, "100", "200"]);
    const ready = await store.state(key);
    assert.equal(ready.kind === "ready" && ready.snapshot.changesSince, "2026-09-23T10:59:00.000Z");
  });

  test("one read at a time: a second read of the same Snapshot leaves it to the first", async () => {
    const store = snapshotStore(scratch(), clock());
    let second: Promise<unknown> | undefined;
    const { tracker } = fakeTracker(150, { onPage: async () => void (second ??= store.read(key, fakeTracker(150).tracker, project)) });
    assert.deepEqual(await store.read(key, tracker, project), { kind: "done" });
    assert.deepEqual(await second, { kind: "busy" });
  });

  test("a read left behind by a process that's gone doesn't hold the Snapshot, and resumes", async () => {
    const dir = scratch();
    // A reader that saves its first page, says so, then hangs until it is killed.
    const child = spawn(process.execPath, [fileURLToPath(new URL("./fakes/hanging-read.ts", import.meta.url)), dir], { stdio: ["ignore", "pipe", "inherit"] });
    await new Promise<void>((resolve) => child.stdout.once("data", () => resolve()));
    const store = snapshotStore(dir, clock());
    const running = await store.state(key);
    assert.deepEqual(running.kind === "reading" && [running.read, running.running], [100, true]);
    child.kill("SIGKILL");
    await new Promise((resolve) => child.once("exit", resolve));
    const gone = await store.state(key);
    assert.deepEqual(gone.kind === "reading" && [gone.read, gone.running], [100, false]);
    const again = fakeTracker(150);
    assert.deepEqual(await store.read(key, again.tracker, project), { kind: "done" });
    assert.deepEqual(again.asked, ["100"]);
  });

  test("a Snapshot belongs to one Tracker, one Project and one login", async () => {
    const store = snapshotStore(scratch(), clock());
    await store.read(key, fakeTracker(10).tracker, project);
    assert.equal((await store.state(key)).kind, "ready");
    assert.deepEqual(await store.state({ ...key, login: "someone-else" }), { kind: "none" });
    assert.deepEqual(await store.state({ ...key, project: "github.com#2" }), { kind: "none" });
    assert.deepEqual(await store.state({ ...key, tracker: "ghe.example.com" }), { kind: "none" });
  });

  test("only its OS user can read what it keeps", async () => {
    const dir = scratch();
    await snapshotStore(dir, clock()).read(key, fakeTracker(10).tracker, project);
    for (const file of walk(dir)) {
      const mode = statSync(file).mode & 0o777;
      assert.equal(mode & 0o077, 0, `${file} is ${mode.toString(8)}`);
    }
  });
});

/** Issue `n` of the Project as a Link's far end, open unless it says otherwise. */
function end(n: number, more: Partial<Extract<FarEnd, { readable: true }>> = {}): FarEnd {
  return { id: `I_${n}`, readable: true, open: true, project: project.path, ref: `${project.path}#${n}`, title: `Issue ${n}`, url: `https://github.com/fixture-org/tools/issues/${n}`, ...more };
}

/** Adds Links to the Issues of a fake read: `[a, "blocks", b]` reads "a Blocks b". */
function linked(links: [number, "blocks" | "parent", number][]): (issue: OpenIssue) => OpenIssue {
  return (issue) => {
    const n = Number(issue.ref.slice(1));
    const roles: Link[] = links.flatMap(([a, kind, b]): Link[] => {
      if (a === n) return [{ role: kind === "blocks" ? "blocked" : "child", to: end(b) }];
      if (b === n) return [{ role: kind === "blocks" ? "blocker" : "parent", to: end(a) }];
      return [];
    });
    return { ...issue, links: roles };
  };
}

describe("refreshing a Snapshot for a draw (ADR 0006)", () => {
  /** A store holding a finished read of `count` open Issues, started at 10:00:00 and taking a second. */
  async function readStore(count = 5, shape?: (issue: OpenIssue) => OpenIssue) {
    const time = clock();
    const store = snapshotStore(scratch(), time);
    await store.read(key, fakeTracker(count, { time, ...(shape ? { shape } : {}) }).tracker, project);
    return { store, time };
  }

  /** The Snapshot after one refresh that answers `changes`. */
  async function refreshed(changes: Partial<Extract<ChangesAnswer, { kind: "changes" }>>, count = 5, shape?: (issue: OpenIssue) => OpenIssue) {
    const { store, time } = await readStore(count, shape);
    time.advance(121_000);
    const answer: ChangesAnswer = { kind: "changes", open: [], ends: [], requests: [], caughtUp: true, unread: {}, ...changes };
    const fake = fakeTracker(count, { time, changes: answer });
    const drawn = await store.forDraw(key, fake.tracker, project);
    assert.equal(drawn.kind, "ready");
    return { snapshot: (drawn as Extract<typeof drawn, { kind: "ready" }>).snapshot, refreshes: fake.refreshes, store };
  }

  /** Each Issue's reference, with its Links as `role ref (open|closed)`. */
  const drawnLinks = (issues: OpenIssue[]) =>
    Object.fromEntries(issues.map((i) => [i.ref, i.links.map(({ role, to }) => (to.readable ? `${role} ${to.ref.split("/").pop()}${to.open ? "" : " closed"} ${to.title}` : `${role} unreadable`)).sort()]));

  test("a Snapshot under two minutes old is handed over without a refresh", async () => {
    const { store, time } = await readStore();
    // The read took a second.
    time.advance(118_000);
    const fake = fakeTracker(5, { time });
    const drawn = await store.forDraw(key, fake.tracker, project);
    assert.deepEqual(fake.refreshes, []);
    assert.deepEqual(drawn.kind === "ready" && [drawn.ageMs, drawn.stale], [119_000, undefined]);
  });

  test("an older one is refreshed first, reading what changed since its read started, less a minute for clocks that disagree", async () => {
    const { store, time } = await readStore();
    time.advance(121_000);
    const fake = fakeTracker(5, { time });
    const drawn = await store.forDraw(key, fake.tracker, project);
    assert.deepEqual(fake.refreshes, [{ since: "2026-09-23T09:59:00.000Z", outside: [] }]);
    assert.deepEqual(drawn.kind === "ready" && [drawn.ageMs, drawn.stale], [0, undefined]);
    // The next refresh reads from when this one started.
    time.advance(121_000);
    await store.forDraw(key, fake.tracker, project);
    assert.equal(fake.refreshes[1]?.since, "2026-09-23T10:01:02.000Z");
  });

  test("when the Tracker can't be read, the old Snapshot is handed over as it was, with its age and why", async () => {
    const { store, time } = await readStore();
    time.advance(3 * 3_600_000);
    const unreachable = fakeTracker(5, { time, changes: { kind: "cant-tell", reason: "couldn't reach github.com" } });
    const before = await store.state(key);
    const drawn = await store.forDraw(key, unreachable.tracker, project);
    assert.equal(drawn.kind, "ready");
    const { snapshot, ageMs, stale } = drawn as Extract<typeof drawn, { kind: "ready" }>;
    assert.deepEqual([ageMs, stale], [3 * 3_600_000 + 2000, "couldn't reach github.com"]);
    assert.deepEqual(snapshot, before.kind === "ready" && before.snapshot);
    // Asking again tries again.
    time.advance(1000);
    await store.forDraw(key, unreachable.tracker, project);
    assert.equal(unreachable.refreshes.length, 2);
  });

  test("a refresh replaces the Issues that changed, adds new ones oldest first, and drops ones no longer open", async () => {
    const { snapshot } = await refreshed({
      open: [{ ...issue(6) }, { ...issue(2), title: "Import state from S3", assignees: ["fixture-bot"] }],
      ends: [end(3, { open: false, closedAt: "2026-09-23T10:01:00Z", closedAs: "completed" })],
    });
    assert.deepEqual(snapshot.issues.map((i) => [i.ref, i.title, i.assignees]), [
      ["#1", "Issue 1", []],
      ["#2", "Import state from S3", ["fixture-bot"]],
      ["#4", "Issue 4", []],
      ["#5", "Issue 5", []],
      ["#6", "Issue 6", []],
    ]);
  });

  test("a Link made or removed, read from only one end, shows at both", async () => {
    const { snapshot } = await refreshed(
      // #1 no longer Blocks #2, and #4 became #3's Parent; the Tracker gave only #2 and #3.
      { open: [issue(2), { ...issue(3), links: [{ role: "parent", to: end(4) }] }] },
      5,
      linked([[1, "blocks", 2]]),
    );
    assert.deepEqual(drawnLinks(snapshot.issues), {
      "#1": [],
      "#2": [],
      "#3": ["parent tools#4 Issue 4"],
      "#4": ["child tools#3 Issue 3"],
      "#5": [],
    });
  });

  test("a Link's far end follows what changed: a closed blocker stays, closed, and a renamed Issue is named anew", async () => {
    const { snapshot } = await refreshed(
      {
        open: [{ ...issue(4), title: "Import state from S3", links: [{ role: "child", to: end(5) }] }],
        ends: [end(2, { open: false, closedAt: "2026-09-23T10:01:00Z", closedAs: "duplicate" })],
      },
      5,
      linked([[2, "blocks", 1], [4, "parent", 5]]),
    );
    assert.deepEqual(drawnLinks(snapshot.issues), {
      "#1": ["blocker tools#2 closed Issue 2"],
      "#3": [],
      "#4": ["child tools#5 Issue 5"],
      "#5": ["parent tools#4 Import state from S3"],
    });
    const blocker = snapshot.issues[0]!.links[0]!.to;
    assert.deepEqual(blocker.readable && [blocker.closedAt, blocker.closedAs], ["2026-09-23T10:01:00Z", "duplicate"]);
  });

  test("the Outside Issues a Link reaches are read again, and one this login can't read any more loses its name", async () => {
    const plans = (n: number, title = `Plan ${n}`): FarEnd => ({ id: `P_${n}`, readable: true, open: true, project: "fixture-org/plans", ref: `fixture-org/plans#${n}`, title, url: `https://github.com/fixture-org/plans/issues/${n}` });
    const outside = (issue: OpenIssue): OpenIssue => {
      const far: Record<string, FarEnd> = { "#1": plans(7), "#2": plans(8), "#3": { id: "I_3/hidden/0", readable: false } };
      const to = far[issue.ref];
      return to ? { ...issue, links: [{ role: "parent", to }] } : issue;
    };
    const { snapshot, refreshes } = await refreshed({ ends: [plans(7, "Q3 importer epic"), { id: "P_8", readable: false }] }, 3, outside);
    assert.deepEqual(refreshes.map((r) => r.outside), [["P_7", "P_8"]], "one it can't read is never asked about");
    assert.deepEqual(drawnLinks(snapshot.issues), { "#1": ["parent plans#7 Q3 importer epic"], "#2": ["parent unreadable"], "#3": ["parent unreadable"] });
  });

  test("a refresh that couldn't reach back far enough is remembered, until the next full read", async () => {
    const { store, time } = await readStore();
    const behind = fakeTracker(5, { time, changes: { kind: "changes", open: [], ends: [], requests: [], caughtUp: false, unread: {} } });
    const caughtUp = fakeTracker(5, { time });
    time.advance(121_000);
    assert.deepEqual(await store.refresh(key, behind.tracker, project), { kind: "done", caughtUp: false });
    time.advance(121_000);
    assert.deepEqual(await store.refresh(key, caughtUp.tracker, project), { kind: "done", caughtUp: false });
    const state = await store.state(key);
    assert.equal(state.kind === "ready" && state.snapshot.caughtUp, false);
  });

  test("a refresh keeps what the Tracker couldn't give, and why", async () => {
    const { snapshot } = await refreshed({ unread: { closingRequests: "this login can't read pull requests" } });
    assert.deepEqual(snapshot.unread, { closingRequests: "this login can't read pull requests" });
  });

  test("a draw that finds a refresh already running draws what's there, and says so", async () => {
    const { store, time } = await readStore();
    time.advance(121_000);
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const slow = fakeTracker(5, { time });
    const running = store.refresh(key, { ...slow.tracker, changes: async (...args) => (await held, slow.tracker.changes(...args)) }, project);
    await new Promise((resolve) => setImmediate(resolve));
    const other = fakeTracker(5, { time });
    const drawn = await store.forDraw(key, other.tracker, project);
    assert.deepEqual(drawn.kind === "ready" && drawn.stale, "another refresh of it is running");
    assert.deepEqual(other.refreshes, []);
    release();
    assert.equal((await running).kind, "done");
  });

  test("a Closing Request updated since, that no longer closes an Issue, leaves it", async () => {
    const request = (n: number) => ({ ref: `${project.path}#${n}`, url: `https://github.com/fixture-org/tools/pull/${n}`, draft: false, author: "fixture-bot" });
    const shape = (issue: OpenIssue): OpenIssue => (issue.ref === "#3" ? { ...issue, closingRequests: [request(40)] } : issue.ref === "#4" ? { ...issue, closingRequests: [request(41)] } : issue);
    const { snapshot } = await refreshed({ requests: [`${project.path}#40`] }, 5, shape);
    assert.deepEqual(snapshot.issues.map((i) => [i.ref, i.closingRequests.map((r) => r.ref)]), [
      ["#1", []],
      ["#2", []],
      ["#3", []],
      ["#4", [`${project.path}#41`]],
      ["#5", []],
    ]);
  });

  test("once the Tracker refuses the login, or shows it no such Project, the Snapshot is deleted", async () => {
    const answers = [
      { kind: "refused", reason: "github.com refused this login: Bad credentials" },
      { kind: "not-found", reason: "no repository fixture-org/tools on github.com that this login can see" },
    ] as const;
    for (const answer of answers) {
      const dir = scratch();
      const time = clock();
      const store = snapshotStore(dir, time);
      await store.read(key, fakeTracker(5, { time }).tracker, project);
      time.advance(121_000);
      assert.deepEqual(await store.forDraw(key, fakeTracker(5, { time, changes: answer }).tracker, project), { kind: "refused", reason: answer.reason });
      assert.notEqual((await store.state(key)).kind, "ready");
      assert.deepEqual(titlesIn(dir), [], answer.kind);
    }
  });
});

describe("reading a Snapshot again in full (ADR 0006)", () => {
  /** A re-read of `count` open Issues whose second page waits until `release` is called. */
  function heldReread(count: number, time: ReturnType<typeof clock>) {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let pages = 0;
    const fake = fakeTracker(count, { time, onPage: async () => void (++pages === 2 && (await held)) });
    return { ...fake, release };
  }

  test("a full read in progress never blocks a draw: the Snapshot there is refreshed and drawn meanwhile, then replaced", async () => {
    const time = clock();
    const store = snapshotStore(scratch(), time);
    await store.read(key, fakeTracker(5, { time }).tracker, project);
    time.advance(121_000);
    const reread = heldReread(150, time);
    const reading = store.read(key, reread.tracker, project);
    while (reread.asked.length < 2) await new Promise((resolve) => setImmediate(resolve));

    const refresher = fakeTracker(5, { time });
    const drawn = await store.forDraw(key, refresher.tracker, project);
    assert.equal(refresher.refreshes.length, 1, "the refresh isn't held up by the full read");
    assert.deepEqual(drawn.kind === "ready" && [drawn.snapshot.issues.length, drawn.ageMs, drawn.stale], [5, 0, undefined]);

    reread.release();
    assert.deepEqual(await reading, { kind: "done" });
    const after = await store.state(key);
    assert.equal(after.kind === "ready" && after.snapshot.issues.length, 150);
  });

  test("a Snapshot is due a full read once a refresh couldn't prove it caught up, until one finishes", async () => {
    const time = clock();
    const store = snapshotStore(scratch(), time);
    await store.read(key, fakeTracker(5, { time }).tracker, project);
    const due = async () => {
      const state = await store.state(key);
      return state.kind === "ready" && state.readAgain;
    };
    assert.equal(await due(), false);
    time.advance(121_000);
    const behind: ChangesAnswer = { kind: "changes", open: [], ends: [], requests: [], caughtUp: false, unread: {} };
    await store.refresh(key, fakeTracker(5, { time, changes: behind }).tracker, project);
    assert.equal(await due(), true);

    const reread = heldReread(150, time);
    const reading = store.read(key, reread.tracker, project);
    while (reread.asked.length < 2) await new Promise((resolve) => setImmediate(resolve));
    assert.equal(await due(), false, "not while one is running");
    reread.release();
    await reading;
    assert.equal(await due(), false);
  });

  test("otherwise a Snapshot is due a full read a week after the last one started", async () => {
    const time = clock();
    const store = snapshotStore(scratch(), time);
    await store.read(key, fakeTracker(5, { time }).tracker, project);
    const refresher = fakeTracker(5, { time });
    const due = async () => {
      const state = await store.state(key);
      return state.kind === "ready" && state.readAgain;
    };
    // The read and the refresh take a second each.
    time.advance(7 * 86_400_000 - 3000);
    await store.refresh(key, refresher.tracker, project);
    assert.equal(await due(), false, "refreshes don't count as full reads");
    time.advance(1000);
    assert.equal(await due(), true);
    // Drawn meanwhile: it's the full read that's due, not the Snapshot that's old.
    const drawn = await store.forDraw(key, refresher.tracker, project);
    assert.deepEqual(drawn.kind === "ready" && [drawn.stale, drawn.readAgain], [undefined, true]);
  });

  test("what's read after the CLI switched to another login is never saved as this login's", async () => {
    const time = clock();
    const store = snapshotStore(scratch(), time);
    const switched = fakeTracker(7, { time, login: "someone-else" });
    assert.deepEqual(await store.read(key, switched.tracker, project), { kind: "failed", reason: "github.com now logs in as someone-else" });
    assert.notEqual((await store.state(key)).kind, "ready");

    await store.read(key, fakeTracker(5, { time }).tracker, project);
    time.advance(121_000);
    const changed: ChangesAnswer = { kind: "changes", open: [issue(6)], ends: [], requests: [], caughtUp: true, unread: {} };
    const refreshed = await store.refresh(key, fakeTracker(5, { time, login: "someone-else", changes: changed }).tracker, project);
    assert.deepEqual(refreshed, { kind: "failed", reason: "github.com now logs in as someone-else" });
    const state = await store.state(key);
    assert.equal(state.kind === "ready" && state.snapshot.issues.length, 5);
  });

  test("a login refused while a full read runs doesn't get its Snapshot back when the read finishes", async () => {
    const dir = scratch();
    const time = clock();
    const store = snapshotStore(dir, time);
    await store.read(key, fakeTracker(5, { time }).tracker, project);
    time.advance(121_000);
    const reread = heldReread(150, time);
    const reading = store.read(key, reread.tracker, project);
    while (reread.asked.length < 2) await new Promise((resolve) => setImmediate(resolve));

    const refused = { kind: "refused", reason: "github.com refused this login: Bad credentials" } as const;
    assert.deepEqual(await store.forDraw(key, fakeTracker(5, { time, changes: refused }).tracker, project), refused);
    reread.release();
    assert.deepEqual(await reading, refused);
    assert.notEqual((await store.state(key)).kind, "ready");
    assert.deepEqual(titlesIn(dir), []);
  });
});

/** The files under `dir` that hold an Issue's title. */
function titlesIn(dir: string): string[] {
  return walk(dir).filter((file) => statSync(file).isFile() && readFileSync(file, "utf8").includes("Issue 1"));
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true }).map((e) => join(e.parentPath, e.name));
}
