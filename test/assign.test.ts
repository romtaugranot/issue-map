/**
 * Assigning an Issue to yourself from its card: the card offers it where
 * the Map writes, and the write re-reads the Issue first, stops at the first
 * refusal, and shows at once on the card and in Take next. The store is
 * real; the Tracker is an in-memory one whose Issues the write changes.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assignToViewer } from "../src/map/assign.ts";
import { showCard, showMap } from "../src/map/show.ts";
import { snapshotStore, type SnapshotKey } from "../src/snapshot/store.ts";
import type { AssignAnswer, CapabilitiesAnswer, IssueRead, OpenIssue, Project, Tracker } from "../src/tracker/tracker.ts";
import { READS_EVERYTHING } from "./fakes/fake-trackers.ts";

const project: Project = { id: "github.com#1", host: "github.com", path: "fixture-org/tools", url: "https://github.com/fixture-org/tools", issues: { open: 3 } };
const key: SnapshotKey = { tracker: "github.com", project: project.id, login: "fixture-viewer" };

/** #1 Blocks #2; #3 is Related to #1. */
function issues(): OpenIssue[] {
  const end = (n: number) => ({ id: `I_${n}`, readable: true as const, open: true, project: project.path, ref: `${project.path}#${n}`, title: `Issue ${n}`, url: `${project.url}/issues/${n}` });
  const issue = (n: number, links: OpenIssue["links"]): OpenIssue => ({ ...end(n), ref: `#${n}`, createdAt: new Date(Date.UTC(2026, 0, n)).toISOString(), assignees: [], planned: null, taskLevel: false, links, closingRequests: [] });
  return [issue(1, [{ role: "blocked", to: end(2) }, { role: "related", to: end(3) }]), issue(2, [{ role: "blocker", to: end(1) }]), issue(3, [{ role: "related", to: end(1) }])];
}

interface Options {
  capabilities?: CapabilitiesAnswer;
  untested?: string;
  /** What the write answers instead of assigning. */
  refuse?: AssignAnswer;
}

/** A Tracker holding `issues()`, whose writes change them, noting every write. */
function liveTracker(options: Options = {}) {
  const held = issues();
  const writes: string[] = [];
  const read = (issue: OpenIssue): IssueRead => ({
    id: issue.id,
    project: project.path,
    ref: `${project.path}${issue.ref}`,
    title: issue.title,
    url: issue.url,
    open: true,
    assignees: issue.assignees,
    closedAs: null,
    links: issue.links.map((link) => ({ ...link, name: link.role })),
    closingRequests: [],
    mentionedBy: [],
    unread: {},
  });
  const find = (locator: string) => held.find((issue) => `${project.path}${issue.ref}` === locator);
  const tracker: Tracker = {
    product: "GitHub",
    host: "github.com",
    version: null,
    thread: async () => ({ kind: "cant-tell", reason: "unused" }),
    untested: options.untested ?? null,
    capabilities: async () => options.capabilities ?? { kind: "capabilities", ...READS_EVERYTHING },
    resolveProject: async () => ({ kind: "cant-tell", reason: "unused" }),
    changes: async () => ({ kind: "changes", open: [], ends: [], requests: [], caughtUp: true, unread: {} }),
    viewer: async () => ({ kind: "viewer", login: key.login }),
    openIssues: async () => ({ kind: "page", issues: structuredClone(held), total: held.length, next: null, unread: {} }),
    async issue(locator) {
      const found = find(locator);
      return found ? { kind: "issue", issue: read(found) } : { kind: "not-found", reason: `no Issue ${locator} on github.com that this login can read` };
    },
    async assign(locator, viewer) {
      writes.push(locator);
      if (options.refuse) return options.refuse;
      const found = find(locator);
      if (!found) return { kind: "not-found", reason: `no Issue ${locator}` };
      found.assignees = [...found.assignees, viewer];
      return { kind: "assigned", assignees: found.assignees };
    },
  };
  return { tracker, writes, held };
}

async function arrange(options: Options = {}) {
  const store = snapshotStore(mkdtempSync(join(tmpdir(), "issue-map-assign-")), { now: () => Date.parse("2026-09-24T10:00:00Z") });
  const live = liveTracker(options);
  assert.deepEqual(await store.read(key, live.tracker, project), { kind: "done" });
  const deps = { store, startRead: () => {}, sleep: async () => {}, startRefresher: async () => {} };
  const takeNext = async () => {
    const lines = (await showMap(deps, live.tracker, project, { kind: "overview" })).text.split("\n");
    const from = lines.findIndex((line) => line.includes("Take next")) + 1;
    return lines.slice(from, lines.indexOf("", from));
  };
  return { ...live, store, takeNext };
}

const CANT_TELL = { kind: "cant-tell", reason: "this login's token doesn't list what it may write, as a fine-grained token doesn't" } as const;

describe("the card offers to assign an unassigned Issue", () => {
  test("on a Promised Project whose login can write, naming the write", async () => {
    const { tracker } = await arrange();
    const card = await showCard(tracker, project, "#3");
    assert.match(card.text, /^Not Blocked · unassigned$/m);
    assert.deepEqual(card.assign, { label: "Assign #3 to me", description: "writes to GitHub: assigns #3 to fixture-viewer", ref: "#3" });
  });

  test("not on a Best effort or a Refused Project", async () => {
    const bestEffort = await arrange({ untested: "GHES 3.17.4 is older than 3.18, the oldest release GitHub still supports" });
    assert.equal((await showCard(bestEffort.tracker, project, "#3")).assign, undefined);
    const none = { kind: "cant-read", reason: "GitLab 13.1.0 is older than 13.4, the oldest the Map reads" } as const;
    const refused = liveTracker({ capabilities: { kind: "capabilities", links: { blocks: none, parent: none, related: none }, write: { kind: "can" } } });
    assert.equal((await showCard(refused.tracker, project, "#3")).assign, undefined);
  });

  test("to a login the Tracker can't say may write, saying it stops at the first refusal", async () => {
    const { tracker } = await arrange({ capabilities: { kind: "capabilities", ...READS_EVERYTHING, write: CANT_TELL } });
    assert.match((await showCard(tracker, project, "#3")).assign?.description ?? "", /stops at the first refusal$/);
  });
});

describe("assigning an Issue to yourself", () => {
  test("assigns it after reading it again, and the card says it's yours", async () => {
    const { tracker, writes, store } = await arrange();
    const shown = await assignToViewer({ store }, tracker, project, "#3");
    assert.deepEqual(writes, ["fixture-org/tools#3"]);
    const [said, , ...card] = shown.text.split("\n");
    assert.equal(said, "Assigned #3 to you on GitHub.");
    assert.equal(card[2], "Not Blocked · assigned to you");
    assert.equal(shown.assign, undefined, "no second offer");
    assert.equal(shown.opened, true);
  });

  test("the Issue is at once the viewer's own in Take next, still in it", async () => {
    const { tracker, store, takeNext } = await arrange();
    assert.deepEqual(await takeNext(), ["- #1 Issue 1 — ▶1 wait on it", "- #3 Issue 3"]);
    await assignToViewer({ store }, tracker, project, "#3");
    assert.deepEqual(await takeNext(), ["- #1 Issue 1 — ▶1 wait on it", "- #3 Issue 3 — yours"]);
  });

  test("the Issue is read again first: one someone took since the Map read it isn't written to", async () => {
    const { tracker, writes, held, store } = await arrange();
    held[2]!.assignees = ["fixture-dev"];
    const shown = await assignToViewer({ store }, tracker, project, "#3");
    assert.deepEqual(writes, []);
    assert.equal(shown.text.split("\n")[0], "Not assigned: GitHub says #3 is assigned to fixture-dev now.");
    assert.match(shown.text, /^Not Blocked · assigned to fixture-dev$/m);
  });

  test("one already yours is left as it is", async () => {
    const { tracker, writes, held, store } = await arrange();
    held[2]!.assignees = ["fixture-viewer"];
    const shown = await assignToViewer({ store }, tracker, project, "#3");
    assert.deepEqual(writes, []);
    assert.equal(shown.text.split("\n")[0], "#3 is already assigned to you.");
  });

  test("nothing is written on a Best effort Project, or where this login can't write, and it says why", async () => {
    const bestEffort = await arrange({ untested: "GHES 3.17.4 is older than 3.18, the oldest release GitHub still supports" });
    const shown = await assignToViewer({ store: bestEffort.store }, bestEffort.tracker, project, "#3");
    assert.deepEqual(bestEffort.writes, []);
    assert.equal(shown.text.split("\n")[0], "Not assigned: Best effort: GHES 3.17.4 is older than 3.18, the oldest release GitHub still supports — the Map writes nothing here.");

    const reader = await arrange({ capabilities: { kind: "capabilities", ...READS_EVERYTHING, write: { kind: "cant", reason: "this login can only read fixture-org/tools; writing a Link or assigning takes the triage role" } } });
    const refused = await assignToViewer({ store: reader.store }, reader.tracker, project, "#3");
    assert.deepEqual(reader.writes, []);
    assert.equal(refused.text.split("\n")[0], "Not assigned: this login can only read fixture-org/tools; writing a Link or assigning takes the triage role.");
  });

  test("a login that can't be known to write is let try, and stops at the first refusal with the Tracker's reason, changing nothing", async () => {
    const refuse: AssignAnswer = { kind: "not-allowed", reason: "github.com refused to let this login assign fixture-org/tools#3: Resource not accessible by personal access token" };
    const { tracker, writes, store, takeNext } = await arrange({ capabilities: { kind: "capabilities", ...READS_EVERYTHING, write: CANT_TELL }, refuse });
    const shown = await assignToViewer({ store }, tracker, project, "#3");
    assert.deepEqual(writes, ["fixture-org/tools#3"], "one write, not retried");
    assert.equal(shown.text.split("\n")[0], `Not assigned: GitHub refused the write — ${refuse.reason}.`);
    assert.deepEqual(await takeNext(), ["- #1 Issue 1 — ▶1 wait on it", "- #3 Issue 3"]);
  });

  test("an Issue that can't be read isn't written to, and it says why", async () => {
    const { tracker, writes, store } = await arrange();
    const shown = await assignToViewer({ store }, tracker, project, "#99");
    assert.deepEqual(writes, []);
    assert.equal(shown.text, "Not assigned: no Issue fixture-org/tools#99 on github.com that this login can read.");
    assert.equal(shown.opened, false);
  });
});
