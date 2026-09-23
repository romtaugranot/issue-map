/**
 * Seam A: the drawing module, `(Snapshot, command) → text`, with no network
 * and no clock. Hand-written Snapshots cover the rules' edges.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { draw, drawProgress } from "../src/map/draw.ts";
import { snapshot, type IssueSpec, type LinkSpec } from "./fakes/snapshot-builder.ts";

const overview = (s: ReturnType<typeof snapshot>) => draw(s, { kind: "overview" }).text;

describe("the overview", () => {
  test("draws a Group line naming its top Issue and how many Issues it holds, then the Unlinked count", () => {
    const s = snapshot([{ n: 1, title: "Plan the importer" }, { n: 2 }, { n: 3 }], [[1, "parent", 2]]);
    assert.equal(
      overview(s),
      [
        "**fixture-org/tools** · 3 open · 2 on the Map · 1 Unlinked",
        "",
        "**Groups: 1** — largest first",
        "- #1 Plan the importer — 2 Issues",
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
      "- #10 Issue 10 — 10 Issues",
      "- #20 Issue 20 — 9 Issues",
      "- #30 Issue 30 — 8 Issues",
      "- #40 Issue 40 — 7 Issues",
      "- #50 Issue 50 — 6 Issues",
      "- #60 Issue 60 — 5 Issues",
      "- #70 Issue 70 — 4 Issues",
      "- #80 Issue 80 — 3 Issues",
      "- … 2 more Groups, 3 Issues",
    ]);
  });

  test("trims a long title to 60 characters", () => {
    const title = "Support reading state from every remote backend at once, in parallel, with retries";
    const s = snapshot([{ n: 1, title }, { n: 2 }], [[1, "blocks", 2]]);
    assert.equal(groupLines(overview(s))[1], "- #1 Support reading state from every remote backend at once, in… — 2 Issues");
  });
});

describe("Groups (ADR 0008)", () => {
  test("Parent and Blocks Links join a Group directly and through one another, and the top Issue heads it", () => {
    const s = snapshot([{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }], [[3, "blocks", 2], [2, "blocks", 1], [4, "parent", 3]]);
    assert.deepEqual(groupLines(overview(s)), ["**Groups: 1** — largest first", "- #4 Issue 4 — 4 Issues"]);
  });

  test("a Related Link joins nothing between Issues that have a Parent or Blocks Link", () => {
    const s = snapshot([{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }], [[1, "parent", 2], [3, "parent", 4], [2, "related", 4]]);
    assert.deepEqual(groupLines(overview(s)), [
      "**Groups: 2** — largest first",
      "- #1 Issue 1 — 2 Issues",
      "- #3 Issue 3 — 2 Issues",
    ]);
  });

  test("Issues with no Parent or Blocks Link group among themselves through Related, and stay on the Map", () => {
    const s = snapshot(
      [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }, { n: 5 }, { n: 6 }],
      [[1, "parent", 2], [3, "related", 4], [4, "related", 5], [5, "related", 2]],
    );
    const text = overview(s);
    assert.match(text, /^\*\*fixture-org\/tools\*\* · 6 open · 5 on the Map · 1 Unlinked$/m);
    assert.deepEqual(groupLines(text), [
      "**Groups: 2** — largest first",
      "- #3 Issue 3 — 3 Issues",
      "- #1 Issue 1 — 2 Issues",
    ]);
  });

  test("an Issue whose only Links reach closed Issues is Unlinked", () => {
    const s = snapshot([{ n: 1 }, { n: 2 }], [[{ closed: 9 }, "blocks", 1], [2, "related", { closed: 8 }]]);
    const text = overview(s);
    assert.match(text, /· 2 open · 0 on the Map · 2 Unlinked$/m);
    assert.match(text, /^No Issue here has a Link, so there's no Map to draw\.$/m);
  });
});

describe("Outside Issues (ADR 0005)", () => {
  const plans = { outside: "fixture-org/plans#7", title: "Q3 importer epic" };

  test("two Issues sharing an Outside Issue land in one Group, headed by it", () => {
    const s = snapshot([{ n: 1 }, { n: 2 }, { n: 3 }], [[plans, "parent", 1], [plans, "parent", 2]]);
    assert.deepEqual(groupLines(overview(s)), [
      "**Groups: 1** — largest first",
      "- ↗fixture-org/plans#7 Q3 importer epic — 2 Issues, 1↗",
    ]);
  });

  test("a closed Outside Issue joins nothing", () => {
    const s = snapshot([{ n: 1 }, { n: 2 }], [[{ ...plans, open: false }, "parent", 1], [{ ...plans, open: false }, "parent", 2]]);
    assert.match(overview(s), /· 0 on the Map · 2 Unlinked$/m);
  });

  test("an Outside Issue joins Issues that have no Parent or Blocks Link only through Related", () => {
    const s = snapshot(
      [{ n: 1 }, { n: 2 }, { n: 3 }],
      [[plans, "parent", 1], [2, "related", plans], [3, "related", { outside: "fixture-org/plans#8" }]],
    );
    assert.deepEqual(groupLines(overview(s)), [
      "**Groups: 3** — largest first",
      "- ↗fixture-org/plans#7 Q3 importer epic — 1 Issue, 1↗",
      "- #2 Issue 2 — 1 Issue",
      "- #3 Issue 3 — 1 Issue, 1↗",
    ]);
  });

  test("an Outside Issue this login can't read is drawn without a name rather than omitted", () => {
    // The Tracker names neither end the same way, so nothing says they're one Issue: each joins nothing.
    const s = snapshot([{ n: 1 }, { n: 2 }, { n: 3 }], [[{ hidden: "h1" }, "parent", 1], [{ hidden: "h2" }, "parent", 2], [3, "blocks", { hidden: "h3" }]]);
    const text = overview(s);
    assert.match(text, /· 3 on the Map · 0 Unlinked$/m);
    assert.deepEqual(groupLines(text), [
      "**Groups: 3** — largest first",
      "- ↗ an Issue this login can't read — 1 Issue, 1↗",
      "- ↗ an Issue this login can't read — 1 Issue, 1↗",
      "- #3 Issue 3 — 1 Issue, 1↗",
    ]);
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
    assert.deepEqual(lines.slice(1, 17), [...Array.from({ length: 15 }, (_, i) => `- #${40 - i} Issue ${40 - i}`), "_`more` for the next 15_"]);
    assert.equal(lines.length, 17);
  });

  test("the last page holds what's left, oldest last, and offers the Map back", () => {
    const lines = draw(s, { kind: "unlinked", page: 3 }).text.split("\n");
    assert.deepEqual(lines, [
      "**Unlinked: 40** — newest first, page 3 of 3",
      ...[10, 9, 8, 7, 6, 5, 4, 3, 2].map((n) => `- #${n} Issue ${n}`),
      "- #41 Issue 41",
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
        "**fixture-org/tools** · 2 open · 0 on the Map · 2 Unlinked",
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

/** The overview's Groups section: its heading and its lines. */
function groupLines(text: string): string[] {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.startsWith("**Groups"));
  const end = lines.indexOf("", start);
  return lines.slice(start, end === -1 ? undefined : end);
}
