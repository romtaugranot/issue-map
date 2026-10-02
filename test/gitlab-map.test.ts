/**
 * A GitLab Project's Map, read through the GitLab adapter (with `glab`
 * stood in for) and drawn: nothing above the Tracker seam knows it's
 * GitLab. A GitLab group's epic joins the Issues it parents as an Outside Issue,
 * and Related Links are grouped per ADR 0008.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { drawCard } from "../src/map/card.ts";
import { draw } from "../src/map/draw.ts";
import { SNAPSHOT_FORMAT, type Snapshot } from "../src/snapshot/snapshot.ts";
import type { IssueAnswer, IssuePage, OpenIssue, ProjectResolution, Unread } from "../src/tracker/tracker.ts";
import type { World } from "./contract/tracker-contract.ts";
import { arrange } from "./fakes/fake-glab.ts";
import { READS_EVERYTHING } from "./fakes/fake-trackers.ts";

const tools = "fixture-org/tools";

/** Every page of the Project, read as a first read takes them, into a Snapshot. */
async function snapshotOf(world: World): Promise<Snapshot> {
  const tracker = (await arrange(world).kind.recognise("gitlab.com"))!;
  const resolved = (await tracker.resolveProject(tools)) as Extract<ProjectResolution, { kind: "project" }>;
  const issues: OpenIssue[] = [];
  let unread: Unread = {};
  let after: string | null = null;
  do {
    const page = (await tracker.openIssues(resolved.project, after)) as Extract<IssuePage, { kind: "page" }>;
    assert.equal(page.kind, "page");
    issues.push(...page.issues);
    unread = { ...unread, ...page.unread };
    after = page.next;
  } while (after !== null);
  const at = "2026-09-24T00:00:00Z";
  const { id, path, url } = resolved.project;
  return { format: SNAPSHOT_FORMAT, tracker: "gitlab.com", project: { id, path, url }, login: "fixture-viewer", readAt: at, fullReadAt: at, changesSince: at, caughtUp: true, issues, unread, support: { untested: null, links: READS_EVERYTHING.links } };
}

const world: World = {
  projects: [
    { path: tools, number: 1, open: 7, issues: [1, 2, 3, 4, 5, 6, 7].map((number) => ({ number, title: `Issue ${number}` })) },
    { path: "fixture-org", number: 2, open: 1, namespace: true, issues: [{ number: 12, title: "Q3 importer epic" }] },
  ],
  links: [
    ["fixture-org#12", "parent", `${tools}#1`],
    ["fixture-org#12", "parent", `${tools}#2`],
    [`${tools}#3`, "blocks", `${tools}#4`],
    // Joins nothing: both ends already sit in a Group by a Parent or Blocks Link.
    [`${tools}#4`, "related", `${tools}#1`],
    // Groups the two, which have no Parent or Blocks Link.
    [`${tools}#5`, "related", `${tools}#6`],
  ],
};

/** The lines of one section of a drawing, its heading first. */
function section(text: string, heading: string): string[] {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.startsWith(heading));
  const end = lines.indexOf("", start);
  return lines.slice(start, end === -1 ? undefined : end);
}

test("a GitLab group's epic joins the Issues it parents into one Group, drawn as an Outside Issue; Related joins only Issues with no Parent or Blocks Link", async () => {
  const snapshot = await snapshotOf(world);
  const overview = draw(snapshot, { kind: "overview" }).text;
  assert.deepEqual(section(overview, "**Groups"), [
    "**Groups: 3** — largest first",
    "- ↗fixture-org#12 Q3 importer epic — 2 Issues, 2 Unblocked, 1↗ Outside",
    "- #3 Issue 3 — 2 Issues, 1 Unblocked",
    "- #5 Issue 5 — 2 Issues, 2 Unblocked",
  ]);
  assert.match(overview, /^\*\*Unlinked: 1\*\*/m);
  const epic = draw(snapshot, { kind: "group", group: 1, page: 1 }).text;
  assert.match(epic, /#1 Issue 1/);
  assert.match(epic, /#2 Issue 2/);
  assert.doesNotMatch(epic, /#4 /, "the Related Link from #4 joins nothing");
});

test("the epic's card offers what it holds on the Map, not a Map of its group, and its choice opens the level beneath it", async () => {
  const snapshot = await snapshotOf(world);
  const tracker = (await arrange(world).kind.recognise("gitlab.com"))!;
  const read = (await tracker.issue("fixture-org#12")) as Extract<IssueAnswer, { kind: "issue" }>;
  const card = drawCard(read.issue, tools);
  assert.equal(card.move, undefined);
  assert.equal(card.under?.label, "Show what it holds here");
  const beneath = draw(snapshot, { kind: "under", ref: card.under!.ref, page: 1 }).text;
  assert.match(beneath, /^- #1 Issue 1/m);
  assert.match(beneath, /^- #2 Issue 2/m);
});

test("Take next orders by an Issue's own due date where it has one, and by its milestone's where it has none", async () => {
  const snapshot = await snapshotOf({
    projects: [
      {
        path: tools,
        number: 1,
        open: 4,
        issues: [{ number: 1 }, { number: 2, due: "2026-10-15T00:00:00Z", planned: "2026-12-01T00:00:00Z" }, { number: 3, due: "2026-11-01T00:00:00Z" }, { number: 4, planned: "2026-10-20T00:00:00Z" }],
      },
    ],
    links: [
      [`${tools}#1`, "related", `${tools}#2`],
      [`${tools}#3`, "related", `${tools}#4`],
    ],
  });
  assert.deepEqual(section(draw(snapshot, { kind: "overview" }).text, "**Take next").slice(1), [
    "- #2 Issue 2 — due 2026-10-15",
    "- #4 Issue 4 — due 2026-10-20",
    "- #3 Issue 3 — due 2026-11-01",
    "- #1 Issue 1",
  ]);
});
