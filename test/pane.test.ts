/**
 * The Issue Map pane (ADR 0014): what `issue-map pane` prints, what its
 * screens say, and its chart, fitted to its room, on hand-written and
 * recorded Snapshots. The hooks module that draws it is tested by
 * `claude plugin test`, in `hooks/pane.test.ts`.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { pageData } from "../src/map/page.ts";
import { paneData, type PaneData } from "../src/map/pane.ts";
import { CELL, earlier, islandChart, islandPage, isleCaption, isleLabel, packIslands, seaChart, shareBar, TEXT } from "../src/pane/chart.ts";
import { fitLine, textWidth, wrap } from "../src/pane/fit.ts";
import { groupOf, island, issueAt, issueSaid, membersOf, ordinal, outline, shares, stateOf, upOf } from "../src/pane/screens.ts";
import type { Snapshot } from "../src/snapshot/snapshot.ts";
import { snapshot } from "./fakes/snapshot-builder.ts";

/** The README's fixture Project, near enough: #1 Blocks #2 Blocks #3; #4 the Parent of #5, #6 and an Outside Issue, #5 of #7; an Outside Issue Blocks #8; closed Issues Blocked #9 and #12; #6 assigned. */
const small = () =>
  snapshot(
    [
      { n: 1, title: "Lay the foundation" },
      { n: 2, title: "Build the walls" },
      { n: 3, title: "Put on the roof" },
      { n: 4, title: "Plan the release" },
      { n: 5, title: "Write the release notes" },
      { n: 6, title: "Tag the build", assignees: ["someone"] },
      { n: 7, title: "Proofread the release notes" },
      { n: 8, title: "Use the shared config" },
      { n: 9, title: "Remove the compatibility shims" },
      { n: 11, title: "Keep the old parser working" },
      { n: 12, title: "Drop the legacy flag" },
      { n: 13, title: "Document the new layout" },
    ],
    [
      [1, "blocks", 2],
      [2, "blocks", 3],
      [4, "parent", 5],
      [4, "parent", 6],
      [5, "parent", 7],
      [4, "parent", { outside: "issue-map-fixtures/site#1", title: "Update the website for the release" }],
      [{ outside: "issue-map-fixtures-b/elsewhere#1", title: "Publish the shared config" }, "blocks", 8],
      [{ closed: 20 }, "blocks", 9],
      [{ closed: 21 }, "blocks", 12],
    ],
  );

const recorded = (name: string): Snapshot => JSON.parse(gunzipSync(readFileSync(new URL(`fixtures/snapshots/${name}.json.gz`, import.meta.url))).toString("utf8"));
const RECORDED = ["opentofu__opentofu", "microsoft__playwright"];
const at = (d: PaneData, ref: string) => issueAt(d, ref)!;

describe("what issue-map pane prints", () => {
  test("is the HTML Picture's own data, so the two never disagree on Take next or the Groups", () => {
    const s = small();
    const { links, assigned, because, ...page } = paneData(s);
    assert.deepEqual(page, pageData(s));
  });

  test("each of the Project's own Issues' Links, the far end opened in the pane where it's open and named on the page", () => {
    const d = paneData(small());
    assert.deepEqual(d.links[at(d, "#2")], [
      { role: "blocker", to: at(d, "#1"), ref: "#1", title: "Issue 1", open: true },
      { role: "blocked", to: at(d, "#3"), ref: "#3", title: "Issue 3", open: true },
    ]);
    assert.deepEqual(d.links[at(d, "#4")]!.at(-1), { role: "child", to: at(d, "↗issue-map-fixtures/site#1"), ref: "↗issue-map-fixtures/site#1", title: "Update the website for the release", open: true });
    // A closed blocker is listed, and opens nothing.
    assert.equal(d.links[at(d, "#9")]![0]!.open, false);
    assert.equal(d.links[at(d, "#9")]![0]!.to, undefined);
  });

  test("which Issues are assigned, and why each in Take next is there, in its order", () => {
    const d = paneData(small());
    assert.deepEqual(d.assigned, [at(d, "#6")]);
    assert.deepEqual(
      d.next.picks.map((p) => d.issues[p.issue]!.ref),
      ["#1", "#7", "#9", "#12"],
    );
    assert.deepEqual(d.because, ["2 wait on it", "A first step of #5", "Its blocker closed 2d ago", "Its blocker closed 2d ago"]);
  });
});

describe("what the screens say", () => {
  const d = paneData(small());

  test("a Group's outline holds each of its Issues once, indented under the one it was first reached from", () => {
    const g = d.groups[groupOf(d).get(at(d, "#4"))!]!;
    assert.deepEqual(
      outline(g).map((r) => `${"  ".repeat(r.depth)}${d.issues[r.i]!.ref}${r.blocks ? " (blocked)" : ""}`),
      ["#4", "  #5", "    #7", "  #6", "  ↗issue-map-fixtures/site#1"],
    );
    assert.deepEqual(new Set(outline(g).map((r) => r.i)), new Set(membersOf(g)));
    const chain = d.groups[groupOf(d).get(at(d, "#1"))!]!;
    assert.deepEqual(
      outline(chain).map((r) => `${d.issues[r.i]!.ref}${r.blocks ? " (blocked)" : ""}`),
      ["#1", "#2 (blocked)", "#3 (blocked)"],
    );
  });

  test("an Issue's state is the word the chart writes beside it", () => {
    assert.deepEqual(stateOf(d, at(d, "#1")), { word: "1st in Take next", tone: "pick" });
    assert.deepEqual(stateOf(d, at(d, "#2")), { word: "Blocked", tone: "stop" });
    assert.deepEqual(stateOf(d, at(d, "↗issue-map-fixtures/site#1")), { word: "Outside", tone: "muted" });
    assert.deepEqual(issueSaid(d, at(d, "#2")), { blocked: "Blocked by #1.", state: "Unassigned.", next: null });
    assert.deepEqual(issueSaid(d, at(d, "#7")), { blocked: null, state: "Unblocked. Unassigned.", next: "2nd in Take next." });
    assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal), ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st"]);
  });

  test("up goes up the Map's own levels: an Issue to its island, or in none to the Unlinked list; an island or a list to the Map", () => {
    assert.equal(upOf(d, { kind: "map" }), null);
    assert.deepEqual(upOf(d, { kind: "list", which: "next" }), { to: { kind: "map" }, label: "Map" });
    assert.deepEqual(upOf(d, island(d, 0)), { to: { kind: "map" }, label: "Map" });
    assert.deepEqual(upOf(d, { kind: "issue", ref: "#7" }), { to: { kind: "island", head: "#4", mark: "#7" }, label: "Group 1" });
    assert.deepEqual(upOf(d, { kind: "issue", ref: "#13" }), { to: { kind: "list", which: "unlinked", mark: "#13" }, label: "Unlinked" });
  });

  test("the share line counts each Issue once: to take next, waiting on the Map, and Unlinked", () => {
    const parts = shares(d);
    assert.deepEqual(parts, { next: 4, waiting: d.onMap - 2, unlinked: d.unlinked.length - 2, others: true });
    for (const name of RECORDED) {
      const r = paneData(recorded(name));
      const { next, waiting, unlinked } = shares(r);
      assert.equal(next + waiting + unlinked, r.onMap + r.unlinked.length, name);
    }
  });
});

describe("text fitted to its room", () => {
  const titles = paneData(recorded("opentofu__opentofu")).issues.map((issue) => issue.title);

  test("a line cut to its room never runs past it, and is left whole where it fits", () => {
    for (const room of [40, 120, 300]) {
      for (const title of titles) {
        const line = fitLine(title, room, 13, 600);
        if (line.endsWith("…")) assert.ok(textWidth(line, 13, 600) <= room || line === "…", `${line} in ${room}`);
        else assert.equal(line, title);
      }
    }
  });

  test("a title wraps onto at most its lines, each within its room", () => {
    for (const title of titles) {
      const lines = wrap(title, 200, 12, 2);
      assert.ok(lines.length <= 2);
      for (const line of lines) assert.ok(textWidth(line, 12) <= 200 || !line.includes(" "), line);
    }
  });

  test("is measured wide enough: wider than the face the desktop app draws in on Windows", () => {
    // Segoe UI at 1000 px, as a canvas measures it.
    assert.ok(textWidth("Remove the compatibility shims", 1000) > 13_800);
    assert.ok(textWidth("WWW", 1000, 600) > 2_800);
  });
});

describe("the chart", () => {
  const SIZES = [
    [340, 300],
    [420, 420],
    [520, 640],
  ] as const;

  test("islands are packed inside the chart, none on another", () => {
    for (const name of RECORDED) {
      const d = paneData(recorded(name));
      for (const [w, h] of SIZES) {
        const isles = packIslands(d, w, h);
        assert.equal(isles.length, Math.min(24, d.groups.length), `${name} ${w}x${h}`);
        for (const c of isles) assert.ok(c.x - c.r >= 4 && c.x + c.r <= w - 4 && c.y - c.r >= 4 && c.y + c.r <= h - 4);
        for (const a of isles) for (const b of isles) if (a !== b) assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= a.r + b.r + 6 - 1e-9);
      }
    }
  });

  test("an opened island's page fits the chart, its boxes stacked, and Earlier goes back to the page before", () => {
    const d = paneData(recorded("opentofu__opentofu"));
    for (const [w, h] of SIZES) {
      for (let k = 0; k < d.groups.length; k++) {
        const page = islandPage(d, k, w, h, {});
        assert.ok(page.boxes.length > 0);
        for (const b of page.boxes) assert.ok(b.y + b.h <= h - 12 && b.x + b.w <= w - 12, `group ${k + 1}`);
        page.boxes.slice(1).forEach((b, j) => assert.ok(b.y >= page.boxes[j]!.y + page.boxes[j]!.h));
        const next = islandPage(d, k, w, h, { from: page.first + page.boxes.length });
        if (page.first + page.boxes.length < page.rows) assert.equal(earlier(d, k, w, h, next.first), 0, `group ${k + 1}`);
      }
    }
  });

  test("an opened island's boxes lie on the pane's cells, a row for the reference, one for each line of the title and one for the frame, so the pane can draw them", () => {
    const d = paneData(recorded("opentofu__opentofu"));
    for (const [w, h] of SIZES) {
      for (const b of islandPage(d, 0, w, h, {}).boxes) {
        assert.deepEqual([b.x % CELL.w, b.y % CELL.h, b.w % CELL.w, b.h % CELL.h], [0, 0, 0, 0]);
        assert.equal(b.h / CELL.h, 1 + b.lines.length + 1);
        for (const line of b.lines) assert.ok(textWidth(line, TEXT, 600) <= b.w - 4 * CELL.w, line);
      }
    }
  });

  test("an island's label gives its size only where the island holds it", () => {
    const d = paneData(recorded("opentofu__opentofu"));
    for (const c of packIslands(d, 420, 600)) {
      const { n, size } = isleLabel(d, c);
      assert.equal(n, String(c.k + 1));
      if (size) assert.ok(textWidth(size, TEXT, 600) <= 2 * c.r - 10);
    }
  });

  test("an opened island's lines never cross a box", () => {
    const d = paneData(recorded("opentofu__opentofu"));
    for (let k = 0; k < d.groups.length; k++) {
      const page = islandPage(d, k, 420, 2_000, {});
      const by = new Map(page.boxes.map((b) => [b.i, b]));
      for (const b of page.boxes) {
        const above = b.from === null ? undefined : by.get(b.from);
        if (!above) continue;
        // Down from the box above at its left, then across into this one.
        const x = above.x + 10;
        for (const other of page.boxes) {
          if (other === above || other === b) continue;
          const down = x >= other.x && x <= other.x + other.w && other.y < b.y + 15 && other.y + other.h > above.y + above.h;
          assert.ok(!down, `group ${k + 1}: ${d.issues[b.i]!.ref}'s line runs through ${d.issues[other.i]!.ref}`);
        }
      }
    }
  });

  test("a page moves back to show the Issue just left", () => {
    const d = paneData(recorded("opentofu__opentofu"));
    // The largest Group, in a chart too short to hold it on one page.
    const last = outline(d.groups[0]!).at(-1)!.i;
    assert.ok(!islandPage(d, 0, 420, 200, {}).boxes.some((b) => b.i === last));
    const page = islandPage(d, 0, 420, 200, { mark: last });
    assert.ok(page.boxes.some((b) => b.i === last));
  });

  test("is one SVG document, its titles as text, never markup, as is each island's name card", () => {
    const s = small();
    s.issues[3]!.title = `</text><script>alert(1)</script> & "quoted"`;
    const d = paneData(s);
    const cards = d.groups.map((_, k) => isleCaption(d, k, 420).source);
    assert.ok(cards.some((card) => card.includes("&#60;/text&#62;&#60;script&#62;")));
    for (const source of [seaChart(d, 420, 400).source, islandChart(d, 0, 420, 400, islandPage(d, 0, 420, 400, {}), { grow: true }), ...cards]) {
      assert.match(source, /^<svg [^>]*>[\s\S]*<\/svg>$/);
      assert.doesNotMatch(source, /<script/);
      assert.ok(source.length < 131_072);
    }
  });

  test("an island's lantern marks a Group holding an Issue in Take next, larger on the one to start with", () => {
    const d = paneData(small());
    const { source } = seaChart(d, 420, 400);
    assert.equal((source.match(/fill="var\(--pick\)"/g) ?? []).length, 2);
    assert.match(source, /r="6" fill="var\(--pick\)"/);
  });

  test("the share bar gives each share its length, leaving out an empty one", () => {
    const widths = (source: string) => [...source.matchAll(/<rect x="[\d.]+" width="([\d.]+)" height="7" fill="var\(--(\w+)\)"/g)].map((m) => [m[2], Number(m[1])]);
    assert.deepEqual(widths(shareBar([1, 0, 2], 302)), [["pick", 100], ["faint", 200]]);
    assert.deepEqual(widths(shareBar([15, 34, 228], 400)).map(([kind]) => kind), ["pick", "stop", "faint"]);
  });
});
