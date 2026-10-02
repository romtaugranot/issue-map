/**
 * The README's examples are the drawn output (#52): a Snapshot built from
 * the github Fixture's declared Issues and Links, read two days after its
 * blockers closed, drawn as the overview, the first Group's outline, #2's
 * card and the status line's row, each equal to the README's block.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { draw } from "../src/map/draw.ts";
import { showCard } from "../src/map/show.ts";
import { statusRow } from "../src/map/status.ts";
import { SNAPSHOT_FORMAT, type Snapshot } from "../src/snapshot/snapshot.ts";
import type { FarEnd, IssueRead, Link, OpenIssue } from "../src/tracker/tracker.ts";
import { fakeTrackers, READS_EVERYTHING } from "./fakes/fake-trackers.ts";
import { FIXTURES, title } from "./live/fixtures.ts";

const READ_AT = "2026-09-23T00:00:00Z";
const CLOSED_AT = "2026-09-21T00:00:00Z";
const { projects, links } = FIXTURES.github;
const home = projects[0]!;
/** GitHub's names for each kind of Link, as seen from the Issue it's read on. */
const NAMES = { blocker: "Blocked by", blocked: "Blocking", parent: "Parent issue", child: "Sub-issues", related: "Related" } as const;

/** Each declared Issue's far end, numbered in its Project in the order declared. */
const ends = new Map<string, FarEnd>(
  projects.flatMap(({ path, issues }) =>
    issues.map((issue, i): [string, FarEnd] => {
      const closed = typeof issue.closed === "object" ? "duplicate" : issue.closed;
      const end: FarEnd = { id: `${path}#${i + 1}`, readable: true, open: !closed, project: path, ref: `${path}#${i + 1}`, title: title(issue), url: `https://github.com/${path}/issues/${i + 1}` };
      return [issue.key, closed ? { ...end, closedAt: CLOSED_AT, closedAs: closed } : end];
    }),
  ),
);

/** The Links each declared Issue has, by key. */
function linksOf(key: string): Link[] {
  return links.flatMap(([a, kind, b]): Link[] => {
    const [near, far] = kind === "blocks" ? (["blocked", "blocker"] as const) : kind === "parent" ? (["child", "parent"] as const) : (["related", "related"] as const);
    if (a === key) return [{ role: near, to: ends.get(b)! }];
    if (b === key) return [{ role: far, to: ends.get(a)! }];
    return [];
  });
}

const issues: OpenIssue[] = home.issues.flatMap((issue, i) => {
  const end = ends.get(issue.key)!;
  if (!end.readable || !end.open) return [];
  return [
    {
      id: end.id,
      ref: `#${i + 1}`,
      title: end.title,
      url: end.url,
      createdAt: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
      assignees: [],
      planned: null,
      taskLevel: false,
      links: linksOf(issue.key),
      closingRequests: issue.closingRequest ? [{ ref: `${home.path}#${100 + i}`, url: `https://github.com/${home.path}/pull/${100 + i}`, draft: false, author: "fixture-dev" }] : [],
    },
  ];
});

const snapshot: Snapshot = {
  format: SNAPSHOT_FORMAT,
  tracker: "github.com",
  project: { id: "github.com#1", path: home.path, url: `https://github.com/${home.path}` },
  login: "fixture-viewer",
  readAt: READ_AT,
  fullReadAt: READ_AT,
  changesSince: READ_AT,
  caughtUp: true,
  issues,
  unread: {},
  support: { untested: null, links: READS_EVERYTHING.links },
};

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
/** The README's blockquotes, in order, less their `> `. */
const quoted = readme.split(/\n{2,}/).filter((block) => block.startsWith(">")).map((block) => block.replace(/^> ?/gm, "").trimEnd());

test("the README's overview is the one drawn", () => {
  assert.equal(quoted[0], draw(snapshot, { kind: "overview" }).text);
});

test("the README's outline is the first Group's, as drawn", () => {
  assert.equal(quoted[1], draw(snapshot, { kind: "group", group: 1, page: 1 }).text);
});

test("the README's card is #2's, as drawn", async () => {
  const two = issues[1]!;
  const read: IssueRead = { id: two.id, project: home.path, ref: `${home.path}#2`, title: two.title, url: two.url, open: true, assignees: [], closedAs: null, links: two.links.map((link) => ({ ...link, name: NAMES[link.role] })), closingRequests: [], mentionedBy: [], unread: {} };
  const found = await fakeTrackers({ "github.com": { product: "GitHub", issues: [read], viewer: "fixture-viewer" } }).at("github.com");
  assert.equal(found.kind, "identified");
  const project = { id: "github.com#1", host: "github.com", path: home.path, url: `https://github.com/${home.path}`, issues: { open: issues.length } };
  assert.equal(quoted[2], (await showCard((found as Extract<typeof found, { kind: "identified" }>).tracker, project, "#2")).text);
});

test("the README's status line row is the one worked out", () => {
  const row = /```text\n(◆ .*)\n```/.exec(readme)?.[1];
  assert.equal(row, statusRow(snapshot));
});
