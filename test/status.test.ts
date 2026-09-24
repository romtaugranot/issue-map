/**
 * The optional status line (#40): one row of the Home Project's Take next,
 * drawn from what the background refresher keeps beside its Snapshot.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { draw } from "../src/map/draw.ts";
import { statusRow } from "../src/map/status.ts";
import type { Snapshot } from "../src/snapshot/snapshot.ts";
import type { Glance } from "../src/snapshot/store.ts";
import type { Project } from "../src/tracker/tracker.ts";
import { statusLine, type StatusDeps } from "../src/status/line.ts";
import { snapshot, PROJECT } from "./fakes/snapshot-builder.ts";

function recorded(name: string): Snapshot {
  const file = new URL(`./fixtures/snapshots/${name}.json.gz`, import.meta.url);
  return JSON.parse(gunzipSync(readFileSync(file)).toString("utf8")) as Snapshot;
}

/** The overview's first Take next line, less its `- `. */
function firstTakeNext(s: Snapshot): string | undefined {
  const lines = draw(s, { kind: "overview" }).text.split("\n");
  const heading = lines.findIndex((l) => l.startsWith("**Take next"));
  return lines[heading + 1]?.startsWith("- ") ? lines[heading + 1]!.slice(2) : undefined;
}

describe("the status line's row", () => {
  for (const name of ["opentofu__opentofu", "rust-lang__rust", "gitlab-org__gitlab"]) {
    test(`${name}: its next Issue is the overview's first in Take next, word for word`, () => {
      const s = recorded(name);
      const next = firstTakeNext(s);
      assert.ok(next, "the recording has a Take next");
      const row = statusRow(s);
      assert.ok(row.startsWith(`◆ ${s.project.path} · Take next: `), row);
      assert.ok(row.endsWith(` · ${next}`), `${row}\nwants: ${next}`);
    });
  }

  test("opentofu/opentofu: counts Take next as the overview does", () => {
    assert.match(statusRow(recorded("opentofu__opentofu")), /^◆ opentofu\/opentofu · Take next: 15 · #4227 /);
  });

  test("microsoft/playwright: no Links, so no Take next", () => {
    assert.equal(statusRow(recorded("microsoft__playwright")), "◆ microsoft/playwright · No Issue here has a Link, so there's no Map to draw");
  });

  test("names the most waited-on Issue with why, as the overview does", () => {
    const s = snapshot([{ n: 1, title: "Land the API" }, { n: 2 }, { n: 3 }, { n: 4 }], [[1, "blocks", 2], [2, "blocks", 3], [4, "blocks", 3]]);
    assert.equal(statusRow(s), `◆ ${PROJECT} · Take next: 2 · #1 Land the API — ▶2 wait on it`);
  });

  test("says when every Unblocked Issue is taken by others", () => {
    const s = snapshot([{ n: 1, assignees: ["someone"] }, { n: 2 }], [[1, "blocks", 2]]);
    assert.equal(statusRow(s), `◆ ${PROJECT} · Take next: 0 — all 1 Unblocked Issue is taken by others`);
  });

  test("says when every Issue on the Map is Blocked", () => {
    const s = snapshot([{ n: 1 }, { n: 2 }], [[1, "blocks", 2], [2, "blocks", 1]]);
    assert.equal(statusRow(s), `◆ ${PROJECT} · Take next: 0 — every Issue on the Map is Blocked, or a Parent of Blocked Issues`);
  });

  test("calls nothing Unblocked where Blocks Links can't be read", () => {
    const s = snapshot([{ n: 1 }, { n: 2 }], [[1, "parent", 2]], { blocks: "GitLab Free doesn't record them" });
    assert.equal(statusRow(s), `◆ ${PROJECT} · Take next: none — the Map can't read this Project's Blocks Links`);
  });

  test("draws nothing of a Refused Project", () => {
    const none = { kind: "cant-record", reason: "GitLab 13.3.0 records no Link kind the Map can read" } as const;
    const s = snapshot([{ n: 1 }], [], { blocks: none.reason }, { untested: "GitLab 13.3.0 is older than 16.0", links: { blocks: none, parent: none, related: none } });
    assert.equal(statusRow(s), `◆ ${PROJECT} · Refused: the Map can read no Link kind here`);
  });
});

const home: Project = { id: "github.com#1", host: "github.com", path: "fixture-org/tools", url: "https://github.com/fixture-org/tools", issues: { open: 250 } };

/** A checkout at `/work/tools` whose Home Project is `home`, and what the store holds of each Project, by Tracker and identity. */
function deps(glances: Record<string, Glance>, options: { home?: Project | null } = {}): StatusDeps & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    checkoutRoot: async (dir) => (dir.startsWith("/work/tools") ? "/work/tools" : null),
    lastHome: async (root) => (root === "/work/tools" && options.home !== null ? (options.home ?? home) : undefined),
    store: {
      async glance(tracker, project) {
        asked.push(`${tracker} ${project}`);
        return glances[`${tracker} ${project}`] ?? { kind: "none" };
      },
    },
  };
}

describe("the status line", () => {
  const row = `◆ fixture-org/tools · Take next: 2 · #1 Land the API — ▶2 wait on it`;

  test("shows the row kept beside the Home Project's Snapshot, from anywhere in its checkout", async () => {
    assert.equal(await statusLine(deps({ "github.com github.com#1": { kind: "ready", line: row, ageMs: 100_000 } }), "/work/tools/src"), row);
  });

  test("says how old the Snapshot is once it stops being fresh, as the Map does", async () => {
    const shown = await statusLine(deps({ "github.com github.com#1": { kind: "ready", line: row, ageMs: 3 * 3_600_000 + 60_000 } }), "/work/tools");
    assert.equal(shown, `${row} · read 3h ago`);
  });

  test("always shows the Home Project, never a Project the user moved to", async () => {
    const elsewhere = { "gitlab.com gitlab.com#9": { kind: "ready", line: "◆ fixture-group/app · Take next: 1 · #3 Elsewhere", ageMs: 0 } } as const;
    const d = deps({ ...elsewhere, "github.com github.com#1": { kind: "ready", line: row, ageMs: 0 } });
    assert.equal(await statusLine(d, "/work/tools"), row);
    assert.deepEqual(d.asked, ["github.com github.com#1"]);
  });

  test("says how far the first read has got", async () => {
    const shown = await statusLine(deps({ "github.com github.com#1": { kind: "reading", read: 1200, total: 48243 } }), "/work/tools");
    assert.equal(shown, "◆ fixture-org/tools · reading it for the first time: 1,200 of 48,243 Issues (2%)");
  });

  test("with nothing kept warm for the Home Project, asks for the Map rather than reading it", async () => {
    assert.equal(await statusLine(deps({}), "/work/tools"), "◆ fixture-org/tools · ask for the Map to see Take next here");
  });

  test("before the Home Project is known, asks for the Map", async () => {
    assert.equal(await statusLine(deps({}, { home: null }), "/work/tools"), "◆ No Home Project yet · ask for the Map");
  });

  test("outside a git checkout, shows nothing", async () => {
    assert.equal(await statusLine(deps({}), "/somewhere/else"), "");
  });
});
