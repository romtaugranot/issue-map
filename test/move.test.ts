/**
 * Moving to another Project: typed targets, `go`, `back`, `map` and `home`.
 * The Trackers are fakes, the trail and recent Projects are kept in memory,
 * and the Map's drawing is stood in for by a line naming what was drawn,
 * since the drawing module is tested on its own. Local paths are real git
 * checkouts.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { move, localCheckouts, type Answer, type MoveDeps, type Position, type Recent, type Request } from "../src/move/move.ts";
import { showCard } from "../src/map/show.ts";
import { assignToViewer } from "../src/map/assign.ts";
import { startWork } from "../src/map/start.ts";
import { snapshotStore } from "../src/snapshot/store.ts";
import type { HomeAnswer } from "../src/home/home.ts";
import type { Command } from "../src/map/draw.ts";
import type { FarEnd, IssueRead, NamedLink, Project, Tracker } from "../src/tracker/tracker.ts";
import { fakeTrackers, type FakeHost } from "./fakes/fake-trackers.ts";

const HOME = "fixture-org/tools";
const PLANS = "fixture-org/plans";
const NOW = Date.parse("2026-09-24T12:00:00Z");
const HOUR = 3_600_000;

function end(project: string, n: number, host = "github.com"): FarEnd {
  return { id: `${project}#${n}`, readable: true, open: true, project, ref: `${project}#${n}`, title: `Issue ${n}`, url: `https://${host}/${project}/issues/${n}` };
}

function read(project: string, n: number, links: NamedLink[] = []): IssueRead {
  return { id: `${project}#${n}`, project, ref: `${project}#${n}`, title: `Issue ${n}`, url: `https://github.com/${project}/issues/${n}`, open: true, assignees: [], closedAs: null, links, closingRequests: [], mentionedBy: [], unread: {} };
}

/** #12 in the Home Project has a Parent outside it, plans#7, whose own Links the Home Project's Map never reads. */
const hosts: Record<string, FakeHost> = {
  "github.com": {
    product: "GitHub",
    projects: [
      { path: HOME, open: 20 },
      { path: PLANS, open: 5 },
      { path: "fixture-org/other", open: 3 },
      { path: "fixture-org/quiet", open: 0 },
      { path: "fixture-org/wiki", open: "off" },
      { path: "fixture-org/refused", open: 4 },
      { path: "fixture-viewer/dotfiles", open: 2 },
    ],
    issues: [
      read(HOME, 12, [{ role: "parent", name: "Parent issue", to: end(PLANS, 7) }]),
      read(PLANS, 7, [{ role: "child", name: "Sub-issues", to: end(HOME, 12) }, { role: "child", name: "Sub-issues", to: end(PLANS, 8) }]),
    ],
  },
  "gitlab.com": { product: "GitLab", projects: [{ path: "fixture-group/sub/app", open: 9 }], issues: [] },
};

interface World {
  deps: MoveDeps;
  trail: () => Position[];
  recents: () => Recent[];
  /** What the Map drew, one line per draw. */
  drawn: string[];
  reads: string[];
  go(request: Request): Promise<Answer>;
}

async function world(options: { others?: HomeAnswer["others"]; trail?: Position[]; recents?: Recent[]; noHome?: boolean; hosts?: Record<string, FakeHost> } = {}): Promise<World> {
  const trackers = fakeTrackers(options.hosts ?? hosts);
  const github = await trackers.at("github.com");
  assert.equal(github.kind, "identified");
  const tracker = (github as { tracker: Tracker }).tracker;
  const project: Project = { id: `github.com#${HOME}`, host: "github.com", path: HOME, url: `https://github.com/${HOME}`, issues: { open: 20 } };
  const home: HomeAnswer = options.noHome
    ? { text: "No Home Project: this checkout has no remote that leads to a Tracker.", choices: [], others: [] }
    : { text: `Home Project: github.com/${HOME} — 20 open Issues`, choices: [], others: options.others ?? [], home: { tracker, project } };
  let trail = options.trail ?? [];
  let recents = options.recents ?? [];
  const drawn: string[] = [];
  const deps: MoveDeps = {
    trackers,
    home,
    trail: { get: async () => trail, set: async (next) => void (trail = next) },
    recents: { get: async () => recents, set: async (next) => void (recents = next) },
    checkouts: localCheckouts({ trackers, env: {}, sshHostname: async (alias) => alias }, tmpdir()),
    now: () => NOW,
    async showMap(_tracker, project, command: Command, at) {
      const line = `${project.path} ${command.kind}${at.home ? " (kept warm)" : ""}${at.away ? ` · ⌂ ${at.away}` : ""}`;
      drawn.push(line);
      if (project.path === "fixture-org/refused") return { text: `No Map of github.com/${project.path}: GitHub can read no Link kind here`, drew: "nothing" };
      return { text: `MAP ${line}`, drew: "map" };
    },
    showCard,
    start: startWork,
    assign: (tracker, project, ref) => assignToViewer({ store: snapshotStore(mkdtempSync(join(tmpdir(), "issue-map-move-")), { now: () => NOW }) }, tracker, project, ref),
    suggest: async (_tracker, project, view) => `SUGGEST ${project.path} ${view.kind}`,
    offer: async () => ({ text: "OFFER" }),
    confirm: async () => "CONFIRM",
  };
  return {
    deps,
    trail: () => trail,
    recents: () => recents,
    drawn,
    reads: trackers.reads,
    go: (request) => move(deps, request),
  };
}

const where = (w: World) => w.trail().map(({ project, view }) => `${project.path} ${view.kind === "card" ? view.ref : view.kind}`);

/** A real git checkout with these remotes and this local config. */
function checkout(remotes: Record<string, string>, config: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "issue-map-move-"));
  git(dir, "init", "-q");
  for (const [name, url] of Object.entries(remotes)) git(dir, "remote", "add", name, url);
  for (const [key, value] of Object.entries(config)) git(dir, "config", "--local", key, value);
  return dir;
}

function git(dir: string, ...args: string[]): string {
  try {
    return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

describe("a typed target", () => {
  test("a Project's URL moves to its overview, away from home", async () => {
    const w = await world();
    const answer = await w.go({ kind: "go", target: `https://github.com/${PLANS}` });
    assert.equal(answer.text, `MAP ${PLANS} overview · ⌂ ${HOME}`);
    assert.deepEqual(where(w), [`${HOME} overview`, `${PLANS} overview`]);
  });

  test("an Issue's URL lands on its card inside its own Project's Map, which shows its Links", async () => {
    const w = await world();
    const answer = await w.go({ kind: "go", target: `https://github.com/${PLANS}/issues/7` });
    assert.match(answer.text, /^\*\*#7 Issue 7\*\*\\$/m, "named inside its own Project, not as an Outside Issue");
    assert.match(answer.text, /^\*\*Sub-issues: 2\*\*$/m);
    assert.deepEqual(answer.links.map((c) => c.label), [`${HOME}#12`, "#8"]);
    assert.deepEqual(where(w), [`${HOME} overview`, `${PLANS} #7`]);
    assert.deepEqual(w.drawn, [], "a card is read live, with no Map drawn");
  });

  test("an owner/repo moves to its overview, and an owner/repo#n to that Issue's card", async () => {
    const w = await world();
    assert.equal((await w.go({ kind: "go", target: PLANS })).text, `MAP ${PLANS} overview · ⌂ ${HOME}`);
    assert.match((await w.go({ kind: "go", target: `${PLANS}#7` })).text, /^\*\*#7 Issue 7\*\*\\$/m);
    assert.deepEqual(where(w), [`${HOME} overview`, `${PLANS} overview`, `${PLANS} #7`]);
  });

  test("a short name is looked up on the Tracker on screen, then the Home Project's, then the other well-known Trackers", async () => {
    const w = await world();
    assert.equal((await w.go({ kind: "go", target: "fixture-group/sub/app" })).text, `MAP fixture-group/sub/app overview · ⌂ ${HOME}`);
    assert.deepEqual(w.reads, ["github.com/fixture-group/sub/app", "gitlab.com/fixture-group/sub/app"]);
    w.reads.length = 0;
    assert.equal((await w.go({ kind: "go", target: "gitlab.com/fixture-group/sub/app" })).text, `MAP fixture-group/sub/app overview · ⌂ ${HOME}`);
    assert.deepEqual(w.reads, ["gitlab.com/fixture-group/sub/app"], "a name that starts with a host is read there alone");
  });

  test("a short name more than one Tracker holds is asked about, one choice per Tracker", async () => {
    const both = { ...hosts, "gitlab.com": { ...hosts["gitlab.com"]!, projects: [{ path: PLANS, open: 2 }] } };
    const w = await world({ hosts: both });
    const asked = await w.go({ kind: "go", target: PLANS });
    assert.equal(asked.text, `More than one Tracker holds ${PLANS}: ask which one to open.`);
    assert.deepEqual(asked.choices, [
      { label: `github.com/${PLANS}`, description: "GitHub · 5 open Issues", run: `issue-map go 'github.com/${PLANS}'` },
      { label: `gitlab.com/${PLANS}`, description: "GitLab · 2 open Issues", run: `issue-map go 'gitlab.com/${PLANS}'` },
    ]);
    assert.deepEqual(w.trail(), [], "asking isn't moving");
  });

  test("a local path moves to the Project that checkout opens on", async () => {
    const w = await world();
    const dir = checkout({ origin: `https://github.com/${PLANS}.git` });
    assert.equal((await w.go({ kind: "go", target: dir })).text, `MAP ${PLANS} overview · ⌂ ${HOME}`);
    assert.deepEqual(where(w), [`${HOME} overview`, `${PLANS} overview`]);
  });

  test("a local path that leads to several Projects asks which, and the pick is saved in that checkout", async () => {
    const w = await world();
    const dir = checkout({ upstream: `https://github.com/${PLANS}.git`, origin: "https://github.com/fixture-org/other.git" });
    const asked = await w.go({ kind: "go", target: dir });
    assert.equal(asked.text, `${dir} leads to 2 Projects with open Issues. Ask which one to open; the pick is saved in that checkout, as its Home Project.`);
    assert.deepEqual(asked.choices, [
      { label: `github.com/${PLANS}`, description: "5 open Issues · remote upstream", run: `issue-map go '${dir}' --pick-there 'https://github.com/${PLANS}'` },
      { label: "github.com/fixture-org/other", description: "3 open Issues · remote origin", run: `issue-map go '${dir}' --pick-there 'https://github.com/fixture-org/other'` },
    ]);
    assert.deepEqual(w.trail(), [], "asking isn't moving");

    const picked = await w.go({ kind: "go", target: dir, pickThere: "https://github.com/fixture-org/other" });
    assert.equal(picked.text, `MAP fixture-org/other overview · ⌂ ${HOME}`);
    assert.equal(git(dir, "config", "--local", "--get", "issue-map.home"), "https://github.com/fixture-org/other");
    assert.equal((await w.go({ kind: "go", target: dir })).text, `MAP fixture-org/other overview · ⌂ ${HOME}`, "and isn't asked again");
  });

  test("a reference like #7 names an Issue in the Project on screen", async () => {
    const w = await world({ trail: [{ project: { id: "github.com#fixture-org/plans", host: "github.com", path: PLANS, url: `https://github.com/${PLANS}`, issues: { open: 5 } }, view: { kind: "overview" } }] });
    assert.match((await w.go({ kind: "go", target: "#7" })).text, /^\*\*#7 Issue 7\*\*\\$/m);
  });
});

describe("`go` on its own", () => {
  test("offers up to four nearby Projects: the checkout's others and added directories first, then recent ones, newest first", async () => {
    const others = [{ label: "github.com/fixture-org/other", description: "3 open Issues · remote upstream", url: "https://github.com/fixture-org/other" }];
    const added = checkout({ origin: "https://gitlab.com/fixture-group/sub/app.git" });
    const recents: Recent[] = [
      { host: "github.com", path: "fixture-org/quiet", openedAt: NOW - 50 * HOUR },
      { host: "github.com", path: PLANS, openedAt: NOW - 2 * HOUR },
      { host: "github.com", path: "fixture-org/wiki", openedAt: NOW - 30 * HOUR },
    ];
    const w = await world({ others, recents });
    const answer = await w.go({ kind: "go", dirs: [added] });
    assert.deepEqual(answer.choices, [
      { label: "github.com/fixture-org/other", description: "3 open Issues · remote upstream", run: "issue-map go 'https://github.com/fixture-org/other'" },
      { label: "gitlab.com/fixture-group/sub/app", description: `added directory ${added}`, run: `issue-map go '${added}'` },
      { label: `github.com/${PLANS}`, description: "opened 2h ago", run: `issue-map go 'github.com/${PLANS}'` },
      { label: "github.com/fixture-org/wiki", description: "opened 1d ago", run: "issue-map go 'github.com/fixture-org/wiki'" },
    ]);
    assert.match(answer.text, /Other takes/);
  });

  test("makes no Tracker read, so never lists the viewer's own Projects, and leaves out the Project on screen and the Home Project", async () => {
    const recents: Recent[] = [
      { host: "github.com", path: HOME, openedAt: NOW - HOUR },
      { host: "github.com", path: PLANS, openedAt: NOW - 2 * HOUR },
      { host: "github.com", path: "fixture-org/other", openedAt: NOW - 3 * HOUR },
    ];
    const onPlans: Position = { project: { id: "github.com#fixture-org/plans", host: "github.com", path: PLANS, url: `https://github.com/${PLANS}`, issues: { open: 5 } }, view: { kind: "overview" } };
    const w = await world({ recents, trail: [onPlans] });
    const answer = await w.go({ kind: "go" });
    assert.deepEqual(answer.choices.map((c) => c.label), ["github.com/fixture-org/other"]);
    assert.deepEqual(w.reads, []);
    assert.doesNotMatch(JSON.stringify(answer), /fixture-viewer/);
  });

  test("with nothing nearby, says what it takes instead", async () => {
    const answer = await (await world()).go({ kind: "go" });
    assert.deepEqual(answer.choices, []);
    assert.equal(answer.text, "No Project near this one to offer. `go` takes a Project's or an Issue's URL, an `owner/repo`, or a local path.");
  });
});

describe("an Outside Issue's card", () => {
  test("offers to open its Project's Map, and that move lands on its card there", async () => {
    const w = await world();
    const card = await w.go({ kind: "view", view: { kind: "card", ref: `↗${PLANS}#7`, page: 1 } });
    assert.match(card.text, /an Outside Issue, in fixture-org\/plans/);
    assert.deepEqual(card.choices, [
      { label: `Start work on ↗${PLANS}#7`, description: "reads its body and comments to brief you; makes no branch and opens no editor", run: `issue-map start '${PLANS}#7'` },
      { label: `Open ${PLANS}'s Map`, description: "on this Issue's card there, which shows its Links", run: `issue-map go 'https://github.com/${PLANS}/issues/7'` },
    ]);
    const moved = await w.go({ kind: "go", target: `https://github.com/${PLANS}/issues/7` });
    assert.match(moved.text, /^\*\*Sub-issues: 2\*\*$/m);
    assert.deepEqual(where(w), [`${HOME} overview`, `${HOME} ↗${PLANS}#7`, `${PLANS} #7`]);
  });

  test("one this login can't read still offers its Project's Map", async () => {
    const card = await (await world()).go({ kind: "view", view: { kind: "card", ref: `${PLANS}#99`, page: 1 } });
    assert.deepEqual(card.choices, [{ label: `Open ${PLANS}'s Map`, description: "its overview, since this Issue couldn't be read", run: `issue-map go 'github.com/${PLANS}'` }]);
  });
});

describe("a GitLab group's epic's card", () => {
  const APP = "fixture-group/sub/app";
  const epic: IssueRead = { ...read("fixture-group", 12), title: "Q3 importer epic", url: "https://gitlab.com/groups/fixture-group/-/work_items/12" };
  const withEpic: Record<string, FakeHost> = { ...hosts, "gitlab.com": { ...hosts["gitlab.com"]!, issues: [epic] } };
  const onApp: Position = { project: { id: `gitlab.com#${APP}`, host: "gitlab.com", path: APP, url: `https://gitlab.com/${APP}`, issues: { open: 9 } }, view: { kind: "overview" } };

  test("offers what the epic holds on this Map, not a Map of its group (ADR 0005), and that opens the level beneath it here", async () => {
    const w = await world({ hosts: withEpic, trail: [onApp] });
    const card = await w.go({ kind: "view", view: { kind: "card", ref: "↗fixture-group#12", page: 1 } });
    assert.deepEqual(card.choices, [
      { label: "Start work on ↗fixture-group#12", description: "reads its body and comments to brief you; makes no branch and opens no editor", run: "issue-map start 'fixture-group#12'" },
      { label: "Show what it holds here", description: "the level beneath it on this Map", run: "issue-map group 'fixture-group#12'" },
    ]);
    await w.go({ kind: "view", view: { kind: "under", ref: "fixture-group#12", page: 1 } });
    assert.deepEqual(w.drawn, [`${APP} under · ⌂ ${HOME}`]);
  });

  test("one this login can't read offers no Map of its group", async () => {
    for (const ref of ["fixture-group#99", "fixture-group/sub#99"]) {
      const card = await (await world({ hosts: withEpic, trail: [onApp] })).go({ kind: "view", view: { kind: "card", ref, page: 1 } });
      assert.match(card.text, /^No card for /);
      assert.deepEqual(card.choices, [], ref);
    }
  });
});

describe("assigning an Issue to yourself from its card", () => {
  const withViewer: Record<string, FakeHost> = { ...hosts, "github.com": { ...hosts["github.com"]!, viewer: "fixture-viewer" } };

  test("the card's offer is a choice whose command assigns it, and assigning lands on its card in the Project on screen", async () => {
    const w = await world({ hosts: withViewer });
    const card = await w.go({ kind: "view", view: { kind: "card", ref: "#12", page: 1 } });
    assert.deepEqual(card.choices[0], { label: "Assign #12 to me", description: "writes to GitHub: assigns #12 to fixture-viewer", run: "issue-map assign '#12'" });
    const assigned = await w.go({ kind: "assign", ref: "#12" });
    assert.match(assigned.text, /^Assigned #12 to you on GitHub\.\n\n\*\*#12 Issue 12\*\*\\$/m);
    assert.match(assigned.text, /^Not Blocked · assigned to you$/m);
    assert.deepEqual(assigned.choices.map((c) => c.label), ["Start work on #12"]);
    assert.deepEqual(assigned.links.map((l) => l.label), [`${PLANS}#7`]);
    assert.deepEqual(where(w), [`${HOME} overview`, `${HOME} #12`]);
  });

  test("an Issue moved to by its URL offers it too", async () => {
    const w = await world({ hosts: withViewer });
    const card = await w.go({ kind: "go", target: `https://github.com/${HOME}/issues/12` });
    assert.deepEqual(card.choices.map((c) => c.run), ["issue-map assign '#12'", "issue-map start '#12'"]);
  });

  test("an Issue that can't be assigned leaves the user where they are, and says why", async () => {
    const w = await world({ hosts: withViewer });
    const answer = await w.go({ kind: "assign", ref: "#99" });
    assert.equal(answer.text, `Not assigned: no Issue ${HOME}#99 on github.com that this login can read.`);
    assert.deepEqual(where(w), []);
  });
});

describe("starting work on an Issue from its card", () => {
  const withThread: Record<string, FakeHost> = {
    ...hosts,
    "github.com": {
      ...hosts["github.com"]!,
      threads: [{ ref: `${HOME}#12`, title: "Issue 12", url: `https://github.com/${HOME}/issues/12`, open: true, body: "State lives in S3.", comments: [{ author: "fixture-dev", at: "2026-02-01T10:00:00Z", body: "I can take this." }], earlier: false }],
    },
  };

  test("the card offers it as a choice whose command hands over the Issue's body and comments", async () => {
    const w = await world({ hosts: withThread });
    const card = await w.go({ kind: "view", view: { kind: "card", ref: "#12", page: 1 } });
    assert.deepEqual(card.choices, [{ label: "Start work on #12", description: "reads its body and comments to brief you; makes no branch and opens no editor", run: "issue-map start '#12'" }]);
    const started = await w.go({ kind: "start", ref: "#12" });
    assert.match(started.text, /^\*\*#12 Issue 12\*\*$/m);
    assert.match(started.text, /^State lives in S3\.$/m);
    assert.match(started.text, /^I can take this\.$/m);
    assert.deepEqual([started.links, started.choices], [[], []]);
  });

  test("leaves the user where they were, so they carry on moving from there", async () => {
    const w = await world({ hosts: withThread });
    await w.go({ kind: "view", view: { kind: "card", ref: "#12", page: 1 } });
    await w.go({ kind: "view", view: { kind: "card", ref: `${PLANS}#7`, page: 1 } });
    const before = where(w);
    await w.go({ kind: "start", ref: "#12" });
    assert.deepEqual(where(w), before);
    assert.match((await w.go({ kind: "back" })).text, /^\*\*#12 Issue 12\*\*\\$/m, "back retraces from the card the user was on");
  });

  test("starts work on an Outside Issue by its full reference, from the Project on screen", async () => {
    const hosts: Record<string, FakeHost> = { ...withThread, "github.com": { ...withThread["github.com"]!, threads: [{ ...withThread["github.com"]!.threads![0]!, ref: `${PLANS}#7`, title: "Q3 importer epic" }] } };
    const w = await world({ hosts });
    const started = await w.go({ kind: "start", ref: `${PLANS}#7` });
    assert.match(started.text, /^\*\*↗fixture-org\/plans#7 Q3 importer epic\*\*$/m);
    assert.deepEqual(where(w), []);
  });

  test("an Issue whose thread can't be read says why, and the user stays where they were", async () => {
    const w = await world({ hosts: withThread });
    const answer = await w.go({ kind: "start", ref: "#99" });
    assert.equal(answer.text, `Can't start work on #99: no Issue ${HOME}#99 on github.com that this login can read.`);
    assert.deepEqual(where(w), []);
  });
});

describe("back, map and home", () => {
  test("`back` retraces one trail that spans Projects, `map` draws the Project on screen, and `home` returns", async () => {
    const w = await world();
    await w.go({ kind: "view", view: { kind: "overview" } });
    await w.go({ kind: "view", view: { kind: "card", ref: "#12", page: 1 } });
    await w.go({ kind: "view", view: { kind: "card", ref: `${PLANS}#7`, page: 1 } });
    await w.go({ kind: "go", target: `https://github.com/${PLANS}/issues/7` });
    assert.equal((await w.go({ kind: "view", view: { kind: "overview" } })).text, `MAP ${PLANS} overview · ⌂ ${HOME}`);
    assert.deepEqual(where(w), [`${HOME} overview`, `${HOME} #12`, `${HOME} ${PLANS}#7`, `${PLANS} #7`, `${PLANS} overview`]);

    assert.match((await w.go({ kind: "back" })).text, /^\*\*#7 Issue 7\*\*\\$/m);
    assert.match((await w.go({ kind: "back" })).text, /an Outside Issue, in fixture-org\/plans/, "back to the Outside Issue's card that was left");
    assert.match((await w.go({ kind: "back" })).text, /^\*\*#12 Issue 12\*\*\\$/m);
    assert.equal((await w.go({ kind: "back" })).text, `MAP ${HOME} overview (kept warm)`);
    assert.equal((await w.go({ kind: "back" })).text, "Nothing to go back to: this is where this session's trail starts.");
    assert.deepEqual(where(w), [`${HOME} overview`]);

    await w.go({ kind: "go", target: PLANS });
    assert.equal((await w.go({ kind: "home" })).text, `MAP ${HOME} overview (kept warm)`);
    assert.deepEqual(where(w), [`${HOME} overview`, `${PLANS} overview`, `${HOME} overview`], "home is a move too, so `back` retraces it");
  });

  test("a session's first move can be retraced back to the Home Project it started on", async () => {
    const w = await world();
    await w.go({ kind: "go", target: PLANS });
    assert.equal((await w.go({ kind: "back" })).text, `MAP ${HOME} overview (kept warm)`);
    assert.deepEqual(where(w), [`${HOME} overview`]);
  });

  test("`back` to a place that no longer opens leaves the user where they are", async () => {
    const w = await world();
    await w.go({ kind: "view", view: { kind: "overview" } });
    await w.go({ kind: "go", target: PLANS });
    w.deps.showMap = async (_tracker, project) => ({ text: `No Map of github.com/${project.path}: GitHub refused: no login for github.com`, drew: "nothing" });
    assert.equal((await w.go({ kind: "back" })).text, `No Map of github.com/${HOME}: GitHub refused: no login for github.com\nYou're still on ${PLANS}.`);
    assert.deepEqual(where(w), [`${HOME} overview`, `${PLANS} overview`]);
  });

  test("`home` typed on the Home Project's overview re-picks it, when the checkout leads to other Projects", async () => {
    const others = [{ label: "github.com/fixture-org/other", description: "3 open Issues · remote upstream", url: "https://github.com/fixture-org/other" }];
    const w = await world({ others });
    assert.equal((await w.go({ kind: "home" })).text, `MAP ${HOME} overview (kept warm)`, "from nowhere yet, it goes home");
    const again = await w.go({ kind: "home" });
    assert.equal(again.text, `Home Project: github.com/${HOME}. This checkout also leads to 1 other Project with open Issues: ask which one is the Home Project.`);
    assert.deepEqual(again.choices, [
      { label: `github.com/${HOME}`, description: "20 open Issues · the Home Project now", run: `issue-map home --pick 'https://github.com/${HOME}'` },
      { label: "github.com/fixture-org/other", description: "3 open Issues · remote upstream", run: "issue-map home --pick 'https://github.com/fixture-org/other'" },
    ]);
    assert.equal((await w.go({ kind: "home", picked: true })).text, `Home Project: github.com/${HOME} — 20 open Issues\n\nMAP ${HOME} overview (kept warm)`, "once picked, it goes home");
  });

  test("`home` typed on the Home Project's overview just redraws it when there's nothing to re-pick", async () => {
    const w = await world();
    await w.go({ kind: "home" });
    assert.equal((await w.go({ kind: "home" })).text, `MAP ${HOME} overview (kept warm)`);
    assert.deepEqual(where(w), [`${HOME} overview`]);
  });

  test("with no Home Project, `home` says so, and asking for the Map offers `go`", async () => {
    const w = await world({ noHome: true });
    assert.equal((await w.go({ kind: "home" })).text, "No Home Project: this checkout has no remote that leads to a Tracker.");
    const map = await w.go({ kind: "view", view: { kind: "overview" } });
    assert.equal(map.text, "No Home Project: this checkout has no remote that leads to a Tracker.\n\nNo Project near this one to offer. `go` takes a Project's or an Issue's URL, an `owner/repo`, or a local path.");
    assert.equal((await w.go({ kind: "go", target: PLANS })).text, `MAP ${PLANS} overview`);
  });
});

describe("the HTML Picture", () => {
  test("is of the Project on screen, and moves nothing: it's a page beside the Map, not a place on it", async () => {
    const w = await world();
    await w.go({ kind: "go", target: `https://github.com/${PLANS}` });
    const answer = await w.go({ kind: "html" });
    assert.equal(answer.text, `MAP ${PLANS} html · ⌂ ${HOME}`);
    assert.deepEqual(where(w), [`${HOME} overview`, `${PLANS} overview`]);
  });
});

describe("a move that can't open", () => {
  const cases: [string, string][] = [
    ["fixture-org/nowhere", "Can't move to fixture-org/nowhere: no Project fixture-org/nowhere on github.com; no Project fixture-org/nowhere on gitlab.com. You're still on fixture-org/tools."],
    ["https://github.com/fixture-org/wiki", "Can't move to https://github.com/fixture-org/wiki: fixture-org/wiki has Issues turned off. You're still on fixture-org/tools."],
    ["github.com/fixture-org/quiet", "Can't move to github.com/fixture-org/quiet: fixture-org/quiet has no open Issues. You're still on fixture-org/tools."],
    [`${PLANS}#99`, `Can't move to ${PLANS}#99: no Issue ${PLANS}#99 on github.com that this login can read; no Issue ${PLANS}#99 on gitlab.com that this login can read. You're still on fixture-org/tools.`],
    ["https://example.org/fixture-org/tools", "Can't move to https://example.org/fixture-org/tools: example.org runs no Tracker the Map can read. You're still on fixture-org/tools."],
  ];
  for (const [target, said] of cases) {
    test(`leaves the user where they are and says why: ${target}`, async () => {
      const w = await world();
      await w.go({ kind: "view", view: { kind: "overview" } });
      const before = where(w);
      assert.equal((await w.go({ kind: "go", target })).text, said);
      assert.deepEqual(where(w), before);
    });
  }

  test("a Tracker the user has no login for isn't named, unless none had anything else to say", async () => {
    const w = await world({ hosts: { ...hosts, "gitlab.com": { product: "GitLab", refuse: "no login for gitlab.com" } } });
    assert.equal((await w.go({ kind: "go", target: "fixture-org/nowhere" })).text, "Can't move to fixture-org/nowhere: no Project fixture-org/nowhere on github.com. You're still on fixture-org/tools.");
    const nowhere = await world({ hosts: { "github.com": { ...hosts["github.com"]!, refuse: "no login for github.com" }, "gitlab.com": { product: "GitLab", refuse: "no login for gitlab.com" } } });
    assert.equal(
      (await nowhere.go({ kind: "go", target: "fixture-org/nowhere" })).text,
      "Can't move to fixture-org/nowhere: GitHub refused: no login for github.com; GitLab refused: no login for gitlab.com. You're still on fixture-org/tools.",
    );
  });

  test("a Project whose Map draws nothing, such as one where no Link kind can be read, leaves the user where they are", async () => {
    const w = await world();
    await w.go({ kind: "view", view: { kind: "overview" } });
    const answer = await w.go({ kind: "go", target: "fixture-org/refused" });
    assert.equal(answer.text, "No Map of github.com/fixture-org/refused: GitHub can read no Link kind here\nYou're still on fixture-org/tools.");
    assert.deepEqual(where(w), [`${HOME} overview`]);
    assert.deepEqual(w.recents(), []);
  });

  test("a card that can't open isn't a place on the trail", async () => {
    const w = await world();
    await w.go({ kind: "view", view: { kind: "card", ref: "#404", page: 1 } });
    assert.deepEqual(w.trail(), []);
  });
});

describe("the Home Project stays put", () => {
  test("moving never changes the Home Project, and only the Home Project is kept warm", async () => {
    const w = await world();
    const home = structuredClone({ text: w.deps.home.text, others: w.deps.home.others, project: w.deps.home.home?.project });
    await w.go({ kind: "go", target: PLANS });
    await w.go({ kind: "view", view: { kind: "group", group: 1, page: 1 } });
    await w.go({ kind: "back" });
    await w.go({ kind: "home" });
    assert.deepEqual({ text: w.deps.home.text, others: w.deps.home.others, project: w.deps.home.home?.project }, home);
    assert.deepEqual(w.drawn, [`${PLANS} overview · ⌂ ${HOME}`, `${PLANS} group · ⌂ ${HOME}`, `${PLANS} overview · ⌂ ${HOME}`, `${HOME} overview (kept warm)`]);
  });

  test("a local path's pick is saved in that checkout, never in this one's Home Project", async () => {
    const w = await world();
    const dir = checkout({ upstream: `https://github.com/${PLANS}.git`, origin: "https://github.com/fixture-org/other.git" });
    await w.go({ kind: "go", target: dir, pickThere: `https://github.com/${PLANS}` });
    assert.equal(w.deps.home.home?.project.path, HOME);
  });
});

describe("recent Projects", () => {
  test("a Project counts once its Map has opened, newest first, never the Home Project, and 10 at most", async () => {
    const w = await world({ recents: Array.from({ length: 10 }, (_, i) => ({ host: "github.com", path: `fixture-org/old-${i}`, openedAt: NOW - (i + 1) * HOUR })) });
    await w.go({ kind: "go", target: `https://github.com/${PLANS}/issues/7` });
    assert.equal(w.recents()[0]!.path, "fixture-org/old-0", "a card alone isn't its Map opening");
    await w.go({ kind: "view", view: { kind: "overview" } });
    await w.go({ kind: "home" });
    assert.deepEqual(w.recents().map((r) => r.path), [PLANS, ...Array.from({ length: 9 }, (_, i) => `fixture-org/old-${i}`)]);
    assert.equal(w.recents()[0]!.openedAt, NOW);
  });

  test("a recent Project found gone or unreadable is dropped, and one with no open Issues just now is kept", async () => {
    const w = await world({ recents: [{ host: "github.com", path: "fixture-org/gone", openedAt: NOW - HOUR }, { host: "github.com", path: "fixture-org/quiet", openedAt: NOW - 2 * HOUR }] });
    await w.go({ kind: "go", target: "github.com/fixture-org/gone" });
    await w.go({ kind: "go", target: "github.com/fixture-org/quiet" });
    assert.deepEqual(w.recents().map((r) => r.path), ["fixture-org/quiet"]);
  });
});
