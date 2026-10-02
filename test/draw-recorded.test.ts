/**
 * Seam A against the four Snapshots recorded for the prototypes (#9, #22).
 * Expected counts are the ones those prototypes and ADR 0008 measured.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { draw } from "../src/map/draw.ts";
import type { Snapshot } from "../src/snapshot/snapshot.ts";

function recorded(name: string): Snapshot {
  const file = new URL(`./fixtures/snapshots/${name}.json.gz`, import.meta.url);
  return JSON.parse(gunzipSync(readFileSync(file)).toString("utf8")) as Snapshot;
}

/**
 * About 20 lines, whatever the Project's size (#22): the header, Take next's
 * heading and 5 lines, the Groups' heading, 8 lines and a count, the Unlinked
 * line, and the three blank lines between them.
 */
const OVERVIEW_LINES = 21;

/** One level of a Group's outline, whatever the Group holds: the header, a blank line, the level's heading, 10 lines, a blank line and a hint. */
const OUTLINE_LINES = 15;

describe("recorded Snapshots", () => {
  test("opentofu/opentofu: 277 open, 233 of them Unlinked", () => {
    const text = draw(recorded("opentofu__opentofu"), { kind: "overview" }).text;
    assert.match(text.split("\n")[0]!, /^\*\*opentofu\/opentofu\*\* · 277 open · 44 on the Map · 233 Unlinked · Promised$/);
  });

  // The worked example of #12: the RFC Tracker has four waiting on it and gives way to its unassigned children.
  test("opentofu/opentofu: Take next opens with #3414's children, carrying its count", () => {
    const lines = section(draw(recorded("opentofu__opentofu"), { kind: "overview" }).text, "**Take next");
    assert.match(lines[0]!, /^\*\*Take next: 15\*\* — most waited on first · 10 more not listed · 4 taken by others · Closing Requests unread \(the recording didn't read them\)/);
    assert.deepEqual(lines.slice(1, 4).map((l) => l.replace(/^(- #\d+) .* — /, "$1 — ")), ["- #4227 — ▶4 via #3414", "- #4297 — ▶4 via #3414", "- #4390 — ▶4 via #3414"]);
  });

  // #20 measured it: 7 open Issues have a closed blocker, and for 6 it's their only Link, so they're Unlinked and still in Take next.
  test("opentofu/opentofu: an Unlinked Issue whose blocker closed is marked on the Unlinked list, by the blocker, since the recording has no close dates", () => {
    const page = draw(recorded("opentofu__opentofu"), { kind: "unlinked", page: 6 }).text.split("\n");
    assert.ok(page.includes(String.raw`- #3107 \`-detailed-exitcode\` should exit with status 2 when \`-refre… — unblocked since #3595 closed`), page.join("\n"));
    assert.ok(page.some((l) => l.startsWith("- #3163 ") && l.endsWith(" — unblocked since ↗golang/go#71924 closed")), "an Outside blocker too");
  });

  test("microsoft/playwright: no Links, so no Map", () => {
    const lines = draw(recorded("microsoft__playwright"), { kind: "overview" }).text.split("\n");
    assert.equal(lines[0], "**microsoft/playwright** · 176 open · 0 on the Map · 176 Unlinked · Promised");
    assert.equal(lines[2], "No Issue here has a Link, so there's no Map to draw.");
    assert.equal(lines[4], "**Unlinked: 176** — no Link to another open Issue. Ask to list them.");
  });

  // #22's README gives 473 on the Map in 63 Groups, but its own renderer draws 263 in 70 from this recording.
  test("rust-lang/rust: 263 on the Map in 70 Groups, the largest holding 29", () => {
    const text = draw(recorded("rust-lang__rust"), { kind: "overview" }).text;
    assert.equal(text.split("\n")[0], "**rust-lang/rust** · 11,219 open · 263 on the Map · 10,956 Unlinked · Promised");
    const groups = section(text, "**Groups");
    assert.equal(groups[0], "**Groups: 70** — largest first");
    assert.match(groups[1]!, / — 29 Issues(, \d+↗)?$/);
  });

  describe("gitlab-org/gitlab, the largest", () => {
    const snapshot = recorded("gitlab-org__gitlab");
    const overview = draw(snapshot, { kind: "overview" }).text;
    const lines = overview.split("\n");

    test("22,797 on the Map in 5,812 Groups, the largest holding 306 (ADR 0008)", () => {
      assert.equal(lines[0], "**gitlab-org/gitlab** · 48,243 open · 22,797 on the Map · 25,446 Unlinked · Promised");
      const groups = section(overview, "**Groups");
      assert.equal(groups[0], "**Groups: 5,812** — largest first");
      assert.match(groups[1]!, / — 306 Issues(, \d+↗)?$/);
    });

    test(`the overview holds its line budget of ${OVERVIEW_LINES}`, () => {
      assert.ok(lines.length <= OVERVIEW_LINES, `${lines.length} lines:\n${overview}`);
      assert.equal(section(overview, "**Take next").length, 6, "Take next's heading and 5 lines");
      assert.equal(section(overview, "**Groups").length, 10, "the Groups' heading, 8 lines and a count");
    });

    test(`opening the largest Group, 306 Issues under one Outside Issue, holds the outline's line budget of ${OUTLINE_LINES}`, () => {
      const outline = draw(snapshot, { kind: "group", group: 1, page: 1 }).text;
      const lines = outline.split("\n");
      assert.ok(lines.length <= OUTLINE_LINES, `${lines.length} lines:\n${outline}`);
      assert.match(lines[0]!, /^\*\*Group 1 of 5,812\*\* · ↗gitlab-org&8918 .* \(an Outside Issue\) — 306 Issues, 1↗$/);
      assert.match(lines[2]!, /^\*\*Under ↗gitlab-org&8918, alone at the top: 306\*\* — oldest first · page 1 of 31$/);
      assert.equal(lines.filter((l) => l.startsWith("- ")).length, 10);
      for (const page of [2, 31]) {
        const later = draw(snapshot, { kind: "under", ref: "gitlab-org&8918", page }).text.split("\n");
        assert.ok(later.length <= OUTLINE_LINES, `page ${page}: ${later.length} lines`);
      }
    });

    test("the Group list pages all 5,812 Groups 15 at a time, the first 8 as the overview lists them", () => {
      const first = draw(snapshot, { kind: "groups", page: 1 }).text.split("\n");
      assert.equal(first[0], "**Groups: 5,812** — largest first, page 1 of 388");
      assert.deepEqual(first.slice(1, 9).map((l) => l.replace(/^\d+\. /, "- ")), section(overview, "**Groups").slice(1, 9));
      assert.match(section(overview, "**Groups")[9]!, /^- … 5,804 more Groups, [\d,]+ Issues\. Ask to list them\.$/);
      const last = draw(snapshot, { kind: "groups", page: 388 }).text.split("\n");
      assert.deepEqual(last.filter((l) => /^\d+\. /.test(l)).map((l) => l.split(".")[0]), ["5806", "5807", "5808", "5809", "5810", "5811", "5812"]);
    });

    test("an Unlinked page stays 15 Issues", () => {
      const page = draw(snapshot, { kind: "unlinked", page: 2 }).text.split("\n");
      assert.equal(page[0], "**Unlinked: 25,446** — newest first, page 2 of 1,697");
      assert.equal(page.filter((l) => l.startsWith("- ")).length, 15);
    });
  });
});

/** One section of an overview: the line starting with `heading`, and the lines up to the next blank one. */
function section(text: string, heading: string): string[] {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.startsWith(heading));
  return lines.slice(start, lines.indexOf("", start));
}
