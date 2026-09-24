/**
 * Seam A: starting work, `(an Issue's thread, the Map's Project) → text`
 * for Claude to brief the user from, with no network and no clock. However
 * long the thread, the text stays within a fixed budget.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { drawThread, THREAD_BUDGET } from "../src/map/start.ts";
import type { IssueComment, Thread } from "../src/tracker/tracker.ts";

const PROJECT = "fixture-org/tools";

function thread(more: Partial<Thread> = {}): Thread {
  return {
    ref: `${PROJECT}#12`,
    title: "Import state from S3",
    url: `https://github.com/${PROJECT}/issues/12`,
    open: true,
    body: "State lives in S3.",
    comments: [
      { author: "fixture-dev", at: "2026-02-01T10:00:00Z", body: "I can take this." },
      { author: null, at: "2026-02-02T10:00:00Z", body: "Reproduced on main." },
    ],
    earlier: false,
    ...more,
  };
}

const comment = (n: number, body = `Comment ${n}`): IssueComment => ({ author: "fixture-dev", at: new Date(Date.UTC(2026, 1, n)).toISOString(), body });

describe("starting work on an Issue", () => {
  test("a short thread is given whole: the Issue, its body, then its comments oldest first with who wrote each and when", () => {
    assert.equal(
      drawThread(thread(), PROJECT),
      [
        "**#12 Import state from S3**",
        "https://github.com/fixture-org/tools/issues/12",
        "Open · 2 comments",
        "",
        "**Body**",
        "State lives in S3.",
        "",
        "**Comments**, oldest first",
        "",
        "fixture-dev on 2026-02-01:",
        "I can take this.",
        "",
        "a deleted account on 2026-02-02:",
        "Reproduced on main.",
      ].join("\n"),
    );
  });

  test("says when the Issue is closed, has no body, or has no comments", () => {
    const text = drawThread(thread({ open: false, body: "  ", comments: [] }), PROJECT);
    assert.deepEqual(text.split("\n").slice(2), ["Closed · no comments", "", "**Body**", "(none)"]);
  });

  test("an Outside Issue is named in full", () => {
    const text = drawThread(thread({ ref: "fixture-org/plans#7" }), PROJECT);
    assert.equal(text.split("\n")[0], "**↗fixture-org/plans#7 Import state from S3**");
  });

  test("a very long thread stays within the budget", () => {
    const log = "Error: access denied\n".repeat(3_000);
    const huge = thread({ body: log, comments: Array.from({ length: 100 }, (_, i) => comment(i + 1, log)), earlier: true });
    assert.ok(drawThread(huge, PROJECT).length <= THREAD_BUDGET, `${drawThread(huge, PROJECT).length} characters`);
  });

  test("a long body or comment keeps its start and its end, and says how much was left out between", () => {
    const body = `Steps to reproduce.\n${"x".repeat(50_000)}\nThe last line of the log.`;
    const text = drawThread(thread({ body, comments: [] }), PROJECT);
    assert.match(text, /\*\*Body\*\*\nSteps to reproduce\./);
    assert.match(text, /\[… [\d,]+ characters left out …\]/);
    assert.match(text, /The last line of the log\.$/);
  });

  test("when the comments don't all fit, the latest are kept, and it says how many earlier ones were left out", () => {
    const long = "y".repeat(1_400);
    const many = thread({ comments: Array.from({ length: 60 }, (_, i) => comment(i + 1, `Comment ${i + 1} ${long}`)) });
    const text = drawThread(many, PROJECT);
    assert.match(text, /Comment 60 /);
    assert.doesNotMatch(text, /Comment 1 /);
    const left = Number(/\*\*Comments\*\*, oldest first — the (\d+) earlier ones are left out/.exec(text)?.[1]);
    assert.ok(left > 0 && !text.includes(`Comment ${left} `) && text.includes(`Comment ${left + 1} `), `left out ${left}`);
    assert.match(text.split("\n")[2]!, /^Open · 60 comments$/);
  });

  test("says when the Tracker gave only the latest comments", () => {
    const text = drawThread(thread({ comments: [comment(1)], earlier: true }), PROJECT);
    assert.match(text.split("\n")[2]!, /^Open · the latest 1 comment read; earlier ones weren't$/);
  });
});
