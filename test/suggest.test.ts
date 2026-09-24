/**
 * Link Suggestions: `suggest` reads the Issues on screen for Claude to
 * propose from, `offer` checks each proposal live and offers the ones that
 * hold up in one multi-select, and `confirm` writes the ticked ones and
 * remembers the rest as declined. The store is real; the Tracker is an
 * in-memory one whose Links the writes change.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { confirm, offer, suggest, type Declines, type Pending, type PendingSuggestions, type Proposal } from "../src/map/suggest.ts";
import { showMap } from "../src/map/show.ts";
import { snapshotStore, type SnapshotKey } from "../src/snapshot/store.ts";
import type { CapabilitiesAnswer, FarEnd, IssueRead, LinkAnswer, LinkKind, NamedLink, OpenIssue, Project, Thread, Tracker } from "../src/tracker/tracker.ts";
import { READS_EVERYTHING } from "./fakes/fake-trackers.ts";

const project: Project = { id: "gitlab.com#1", host: "gitlab.com", path: "fixture-org/tools", url: "https://gitlab.com/fixture-org/tools", issues: { open: 11 } };
const key: SnapshotKey = { tracker: "gitlab.com", project: project.id, login: "fixture-viewer" };
const full = (n: number) => `${project.path}#${n}`;

interface Held {
  n: number;
  title: string;
  open: boolean;
  closedAs?: string;
  duplicateOf?: number;
  body: string;
  comments?: { author: string; at: string; body: string }[];
  mentionedBy?: number[];
}

/**
 * #1 Blocks #2; #3 is the Parent of #4; #11, closed as a duplicate of #12,
 * Blocks #10. #6 names #1 in its text. The rest are Unlinked.
 */
function world(): { held: Held[]; links: [number, LinkKind, number][] } {
  return {
    held: [
      { n: 1, title: "Import state from S3", open: true, body: "State lives in S3.\n\nNeeds the credentials work in #6 first.", mentionedBy: [6] },
      { n: 2, title: "Add S3 retries", open: true, body: "Retry on 503." },
      { n: 3, title: "Importer epic", open: true, body: "Every importer." },
      { n: 4, title: "Read state over HTTP", open: true, body: "Part of the importer work.", comments: [{ author: "fixture-dev", at: "2026-02-01T10:00:00Z", body: "This also depends on #7." }] },
      { n: 5, title: "Lock files", open: true, body: "Unrelated." },
      { n: 6, title: "Credentials helper", open: true, body: "#1 can't start until this lands." },
      { n: 7, title: "HTTP client", open: true, body: "A client." },
      { n: 8, title: "Docs", open: true, body: "Write docs." },
      { n: 9, title: "Rewrite importer", open: true, body: "Everything again." },
      { n: 10, title: "Import from GCS", open: true, body: "Like S3." },
      { n: 11, title: "GCS auth", open: false, closedAs: "duplicate", duplicateOf: 12, body: "Old." },
      { n: 12, title: "Cloud auth", open: true, body: "One auth for every cloud." },
    ],
    links: [[1, "blocks", 2], [3, "parent", 4], [11, "blocks", 10]],
  };
}

interface Options {
  capabilities?: CapabilitiesAnswer;
  /** What a write answers instead of linking. */
  refuse?: LinkAnswer;
}

/** A Tracker holding `world()`, whose writes change its Links, noting every read of a thread and every write. */
function liveTracker(options: Options = {}) {
  const { held, links } = world();
  const threads: string[] = [];
  const writes: string[] = [];
  const find = (locator: string) => held.find((h) => full(h.n) === locator);
  const end = (h: Held): FarEnd => ({
    id: `I_${h.n}`,
    readable: true,
    open: h.open,
    project: project.path,
    ref: full(h.n),
    title: h.title,
    url: `${project.url}/-/issues/${h.n}`,
    ...(h.open ? {} : { closedAt: "2026-09-20T00:00:00Z", ...(h.closedAs ? { closedAs: h.closedAs } : {}) }),
    ...(h.duplicateOf ? { duplicateOf: full(h.duplicateOf) } : {}),
  });
  const linksOf = (n: number): NamedLink[] =>
    links.flatMap(([a, kind, b]): NamedLink[] => {
      const other = (m: number) => end(held.find((h) => h.n === m)!);
      if (a === n) return [{ role: kind === "blocks" ? "blocked" : kind === "parent" ? "child" : "related", name: kind, to: other(b) }];
      if (b === n) return [{ role: kind === "blocks" ? "blocker" : kind === "parent" ? "parent" : "related", name: kind, to: other(a) }];
      return [];
    });
  const read = (h: Held): IssueRead => ({
    id: `I_${h.n}`,
    project: project.path,
    ref: full(h.n),
    title: h.title,
    url: `${project.url}/-/issues/${h.n}`,
    open: h.open,
    assignees: [],
    closedAs: h.closedAs ?? null,
    links: linksOf(h.n),
    closingRequests: [],
    mentionedBy: (h.mentionedBy ?? []).map((m) => ({ id: `I_${m}`, ref: full(m) })),
    unread: {},
  });
  const openIssue = (h: Held): OpenIssue => ({
    id: `I_${h.n}`,
    ref: `#${h.n}`,
    title: h.title,
    url: `${project.url}/-/issues/${h.n}`,
    createdAt: new Date(Date.UTC(2026, 0, h.n)).toISOString(),
    assignees: [],
    planned: null,
    taskLevel: false,
    links: linksOf(h.n).map(({ role, to }) => ({ role, to })),
    closingRequests: [],
  });
  const tracker: Tracker = {
    product: "GitLab",
    host: "gitlab.com",
    version: null,
    untested: null,
    capabilities: async () => options.capabilities ?? { kind: "capabilities", ...READS_EVERYTHING },
    resolveProject: async () => ({ kind: "cant-tell", reason: "unused" }),
    changes: async () => ({ kind: "changes", open: [], ends: [], requests: [], caughtUp: true, unread: {} }),
    viewer: async () => ({ kind: "viewer", login: key.login }),
    openIssues: async () => {
      const open = held.filter((h) => h.open);
      return { kind: "page", issues: open.map(openIssue), total: open.length, next: null, unread: {} };
    },
    async issue(locator) {
      const found = find(locator);
      return found ? { kind: "issue", issue: read(found) } : { kind: "not-found", reason: `no Issue ${locator} on gitlab.com that this login can read` };
    },
    async thread(locator) {
      threads.push(locator);
      const found = find(locator);
      if (!found) return { kind: "not-found", reason: `no Issue ${locator} on gitlab.com that this login can read` };
      const thread: Thread = { ref: full(found.n), title: found.title, url: `${project.url}/-/issues/${found.n}`, open: found.open, body: found.body, comments: found.comments ?? [], earlier: false };
      return { kind: "thread", thread };
    },
    assign: async () => ({ kind: "cant-tell", reason: "unused" }),
    async link(from, kind, to) {
      writes.push(`${from} ${kind} ${to}`);
      if (options.refuse) return options.refuse;
      const [a, b] = [find(from), find(to)];
      if (!a || !b) return { kind: "not-found", reason: `no Issue ${a ? to : from}` };
      links.push([a.n, kind, b.n]);
      return { kind: "linked" };
    },
  };
  return { tracker, threads, writes, held, links };
}

/** Pending Link Suggestions and declines, kept in memory. */
function memory() {
  let pending: PendingSuggestions | null = null;
  const declined = new Map<string, string[]>();
  const at = (k: SnapshotKey) => `${k.tracker} ${k.project} ${k.login}`;
  const kept: Pending = { get: async () => pending, set: async (p) => void (pending = p) };
  const declines: Declines = { get: async (k) => declined.get(at(k)) ?? [], add: async (k, more) => void declined.set(at(k), [...(declined.get(at(k)) ?? []), ...more]) };
  return { pending: kept, declines };
}

async function arrange(options: Options = {}) {
  const store = snapshotStore(mkdtempSync(join(tmpdir(), "issue-map-suggest-")), { now: () => Date.parse("2026-09-24T10:00:00Z") });
  const live = liveTracker(options);
  assert.deepEqual(await store.read(key, live.tracker, project), { kind: "done" });
  const deps = { store, ...memory() };
  const overview = async () => (await showMap({ store, startRead: () => {}, sleep: async () => {}, startRefresher: async () => {} }, live.tracker, project, { kind: "overview" })).text;
  return { ...live, deps, overview };
}

/** A proposal as Claude pipes it to `offer`. */
function proposal(from: string, kind: LinkKind, to: string, quote: string, source: string): Proposal {
  return { from, kind, to, quote, source };
}

const CREDENTIALS = proposal("#6", "blocks", "#1", "Needs the credentials work in #6 first.", "#1");

describe("suggest reads only the page on screen", () => {
  test("on the overview, the Issues it draws, with their text, and what the Issues that mention them say of them", async () => {
    const { tracker, threads, deps } = await arrange();
    const text = await suggest(deps, tracker, project, { kind: "overview" });
    assert.deepEqual([...threads].sort(), [full(1), full(10), full(3), full(4), full(6)].sort(), "#1, #3, #4 and #10 are on screen; #6 names #1");
    assert.match(text, /^\*\*#1 Import state from S3\*\*/m);
    assert.match(text, /Needs the credentials work in #6 first\./);
    assert.match(text, /fixture-dev on 2026-02-01:\nThis also depends on #7\./);
    assert.match(text, /#6 mentions it: "#1 can't start until this lands\."/);
    assert.doesNotMatch(text, /Retry on 503|Write docs/, "Issues off screen aren't read");
  });

  test("on the Unlinked list, the Issues on that page", async () => {
    const { tracker, threads, deps } = await arrange();
    await suggest(deps, tracker, project, { kind: "unlinked", page: 1 });
    assert.deepEqual([...threads].sort(), [5, 6, 7, 8, 9, 10, 12].map(full).sort());
  });

  test("on a card, only its Issue", async () => {
    const { tracker, threads, deps } = await arrange();
    await suggest(deps, tracker, project, { kind: "card", ref: "#9", page: 1 });
    assert.deepEqual(threads, [full(9)]);
  });

  test("says which kinds the Project records, the only ones to suggest", async () => {
    const { tracker, deps } = await arrange({ capabilities: { kind: "capabilities", links: { ...READS_EVERYTHING.links, related: { kind: "cant-record", reason: "GitHub records no Related Links" } }, write: { kind: "can" } } });
    const text = await suggest(deps, tracker, project, { kind: "card", ref: "#9", page: 1 });
    assert.match(text, /^Kinds to suggest: Blocks, Parent — the only ones this Project records\. Related: GitHub records no Related Links\.$/m);
  });
});

describe("offer checks each proposal and offers the ones that hold up", () => {
  test("a proposal whose quote is in its source's text is offered, quoting where it came from", async () => {
    const { tracker, deps } = await arrange();
    await suggest(deps, tracker, project, { kind: "overview" });
    const offered = await offer(deps, tracker, project, [CREDENTIALS]);
    assert.match(offered.text, /^1\. #6 Blocks #1 — "Needs the credentials work in #6 first\." \(#1's body\)$/m);
    assert.deepEqual(offered.confirm?.choices[0], { label: "#6 Blocks #1", description: `"Needs the credentials work in #6 first." — #1's body` });
  });

  test("a blocker closed as a duplicate gives a suggested Link to the open duplicate, found by the Map itself", async () => {
    const { tracker, deps } = await arrange();
    const text = await suggest(deps, tracker, project, { kind: "overview" });
    assert.match(text, /^- #12 Blocks #10 — #11, which Blocks #10, closed as a duplicate of #12$/m);
    const offered = await offer(deps, tracker, project, []);
    assert.match(offered.text, /^1\. #12 Blocks #10 — #11, which Blocks #10, closed as a duplicate of #12 \(found by the Map\)$/m);
  });

  test("a proposal that doesn't hold up isn't offered, and says why", async () => {
    const { tracker, deps } = await arrange({ capabilities: { kind: "capabilities", links: { ...READS_EVERYTHING.links, related: { kind: "cant-record", reason: "GitHub records no Related Links" } }, write: { kind: "can" } } });
    await suggest(deps, tracker, project, { kind: "overview" });
    const offered = await offer(deps, tracker, project, [
      proposal("#6", "blocks", "#1", "Blocked by #6.", "#1"),
      proposal("#4", "related", "#7", "This also depends on #7.", "#4"),
      proposal("#9", "parent", "#4", "Part of the importer work.", "#4"),
      proposal("#1", "blocks", "#2", "State lives in S3.", "#1"),
      proposal("#7", "blocks", "#8", "A client.", "#7"),
      proposal("#1", "blocks", "#11", "State lives in S3.", "#1"),
      proposal("#4", "blocks", "#1", "STATE LIVES IN S3.", "#1"),
      proposal("#7", "blocks", "#1", "A client.", "#7"),
    ]);
    const why = offered.text.slice(offered.text.indexOf("Not offered"));
    assert.match(why, /^- #6 Blocks #1 — the quote isn't in #1's text$/m);
    assert.match(why, /^- #4 Related to #7 — Related Links can't be recorded here: GitHub records no Related Links$/m);
    assert.match(why, /^- #9 Parent of #4 — #4 already has a Parent, #3, and a Link Suggestion never moves an Issue from its Parent$/m);
    assert.match(why, /^- #1 Blocks #2 — already recorded$/m);
    assert.match(why, /^- #7 Blocks #8 — neither Issue is on screen$/m);
    assert.match(why, /^- #1 Blocks #11 — #11 is closed$/m);
    assert.match(why, /^- #4 Blocks #1 — the quote isn't in #1's text$/m, "quoted as written, not in other words or case");
    assert.match(why, /^- #7 Blocks #1 — it quotes #7, whose text `suggest` didn't read$/m);
    assert.deepEqual(offered.confirm?.choices.map((c) => c.label), ["#12 Blocks #10"]);
  });

  test("offers nothing before suggest has read a page", async () => {
    const { tracker, deps } = await arrange();
    const offered = await offer(deps, tracker, project, [CREDENTIALS]);
    assert.equal(offered.confirm, undefined);
    assert.match(offered.text, /`issue-map suggest` first/);
  });

  test("a login that can't write sees the list and is offered no write", async () => {
    const { tracker, deps, writes } = await arrange({ capabilities: { kind: "capabilities", ...READS_EVERYTHING, write: { kind: "cant", reason: "this login can only read fixture-org/tools" } } });
    await suggest(deps, tracker, project, { kind: "overview" });
    const offered = await offer(deps, tracker, project, [CREDENTIALS]);
    assert.match(offered.text, /^1\. #6 Blocks #1/m);
    assert.match(offered.text, /^Not offered to write: this login can only read fixture-org\/tools\.$/m);
    assert.equal(offered.confirm, undefined);
    assert.match(await confirm(deps, tracker, project, [1]), /^Nothing written: this login can only read fixture-org\/tools\.$/m);
    assert.deepEqual(writes, []);
  });
});

describe("confirm writes the ticked suggestions and remembers the rest as declined", () => {
  test("a confirmed suggestion is written to the Tracker, and only then drawn on the Map", async () => {
    const { tracker, deps, writes, overview } = await arrange();
    const before = await overview();
    await suggest(deps, tracker, project, { kind: "overview" });
    await offer(deps, tracker, project, [CREDENTIALS]);
    assert.equal(await overview(), before, "an offered suggestion isn't drawn");
    const said = await confirm(deps, tracker, project, [1]);
    assert.deepEqual(writes, [`${full(6)} blocks ${full(1)}`]);
    assert.match(said, /^Wrote #6 Blocks #1 to GitLab\.$/m);
    assert.match(await overview(), /^- #6 Credentials helper — ▶2 wait on it$/m);
  });

  test("one left unticked is declined, and isn't offered again", async () => {
    const { tracker, deps, writes } = await arrange();
    await suggest(deps, tracker, project, { kind: "overview" });
    assert.equal((await offer(deps, tracker, project, [CREDENTIALS])).confirm?.choices.length, 2);
    assert.match(await confirm(deps, tracker, project, [2]), /^Declined 1: #6 Blocks #1 won't be suggested again\.$/m);
    assert.deepEqual(writes, [`${full(12)} blocks ${full(10)}`]);
    await suggest(deps, tracker, project, { kind: "overview" });
    const again = await offer(deps, tracker, project, [CREDENTIALS]);
    assert.equal(again.confirm, undefined);
    assert.match(again.text, /^1 declined before, not offered again\.$/m);
  });

  test("one the Map found and that was declined isn't listed by suggest again", async () => {
    const { tracker, deps } = await arrange();
    await suggest(deps, tracker, project, { kind: "overview" });
    await offer(deps, tracker, project, []);
    await confirm(deps, tracker, project, []);
    assert.doesNotMatch(await suggest(deps, tracker, project, { kind: "overview" }), /Found by the Map/);
  });

  test("once some are confirmed, what's left on the page can be offered again", async () => {
    const { tracker, deps } = await arrange();
    await suggest(deps, tracker, project, { kind: "overview" });
    await offer(deps, tracker, project, []);
    await confirm(deps, tracker, project, [1]);
    const again = await offer(deps, tracker, project, [CREDENTIALS]);
    assert.deepEqual(again.confirm?.choices.map((c) => c.label), ["#6 Blocks #1"]);
  });

  test("each suggestion is read again before it's written: one recorded since isn't written twice", async () => {
    const { tracker, deps, writes, links } = await arrange();
    await suggest(deps, tracker, project, { kind: "overview" });
    await offer(deps, tracker, project, [CREDENTIALS]);
    links.push([6, "blocks", 1]);
    assert.match(await confirm(deps, tracker, project, [1, 2]), /^#6 Blocks #1 is already recorded\.$/m);
    assert.deepEqual(writes, [`${full(12)} blocks ${full(10)}`]);
  });

  test("the Tracker's refusal stops the writes, and says why", async () => {
    const refuse: LinkAnswer = { kind: "not-allowed", reason: "GitLab refused to let this login link fixture-org/tools#6 to fixture-org/tools#1" };
    const { tracker, deps, writes } = await arrange({ refuse });
    await suggest(deps, tracker, project, { kind: "overview" });
    await offer(deps, tracker, project, [CREDENTIALS]);
    const said = await confirm(deps, tracker, project, [1, 2]);
    assert.equal(writes.length, 1, "stops at the first refusal");
    assert.match(said, new RegExp(`^Not written: #6 Blocks #1 — GitLab refused the write — ${refuse.reason}\\.$`, "m"));
    assert.match(said, /^Not tried: #12 Blocks #10\.$/m);
  });
});
