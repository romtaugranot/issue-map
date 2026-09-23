/**
 * Seam C: the Snapshot store, with an injected clock and a fake Tracker that
 * can be told to fail, so ADR 0006's rules are asserted directly.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { snapshotStore, type SnapshotKey, type SnapshotState } from "../src/snapshot/store.ts";
import type { IssuePage, OpenIssue, Project, Tracker } from "../src/tracker/tracker.ts";

const project: Project = { id: "github.com#1", host: "github.com", path: "fixture-org/tools", url: "https://github.com/fixture-org/tools", issues: { open: 250 } };
const key: SnapshotKey = { tracker: "github.com", project: project.id, login: "fixture-viewer" };

function issue(n: number): OpenIssue {
  return { id: `I_${n}`, ref: `#${n}`, title: `Issue ${n}`, url: `https://github.com/fixture-org/tools/issues/${n}`, createdAt: new Date(Date.UTC(2026, 0, n)).toISOString(), assignees: [], planned: null, taskLevel: false, links: [] };
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
}

/**
 * `count` open Issues in pages of 100. Each page takes `pageMs` on the clock;
 * `fail` makes the page at that `after` answer with a failure instead, once.
 */
function fakeTracker(count: number, options: { time?: ReturnType<typeof clock>; pageMs?: number; fail?: { at: string | null; answer: IssuePage }; onPage?: () => Promise<void> } = {}): FakeTracker {
  const asked: (string | null)[] = [];
  let fail = options.fail;
  const all = Array.from({ length: count }, (_, i) => issue(i + 1));
  const tracker: Tracker = {
    product: "GitHub",
    host: "github.com",
    version: null,
    resolveProject: async () => ({ kind: "cant-tell", reason: "unused" }),
    viewer: async () => ({ kind: "viewer", login: key.login }),
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
      return { kind: "page", issues: all.slice(start, start + 100), total: count, next };
    },
  };
  return { tracker, asked };
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
    assert.equal(ageMs, 45_000);
    assert.deepEqual(snapshot, {
      tracker: "github.com",
      project: { id: project.id, path: project.path, url: project.url },
      login: "fixture-viewer",
      readAt: "2026-09-23T10:00:03.000Z",
      issues: Array.from({ length: 250 }, (_, i) => issue(i + 1)),
    });
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

  test("a refused login stops the read and says so", async () => {
    const store = snapshotStore(scratch(), clock());
    const { tracker } = fakeTracker(50, { fail: { at: null, answer: { kind: "refused", reason: "github.com refused this login" } } });
    assert.deepEqual(await store.read(key, tracker, project), { kind: "failed", reason: "github.com refused this login" });
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

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true }).map((e) => join(e.parentPath, e.name));
}
