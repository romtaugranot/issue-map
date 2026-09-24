/**
 * The status line as Claude Code runs it (#40): a process of its own, given
 * the session's JSON on standard input, wrapping the user's own status line
 * command when there is one, and done inside Claude Code's 300 ms debounce
 * on the largest recorded Project.
 */
import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { statusRow } from "../src/map/status.ts";
import type { Snapshot } from "../src/snapshot/snapshot.ts";
import { snapshotStore, type SnapshotKey } from "../src/snapshot/store.ts";
import { checkoutRoot } from "../src/home/checkout.ts";
import { lastHomeOf } from "../src/state.ts";
import { homeRow } from "../src/status/line.ts";
import type { Project, Tracker } from "../src/tracker/tracker.ts";

const ENTRY = fileURLToPath(new URL("../bin/issue-map-status-line", import.meta.url));
/** Claude Code debounces status line runs at 300 ms and cancels one still running when the next starts. */
const BUDGET_MS = 300;

/**
 * A git checkout whose Home Project is the recorded gitlab-org/gitlab, and a
 * state directory holding its Snapshot, saved through the store so its row
 * is kept beside it, and kept warm by a refresher: this test process holds
 * the refresher's claim.
 */
async function warmCheckout(): Promise<{ checkout: string; state: string; row: string }> {
  const recorded = JSON.parse(gunzipSync(readFileSync(new URL("./fixtures/snapshots/gitlab-org__gitlab.json.gz", import.meta.url))).toString("utf8")) as Snapshot;
  const checkout = mkdtempSync(join(tmpdir(), "issue-map-checkout-"));
  execFileSync("git", ["init", "-q", checkout]);
  const state = mkdtempSync(join(tmpdir(), "issue-map-state-"));
  const project: Project = { id: recorded.project.id, host: recorded.tracker, path: recorded.project.path, url: recorded.project.url, issues: { open: recorded.issues.length } };
  await lastHomeOf((await checkoutRoot(checkout))!, state).set(project);
  const key: SnapshotKey = { tracker: recorded.tracker, project: recorded.project.id, login: recorded.login };
  // On the wall clock, since the process run below judges the refresher's claim by it.
  const store = snapshotStore(state, { now: Date.now }, { summarise: statusRow });
  await store.read(key, recordedTracker(recorded), project);
  assert.ok(await store.claimRefresher(key));
  // Only the row is kept: holding the whole Snapshot would slow every process this one starts, git among them.
  return { checkout, state, row: statusRow(recorded) };
}

/** A Tracker that gives the recorded Snapshot's Issues in one page, as its login. */
function recordedTracker(recorded: Snapshot): Tracker {
  const unused = async () => ({ kind: "cant-tell", reason: "unused" }) as const;
  return {
    product: "GitLab",
    host: recorded.tracker,
    version: null,
    untested: recorded.support.untested,
    capabilities: async () => ({ kind: "capabilities", links: recorded.support.links, write: { kind: "can" } }),
    openIssues: async () => ({ kind: "page", issues: recorded.issues, total: recorded.issues.length, next: null, unread: recorded.unread }),
    viewer: async () => ({ kind: "viewer", login: recorded.login }),
    resolveProject: unused,
    changes: unused,
    issue: unused,
    thread: unused,
    assign: unused,
    link: unused,
  };
}

/** Runs the status line as Claude Code does, and how long it took. */
function run(args: string[], stdin: string, env: Record<string, string>): Promise<{ stdout: string; code: number | null; ms: number }> {
  const started = performance.now();
  return new Promise((resolve) => {
    const child = spawn(ENTRY, args, { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "inherit"] });
    let stdout = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.on("close", (code) => resolve({ stdout, code, ms: performance.now() - started }));
    child.stdin.end(stdin);
  });
}

describe("the status line on the largest recorded Project, gitlab-org/gitlab", () => {
  let warm: Awaited<ReturnType<typeof warmCheckout>>;
  before(async () => {
    warm = await warmCheckout();
  });
  const session = () => JSON.stringify({ session_id: "fixture-session", workspace: { current_dir: warm.checkout, project_dir: warm.checkout }, cwd: warm.checkout });

  test(`is worked out within ${BUDGET_MS} ms, never reading the Snapshot`, async () => {
    const store = snapshotStore(warm.state, { now: Date.now });
    const started = performance.now();
    const row = await homeRow({ checkoutRoot, lastHome: (root) => lastHomeOf(root, warm.state).get(), store }, warm.checkout);
    const ms = performance.now() - started;
    // Kept when the Snapshot was saved, so fresh; the recording dates no closed blocker, so when it was read changes nothing else.
    assert.equal(row, warm.row);
    assert.ok(ms < BUDGET_MS, `${Math.round(ms)} ms`);
  });

  // Starting Node takes most of it; a loaded machine can take longer, so it's run a few times and the quickest counts.
  test(`runs as a process of its own, standard input to row, within ${BUDGET_MS} ms`, async () => {
    const runs = [];
    for (let i = 0; i < 3; i++) runs.push(await run([], session(), { ISSUE_MAP_STATE_DIR: warm.state }));
    assert.equal(runs[0]!.code, 0);
    assert.equal(runs[0]!.stdout, `${warm.row}\n`);
    const quickest = Math.min(...runs.map((r) => r.ms));
    assert.ok(quickest < BUDGET_MS, `${Math.round(quickest)} ms`);
  });

  test("wraps the user's own status line: their rows first, given the same standard input, then the Map's", async () => {
    const { stdout, code } = await run(["--wrap", `node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log("theirs: "+JSON.parse(s).session_id+"\\nsecond row"))'`], session(), { ISSUE_MAP_STATE_DIR: warm.state });
    assert.equal(code, 0);
    const rows = stdout.trimEnd().split("\n");
    assert.deepEqual(rows.slice(0, 2), ["theirs: fixture-session", "second row"]);
    assert.match(rows[2]!, /^◆ gitlab-org\/gitlab · Take next: /);
    assert.equal(rows.length, 3);
  });

  test("still shows the Map's row when the user's command fails", async () => {
    const { stdout, code } = await run(["--wrap", "echo half a row; exit 3"], session(), { ISSUE_MAP_STATE_DIR: warm.state });
    assert.equal(code, 0);
    assert.deepEqual(stdout.trimEnd().split("\n").map((r) => r.slice(0, 20)), ["half a row", "◆ gitlab-org/gitlab "]);
  });

  test("reads the directory from standard input, and makes do without it", async () => {
    const elsewhere = mkdtempSync(join(tmpdir(), "issue-map-elsewhere-"));
    const outside = await run([], JSON.stringify({ workspace: { current_dir: elsewhere } }), { ISSUE_MAP_STATE_DIR: warm.state });
    assert.deepEqual([outside.code, outside.stdout], [0, ""], "outside a checkout, nothing of the Map's");
    const garbled = await new Promise<{ stdout: string; code: number | null }>((resolve) => {
      const child = spawn(ENTRY, [], { cwd: warm.checkout, env: { ...process.env, ISSUE_MAP_STATE_DIR: warm.state }, stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      child.stdout.on("data", (chunk) => (stdout += chunk));
      child.on("close", (code) => resolve({ stdout, code }));
      child.stdin.end("not JSON");
    });
    assert.equal(garbled.code, 0);
    assert.match(garbled.stdout, /^◆ gitlab-org\/gitlab · /, "from the directory it runs in");
  });
});
