/**
 * Seam A: the drawing module, `(Snapshot, command) → text`, with no network
 * and no clock. Hand-written Snapshots cover the rules' edges.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { draw, drawProgress } from "../src/map/draw.ts";
import { snapshot, VIEWER, type IssueSpec, type LinkSpec } from "./fakes/snapshot-builder.ts";
import { READS_EVERYTHING } from "./fakes/fake-trackers.ts";

const overview = (s: ReturnType<typeof snapshot>) => draw(s, { kind: "overview" }).text;

describe("the overview", () => {
  test("draws Take next, then a Group line naming its top Issue and how many Issues it holds, then the Unlinked count", () => {
    const s = snapshot([{ n: 1, title: "Plan the importer" }, { n: 2 }, { n: 3 }], [[1, "blocks", 2]]);
    assert.equal(
      overview(s),
      [
        "**fixture-org/tools** · 3 open · 2 on the Map · 1 Unlinked · Promised",
        "",
        "**Take next: 1** — most waited on first",
        "- #1 Plan the importer — ▶1 wait on it",
        "",
        "**Groups: 1** — largest first",
        "- #1 Plan the importer — 2 Issues, 1 Unblocked",
        "",
        "**Unlinked: 1** — no Link to another open Issue. Ask to list them.",
      ].join("\n"),
    );
  });

  test("lists 8 Group lines largest first and holds the rest in a count", () => {
    // Ten Groups: #10 heads 10 Issues, #20 heads 9, … #100 heads 1 plus an Outside Issue.
    const issues = [];
    const links: LinkSpec[] = [];
    for (let size = 10; size >= 1; size--) {
      const head = (11 - size) * 10;
      issues.push({ n: head });
      for (let i = 1; i < size; i++) {
        issues.push({ n: head + i });
        links.push([head, "parent", head + i]);
      }
    }
    links.push([{ outside: "fixture-org/plans#7" }, "parent", 100]);
    assert.deepEqual(groupLines(overview(snapshot(issues, links))), [
      "**Groups: 10** — largest first",
      "- #10 Issue 10 — 10 Issues, 9 Unblocked",
      "- #20 Issue 20 — 9 Issues, 8 Unblocked",
      "- #30 Issue 30 — 8 Issues, 7 Unblocked",
      "- #40 Issue 40 — 7 Issues, 6 Unblocked",
      "- #50 Issue 50 — 6 Issues, 5 Unblocked",
      "- #60 Issue 60 — 5 Issues, 4 Unblocked",
      "- #70 Issue 70 — 4 Issues, 3 Unblocked",
      "- #80 Issue 80 — 3 Issues, 2 Unblocked",
      "- … 2 more Groups, 3 Issues. Ask to list them.",
    ]);
  });

  test("away from the Home Project, adds a line naming it and how to return", () => {
    const s = snapshot([{ n: 1 }, { n: 2 }], [[1, "blocks", 2]]);
    const lines = draw(s, { kind: "overview" }, { home: "fixture-org/home" }).text.split("\n");
    assert.deepEqual(lines.slice(0, 3), ["**fixture-org/tools** · 2 open · 2 on the Map · 0 Unlinked · Promised", "⌂ Home: fixture-org/home — `home` to return", ""]);
    assert.doesNotMatch(overview(s), /⌂/, "at home there's no line");
  });

  test("trims a long title to 60 characters", () => {
    const title = "Support reading state from every remote backend at once, in parallel, with retries";
    const s = snapshot([{ n: 1, title }, { n: 2 }], [[1, "blocks", 2]]);
    assert.equal(groupLines(overview(s))[1], "- #1 Support reading state from every remote backend at once, in… — 2 Issues, 1 Unblocked");
  });
});

describe("Take next", () => {
  test("lists the Unblocked Issues above the Group lines, each with how many open Issues wait on it", () => {
    // #1 Blocks #2, which Blocks #3; #4 Blocks #5.
    const s = snapshot([{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }, { n: 5 }], [[1, "blocks", 2], [2, "blocks", 3], [4, "blocks", 5]]);
    assert.deepEqual(overview(s).split("\n").slice(0, 7), [
      "**fixture-org/tools** · 5 open · 5 on the Map · 0 Unlinked · Promised",
      "",
      "**Take next: 2** — most waited on first",
      "- #1 Issue 1 — ▶2 wait on it",
      "- #4 Issue 4 — ▶1 wait on it",
      "",
      "**Groups: 2** — largest first",
    ]);
  });

  test("an Issue that an open Issue in any Project Blocks is Blocked, and waits pass through Outside Issues", () => {
    const other = { outside: "fixture-org/plans#7" };
    // #1 Blocks the Outside Issue, which Blocks #2; another Blocks #3; one this login can't read Blocks #4.
    const s = snapshot(
      [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }, { n: 5 }, { n: 6 }],
      [[1, "blocks", other], [other, "blocks", 2], [{ outside: "fixture-org/plans#8" }, "blocks", 3], [{ hidden: "h1" }, "blocks", 4], [6, "related", 5]],
    );
    assert.deepEqual(takeNext(overview(s)), [
      "**Take next: 3** — most waited on first",
      "- #1 Issue 1 — ▶2 wait on it",
      "- #5 Issue 5",
      "- #6 Issue 6",
    ]);
  });

  test("holds only Issues that are unassigned or the viewer's own, and leaves out any with someone else's open Closing Request", () => {
    const s = snapshot(
      [
        { n: 1 },
        { n: 2, assignees: [VIEWER] },
        { n: 3, assignees: ["fixture-other"] },
        { n: 4, closingRequests: ["fixture-other"] },
        { n: 5, closingRequests: [VIEWER] },
        { n: 6, assignees: [VIEWER], closingRequests: ["fixture-other"] },
        { n: 7, assignees: ["fixture-other", VIEWER] },
      ],
      [[1, "related", 2], [2, "related", 3], [3, "related", 4], [4, "related", 5], [5, "related", 6], [6, "related", 7]],
    );
    assert.deepEqual(takeNext(overview(s)), [
      "**Take next: 4** — most waited on first · 3 taken by others, ask who has them",
      "- #1 Issue 1",
      "- #2 Issue 2 — yours",
      "- #5 Issue 5 — yours",
      "- #7 Issue 7 — yours",
    ]);
  });

  test("says so when every Unblocked Issue is taken by others", () => {
    const s = snapshot([{ n: 1, assignees: ["fixture-other"] }, { n: 2, closingRequests: ["fixture-other"] }], [[1, "related", 2]]);
    assert.deepEqual(takeNext(overview(s)), ["**Take next: 0** — all 2 Unblocked Issues are taken by others, ask who has them"]);
  });

  test("a Parent with open children gives way to its Unblocked children, which carry its count", () => {
    // #1 is the Parent of #2–#4, and #5 and #6 wait on it. #7 Blocks #3; #4 Blocks #8. #20's only child is Task-level.
    const s = snapshot(
      [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }, { n: 5 }, { n: 6 }, { n: 7 }, { n: 8 }, { n: 20 }, { n: 21, taskLevel: true }],
      [[1, "parent", 2], [1, "parent", 3], [1, "parent", 4], [1, "blocks", 5], [5, "blocks", 6], [7, "blocks", 3], [4, "blocks", 8], [20, "parent", 21]],
    );
    assert.deepEqual(takeNext(overview(s)), [
      "**Take next: 4** — most waited on first",
      "- #2 Issue 2 — ▶2 wait on it, via #1",
      "- #4 Issue 4 — ▶2 wait on it, via #1",
      "- #7 Issue 7 — ▶1 wait on it",
      "- #20 Issue 20",
    ]);
  });

  test("a child under several Parents takes the largest count, and a count passes down through a Parent under a Parent", () => {
    // #1 has one waiting on it, #2 has three; #3 sits under both. #4 is under #2 and the Parent of #5.
    const s = snapshot(
      [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }, { n: 5 }, { n: 10 }, { n: 11 }, { n: 12 }, { n: 13 }],
      [[1, "parent", 3], [2, "parent", 3], [2, "parent", 4], [4, "parent", 5], [1, "blocks", 10], [2, "blocks", 11], [2, "blocks", 12], [2, "blocks", 13]],
    );
    assert.deepEqual(takeNext(overview(s)), [
      "**Take next: 2** — most waited on first",
      "- #3 Issue 3 — ▶3 wait on it, via #2",
      "- #5 Issue 5 — ▶3 wait on it, via #4",
    ]);
  });

  test("orders by how many wait on it, then earliest Planned date, then oldest, and shows 5, counting the rest in its heading", () => {
    const s = snapshot(
      [
        { n: 1 },
        { n: 2, planned: "2026-12-01T00:00:00Z" },
        { n: 3, planned: "2026-10-01T00:00:00Z" },
        { n: 4 },
        { n: 5 },
        { n: 6 },
        { n: 7, planned: "2026-11-01T00:00:00Z" },
        { n: 8 },
        { n: 9 },
      ],
      [[1, "blocks", 9], [7, "blocks", 8], [2, "related", 3], [3, "related", 4], [4, "related", 5], [5, "related", 6]],
    );
    const expected = [
      "**Take next: 7** — most waited on first · 2 more not listed, ask to list them",
      "- #7 Issue 7 — ▶1 wait on it · due 2026-11-01",
      "- #1 Issue 1 — ▶1 wait on it",
      "- #3 Issue 3 — due 2026-10-01",
      "- #2 Issue 2 — due 2026-12-01",
      "- #4 Issue 4",
    ];
    assert.deepEqual(takeNext(overview(s)), expected);
    assert.deepEqual(takeNext(overview({ ...s, issues: [...s.issues].reverse() })), expected, "the same whatever order the Issues were read in");
  });

  test("where Blocks Links can't be read, calls nothing Unblocked and says why", () => {
    const s = snapshot([{ n: 1 }, { n: 2 }], [[1, "parent", 2]], { blocks: "GitLab Free doesn't record them" });
    assert.deepEqual(takeNext(overview(s)), [
      "**Take next: none** — the Map can't read this Project's Blocks Links (GitLab Free doesn't record them), so it calls no Issue Unblocked",
    ]);
  });

  test("where Closing Requests can't be read, leaves nothing out as taken and says so", () => {
    const s = snapshot([{ n: 1, assignees: ["fixture-other"] }, { n: 2 }], [[1, "related", 2]], { closingRequests: "this login can't read pull requests" });
    assert.deepEqual(takeNext(overview(s)), [
      "**Take next: 1** — most waited on first · 1 taken by others, ask who has them · Closing Requests unread (this login can't read pull requests), so none leaves an Issue out",
      "- #2 Issue 2",
    ]);
  });

  test("at most 3 children stand in for one Parent, even with nothing waiting on it, and the rest are held in a count", () => {
    const s = snapshot(
      [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }, { n: 5 }, { n: 6 }, { n: 20 }, { n: 21 }],
      [[1, "parent", 2], [1, "parent", 3], [1, "parent", 4], [1, "parent", 5], [1, "parent", 6], [20, "related", 21]],
    );
    assert.deepEqual(takeNext(overview(s)), [
      "**Take next: 7** — most waited on first · 1 more not listed, ask to list them",
      "- #2 Issue 2 — via #1",
      "- #3 Issue 3 — via #1",
      "- #4 Issue 4 — via #1",
      "- … 2 more under #1",
      "- #20 Issue 20",
    ]);
  });

  test("a Parent whose only open children are in other Projects stays in Take next, since none of them can stand in", () => {
    const s = snapshot([{ n: 1 }], [[1, "parent", { outside: "fixture-org/plans#7" }]]);
    assert.deepEqual(takeNext(overview(s)), ["**Take next: 1** — most waited on first", "- #1 Issue 1"]);
  });

  test("says so when nothing on the Map is Unblocked", () => {
    const s = snapshot([{ n: 1 }, { n: 2 }], [[1, "blocks", 2], [2, "blocks", 1]]);
    assert.deepEqual(takeNext(overview(s)), ["**Take next: 0** — every Issue on the Map is Blocked, or a Parent of Blocked Issues"]);
  });

  test("Blocks Links in a cycle count each Issue in it once", () => {
    // #4 Blocks #1, and #1 and #2 Block each other; #5 Blocks #6, and #6, #7 and #8 Block in a circle.
    const s = snapshot(
      [{ n: 1 }, { n: 2 }, { n: 4 }, { n: 5 }, { n: 6 }, { n: 7 }, { n: 8 }],
      [[4, "blocks", 1], [1, "blocks", 2], [2, "blocks", 1], [5, "blocks", 6], [6, "blocks", 7], [7, "blocks", 8], [8, "blocks", 6]],
    );
    const expected = ["**Take next: 2** — most waited on first", "- #5 Issue 5 — ▶3 wait on it", "- #4 Issue 4 — ▶2 wait on it"];
    assert.deepEqual(takeNext(overview(s)), expected);
    assert.deepEqual(takeNext(overview({ ...s, issues: [...s.issues].reverse() })), expected, "the same whatever order the Issues were read in");
  });

  test("Parent Links in a cycle pass a count down to the children under it once", () => {
    // #1 and #2 are each other's Parent; #1 is the Parent of #3, #2 of #4; #9 waits on #1.
    const s = snapshot([{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }, { n: 9 }], [[1, "parent", 2], [2, "parent", 1], [1, "parent", 3], [2, "parent", 4], [1, "blocks", 9]]);
    const expected = ["**Take next: 2** — most waited on first", "- #3 Issue 3 — ▶1 wait on it, via #1", "- #4 Issue 4 — ▶1 wait on it, via #2"];
    assert.deepEqual(takeNext(overview(s)), expected);
    assert.deepEqual(takeNext(overview({ ...s, issues: [...s.issues].reverse() })), expected, "the same whatever order the Issues were read in");
  });
});

describe("Groups (ADR 0008)", () => {
  test("Parent and Blocks Links join a Group directly and through one another, and the top Issue heads it", () => {
    const s = snapshot([{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }], [[3, "blocks", 2], [2, "blocks", 1], [4, "parent", 3]]);
    assert.deepEqual(groupLines(overview(s)), ["**Groups: 1** — largest first", "- #4 Issue 4 — 4 Issues, 1 Unblocked"]);
  });

  test("the Issue with most of the Project's own Issues under it heads the Group; Outside Issues under it don't count", () => {
    // #1 has two Outside children; #2 has one of the Project's own, #3, which Blocks one of #1's.
    const plans = [{ outside: "fixture-org/plans#7" }, { outside: "fixture-org/plans#8" }];
    const s = snapshot([{ n: 1 }, { n: 2 }, { n: 3 }], [[1, "parent", plans[0]!], [1, "parent", plans[1]!], [2, "parent", 3], [3, "blocks", plans[0]!]]);
    assert.deepEqual(groupLines(overview(s)), ["**Groups: 1** — largest first", "- #2 Issue 2 — 3 Issues, 2 Unblocked, 2↗ Outside"]);
  });

  test("a Related Link joins nothing between Issues that have a Parent or Blocks Link", () => {
    const s = snapshot([{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }], [[1, "parent", 2], [3, "parent", 4], [2, "related", 4]]);
    assert.deepEqual(groupLines(overview(s)), [
      "**Groups: 2** — largest first",
      "- #1 Issue 1 — 2 Issues, 1 Unblocked",
      "- #3 Issue 3 — 2 Issues, 1 Unblocked",
    ]);
  });

  test("Issues with no Parent or Blocks Link group among themselves through Related, and stay on the Map", () => {
    const s = snapshot(
      [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }, { n: 5 }, { n: 6 }],
      [[1, "parent", 2], [3, "related", 4], [4, "related", 5], [5, "related", 2]],
    );
    const text = overview(s);
    assert.match(text, /^\*\*fixture-org\/tools\*\* · 6 open · 5 on the Map · 1 Unlinked · Promised$/m);
    assert.deepEqual(groupLines(text), [
      "**Groups: 2** — largest first",
      "- #3 Issue 3 — 3 Issues, 3 Unblocked",
      "- #1 Issue 1 — 2 Issues, 1 Unblocked",
    ]);
  });

  test("a Group line says how many of its Issues are Unblocked, as Take next counts them, and its Outside Issues in words", () => {
    // #1 and #2 Block each other, so all their Group is Blocked. #10 is the Parent of #11 and #12 and gives way to them; #12 is someone else's; #13 waits on #11; an Outside Issue is under #10.
    const s = snapshot(
      [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 10 }, { n: 11 }, { n: 12, assignees: ["fixture-other"] }, { n: 13 }],
      [[1, "blocks", 2], [2, "blocks", 1], [2, "blocks", 3], [10, "parent", 11], [10, "parent", 12], [11, "blocks", 13], [10, "parent", { outside: "fixture-org/plans#7" }]],
    );
    const text = overview(s);
    assert.deepEqual(groupLines(text), [
      "**Groups: 2** — largest first",
      "- #10 Issue 10 — 4 Issues, 2 Unblocked, 1↗ Outside",
      "- #1 Issue 1 — 3 Issues, 0 Unblocked",
    ]);
    assert.equal(takeNext(text)[0], "**Take next: 1** — most waited on first · 1 taken by others, ask who has them", "the 2 Unblocked are Take next's 1 and the 1 taken by others");
  });

  test("where Blocks Links can't be read, a Group line counts nothing Unblocked", () => {
    const s = snapshot([{ n: 1 }, { n: 2 }], [[1, "parent", 2], [1, "parent", { outside: "fixture-org/plans#7" }]], { blocks: "GitLab Free doesn't record them" });
    assert.deepEqual(groupLines(overview(s)), ["**Groups: 1** — largest first", "- #1 Issue 1 — 2 Issues, 1↗ Outside"]);
  });

  test("an Issue whose only Links reach closed Issues is Unlinked", () => {
    const s = snapshot([{ n: 1 }, { n: 2 }], [[{ closed: 9 }, "related", 1], [2, "related", { closed: 8 }]]);
    const text = overview(s);
    assert.match(text, /· 2 open · 0 on the Map · 2 Unlinked · Promised$/m);
    assert.match(text, /^No Issue here has a Link, so there's no Map to draw\.$/m);
  });
});

describe("closed Issues", () => {
  test("an Issue whose only blocker has closed is Unblocked and in Take next, marked with when, though it stays Unlinked", () => {
    const s = snapshot([{ n: 1 }, { n: 2 }], [[{ closed: 9 }, "blocks", 1]]);
    assert.equal(
      overview(s),
      [
        "**fixture-org/tools** · 2 open · 0 on the Map · 2 Unlinked · Promised",
        "",
        "**Take next: 1** — most waited on first",
        "- #1 Issue 1 — unblocked 2d ago",
        "",
        "No Issue here has a Link to another open Issue, so there are no Groups to draw.",
        "",
        "**Unlinked: 2** — no Link to another open Issue. Ask to list them.",
      ].join("\n"),
    );
  });

  test("a blocker closed as a duplicate or as not planned still unblocks, and the line says how it closed; the last to close dates it", () => {
    // #1 and #2 are Related. #1's blockers closed as a duplicate 5 hours before the read, and as completed long before; #2's as not planned.
    const s = snapshot(
      [{ n: 1 }, { n: 2 }, { n: 3 }],
      [
        [1, "related", 2],
        [{ closed: 7, closedAs: "completed", closedAt: "2026-06-01T00:00:00Z" }, "blocks", 1],
        [{ closed: 8, closedAs: "duplicate", closedAt: "2026-09-22T19:00:00Z" }, "blocks", 1],
        [{ closed: 9, closedAs: "not planned", closedAt: "2024-01-01T00:00:00Z" }, "blocks", 2],
      ],
    );
    assert.deepEqual(takeNext(overview(s)), [
      "**Take next: 2** — most waited on first",
      "- #1 Issue 1 — unblocked 5h ago · #8 closed as duplicate",
      "- #2 Issue 2 — unblocked 2y ago · #9 closed as not planned",
    ]);
  });

  test("a blocker that closed on a date the read didn't give is named instead, even beside one it did, since it may have closed last", () => {
    const s = snapshot([{ n: 1 }], [[{ closed: 8 }, "blocks", 1], [{ closed: 9 }, "blocks", 1]]);
    delete (s.issues[0]!.links[1]!.to as { closedAt?: string }).closedAt;
    assert.deepEqual(takeNext(overview(s)), ["**Take next: 1** — most waited on first", "- #1 Issue 1 — unblocked since #9 closed"]);
  });

  test("a closed blocker doesn't unblock an Issue an open one still Blocks", () => {
    const s = snapshot([{ n: 1 }, { n: 2 }], [[{ closed: 9 }, "blocks", 2], [1, "blocks", 2]]);
    assert.deepEqual(takeNext(overview(s)), ["**Take next: 1** — most waited on first", "- #1 Issue 1 — ▶1 wait on it"]);
  });

  test("a wait stops at a closed Issue: what it Blocked is Unblocked, and what Blocked it gets no count for it", () => {
    // #1 Blocks #9, which is closed and Blocks #2.
    const s = snapshot([{ n: 1 }, { n: 2 }, { n: 3 }], [[1, "blocks", { closed: 9 }], [{ closed: 9 }, "blocks", 2], [1, "related", 3]]);
    assert.deepEqual(takeNext(overview(s)), [
      "**Take next: 3** — most waited on first",
      "- #1 Issue 1",
      "- #2 Issue 2 — unblocked 2d ago",
      "- #3 Issue 3",
    ]);
  });

  test("a closed Parent joins nothing: its open children split into Groups of their own, and it is drawn in neither the overview nor an outline", () => {
    // #9 is closed and the Parent of #1 and #2, which are the Parents of #3 and #4.
    const s = snapshot([{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }], [[{ closed: 9 }, "parent", 1], [{ closed: 9 }, "parent", 2], [1, "parent", 3], [2, "parent", 4]]);
    const text = overview(s);
    assert.deepEqual(groupLines(text), ["**Groups: 2** — largest first", "- #1 Issue 1 — 2 Issues, 1 Unblocked", "- #2 Issue 2 — 2 Issues, 1 Unblocked"]);
    for (const drawn of [text, draw(s, { kind: "group", group: 1, page: 1 }).text, draw(s, { kind: "under", ref: "#1", page: 1 }).text]) {
      assert.doesNotMatch(drawn, /#9/);
    }
  });

  test("the marking comes from close dates against when the Snapshot was read, so the same Snapshot always draws the same", () => {
    const s = snapshot([{ n: 1 }], [[{ closed: 9, closedAt: "2026-09-20T00:00:00Z" }, "blocks", 1]]);
    assert.equal(takeNext(overview(s))[1], "- #1 Issue 1 — unblocked 3d ago");
    assert.equal(overview(s), overview(s));
    assert.equal(takeNext(overview({ ...s, readAt: "2026-11-20T00:00:00Z" }))[1], "- #1 Issue 1 — unblocked 2mo ago", "read again later");
  });

  test("the Unlinked list marks an Issue a closed blocker left Unblocked", () => {
    const s = snapshot([{ n: 1 }, { n: 2 }], [[{ closed: 9 }, "blocks", 1]]);
    assert.deepEqual(draw(s, { kind: "unlinked", page: 1 }).text.split("\n").slice(1, 3), ["- #2 Issue 2", "- #1 Issue 1 — unblocked 2d ago"]);
  });
});

describe("Outside Issues (ADR 0005)", () => {
  const plans = { outside: "fixture-org/plans#7", title: "Q3 importer epic" };

  test("two Issues sharing an Outside Issue land in one Group, headed by it", () => {
    const s = snapshot([{ n: 1 }, { n: 2 }, { n: 3 }], [[plans, "parent", 1], [plans, "parent", 2]]);
    assert.deepEqual(groupLines(overview(s)), [
      "**Groups: 1** — largest first",
      "- ↗fixture-org/plans#7 Q3 importer epic — 2 Issues, 2 Unblocked, 1↗ Outside",
    ]);
  });

  test("a closed Outside Issue joins nothing", () => {
    const s = snapshot([{ n: 1 }, { n: 2 }], [[{ ...plans, open: false }, "parent", 1], [{ ...plans, open: false }, "parent", 2]]);
    assert.match(overview(s), /· 0 on the Map · 2 Unlinked · Promised$/m);
  });

  test("an Outside Issue joins Issues that have no Parent or Blocks Link only through Related", () => {
    const s = snapshot(
      [{ n: 1 }, { n: 2 }, { n: 3 }],
      [[plans, "parent", 1], [2, "related", plans], [3, "related", { outside: "fixture-org/plans#8" }]],
    );
    assert.deepEqual(groupLines(overview(s)), [
      "**Groups: 3** — largest first",
      "- ↗fixture-org/plans#7 Q3 importer epic — 1 Issue, 1 Unblocked, 1↗ Outside",
      "- #2 Issue 2 — 1 Issue, 1 Unblocked",
      "- #3 Issue 3 — 1 Issue, 1 Unblocked, 1↗ Outside",
    ]);
  });

  test("an Outside Issue this login can't read is drawn without a name rather than omitted", () => {
    // The Tracker names neither end the same way, so nothing says they're one Issue: each joins nothing.
    const s = snapshot([{ n: 1 }, { n: 2 }, { n: 3 }], [[{ hidden: "h1" }, "parent", 1], [{ hidden: "h2" }, "parent", 2], [3, "blocks", { hidden: "h3" }]]);
    const text = overview(s);
    assert.match(text, /· 3 on the Map · 0 Unlinked · Promised$/m);
    assert.deepEqual(groupLines(text), [
      "**Groups: 3** — largest first",
      "- ↗ an Issue this login can't read — 1 Issue, 1 Unblocked, 1↗ Outside",
      "- ↗ an Issue this login can't read — 1 Issue, 1 Unblocked, 1↗ Outside",
      "- #3 Issue 3 — 1 Issue, 1 Unblocked, 1↗ Outside",
    ]);
  });
});

describe("a Group's outline (ADR 0008)", () => {
  const outline = (s: ReturnType<typeof snapshot>, which: number | string, page = 1) =>
    draw(s, typeof which === "number" ? { kind: "group", group: which, page } : { kind: "under", ref: which, page }).text;

  // #1 is the Parent of #2 and #3, #2 the Parent of #4; #1 Blocks #7, and #6 Blocks #3.
  const tree = snapshot(
    [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }, { n: 5 }, { n: 6 }, { n: 7 }],
    [[1, "parent", 2], [1, "parent", 3], [2, "parent", 4], [1, "blocks", 7], [6, "blocks", 3]],
  );

  test("opening a Group lists what sits at its top, most under it first", () => {
    assert.equal(
      outline(tree, 1),
      [
        "**Group 1 of 1** · #1 Issue 1 — 6 Issues, 2 Unblocked",
        "",
        "**At the top: 2** — most under it first",
        "- #1 Issue 1 — 4 under it · 1 Unblocked",
        "- #6 Issue 6 — 1 under it · 1 Unblocked",
        "",
        "_Name one to open the level below it · `map` for the Map_",
      ].join("\n"),
    );
  });

  test("naming an Issue opens the level beneath it: its children, and the Issues it Blocks", () => {
    assert.equal(
      outline(tree, "#1"),
      [
        "**Group 1 of 1** · #1 Issue 1 — 6 Issues, 2 Unblocked",
        "",
        "**Under #1: 3** — most under it first",
        "- #2 Issue 2 — 1 under it · 1 Unblocked",
        "- #3 Issue 3 — 0 Unblocked",
        "- #7 Issue 7 — Blocked by it · 0 Unblocked",
        "",
        "_Name one to open the level below it · `map` for the Map_",
      ].join("\n"),
    );
    assert.equal(outline(tree, "#2").split("\n")[2], "**Under #2: 1** — oldest first", "a level deeper again, where nothing has anything beneath it");
    assert.equal(outline(tree, "https://github.com/fixture-org/tools/issues/2"), outline(tree, "#2"), "by URL too");
  });

  test("each entry says how many Unblocked Issues it and those beneath it hold, as Take next counts them", () => {
    // In the tree, #1 gives way to its children #2 and #3; #2 gives way to #4. #6 Blocks #3, and #1 Blocks #7. So #4 and #6 are Unblocked.
    const top = outline(tree, 1).split("\n");
    assert.equal(top[0], "**Group 1 of 1** · #1 Issue 1 — 6 Issues, 2 Unblocked");
    assert.deepEqual(top.slice(3, 5), ["- #1 Issue 1 — 4 under it · 1 Unblocked", "- #6 Issue 6 — 1 under it · 1 Unblocked"]);
    assert.deepEqual(outline(tree, "#1").split("\n").slice(3, 6), ["- #2 Issue 2 — 1 under it · 1 Unblocked", "- #3 Issue 3 — 0 Unblocked", "- #7 Issue 7 — Blocked by it · 0 Unblocked"]);
    assert.equal(takeNext(overview(tree))[0], "**Take next: 2** — most waited on first");
    const reaching = snapshot([{ n: 1 }, { n: 2 }], [[1, "parent", 2], [1, "parent", { outside: "fixture-org/plans#7" }]]);
    assert.deepEqual(outline(reaching, "#1").split("\n").slice(3, 5), ["- #2 Issue 2 — 1 Unblocked", "- ↗fixture-org/plans#7 Outside fixture-org/plans#7"], "an Outside Issue with none of the Project's beneath it holds none to count");
    const unread = snapshot([{ n: 1 }, { n: 2 }, { n: 3 }], [[1, "parent", 2], [2, "parent", 3]], { blocks: "GitLab Free doesn't record them" });
    assert.equal(outline(unread, 1).split("\n")[3], "- #2 Issue 2 — 1 under it", "none where Blocks Links can't be read");
  });

  test("an Issue is named by its reference, after the Project's path, or by an Issue or work-item URL of it in the Project", () => {
    const refs = [
      "fixture-org/tools#2",
      "https://github.com/fixture-org/tools/-/work_items/2",
      "https://github.com/fixture-org/tools/-/issues/2/",
      "https://github.com/fixture-org/tools/issues/2#issuecomment-123",
      "https://github.com/fixture-org/tools/issues/2?tab=timeline",
      "https://GitHub.com/Fixture-Org/Tools/issues/2",
    ];
    for (const ref of refs) assert.equal(outline(tree, ref), outline(tree, "#2"), ref);
    const plans = { outside: "fixture-org/plans#7" };
    const s = snapshot([{ n: 1 }, { n: 2 }], [[plans, "parent", 1], [plans, "parent", 2]]);
    assert.equal(outline(s, "↗fixture-org/plans#7"), outline(s, "fixture-org/plans#7"), "with the ↗ the outline prints");
  });

  test("a merge request or milestone URL that shares an Issue's number isn't that Issue", () => {
    for (const ref of ["https://github.com/fixture-org/tools/-/merge_requests/2", "https://github.com/fixture-org/tools/pull/2", "https://github.com/fixture-org/tools/-/milestones/2"]) {
      assert.equal(outline(tree, ref), `No Issue on the Map of fixture-org/tools is ${ref}. \`map\` for the Map.`, ref);
    }
  });

  test("opening a Group by place after a refresh reorders the Groups names a different head than the overview picked", () => {
    // Before: #1 heads 3 Issues, #10 heads 2. A refresh adds two children to #10, so it comes first.
    const before = snapshot([{ n: 1 }, { n: 2 }, { n: 3 }, { n: 10 }, { n: 11 }], [[1, "parent", 2], [1, "parent", 3], [10, "parent", 11]]);
    const after = snapshot([{ n: 1 }, { n: 2 }, { n: 3 }, { n: 10 }, { n: 11 }, { n: 12 }, { n: 13 }], [[1, "parent", 2], [1, "parent", 3], [10, "parent", 11], [10, "parent", 12], [10, "parent", 13]]);
    assert.equal(groupLines(overview(before))[1], "- #1 Issue 1 — 3 Issues, 2 Unblocked", "the overview's first Group, picked by place");
    assert.equal(outline(after, 1).split("\n")[0], "**Group 1 of 2** · #10 Issue 10 — 4 Issues, 3 Unblocked", "its first line names the head the skill checks against");
    assert.equal(groupLines(overview(after))[1], "- #10 Issue 10 — 4 Issues, 3 Unblocked", "a redrawn overview agrees with it");
  });

  test("an Issue with Related Links shows how many on its line, and the Related Issue stays in its own Group", () => {
    // #2 is Related to #4, which is in the Group #3 heads, and to an Outside Issue.
    const s = snapshot([{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }], [[1, "parent", 2], [3, "parent", 4], [2, "related", 4], [2, "related", { outside: "fixture-org/plans#9" }]]);
    assert.deepEqual(outline(s, 1).split("\n").slice(2, 4), ["**Under #1, alone at the top: 1** — oldest first", "- #2 Issue 2 — 1 Unblocked · 2 Related"]);
    assert.equal(outline(s, 2).split("\n")[3], "- #4 Issue 4 — 1 Unblocked · 1 Related");
  });

  test("the overview draws no Related count between Groups", () => {
    const s = snapshot([{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }], [[1, "parent", 2], [3, "parent", 4], [2, "related", 4]]);
    assert.doesNotMatch(overview(s), /Related/);
  });

  test("a Group of Issues joined only by Related lists them all at its top, oldest first, a page of 10 at a time, with nothing beneath to open", () => {
    const issues = Array.from({ length: 12 }, (_, i): IssueSpec => ({ n: i + 1 }));
    const links = issues.slice(1).map(({ n }): LinkSpec => [n - 1, "related", n]);
    const first = outline(snapshot(issues, links), 1).split("\n");
    assert.deepEqual(first.slice(2, 5), ["**At the top: 12** — oldest first · page 1 of 2", "- #1 Issue 1 — 1 Unblocked · 1 Related", "- #2 Issue 2 — 1 Unblocked · 2 Related"]);
    assert.equal(first.length, 15);
    assert.equal(first.at(-1), "_`more` for the next 10 · `map` for the Map_");
    assert.deepEqual(outline(snapshot(issues, links), 1, 2).split("\n").slice(2), [
      "**At the top: 12** — oldest first · page 2 of 2",
      "- #11 Issue 11 — 1 Unblocked · 2 Related",
      "- #12 Issue 12 — 1 Unblocked · 1 Related",
      "",
      "_`map` for the Map_",
    ]);
  });

  test("a Group headed by an Outside Issue names it as one, and opens on the level beneath it when it's alone at the top", () => {
    const plans = { outside: "fixture-org/plans#7", title: "Q3 importer epic" };
    const s = snapshot([{ n: 1 }, { n: 2 }, { n: 3 }], [[plans, "parent", 1], [plans, "parent", 2], [2, "parent", 3]]);
    assert.equal(
      outline(s, 1),
      [
        "**Group 1 of 1** · ↗fixture-org/plans#7 Q3 importer epic (an Outside Issue) — 3 Issues, 2 Unblocked, 1↗ Outside",
        "",
        "**Under ↗fixture-org/plans#7, alone at the top: 2** — most under it first",
        "- #2 Issue 2 — 1 under it · 1 Unblocked",
        "- #1 Issue 1 — 1 Unblocked",
        "",
        "_Name one to open the level below it · `map` for the Map_",
      ].join("\n"),
    );
    assert.equal(outline(s, "fixture-org/plans#7"), outline(s, 1).replace(", alone at the top", ""));
  });

  test("an Outside Issue this login can't read heads its Group without a name, still as an Outside Issue", () => {
    const s = snapshot([{ n: 1 }, { n: 2 }], [[{ hidden: "h1" }, "parent", 1], [1, "parent", 2]]);
    assert.deepEqual(outline(s, 1).split("\n").slice(0, 4), [
      "**Group 1 of 1** · ↗ an Issue this login can't read (an Outside Issue) — 2 Issues, 1 Unblocked, 1↗ Outside",
      "",
      "**Under ↗ an Outside Issue this login can't read, alone at the top: 1** — most under it first",
      "- #1 Issue 1 — 1 under it · 1 Unblocked",
    ]);
  });

  test("where Links run in a circle, the oldest Issue in it stands at the top", () => {
    const s = snapshot([{ n: 1 }, { n: 2 }, { n: 3 }], [[1, "blocks", 2], [2, "blocks", 3], [3, "blocks", 1]]);
    assert.deepEqual(outline(s, 1).split("\n").slice(2, 6), ["**Under #1, alone at the top: 1** — most under it first", "- #2 Issue 2 — Blocked by it · 2 under it · 0 Unblocked", "", "_Name one to open the level below it · `map` for the Map_"]);
  });

  test("says so when the Issue named has nothing beneath it, is Unlinked, isn't there, or the Group doesn't exist", () => {
    const s = snapshot([{ n: 1 }, { n: 2 }, { n: 3 }], [[1, "parent", 2]]);
    assert.deepEqual(outline(s, "#2").split("\n").slice(2), ["Nothing sits beneath #2 in this Group.", "_`map` for the Map_"]);
    assert.equal(outline(s, "#3"), "#3 is Unlinked: it has no Link to another open Issue, so it's in no Group.");
    assert.equal(outline(s, "fixture-org/tools#3"), "fixture-org/tools#3 is Unlinked: it has no Link to another open Issue, so it's in no Group.");
    assert.equal(outline(s, "#9"), "No Issue on the Map of fixture-org/tools is #9. `map` for the Map.");
    assert.equal(outline(s, 2), "There is only 1 Group on the Map of fixture-org/tools. `map` for the Map.");
    assert.equal(outline(snapshot([{ n: 1 }]), 1), "No Issue here has a Link, so there's no Group to open. `map` for the Map.");
  });
});

describe("the Group list", () => {
  // Twenty Groups: #1 heads 21 Issues, #2 heads 20, … #20 heads 2, so largest first is #1 to #20.
  const issues: IssueSpec[] = [];
  const links: LinkSpec[] = [];
  for (let g = 1; g <= 20; g++) {
    issues.push({ n: g });
    for (let i = 1; i <= 21 - g; i++) {
      const n = g * 100 + i;
      issues.push({ n });
      links.push([g, "parent", n]);
    }
  }
  const s = snapshot(issues, links);
  const list = (page: number) => draw(s, { kind: "groups", page }).text.split("\n");

  test("pages every Group 15 at a time, largest first, numbered by the place that opens it", () => {
    const lines = list(1);
    assert.equal(lines[0], "**Groups: 20** — largest first, page 1 of 2");
    assert.deepEqual(lines.slice(1, 3), ["1. #1 Issue 1 — 21 Issues, 20 Unblocked", "2. #2 Issue 2 — 20 Issues, 19 Unblocked"]);
    assert.equal(lines[15], "15. #15 Issue 15 — 7 Issues, 6 Unblocked");
    assert.deepEqual(lines.slice(16), ["", "_`more` for the next 15 · a Group's number opens it · `map` for the Map_"]);
    for (const place of [1, 9, 15]) {
      const head = lines[place]!.replace(/^\d+\. /, "").split(" — ")[0];
      assert.match(draw(s, { kind: "group", group: place, page: 1 }).text.split("\n")[0]!, new RegExp(`^\\*\\*Group ${place} of 20\\*\\* · ${head} — `), `Group ${place}`);
    }
  });

  test("the last page carries on the numbering and offers the Map back; a page past the end shows the last", () => {
    assert.deepEqual(list(2), [
      "**Groups: 20** — largest first, page 2 of 2",
      ...[16, 17, 18, 19, 20].map((g) => `${g}. #${g} Issue ${g} — ${22 - g} Issues, ${21 - g} Unblocked`),
      "",
      "_A Group's number opens it · `map` for the Map_",
    ]);
    assert.deepEqual(list(9), list(2));
  });

  test("its first lines match the overview's Group lines, which hint at it once there are more", () => {
    const shown = groupLines(overview(s));
    assert.deepEqual(list(1).slice(1, 9), shown.slice(1, 9).map((line, i) => line.replace(/^- /, `${i + 1}. `)));
    assert.equal(shown[9], "- … 12 more Groups, 90 Issues. Ask to list them.");
  });

  test("says so when there's no Group to list", () => {
    assert.equal(draw(snapshot([{ n: 1 }]), { kind: "groups", page: 1 }).text, "No Issue here has a Link, so there's no Group to list. `map` for the Map.");
  });
});

describe("the Take next list", () => {
  // #1 is the Parent of #2–#6, so they stand in for it; #20–#34 are joined in a chain by Related Links. All 20 are Unblocked, none waits on another.
  const children = [2, 3, 4, 5, 6];
  const chain = Array.from({ length: 15 }, (_, i) => 20 + i);
  const s = snapshot(
    [{ n: 1 }, ...children.map((n) => ({ n })), ...chain.map((n) => ({ n }))],
    [...children.map((n): LinkSpec => [1, "parent", n]), ...chain.slice(1).map((n): LinkSpec => [n - 1, "related", n])],
  );
  const list = (page: number) => draw(s, { kind: "next", page }).text.split("\n");

  test("pages every Issue Take next counts 15 at a time, in its order and with its lines, the stand-ins the overview holds in a count among them", () => {
    assert.deepEqual(takeNext(overview(s)).slice(0, 5), [
      "**Take next: 20** — most waited on first · 14 more not listed, ask to list them",
      "- #2 Issue 2 — via #1",
      "- #3 Issue 3 — via #1",
      "- #4 Issue 4 — via #1",
      "- … 2 more under #1",
    ]);
    assert.deepEqual(list(1), [
      "**Take next: 20** — most waited on first, page 1 of 2",
      ...children.map((n) => `- #${n} Issue ${n} — via #1`),
      ...chain.slice(0, 10).map((n) => `- #${n} Issue ${n}`),
      "",
      "_`more` for the next 15 · `map` for the Map_",
    ]);
    assert.deepEqual(list(2), ["**Take next: 20** — most waited on first, page 2 of 2", ...chain.slice(10).map((n) => `- #${n} Issue ${n}`), "", "_That's all of them. `map` for the Map._"]);
    assert.deepEqual(list(7), list(2), "a page past the end shows the last");
  });

  test("says why when it holds none", () => {
    const s = snapshot([{ n: 1, assignees: ["fixture-other"] }, { n: 2 }], [[1, "blocks", 2]]);
    assert.equal(draw(s, { kind: "next", page: 1 }).text, "**Take next: 0** — all 1 Unblocked Issue is taken by others, ask who has them\n\n_`map` for the Map_");
  });
});

describe("the Issues taken by others", () => {
  test("lists each Unblocked Issue left out of Take next as taken, in its order, with who holds it: its assignees, or the author of a Closing Request", () => {
    const s = snapshot(
      [
        { n: 1 },
        { n: 2, assignees: [VIEWER] },
        { n: 3, assignees: ["fixture-other", "fixture-third"] },
        { n: 4, closingRequests: ["fixture-other"] },
        { n: 5, closingRequests: [VIEWER] },
        { n: 6, assignees: [VIEWER], closingRequests: ["fixture-other"] },
        { n: 7, assignees: ["fixture-third"], closingRequests: ["fixture-other", "fixture-other"] },
      ],
      [[1, "related", 2], [2, "related", 3], [3, "related", 4], [4, "related", 5], [5, "related", 6], [6, "related", 7]],
    );
    assert.match(takeNext(overview(s))[0]!, / · 4 taken by others, ask who has them$/);
    assert.deepEqual(draw(s, { kind: "taken", page: 1 }).text.split("\n"), [
      "**Taken by others: 4** — Unblocked, but someone else has them; most waited on first, page 1 of 1",
      "- #3 Issue 3 — assigned to fixture-other, fixture-third",
      "- #4 Issue 4 — Closing Request by fixture-other",
      "- #6 Issue 6 — yours · Closing Request by fixture-other",
      "- #7 Issue 7 — assigned to fixture-third · Closing Request by fixture-other",
      "",
      "_That's all of them. `map` for the Map._",
    ]);
  });

  test("says so when none is", () => {
    const s = snapshot([{ n: 1 }, { n: 2 }], [[1, "related", 2]]);
    assert.equal(draw(s, { kind: "taken", page: 1 }).text, "No Unblocked Issue here is taken by others. `map` for the Map.");
  });
});

describe("the Unlinked list", () => {
  // #1 is on the Map; #2–#40 are Unlinked, and a higher number is newer.
  const s = snapshot(
    [...Array.from({ length: 40 }, (_, i): IssueSpec => ({ n: i + 1 })), { n: 41, createdAt: "2025-06-01T00:00:00Z" }],
    [[1, "blocks", { outside: "fixture-org/plans#7" }]],
  );

  test("pages 15 at a time, newest first", () => {
    const lines = draw(s, { kind: "unlinked", page: 1 }).text.split("\n");
    assert.equal(lines[0], "**Unlinked: 40** — newest first, page 1 of 3");
    assert.deepEqual(lines.slice(1, 18), [...Array.from({ length: 15 }, (_, i) => `- #${40 - i} Issue ${40 - i}`), "", "_`more` for the next 15_"]);
    assert.equal(lines.length, 18);
  });

  test("the last page holds what's left, oldest last, and offers the Map back", () => {
    const lines = draw(s, { kind: "unlinked", page: 3 }).text.split("\n");
    assert.deepEqual(lines, [
      "**Unlinked: 40** — newest first, page 3 of 3",
      ...[10, 9, 8, 7, 6, 5, 4, 3, 2].map((n) => `- #${n} Issue ${n}`),
      "- #41 Issue 41",
      "",
      "_That's all of them. `map` for the Map._",
    ]);
  });

  test("a page past the end shows the last page", () => {
    assert.equal(draw(s, { kind: "unlinked", page: 9 }).text, draw(s, { kind: "unlinked", page: 3 }).text);
  });

  test("a Project with no Links draws no Map, and still counts its Unlinked Issues on one line", () => {
    assert.equal(
      overview(snapshot([{ n: 1 }, { n: 2 }])),
      [
        "**fixture-org/tools** · 2 open · 0 on the Map · 2 Unlinked · Promised",
        "",
        "No Issue here has a Link, so there's no Map to draw.",
        "",
        "**Unlinked: 2** — no Link to another open Issue. Ask to list them.",
      ].join("\n"),
    );
  });
});

describe("a first read (ADR 0006)", () => {
  const project = "gitlab-org/gitlab";

  test("draws no Map, only how far the read has got and about how long is left", () => {
    // 4,300 Issues in 5 minutes: the other 43,943 at that rate take about 51 minutes.
    assert.equal(
      drawProgress(project, { read: 4300, total: 48243, elapsedMs: 300_000 }).text,
      [
        "**gitlab-org/gitlab** · 48,243 open · reading it for the first time",
        "",
        "⏳ 4,300 of 48,243 Issues read (8%) · about 51 min left",
        "The Map draws when the read finishes, since part of one would be wrong. Ask for the Map again to see how far it's got.",
      ].join("\n"),
    );
  });

  test("says seconds when less than a minute and a half is left, and nothing before the first page", () => {
    assert.match(drawProgress(project, { read: 200, total: 250, elapsedMs: 8000 }).text, /^⏳ 200 of 250 Issues read \(80%\) · about 2s left$/m);
    assert.match(drawProgress(project, { read: 0, total: 250, elapsedMs: 0 }).text, /^⏳ 0 of 250 Issues read \(0%\)$/m);
  });

  test("says why a read stopped, and that asking again resumes it", () => {
    const text = drawProgress(project, { read: 200, total: 250, elapsedMs: 8000, stopped: "couldn't reach gitlab.com" }).text;
    assert.match(text, /^⏳ 200 of 250 Issues read \(80%\)$/m);
    assert.match(text, /^The read stopped: couldn't reach gitlab\.com\. Asking for the Map again resumes it where it stopped\.$/m);
  });
});

/** The overview's Take next section: its heading and its lines. */
function takeNext(text: string): string[] {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.startsWith("**Take next"));
  return start === -1 ? [] : lines.slice(start, lines.indexOf("", start));
}

/** The overview's Groups section: its heading and its lines. */
function groupLines(text: string): string[] {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.startsWith("**Groups"));
  const end = lines.indexOf("", start);
  return lines.slice(start, end === -1 ? undefined : end);
}

describe("an old Snapshot (ADR 0006)", () => {
  const s = snapshot([{ n: 1 }, { n: 2 }], [[1, "blocks", 2]]);

  test("a fresh Snapshot shows no age", () => {
    assert.doesNotMatch(overview(s), /⚠|ago/);
  });

  test("one that couldn't be refreshed opens every drawing with one line saying how old it is and why", () => {
    const stale = { ageMs: 3 * 3_600_000 + 5 * 60_000, reason: "couldn't reach github.com" };
    const line = "⚠ read 3h ago — couldn't refresh it: couldn't reach github.com";
    assert.equal(draw(s, { kind: "overview" }, { stale }).text, `${line}\n${overview(s)}`);
    for (const command of [{ kind: "unlinked", page: 1 }, { kind: "group", group: 1, page: 1 }, { kind: "under", ref: "#1", page: 1 }] as const) {
      assert.equal(draw(s, command, { stale }).text, `${line}\n${draw(s, command).text}`, command.kind);
    }
  });

  test("its age is in minutes under an hour, hours under two days, then days", () => {
    const aged = (ageMs: number) => draw(s, { kind: "overview" }, { stale: { ageMs, reason: "why" } }).text.split("\n")[0];
    assert.equal(aged(150_000), "⚠ read 2 min ago — couldn't refresh it: why");
    assert.equal(aged(47 * 3_600_000), "⚠ read 47h ago — couldn't refresh it: why");
    assert.equal(aged(3 * 86_400_000), "⚠ read 3d ago — couldn't refresh it: why");
  });
});

describe("the Project's band (ADR 0003)", () => {
  const links: LinkSpec[] = [[1, "blocks", 2]];
  const issues: IssueSpec[] = [{ n: 1 }, { n: 2 }, { n: 3 }];
  const untested = "GHES 3.17.2 is older than 3.18, the oldest release GitHub still supports";
  const reads = READS_EVERYTHING.links;

  test("a Project on a Tracker the Map is tested on, with a Link kind it can read, is Promised, and the overview says so", () => {
    assert.equal(overview(snapshot(issues, links)).split("\n")[0], "**fixture-org/tools** · 3 open · 2 on the Map · 1 Unlinked · Promised");
  });

  test("one on an untested version is Best effort: its Map is drawn, marked untested and read-only, and says why", () => {
    const lines = overview(snapshot(issues, links, {}, { untested })).split("\n");
    assert.equal(lines[0], "**fixture-org/tools** · 3 open · 2 on the Map · 1 Unlinked · Best effort");
    assert.equal(lines[1], `⚠ Best effort: ${untested} — the Map is untested here, and read-only: it writes nothing`);
    assert.ok(lines.includes("- #1 Issue 1 — 2 Issues, 1 Unblocked"), "the Map is still drawn");
  });

  test("a Link kind the Map can't read is named with why, since Links of it may be missing; one the Project can't record is named only on Best effort", () => {
    const parent = { kind: "cant-read", reason: "GitLab 15.4 gives a task's Parent only through GraphQL the Map doesn't read" } as const;
    const related = { kind: "cant-record", reason: "GitHub records no Related Links" } as const;
    const lines = overview(snapshot(issues, links, {}, { links: { ...reads, parent, related } })).split("\n");
    assert.equal(lines[1], `⚠ Parent Links can't be read here: ${parent.reason}`);
    assert.doesNotMatch(lines.join("\n"), /Related/);
    const both = overview(snapshot(issues, links, {}, { untested, links: { ...reads, parent, related } })).split("\n");
    assert.equal(both[1], `⚠ Best effort: ${untested} — the Map is untested here, and read-only: it writes nothing · Parent Links can't be read here: ${parent.reason} · Related Links can't be recorded here: ${related.reason}`);
  });

  test("a Project where the Map can read no Link kind is Refused: no Map, and every kind named with why", () => {
    const refused = snapshot(issues, [], { blocks: "GHES 3.16.0 can't record Blocks Links" }, {
      untested,
      links: {
        blocks: { kind: "cant-record", reason: "GHES 3.16.0 can't record Blocks Links; 3.19 and later can" },
        parent: { kind: "cant-record", reason: "GHES 3.16.0 can't record Parent Links; 3.17 and later can" },
        related: { kind: "cant-record", reason: "GitHub records no Related Links" },
      },
    });
    const text =
      "No Map of github.com/fixture-org/tools: Refused — the Map can read no Link kind here. Blocks: GHES 3.16.0 can't record Blocks Links; 3.19 and later can. Parent: GHES 3.16.0 can't record Parent Links; 3.17 and later can. Related: GitHub records no Related Links.";
    for (const command of [{ kind: "overview" }, { kind: "unlinked", page: 1 }, { kind: "group", group: 1, page: 1 }, { kind: "under", ref: "#1", page: 1 }, { kind: "picture", group: 1 }] as const) {
      assert.equal(draw(refused, command).text, text, command.kind);
    }
  });

  test("one reason for every kind, such as a version too old to read, is said once", () => {
    const none = { kind: "cant-read", reason: "GitLab 13.3.0 is older than 13.4, the oldest the Map reads" } as const;
    const refused = snapshot(issues, [], {}, { untested: "GitLab 13.3.0 is older than 16.0, the oldest the Map is tested on", links: { blocks: none, parent: none, related: none } });
    assert.equal(overview(refused), "No Map of github.com/fixture-org/tools: Refused — the Map can read no Link kind here. GitLab 13.3.0 is older than 13.4, the oldest the Map reads.");
  });
});

describe("a Group's Picture", () => {
  const picture = (s: ReturnType<typeof snapshot>, group = 1) => draw(s, { kind: "picture", group }).text;
  /** The rows between the Picture's fences. */
  const rows = (text: string) => text.split("\n").slice(3, text.split("\n").lastIndexOf("```"));

  test("draws the whole Group, a Parent's children and the Issues one Blocks each told apart, with Blocks pointing at the Issue that waits", () => {
    // #1 is the Parent of #2 and #3; #2 Blocks #4.
    const s = snapshot([{ n: 1, title: "Lay the foundation" }, { n: 2 }, { n: 3 }, { n: 4 }], [[1, "parent", 2], [1, "parent", 3], [2, "blocks", 4]]);
    assert.equal(
      picture(s),
      [
        "**Picture of Group 1 of 1** · #1 Lay the foundation — 4 Issues, 2 Unblocked",
        "",
        "```",
        "#1 Lay the foundation",
        "├─ #2 Issue 2",
        "│  └▶ #4 Issue 4",
        "└─ #3 Issue 3",
        "```",
        "_`─` its Parent above it · `▶` Blocked by the Issue above it · `↗` an Outside Issue, not followed_",
        "_`group 1` for its outline · `map` for the Map_",
      ].join("\n"),
    );
    assert.deepEqual(draw(s, { kind: "picture", group: 1 }).issues?.sort(), ["#1", "#2", "#3", "#4"], "every Issue drawn is on screen for Link Suggestions");
  });

  test("an Issue under two Parents is drawn once, and named where it's reached again", () => {
    const s = snapshot([{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }], [[1, "parent", 2], [1, "parent", 3], [2, "parent", 4], [3, "parent", 4]]);
    assert.deepEqual(rows(picture(s)), ["#1 Issue 1", "├─ #2 Issue 2", "│  └─ #4 Issue 4", "└─ #3 Issue 3", "   └─ #4 also under #2, drawn above"]);
  });

  test("Blocks Links in a circle draw each Issue once", () => {
    const s = snapshot([{ n: 1 }, { n: 2 }], [[1, "blocks", 2], [2, "blocks", 1]]);
    assert.deepEqual(rows(picture(s)), ["#1 Issue 1", "└▶ #2 Issue 2", "   └▶ #1 also at the top, drawn above"]);
  });

  test("counts Related Links on a row and draws none; marks Outside Issues, and one this login can't read has no name", () => {
    const s = snapshot(
      [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 9 }],
      [[{ outside: "fixture-org/plans#7", title: "Roadmap" }, "parent", 1], [1, "blocks", 2], [{ hidden: "fixture-org/secret#1" }, "blocks", 3], [1, "blocks", 3], [2, "related", 9], [3, "related", 9]],
    );
    assert.deepEqual(rows(picture(s)), [
      "↗fixture-org/plans#7 Roadmap",
      "└─ #1 Issue 1",
      "   ├▶ #2 (1 Related) Issue 2",
      "   └▶ #3 (1 Related) Issue 3",
      "↗ an Issue this login can't read",
      "└▶ #3 also under #1, drawn above",
    ]);
  });

  test("titles print on one line, cut to fit 72 columns, inside a fence longer than any backtick run in them", () => {
    const s = snapshot([{ n: 1, title: "Run ```sh\nmake``` before\tthe release, every time, on every platform we ship to" }, { n: 2 }], [[1, "blocks", 2]]);
    const lines = picture(s).split("\n");
    assert.equal(lines[2], "````");
    assert.equal(lines[3], "#1 Run ```sh make``` before the release, every time, on every platform …");
    assert.equal(lines[3]!.length, 72);
    assert.equal(lines[5], "````");
  });

  test("a row too deep or an Outside Issue's path too long for a title keeps its reference alone", () => {
    const path = "fixture-org/a-group-with-a-long-name/and-a-subgroup/with-a-project#12";
    const s = snapshot([{ n: 1 }], [[{ outside: path }, "parent", 1]]);
    assert.deepEqual(rows(picture(s)), [`↗${path}`, "└─ #1 Issue 1"]);
  });

  test("a Group too large to draw whole opens as its outline, saying why", () => {
    const issues = Array.from({ length: 26 }, (_, i) => ({ n: i + 1 }));
    const s = snapshot(issues, issues.slice(1).map(({ n }): LinkSpec => [1, "parent", n]));
    const lines = picture(s).split("\n");
    assert.equal(lines[0], "Group 1 is too large to draw whole: a Picture holds about 25 Issues in 30 rows. Here is its outline; `picture '#1'` draws the Picture around #1 instead, as it does around any Issue in it.");
    assert.equal(lines.slice(2).join("\n"), draw(s, { kind: "group", group: 1, page: 1 }).text);
  });

  test("a Group past the last says how many there are", () => {
    const s = snapshot([{ n: 1 }, { n: 2 }], [[1, "blocks", 2]]);
    assert.equal(picture(s, 2), "There is only 1 Group on the Map of fixture-org/tools. `map` for the Map.");
  });
});

describe("a Picture around one Issue", () => {
  const around = (s: ReturnType<typeof snapshot>, ref: string) => draw(s, { kind: "around", ref }).text;
  const rows = (text: string) => text.split("\n").slice(3, text.split("\n").lastIndexOf("```"));
  const chain = (length: number) => {
    const issues = Array.from({ length }, (_, i) => ({ n: i + 1 }));
    return snapshot(issues, issues.slice(1).map(({ n }): LinkSpec => [n - 1, "blocks", n]));
  };

  test("draws the Issue marked in the middle, what it waits on above it and what waits on it beneath, with its Group's line and what the marks mean", () => {
    const s = snapshot([{ n: 1, title: "Lay the foundation" }, { n: 2 }, { n: 3 }, { n: 4 }, { n: 5 }], [[1, "parent", 2], [1, "parent", 3], [2, "blocks", 4], [5, "blocks", 2]]);
    assert.equal(
      around(s, "#2"),
      [
        "**Picture around #2** · in Group 1 of 1 · #1 Lay the foundation — 5 Issues, 2 Unblocked",
        "",
        "```",
        "#1 Lay the foundation",
        "└─ ● #2 Issue 2",
        "   └▶ #4 Issue 4",
        "#5 Issue 5",
        "└▶ #2 also under #1, drawn above",
        "```",
        "_`─` its Parent above it · `▶` Blocked by the Issue above it · `↗` an Outside Issue, not followed · `●` the Issue it's drawn around_",
        "_`issue '#2'` for its card · `group 1` for its Group's outline · `map` for the Map_",
      ].join("\n"),
    );
    assert.deepEqual(draw(s, { kind: "around", ref: "#2" }).issues?.sort(), ["#1", "#2", "#4", "#5"], "only the Issues drawn are on screen, not #3 beside it");
  });

  test("goes about three steps each way, counting what's left above and saying how many sit under where a branch is cut", () => {
    assert.deepEqual(rows(around(chain(9), "#5")), [
      "… 1 more above",
      "#2 Issue 2",
      "└▶ #3 Issue 3",
      "   └▶ #4 Issue 4",
      "      └▶ ● #5 Issue 5",
      "         └▶ #6 Issue 6",
      "            └▶ #7 Issue 7",
      "               └▶ #8 (1 under it) Issue 8",
    ]);
  });

  test("caps each step, counting the rest", () => {
    const issues = Array.from({ length: 9 }, (_, i) => ({ n: i + 1 }));
    const s = snapshot(issues, issues.slice(1).map(({ n }): LinkSpec => [1, "parent", n]));
    assert.deepEqual(rows(around(s, "#1")), ["● #1 Issue 1", "├─ #2 Issue 2", "├─ #3 Issue 3", "├─ #4 Issue 4", "├─ #5 Issue 5", "├─ #6 Issue 6", "└ … 3 more"]);
    const parents = snapshot(issues, issues.slice(1).map(({ n }): LinkSpec => [n, "blocks", 1]));
    assert.deepEqual(rows(around(parents, "#1")).slice(0, 3), ["… 3 more above", "#2 Issue 2", "└▶ ● #1 Issue 1"]);
  });

  test("an Issue not in a Group says so, as opening the level beneath it does", () => {
    const s = snapshot([{ n: 1 }, { n: 2 }, { n: 3 }], [[1, "blocks", 2]]);
    assert.equal(around(s, "#3"), "#3 is Unlinked: it has no Link to another open Issue, so it's in no Group.");
    assert.equal(around(s, "#9"), "No Issue on the Map of fixture-org/tools is #9. `map` for the Map.");
  });

  test("an Outside Issue can be drawn around, named as the Map prints it", () => {
    const s = snapshot([{ n: 1 }], [[{ outside: "fixture-org/plans#7", title: "Roadmap" }, "parent", 1]]);
    assert.deepEqual(rows(around(s, "↗fixture-org/plans#7")), ["● ↗fixture-org/plans#7 Roadmap", "└─ #1 Issue 1"]);
  });
});

describe("a Picture as Mermaid or DOT, to paste where GitHub or GitLab render it (#83)", () => {
  // #1 is the Parent of #2 and #3; #2 Blocks #4.
  const family = () => snapshot([{ n: 1, title: "Lay the foundation" }, { n: 2 }, { n: 3 }, { n: 4 }], [[1, "parent", 2], [1, "parent", 3], [2, "blocks", 4]]);

  test("Mermaid draws the Picture's Issues and the recorded Links between them, Blocks pointing at the Issue that waits", () => {
    const s = family();
    assert.equal(
      draw(s, { kind: "picture", group: 1, as: "mermaid" }).text,
      [
        "**Picture of Group 1 of 1, as Mermaid** · #1 Lay the foundation — 4 Issues, 2 Unblocked",
        "Paste it where GitHub or GitLab render Mermaid, such as a comment on the Group's head Issue. The Map writes nothing to the Tracker.",
        "",
        "```mermaid",
        "flowchart TD",
        '  n1["#1 Lay the foundation"]',
        '  n2["#2 Issue 2"]',
        '  n3["#4 Issue 4"]',
        '  n4["#3 Issue 3"]',
        "  n1 ---|parent of| n2",
        "  n1 ---|parent of| n4",
        "  n2 -->|blocks| n3",
        "```",
        "_`picture 1` for the Picture · `group 1` for its outline · `map` for the Map_",
      ].join("\n"),
    );
    assert.deepEqual(draw(s, { kind: "picture", group: 1, as: "mermaid" }).issues?.sort(), ["#1", "#2", "#3", "#4"]);
  });

  test("DOT draws the same, a Parent Link a dashed line with no arrow", () => {
    assert.deepEqual(draw(family(), { kind: "picture", group: 1, as: "dot" }).text.split("\n").slice(3, -1), [
      "```dot",
      "digraph {",
      "  node [shape=box];",
      '  n1 [label="#1 Lay the foundation"];',
      '  n2 [label="#2 Issue 2"];',
      '  n3 [label="#4 Issue 4"];',
      '  n4 [label="#3 Issue 3"];',
      '  n1 -> n2 [label="parent of", arrowhead=none, style=dashed];',
      '  n1 -> n4 [label="parent of", arrowhead=none, style=dashed];',
      '  n2 -> n3 [label="blocks"];',
      "}",
      "```",
    ]);
  });

  test("Related Links are a suffix, never a line; Outside Issues are marked, and one this login can't read has no name", () => {
    const s = snapshot(
      [{ n: 1 }, { n: 2 }, { n: 9 }],
      [[{ outside: "fixture-org/plans#7", title: "Roadmap" }, "parent", 1], [{ hidden: "fixture-org/secret#1" }, "blocks", 1], [1, "blocks", 2], [2, "related", 9]],
    );
    const lines = draw(s, { kind: "picture", group: 1, as: "mermaid" }).text.split("\n");
    assert.deepEqual(lines.filter((l) => l.startsWith("  n")).filter((l) => l.includes("[")), [
      '  n1["↗fixture-org/plans#7 Roadmap"]',
      '  n2["#1 Issue 1"]',
      '  n3["#2 (1 Related) Issue 2"]',
      "  n4[\"↗ an Issue this login can't read\"]",
    ]);
    assert.ok(!lines.some((l) => l.includes("#9")), "a Related Link is never drawn");
  });

  test("titles with quotes, brackets, backticks, tags and entities can't break the Mermaid or the DOT, and print as typed", () => {
    const s = snapshot([{ n: 1, title: 'Say "hi" [now] {x} <b>y</b> & ```z``` #7; \\ end' }, { n: 2 }], [[1, "blocks", 2]]);
    const mermaid = draw(s, { kind: "picture", group: 1, as: "mermaid" }).text.split("\n");
    assert.ok(mermaid.includes('  n1["#1 Say #quot;hi#quot; [now] {x} #lt;b#gt;y#lt;/b#gt; #amp; #96;#96;#96;z#96;#96;#96; #35;7; #92; end"]'), mermaid.join("\n"));
    assert.ok(mermaid.includes("```mermaid"));
    const dot = draw(s, { kind: "picture", group: 1, as: "dot" }).text.split("\n");
    assert.ok(dot.includes('  n1 [label="#1 Say \\"hi\\" [now] {x} <b>y</b> &amp; ```z``` #7; \\\\ end"];'), dot.join("\n"));
    assert.ok(dot.includes("````dot"), "the fence outruns the title's backticks");
  });

  test("a backslash or a non-breaking space in a title, which end a Mermaid diagram early, are written as a code and a plain space", () => {
    const s = snapshot([{ n: 1, title: "Fix\u00a0it with `\\n`" }, { n: 2 }], [[1, "blocks", 2]]);
    assert.ok(draw(s, { kind: "picture", group: 1, as: "mermaid" }).text.split("\n").includes('  n1["#1 Fix it with #96;#92;n#96;"]'));
  });

  test("around an Issue, it draws the Issues that Picture draws, the Issue marked", () => {
    const s = snapshot([{ n: 1, title: "Lay the foundation" }, { n: 2 }, { n: 3 }, { n: 4 }, { n: 5 }], [[1, "parent", 2], [1, "parent", 3], [2, "blocks", 4], [5, "blocks", 2]]);
    const lines = draw(s, { kind: "around", ref: "#2", as: "mermaid" }).text.split("\n");
    assert.equal(lines[0], "**Picture around #2, as Mermaid** · in Group 1 of 1 · #1 Lay the foundation — 5 Issues, 2 Unblocked");
    assert.deepEqual(lines.slice(4, -2), [
      "flowchart TD",
      '  n1["#1 Lay the foundation"]',
      '  n2["● #2 Issue 2"]',
      '  n3["#4 Issue 4"]',
      '  n4["#5 Issue 5"]',
      "  n1 ---|parent of| n2",
      "  n2 -->|blocks| n3",
      "  n4 -->|blocks| n2",
    ]);
    assert.equal(lines.at(-1), "_`picture '#2'` for the Picture · `issue '#2'` for its card · `map` for the Map_");
  });

  test("a Group too large for a Picture opens as its outline, as the Picture does", () => {
    const issues = Array.from({ length: 26 }, (_, i) => ({ n: i + 1 }));
    const s = snapshot(issues, issues.slice(1).map(({ n }): LinkSpec => [1, "parent", n]));
    assert.equal(draw(s, { kind: "picture", group: 1, as: "mermaid" }).text, draw(s, { kind: "picture", group: 1 }).text);
  });
});
