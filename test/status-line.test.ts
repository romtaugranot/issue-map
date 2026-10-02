/**
 * The status line as the plugin's hooks module runs it (#40, ADR 0011): a
 * process of its own, in the directory the session is in, done well inside
 * 300 ms on the largest recorded Project.
 */
import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

/** A Claude Code config directory of its own, with `settings` when given, so the user's own are never read. */
function configDir(settings?: object): string {
  const dir = mkdtempSync(join(tmpdir(), "issue-map-config-"));
  if (settings) writeFileSync(join(dir, "settings.json"), JSON.stringify(settings));
  return dir;
}

/** Runs the status line as the hooks module does, in `cwd`, and how long it took. */
function run(cwd: string, env: Record<string, string>): Promise<{ stdout: string; code: number | null; ms: number }> {
  const started = performance.now();
  return new Promise((resolve) => {
    const child = spawn(ENTRY, [], { cwd, env: { ...process.env, CLAUDE_CONFIG_DIR: configDir(), ...env }, stdio: ["ignore", "pipe", "inherit"] });
    let stdout = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.on("close", (code) => resolve({ stdout, code, ms: performance.now() - started }));
  });
}

describe("the status line on the largest recorded Project, gitlab-org/gitlab", () => {
  let warm: Awaited<ReturnType<typeof warmCheckout>>;
  before(async () => {
    warm = await warmCheckout();
  });
  test(`is worked out within ${BUDGET_MS} ms, never reading the Snapshot`, async () => {
    const store = snapshotStore(warm.state, { now: Date.now });
    const started = performance.now();
    const row = await homeRow({ checkoutRoot, lastHome: (root) => lastHomeOf(root, warm.state).get(), remotes: async () => [], store }, warm.checkout);
    const ms = performance.now() - started;
    // Kept when the Snapshot was saved, so fresh; the recording dates no closed blocker, so when it was read changes nothing else.
    assert.equal(row, warm.row);
    assert.ok(ms < BUDGET_MS, `${Math.round(ms)} ms`);
  });

  // Starting Node takes most of it; a loaded machine can take longer, so it's run a few times and the quickest counts.
  test(`runs as a process of its own, in the session's directory, within ${BUDGET_MS} ms`, async () => {
    const runs = [];
    for (let i = 0; i < 3; i++) runs.push(await run(warm.checkout, { ISSUE_MAP_STATE_DIR: warm.state }));
    assert.equal(runs[0]!.code, 0);
    assert.equal(runs[0]!.stdout, `${warm.row}\n`);
    const quickest = Math.min(...runs.map((r) => r.ms));
    assert.ok(quickest < BUDGET_MS, `${Math.round(quickest)} ms`);
  });

  test("prints nothing outside a checkout", async () => {
    const elsewhere = mkdtempSync(join(tmpdir(), "issue-map-elsewhere-"));
    assert.deepEqual(await run(elsewhere, { ISSUE_MAP_STATE_DIR: warm.state }).then((r) => [r.code, r.stdout]), [0, ""]);
  });

  test("while a status line 0.1.0 set up is still in the user's settings, says how to take it out", async () => {
    const config = configDir({ statusLine: { type: "command", command: "'/gone/issue-map/0.1.0/bin/issue-map-status-line' --wrap 'mine' 2>/dev/null || sh -c 'mine'" } });
    const { stdout } = await run(warm.checkout, { ISSUE_MAP_STATE_DIR: warm.state, CLAUDE_CONFIG_DIR: config });
    assert.equal(stdout, `${warm.row} · say “take the Map out of my status line” to remove the old one\n`);
  });

  test("the user's own status line alone adds nothing", async () => {
    const config = configDir({ statusLine: { type: "command", command: "mine" } });
    const { stdout } = await run(warm.checkout, { ISSUE_MAP_STATE_DIR: warm.state, CLAUDE_CONFIG_DIR: config });
    assert.equal(stdout, `${warm.row}\n`);
  });
});
