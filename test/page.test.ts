/**
 * The HTML Picture (ADR 0010, #85): one self-contained page of the whole
 * Map, drawn from the same Snapshot by the same rules as the in-session Map.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { layout } from "../src/map/links.ts";
import { htmlPicture, pageData, pageSaid } from "../src/map/page.ts";
import { takeNext } from "../src/map/take-next.ts";
import type { Snapshot } from "../src/snapshot/snapshot.ts";
import { snapshotStore, type SnapshotKey } from "../src/snapshot/store.ts";
import { snapshot } from "./fakes/snapshot-builder.ts";

/** #1 Blocks #2 and #3, #4 is the Parent of #5, #6 Blocks #7 but is assigned to someone else, #8 is Unlinked; #9 reaches an Outside Issue. */
const built = () =>
  snapshot(
    [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }, { n: 5 }, { n: 6, assignees: ["someone"] }, { n: 7 }, { n: 8, title: "</script><script>alert(1)</script>" }, { n: 9 }],
    [[1, "blocks", 2], [1, "blocks", 3], [4, "parent", 5], [6, "blocks", 7], [9, "blocks", { outside: "other/proj#3" }]],
  );

describe("what the page shows", () => {
  test("its Take next and Groups are the in-session Map's, in the same order", () => {
    const s = built();
    const laidOut = layout(s);
    const next = takeNext(s, laidOut);
    const data = pageData(s);
    const ref = (i: number) => data.issues[i]!.ref;
    assert.equal(next.kind, "list");
    if (next.kind !== "list") return;
    assert.deepEqual(data.next.picks.map((p) => ref(p.issue)), next.picks.map((p) => p.issue.ref));
    assert.deepEqual(data.next.taken.map((p) => ref(p.issue)), next.takenByOthers.map((p) => p.issue.ref));
    assert.deepEqual(data.groups.map((g) => ref(g.head)), laidOut.groups.map((g) => (g.head.kind === "issue" ? g.head.issue.ref : g.head.end.readable ? `↗${g.head.end.ref}` : "")));
    assert.deepEqual(data.groups.map((g) => [g.size, g.unblocked]), laidOut.groups.map((g) => [g.issues.length, g.issues.filter((i) => next.unblocked.has(i)).length]));
    assert.deepEqual(data.unlinked.map(ref), ["#8"]);
  });

  test("each Issue links to its Tracker, and an Outside Issue is marked", () => {
    const data = pageData(built());
    const outside = data.issues.find((i) => i.ref === "↗other/proj#3");
    assert.equal(outside?.url, "https://github.com/other/proj/issues/3");
    assert.equal(data.issues.find((i) => i.ref === "#1")?.url, "https://github.com/fixture-org/tools/issues/1");
  });

  test("it says how old its Snapshot is, and why it couldn't be refreshed", () => {
    const data = pageData(built(), { stale: { ageMs: 3_600_000, reason: "github.com didn't answer" } });
    assert.equal(data.readAt, "2026-09-23T00:00:00Z");
    assert.equal(data.stale, "github.com didn't answer");
  });
});

describe("the page itself", () => {
  test("is one file that can make no request: everything inline, and a policy that forbids fetching", () => {
    const html = htmlPicture(built());
    assert.match(html, /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">/);
    assert.doesNotMatch(html, /<link\b|\bsrc=|@import|url\(/i);
  });

  test("a title can't close the script it's kept in", () => {
    const html = htmlPicture(built());
    assert.equal(html.match(/<\/script>/g)?.length, 2, "only the page's own two scripts end");
    const data = JSON.parse(html.match(/<script type="application\/json" id="data">([\s\S]*?)<\/script>/)![1]!);
    assert.ok(data.issues.some((i: { title: string }) => i.title === "</script><script>alert(1)</script>"));
  });
});

describe("where it's written", () => {
  const key: SnapshotKey = { tracker: "github.com", project: "github.com#1", login: "fixture-viewer" };

  test("in the state directory, readable only by its owner, one per Tracker, Project and login, and replaced by the next", async () => {
    const dir = mkdtempSync(join(tmpdir(), "issue-map-page-"));
    const store = snapshotStore(dir, { now: Date.now });
    const path = await store.page(key, "<p>first</p>");
    assert.ok(path.startsWith(dir));
    assert.equal(statSync(path).mode & 0o077, 0);
    assert.equal(await store.page(key, "<p>second</p>"), path);
    assert.equal(readFileSync(path, "utf8"), "<p>second</p>");
    assert.notEqual(await store.page({ ...key, login: "other" }, "<p>other</p>"), path);
  });

  test("deleted with its Snapshot", async () => {
    const dir = mkdtempSync(join(tmpdir(), "issue-map-page-"));
    const store = snapshotStore(dir, { now: Date.now });
    const path = await store.page(key, "<p>Issue 1</p>");
    await store.forget(key, "github.com refused this login");
    assert.ok(!readdirSync(join(path, "..")).some((name) => name.endsWith(".html")));
  });
});

describe("what it says of where the page is", () => {
  const path = "/home/me/.local/state/issue-map/snapshots/github.com/1/me.picture.html";

  test("on this machine, its path to open", () => {
    const said = pageSaid(path, {});
    assert.ok(said.includes(path));
    assert.doesNotMatch(said, /scp|can't reach/);
  });

  test("over SSH, there's no browser here: its path and a ready scp command", () => {
    const said = pageSaid(path, { SSH_CONNECTION: "10.0.0.2 51234 10.0.0.9 22", USER: "me" });
    assert.match(said, /no browser/);
    assert.ok(said.includes(`scp 'me@10.0.0.9:${path}' .`), said);
  });

  test("in a cloud session, the page can't reach this device", () => {
    const said = pageSaid(path, { CLAUDE_CODE_REMOTE: "true" });
    assert.match(said, /can't reach/);
    assert.doesNotMatch(said, /scp/);
  });
});

describe("gitlab-org/gitlab, the largest recorded Snapshot", () => {
  const file = new URL("./fixtures/snapshots/gitlab-org__gitlab.json.gz", import.meta.url);
  const recorded = JSON.parse(gunzipSync(readFileSync(file)).toString("utf8")) as Snapshot;

  test("fits one page well under an Artifact's 16 MB, every Group listed", () => {
    const html = htmlPicture(recorded);
    assert.ok(html.length < 16_000_000, `${html.length} characters`);
    const data = JSON.parse(html.match(/<script type="application\/json" id="data">([\s\S]*?)<\/script>/)![1]!);
    assert.equal(data.groups.length, 5_812);
    assert.equal(data.unlinked.length, 25_446);
  });
});
