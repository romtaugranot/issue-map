/**
 * One contract suite for every Tracker adapter (spec, Seam B), covering
 * needs 1, 2, 3, 4, 6 and 7 including their "can't" answers, for a whole
 * Project, for only what changed in it, and for one Issue read for its card. Each adapter supplies
 * a Stage that stands a World up behind its own boundary.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { ChangesAnswer, FarEnd, IssueAnswer, IssueRead, OpenIssue, Project, ProjectResolution, Tracker, TrackerKind, Unread } from "../../src/tracker/tracker.ts";

export interface ProjectSpec {
  path: string;
  /** Distinct per Project in a World; not the Project's identity as the Tracker states it. */
  number: number;
  open: number | "off";
  parent?: ProjectSpec;
  /** Paths the Project had before it was renamed or moved. */
  oldPaths?: string[];
  issues?: IssueSpec[];
}

export interface IssueSpec {
  number: number;
  title?: string;
  /** ISO date; defaults to day `number` of 2026. */
  createdAt?: string;
  assignees?: string[];
  /** ISO date. */
  planned?: string;
  /** Closed Issues are never listed, but a Link can reach one. */
  closed?: boolean;
  /** How it closed; `completed` by default. */
  closedAs?: "completed" | "not planned" | "duplicate";
  /** When it closed, as an ISO date; the day after it was created by default. */
  closedAt?: string;
  /**
   * When it was last updated, as an ISO date; when it closed, or else when
   * it was created, by default. A Link made or removed is left to the
   * Tracker to mark its own way.
   */
  updatedAt?: string;
  /** This login can't read it, though a Link to it is recorded. */
  hidden?: boolean;
}

/** `"owner/name#12"`. */
export type IssueAddress = string;

export interface World {
  /** What answers at each host other than the well-known one. A host not listed can't be reached. */
  servers?: Record<string, { runs: "this-kind"; version: string } | { runs: "something-else" }>;
  projects?: ProjectSpec[];
  login?: "ok" | "none" | "refused";
  cli?: "installed" | "missing";
  /** Hosts besides the well-known one that the CLI holds a login for. */
  loggedInTo?: string[];
  /** Whether the well-known host can be reached. */
  network?: "up" | "down";
  /**
   * `[a, "blocks", b]` reads "a Blocks b"; `[a, "parent", b]` reads "a is the
   * Parent of b". A fourth element is when the Link was made, as an ISO
   * date; long ago by default.
   */
  links?: [IssueAddress, "blocks" | "parent", IssueAddress, string?][];
  /** Links someone removed, each with when, as an ISO date. */
  removedLinks?: [IssueAddress, "blocks" | "parent", IssueAddress, string][];
  /** The Tracker keeps no record of what changed before this ISO date. */
  changesKeptFrom?: string;
  /** This login's rate limit is used up. */
  rateLimited?: boolean;
  /** The login's name; `fixture-viewer` by default. */
  viewer?: string;
  /** Pull or merge requests that close an Issue when merged. */
  /** `updatedAt` is when one was last updated, as an ISO date; long ago by default. */
  closingRequests?: { closes: IssueAddress; number: number; author: string; draft?: boolean; state?: "open" | "closed" | "merged"; updatedAt?: string }[];
  /** `false` for a login that may read Issues but not pull or merge requests. */
  readsClosingRequests?: boolean;
  /** `[a, b]` reads "a names b in its text". */
  mentions?: [IssueAddress, IssueAddress][];
}

export interface Stage {
  product: string;
  /** A host this kind is known to run at by name alone. */
  wellKnownHost: string;
  /** Builds the adapter against a World, counts requests that left the machine, and lists the hosts the CLI's login was sent to. */
  arrange(world: World): { kind: TrackerKind; requests(): number; loginsSentTo(): string[] };
}

/** The whole contract: every need an adapter answers. */
export function trackerContract(stage: Stage): void {
  identifyContract(stage);
  resolveContract(stage);
  readContract(stage);
  changesContract(stage);
  cardContract(stage);
}

export function identifyContract(stage: Stage): void {
  const { product, wellKnownHost } = stage;

  describe(`${product} Tracker contract`, () => {
    describe("need 1: identify a Tracker at an address", () => {
      test("recognises its well-known host by name, without the network", async () => {
        const { kind, requests } = stage.arrange({});
        const tracker = await kind.recognise(wellKnownHost);
        assert.equal(tracker?.product, product);
        assert.equal(tracker?.host, wellKnownHost);
        assert.equal(requests(), 0);
      });

      test("does not claim an unfamiliar host by name alone", async () => {
        const { kind, requests } = stage.arrange({});
        assert.equal(await kind.recognise("git.example.com"), null);
        assert.equal(requests(), 0);
      });

      test("identifies a self-hosted Tracker and its version, anonymously where it can", async () => {
        const { kind } = stage.arrange({
          servers: { "git.example.com": { runs: "this-kind", version: "3.17.2" } },
          loggedInTo: ["git.example.com"],
        });
        const answer = await kind.probe("git.example.com");
        assert.equal(answer.kind, "identified");
        const { tracker } = answer as Extract<typeof answer, { kind: "identified" }>;
        assert.deepEqual([tracker.product, tracker.host, tracker.version], [product, "git.example.com", "3.17.2"]);
      });

      test("lends the login to no host it found only by probing", async () => {
        const { kind, loginsSentTo } = stage.arrange({ servers: { "git.example.com": { runs: "this-kind", version: "3.17.2" } } });
        assert.equal((await kind.probe("git.example.com")).kind, "identified");
        assert.deepEqual(loginsSentTo(), []);
      });

      test("says a host running something else is not this kind", async () => {
        const { kind } = stage.arrange({ servers: { "git.example.com": { runs: "something-else" } } });
        assert.deepEqual(await kind.probe("git.example.com"), { kind: "not-this-kind" });
      });

      test("can't tell when the host can't be reached, and names it", async () => {
        const { kind } = stage.arrange({});
        const answer = await kind.probe("git.example.com");
        assert.equal(answer.kind, "cant-tell");
        assert.match((answer as { reason: string }).reason, /git\.example\.com/);
      });
    });
  });
}

export function resolveContract(stage: Stage): void {
  const { product, wellKnownHost } = stage;

  async function trackerIn(world: World): Promise<Tracker> {
    const tracker = await stage.arrange(world).kind.recognise(wellKnownHost);
    assert.ok(tracker, `${product} recognises ${wellKnownHost}`);
    return tracker;
  }

  async function resolved(world: World, path: string): Promise<{ project: Project; parent: Project | null }> {
    const answer = await (await trackerIn(world)).resolveProject(path);
    assert.equal(answer.kind, "project", JSON.stringify(answer));
    return answer as Extract<ProjectResolution, { kind: "project" }>;
  }

  describe(`${product} Tracker contract`, () => {
    describe("need 2: resolve a Project", () => {
      const tofu: ProjectSpec = { path: "opentofu/opentofu", number: 1, open: 274 };

      test("resolves a Project to its path, URL and open-Issue count", async () => {
        const { project, parent } = await resolved({ projects: [tofu] }, "opentofu/opentofu");
        assert.equal(project.host, wellKnownHost);
        assert.equal(project.path, "opentofu/opentofu");
        assert.match(project.url, /opentofu\/opentofu$/);
        assert.deepEqual(project.issues, { open: 274 });
        assert.equal(parent, null);
      });

      test("says when a Project has Issues turned off", async () => {
        const { project } = await resolved({ projects: [{ path: "tools/mirror", number: 2, open: "off" }] }, "tools/mirror");
        assert.equal(project.issues, "off");
      });

      test("names a fork's parent with the parent's own open-Issue count", async () => {
        const upstream: ProjectSpec = { path: "cli/cli", number: 3, open: 1028 };
        const fork: ProjectSpec = { path: "fixture-user/cli", number: 4, open: "off", parent: upstream };
        const { project, parent } = await resolved({ projects: [fork, upstream] }, "fixture-user/cli");
        assert.equal(project.issues, "off");
        assert.equal(parent?.path, "cli/cli");
        assert.deepEqual(parent?.issues, { open: 1028 });
        assert.notEqual(parent?.id, project.id);
      });

      test("an old path resolves to the Project's current path and the same identity", async () => {
        const moved: ProjectSpec = { path: "new-org/tool", number: 5, open: 3, oldPaths: ["old-org/tool"] };
        const byOld = await resolved({ projects: [moved] }, "old-org/tool");
        const byNew = await resolved({ projects: [moved] }, "new-org/tool");
        assert.equal(byOld.project.path, "new-org/tool");
        assert.equal(byOld.project.id, byNew.project.id);
      });

      test("says when there is no such Project", async () => {
        const answer = await (await trackerIn({ projects: [tofu] })).resolveProject("nobody/nothing");
        assert.equal(answer.kind, "not-found");
        assert.match((answer as { reason: string }).reason, /nobody\/nothing/);
      });

      test("refuses without a login, and says how to log in", async () => {
        const answer = await (await trackerIn({ projects: [tofu], login: "none" })).resolveProject("opentofu/opentofu");
        assert.equal(answer.kind, "refused");
        assert.match((answer as { reason: string }).reason, /log ?in/i);
      });

      test("refuses when the Tracker rejects the login", async () => {
        const answer = await (await trackerIn({ projects: [tofu], login: "refused" })).resolveProject("opentofu/opentofu");
        assert.equal(answer.kind, "refused");
        assert.match((answer as { reason: string }).reason, new RegExp(wellKnownHost.replaceAll(".", "\\.")));
      });

      test("refuses when there is no CLI to borrow a login from", async () => {
        const answer = await (await trackerIn({ projects: [tofu], cli: "missing" })).resolveProject("opentofu/opentofu");
        assert.equal(answer.kind, "refused");
        assert.match((answer as { reason: string }).reason, /install/i);
      });

      test("refuses a Project on a host found only by probing, without sending it the login", async () => {
        const { kind, loginsSentTo } = stage.arrange({ servers: { "git.example.com": { runs: "this-kind", version: "3.17.2" } }, projects: [tofu] });
        const answer = await kind.probe("git.example.com");
        assert.equal(answer.kind, "identified");
        const resolved = await (answer as Extract<typeof answer, { kind: "identified" }>).tracker.resolveProject("opentofu/opentofu");
        assert.equal(resolved.kind, "refused");
        assert.match((resolved as { reason: string }).reason, /log ?in/i);
        assert.deepEqual(loginsSentTo(), []);
      });

      test("can't tell when the Tracker can't be reached, and names it", async () => {
        const answer = await (await trackerIn({ projects: [tofu], network: "down" })).resolveProject("opentofu/opentofu");
        assert.equal(answer.kind, "cant-tell");
        assert.match((answer as { reason: string }).reason, new RegExp(wellKnownHost.replaceAll(".", "\\.")));
      });
    });
  });
}

export function readContract(stage: Stage): void {
  const { product, wellKnownHost } = stage;

  async function trackerIn(world: World): Promise<Tracker> {
    const tracker = await stage.arrange(world).kind.recognise(wellKnownHost);
    assert.ok(tracker, `${product} recognises ${wellKnownHost}`);
    return tracker;
  }

  /** Every page of a Project's open Issues, as the Map's first read takes them. */
  async function readAll(world: World, path: string): Promise<{ issues: OpenIssue[]; pages: number; total: number; unread: Unread }> {
    const tracker = await trackerIn(world);
    const resolved = await tracker.resolveProject(path);
    assert.equal(resolved.kind, "project", JSON.stringify(resolved));
    const { project } = resolved as Extract<ProjectResolution, { kind: "project" }>;
    const issues: OpenIssue[] = [];
    let after: string | null = null;
    let pages = 0;
    let total = 0;
    let unread: Unread = {};
    do {
      const page = await tracker.openIssues(project, after);
      assert.equal(page.kind, "page", JSON.stringify(page));
      const { issues: more, next, total: counted, unread: missing } = page as Extract<typeof page, { kind: "page" }>;
      issues.push(...more);
      unread = { ...unread, ...missing };
      after = next;
      total = counted;
      pages++;
    } while (after !== null && pages < 100);
    return { issues, pages, total, unread };
  }

  async function project(world: World, path: string): Promise<{ tracker: Tracker; project: Project }> {
    const tracker = await trackerIn(world);
    const resolved = await tracker.resolveProject(path);
    assert.equal(resolved.kind, "project", JSON.stringify(resolved));
    return { tracker, project: (resolved as Extract<ProjectResolution, { kind: "project" }>).project };
  }

  const byRef = (issues: OpenIssue[], ref: string) => {
    const found = issues.find((i) => i.ref === ref);
    assert.ok(found, `${ref} is listed`);
    return found;
  };
  const linkTo = (issue: OpenIssue, role: string, ref: string): FarEnd => {
    const found = issue.links.find((l) => l.role === role && l.to.readable && l.to.ref === ref);
    assert.ok(found, `${issue.ref} has a ${role} Link to ${ref}: ${JSON.stringify(issue.links)}`);
    return found.to;
  };

  describe(`${product} Tracker contract`, () => {
    describe("need 6: say who the viewer is", () => {
      test("names the login", async () => {
        assert.deepEqual(await (await trackerIn({ viewer: "fixture-bot" })).viewer(), { kind: "viewer", login: "fixture-bot" });
      });

      test("refuses without a login, and says how to log in", async () => {
        const answer = await (await trackerIn({ login: "none" })).viewer();
        assert.equal(answer.kind, "refused");
        assert.match((answer as { reason: string }).reason, /log ?in/i);
      });

      test("refuses when the Tracker rejects the login", async () => {
        assert.equal((await (await trackerIn({ login: "refused" })).viewer()).kind, "refused");
      });

      test("can't tell when the Tracker can't be reached", async () => {
        assert.equal((await (await trackerIn({ network: "down" })).viewer()).kind, "cant-tell");
      });

      test("when the Tracker can't be reached or refuses the login, still names the login the CLI holds, read without the network", async () => {
        for (const [trouble, kind] of [[{ network: "down" }, "cant-tell"], [{ rateLimited: true }, "cant-tell"], [{ login: "refused" }, "refused"]] as const) {
          const { kind: trackerKind, requests } = stage.arrange({ viewer: "fixture-bot", ...trouble });
          const tracker = await trackerKind.recognise(wellKnownHost);
          const answer = await tracker!.viewer();
          assert.deepEqual([answer.kind, answer.kind !== "viewer" && answer.login], [kind, "fixture-bot"], JSON.stringify(trouble));
          assert.equal(requests(), 1, "only the one request that failed left the machine");
        }
        const none = await (await trackerIn({ login: "none" })).viewer();
        assert.equal(none.kind !== "viewer" && none.login, undefined, "no login held, none named");
      });
    });

    describe("needs 3, 4 and 7: list open Issues with their Links and Closing Requests", () => {
      const tools = "fixture-org/tools";
      const plans = "fixture-org/plans";

      test("pages through every open Issue, oldest first, each with what the Map draws", async () => {
        const issues: IssueSpec[] = Array.from({ length: 230 }, (_, i) => ({ number: i + 1 }));
        issues[4] = { number: 5, title: "Import state from S3", assignees: ["fixture-bot"], planned: "2026-10-01T00:00:00Z" };
        issues[9] = { number: 10, closed: true };
        const read = await readAll({ projects: [{ path: tools, number: 1, open: 229, issues }] }, tools);
        assert.ok(read.pages > 1, "more than one page");
        assert.equal(read.total, 229);
        assert.equal(read.issues.length, 229);
        assert.deepEqual(read.issues.slice(0, 4).map((i) => i.ref), ["#1", "#2", "#3", "#4"]);
        assert.equal(read.issues.some((i) => i.ref === "#10"), false, "closed Issues aren't listed");
        assert.equal(new Set(read.issues.map((i) => i.id)).size, 229, "each has its own identity");
        const five = byRef(read.issues, "#5");
        assert.equal(five.title, "Import state from S3");
        assert.match(five.url, /fixture-org\/tools\/issues\/5$/);
        assert.equal(five.createdAt.slice(0, 10), "2026-01-05");
        assert.deepEqual(five.assignees, ["fixture-bot"]);
        assert.equal(five.planned?.slice(0, 10), "2026-10-01");
        assert.equal(five.taskLevel, false);
        assert.deepEqual(byRef(read.issues, "#6").assignees, []);
        assert.equal(byRef(read.issues, "#6").planned, null);
      });

      test("reads Blocks and Parent Links with their direction, naming the far end by the identity it's listed with", async () => {
        const world: World = {
          projects: [{ path: tools, number: 1, open: 4, issues: [{ number: 1 }, { number: 2 }, { number: 3 }, { number: 4 }] }],
          links: [[`${tools}#1`, "blocks", `${tools}#2`], [`${tools}#3`, "parent", `${tools}#2`], [`${tools}#3`, "parent", `${tools}#4`]],
        };
        const { issues } = await readAll(world, tools);
        const [one, two, three] = [byRef(issues, "#1"), byRef(issues, "#2"), byRef(issues, "#3")];
        assert.equal(linkTo(one, "blocked", `${tools}#2`).id, two.id);
        assert.equal(linkTo(two, "blocker", `${tools}#1`).id, one.id);
        assert.equal(linkTo(two, "parent", `${tools}#3`).id, three.id);
        assert.equal(linkTo(three, "child", `${tools}#2`).id, two.id);
        linkTo(three, "child", `${tools}#4`);
        assert.deepEqual(byRef(issues, "#4").links.map((l) => l.role), ["parent"]);
        const end = linkTo(one, "blocked", `${tools}#2`);
        assert.deepEqual(end.readable && [end.open, end.project, end.title], [true, tools, "Issue 2"]);
      });

      test("an Issue can have more than one Parent", async () => {
        const world: World = {
          projects: [{ path: tools, number: 1, open: 3, issues: [{ number: 1 }, { number: 2 }, { number: 3 }] }],
          links: [[`${tools}#1`, "parent", `${tools}#3`], [`${tools}#2`, "parent", `${tools}#3`]],
        };
        const three = byRef((await readAll(world, tools)).issues, "#3");
        assert.deepEqual(three.links.filter((l) => l.role === "parent").map((l) => l.to.readable && l.to.ref).sort(), [`${tools}#1`, `${tools}#2`]);
      });

      test("a Link to another Project names the far end's Project; its own Links aren't read", async () => {
        const world: World = {
          projects: [
            { path: tools, number: 1, open: 2, issues: [{ number: 1 }, { number: 2 }] },
            { path: plans, number: 2, open: 2, issues: [{ number: 7, title: "Q3 importer epic" }, { number: 8 }] },
          ],
          links: [[`${plans}#7`, "parent", `${tools}#1`], [`${plans}#7`, "parent", `${tools}#2`], [`${plans}#8`, "blocks", `${plans}#7`]],
        };
        const { issues } = await readAll(world, tools);
        assert.deepEqual(issues.map((i) => i.ref), ["#1", "#2"]);
        const [a, b] = [linkTo(issues[0]!, "parent", `${plans}#7`), linkTo(issues[1]!, "parent", `${plans}#7`)];
        assert.equal(a.id, b.id, "both Links name the same Issue");
        assert.deepEqual(a.readable && [a.open, a.project, a.title], [true, plans, "Q3 importer epic"]);
        assert.equal(issues.flatMap((i) => i.links).some((l) => l.to.readable && l.to.ref === `${plans}#8`), false);
      });

      test("a Link to a closed Issue says it is closed, when, and how", async () => {
        const world: World = {
          projects: [
            {
              path: tools,
              number: 1,
              open: 1,
              issues: [{ number: 1 }, { number: 2, closed: true, closedAt: "2026-09-21T08:00:00Z" }, { number: 3, closed: true, closedAs: "duplicate", closedAt: "2026-09-22T08:00:00Z" }],
            },
          ],
          links: [[`${tools}#2`, "blocks", `${tools}#1`], [`${tools}#3`, "blocks", `${tools}#1`]],
        };
        const one = byRef((await readAll(world, tools)).issues, "#1");
        const [two, three] = [linkTo(one, "blocker", `${tools}#2`), linkTo(one, "blocker", `${tools}#3`)];
        assert.deepEqual(two.readable && [two.open, two.closedAt, two.closedAs], [false, "2026-09-21T08:00:00Z", "completed"]);
        assert.deepEqual(three.readable && [three.open, three.closedAt, three.closedAs], [false, "2026-09-22T08:00:00Z", "duplicate"]);
      });

      test("a Link to an open Issue says no close date or way", async () => {
        const world: World = {
          projects: [{ path: tools, number: 1, open: 2, issues: [{ number: 1 }, { number: 2 }] }],
          links: [[`${tools}#2`, "blocks", `${tools}#1`]],
        };
        const end = linkTo(byRef((await readAll(world, tools)).issues, "#1"), "blocker", `${tools}#2`);
        assert.deepEqual(end.readable && [end.open, "closedAt" in end, "closedAs" in end], [true, false, false]);
      });

      test("a Link to an Issue this login can't read is kept, without a name", async () => {
        const world: World = {
          projects: [
            { path: tools, number: 1, open: 1, issues: [{ number: 1 }] },
            { path: "fixture-org/private", number: 2, open: 1, issues: [{ number: 3, title: "Secret plan", hidden: true }] },
          ],
          links: [[`fixture-org/private#3`, "parent", `${tools}#1`]],
        };
        const [one] = (await readAll(world, tools)).issues;
        assert.equal(one!.links.length, 1);
        assert.equal(one!.links[0]!.role, "parent");
        assert.equal(one!.links[0]!.to.readable, false);
        assert.doesNotMatch(JSON.stringify(one), /Secret plan/);
      });

      test("need 7: reads each Issue's open Closing Requests with their authors, drafts included", async () => {
        const world: World = {
          projects: [{ path: tools, number: 1, open: 3, issues: [{ number: 1 }, { number: 2 }, { number: 3 }] }],
          closingRequests: [
            { closes: `${tools}#1`, number: 40, author: "fixture-bot" },
            { closes: `${tools}#1`, number: 41, author: "fixture-viewer", draft: true },
            { closes: `${tools}#2`, number: 42, author: "fixture-bot", state: "closed" },
            { closes: `${tools}#2`, number: 43, author: "fixture-bot", state: "merged" },
          ],
        };
        const { issues, unread } = await readAll(world, tools);
        assert.deepEqual(
          byRef(issues, "#1").closingRequests.map((r) => [r.ref, r.draft, r.author]),
          [[`${tools}#40`, false, "fixture-bot"], [`${tools}#41`, true, "fixture-viewer"]],
        );
        assert.match(byRef(issues, "#1").closingRequests[0]!.url, /fixture-org\/tools\/(pull|merge_requests)\/40$/);
        assert.deepEqual(byRef(issues, "#2").closingRequests, [], "closed and merged ones aren't open");
        assert.deepEqual(byRef(issues, "#3").closingRequests, []);
        assert.equal(unread.closingRequests, undefined);
      });

      test("need 7: a login that can't read Closing Requests still lists the Issues, and says why none are given", async () => {
        const world: World = {
          projects: [{ path: tools, number: 1, open: 2, issues: [{ number: 1 }, { number: 2 }] }],
          closingRequests: [{ closes: `${tools}#1`, number: 40, author: "fixture-bot" }],
          readsClosingRequests: false,
        };
        const { issues, unread } = await readAll(world, tools);
        assert.deepEqual(issues.map((i) => [i.ref, i.closingRequests]), [["#1", []], ["#2", []]]);
        assert.match(unread.closingRequests ?? "", /pull|merge/i);
      });

      test("says when the Project is gone", async () => {
        const { tracker, project: found } = await project({ projects: [{ path: tools, number: 1, open: 1, issues: [{ number: 1 }] }] }, tools);
        const gone = await tracker.openIssues({ ...found, path: "fixture-org/gone" }, null);
        assert.equal(gone.kind, "not-found");
      });

      test("refuses when the Tracker rejects the login, and can't tell when it can't be reached", async () => {
        const resolved = await project({ projects: [{ path: tools, number: 1, open: 1, issues: [{ number: 1 }] }] }, tools);
        for (const [world, kind] of [[{ login: "refused" }, "refused"], [{ network: "down" }, "cant-tell"]] as const) {
          const tracker = await trackerIn({ projects: [{ path: tools, number: 1, open: 1, issues: [{ number: 1 }] }], ...world });
          assert.equal((await tracker.openIssues(resolved.project, null)).kind, kind);
        }
      });
    });
  });
}

export function changesContract(stage: Stage): void {
  const { product, wellKnownHost } = stage;
  const tools = "fixture-org/tools";
  const plans = "fixture-org/plans";
  /** When the Snapshot was last read; everything in a World is older unless it says otherwise. */
  const since = "2026-09-20T00:00:00Z";
  const after = "2026-09-21T00:00:00Z";
  const six: IssueSpec[] = Array.from({ length: 6 }, (_, i) => ({ number: i + 1 }));

  async function changes(world: World, outside: string[] = []): Promise<Extract<ChangesAnswer, { kind: "changes" }>> {
    const answer = await changesIn(world, outside);
    assert.equal(answer.kind, "changes", JSON.stringify(answer));
    return answer as Extract<ChangesAnswer, { kind: "changes" }>;
  }

  async function changesIn(world: World, outside: string[] = []): Promise<ChangesAnswer> {
    const tracker = await stage.arrange(world).kind.recognise(wellKnownHost);
    assert.ok(tracker, `${product} recognises ${wellKnownHost}`);
    const resolved = await tracker.resolveProject(tools);
    assert.equal(resolved.kind, "project", JSON.stringify(resolved));
    return tracker.changes((resolved as Extract<ProjectResolution, { kind: "project" }>).project, since, outside);
  }

  /** The identity the Tracker gives an Issue, as its card reads it. */
  async function idOf(world: World, ref: string): Promise<string> {
    const answer = await (await stage.arrange(world).kind.recognise(wellKnownHost))!.issue(ref);
    assert.equal(answer.kind, "issue", JSON.stringify(answer));
    return (answer as Extract<IssueAnswer, { kind: "issue" }>).issue.id;
  }

  const refs = (issues: OpenIssue[]) => issues.map((i) => i.ref).sort();
  /** The ends of a Link, read with or without it: at least one end is enough, since a Snapshot records it at both. */
  const readWith = (open: OpenIssue[], a: string, role: string, b: string) =>
    open.some((i) => i.ref === `#${a}` && i.links.some((l) => l.role === role && l.to.readable && l.to.ref === `${tools}#${b}`));

  describe(`${product} Tracker contract`, () => {
    describe("needs 3, 4 and 7 again, for only what changed", () => {
      test("reads the Issues updated since, open ones whole and closed ones as far ends, and no others", async () => {
        const issues: IssueSpec[] = [...six];
        issues[1] = { number: 2, title: "Import state from S3", updatedAt: after };
        issues[2] = { number: 3, closed: true, closedAs: "not planned", closedAt: after };
        const read = await changes({ projects: [{ path: tools, number: 1, open: 5, issues }] });
        assert.deepEqual(read.open.map((i) => [i.ref, i.title]), [["#2", "Import state from S3"]]);
        assert.deepEqual(read.ends.map((e) => e.readable && [e.ref, e.open, e.closedAs, e.closedAt]), [[`${tools}#3`, false, "not planned", after]]);
        assert.equal(read.caughtUp, true);
        assert.deepEqual(read.unread, {});
      });

      test("reads a Link made or removed since, though neither Issue's own update marks it", async () => {
        const world: World = {
          projects: [{ path: tools, number: 1, open: 6, issues: six }],
          links: [[`${tools}#1`, "blocks", `${tools}#2`, after], [`${tools}#3`, "blocks", `${tools}#4`]],
          removedLinks: [[`${tools}#5`, "parent", `${tools}#6`, after]],
        };
        const { open } = await changes(world);
        assert.ok(readWith(open, "1", "blocked", "2") || readWith(open, "2", "blocker", "1"), `the new Link: ${JSON.stringify(open)}`);
        const removedFrom = open.filter((i) => i.ref === "#5" || i.ref === "#6");
        assert.ok(removedFrom.length > 0 && removedFrom.every((i) => i.links.length === 0), `the removed Link: ${JSON.stringify(open)}`);
        assert.equal(open.some((i) => i.ref === "#3" || i.ref === "#4"), false, "a Link made long ago reads nothing");
      });

      test("reads an Issue whose Closing Requests changed since, though its own update doesn't mark it", async () => {
        const world: World = {
          projects: [{ path: tools, number: 1, open: 6, issues: six }],
          closingRequests: [
            { closes: `${tools}#4`, number: 40, author: "fixture-bot", updatedAt: after },
            { closes: `${tools}#5`, number: 41, author: "fixture-bot", state: "closed", updatedAt: after },
            { closes: `${tools}#6`, number: 42, author: "fixture-bot" },
          ],
        };
        const { open, requests } = await changes(world);
        assert.deepEqual(refs(open), ["#4", "#5"]);
        assert.deepEqual([...requests].sort(), [`${tools}#40`, `${tools}#41`], "so an Issue a request no longer closes can be told apart");
        assert.deepEqual(open.find((i) => i.ref === "#4")!.closingRequests.map((r) => [r.ref, r.author]), [[`${tools}#40`, "fixture-bot"]]);
        assert.deepEqual(open.find((i) => i.ref === "#5")!.closingRequests, []);
      });

      test("reads again the Issues outside the Project it's asked about, and says which it can't read any more", async () => {
        const world = (hidden: boolean): World => ({
          projects: [
            { path: tools, number: 1, open: 1, issues: [{ number: 1 }] },
            { path: plans, number: 2, open: 2, issues: [{ number: 7, title: "Q3 importer epic", closed: true, closedAt: after }, { number: 8, hidden }] },
          ],
        });
        const [seven, eight] = [await idOf(world(false), `${plans}#7`), await idOf(world(false), `${plans}#8`)];
        const { open, ends } = await changes(world(true), [seven, eight]);
        assert.deepEqual(open, []);
        const byId = new Map(ends.map((e) => [e.id, e]));
        const read = byId.get(seven);
        assert.deepEqual(read?.readable && [read.ref, read.title, read.open, read.closedAt], [`${plans}#7`, "Q3 importer epic", false, after]);
        assert.deepEqual(byId.get(eight), { id: eight, readable: false });
      });

      test("says so when its record of what changed doesn't reach back far enough", async () => {
        const world: World = { projects: [{ path: tools, number: 1, open: 6, issues: six }], changesKeptFrom: "2026-09-22T00:00:00Z" };
        assert.equal((await changes(world)).caughtUp, false);
      });

      test("a login that can't read Closing Requests still reads what changed, and says why none are given", async () => {
        const issues: IssueSpec[] = [...six];
        issues[1] = { number: 2, updatedAt: after };
        const read = await changes({ projects: [{ path: tools, number: 1, open: 6, issues }], readsClosingRequests: false });
        assert.deepEqual(refs(read.open), ["#2"]);
        assert.match(read.unread.closingRequests ?? "", /pull|merge/i);
      });

      test("refuses when the Tracker rejects the login, can't tell when it can't be reached or the rate limit is used up, and says when the Project is gone", async () => {
        const project: ProjectSpec = { path: tools, number: 1, open: 6, issues: six };
        const tracker = await stage.arrange({ projects: [project] }).kind.recognise(wellKnownHost);
        const resolved = (await tracker!.resolveProject(tools)) as Extract<ProjectResolution, { kind: "project" }>;
        for (const [trouble, kind] of [[{ login: "refused" }, "refused"], [{ network: "down" }, "cant-tell"], [{ rateLimited: true }, "cant-tell"]] as const) {
          const troubled = await stage.arrange({ projects: [project], ...trouble }).kind.recognise(wellKnownHost);
          const answer = await troubled!.changes(resolved.project, since, []);
          assert.equal(answer.kind, kind, JSON.stringify(trouble));
        }
        const gone = await tracker!.changes({ ...resolved.project, path: "fixture-org/gone" }, since, []);
        assert.equal(gone.kind, "not-found");
      });
    });
  });
}

export function cardContract(stage: Stage): void {
  const { product, wellKnownHost } = stage;
  const tools = "fixture-org/tools";
  const plans = "fixture-org/plans";

  async function trackerIn(world: World): Promise<Tracker> {
    const tracker = await stage.arrange(world).kind.recognise(wellKnownHost);
    assert.ok(tracker, `${product} recognises ${wellKnownHost}`);
    return tracker;
  }

  async function issue(world: World, locator: string): Promise<IssueRead> {
    const answer = await (await trackerIn(world)).issue(locator);
    assert.equal(answer.kind, "issue", JSON.stringify(answer));
    return (answer as Extract<IssueAnswer, { kind: "issue" }>).issue;
  }

  /** The identity each open Issue of a Project is listed with. */
  async function listedIds(world: World, path: string): Promise<Map<string, string>> {
    const tracker = await trackerIn(world);
    const resolved = await tracker.resolveProject(path);
    assert.equal(resolved.kind, "project");
    const page = await tracker.openIssues((resolved as Extract<ProjectResolution, { kind: "project" }>).project, null);
    assert.equal(page.kind, "page");
    return new Map((page as Extract<typeof page, { kind: "page" }>).issues.map((i) => [`${path}${i.ref}`, i.id]));
  }

  describe(`${product} Tracker contract`, () => {
    describe("needs 3, 4 and 7 for one Issue, read live for its card", () => {
      const world: World = {
        projects: [
          { path: tools, number: 1, open: 4, issues: [{ number: 1 }, { number: 2, title: "Import state from S3" }, { number: 3 }, { number: 4 }, { number: 5, closed: true, closedAs: "not planned" }] },
          { path: plans, number: 2, open: 1, issues: [{ number: 7, title: "Q3 importer epic" }] },
        ],
        links: [[`${tools}#1`, "blocks", `${tools}#2`], [`${tools}#2`, "blocks", `${tools}#3`], [`${plans}#7`, "parent", `${tools}#2`], [`${tools}#2`, "parent", `${tools}#4`]],
        closingRequests: [{ closes: `${tools}#2`, number: 40, author: "fixture-bot", draft: true }, { closes: `${tools}#2`, number: 41, author: "fixture-bot", state: "merged" }],
        mentions: [[`${tools}#3`, `${tools}#2`], [`${tools}#4`, `${tools}#2`], [`${tools}#2`, `${tools}#1`]],
      };

      test("reads an Issue by its reference: its name, URL, state, Links with the Tracker's name for each kind, Closing Requests and Mentions", async () => {
        const two = await issue(world, `${tools}#2`);
        const ids = await listedIds(world, tools);
        assert.deepEqual([two.id, two.project, two.ref, two.title, two.open, two.closedAs], [ids.get(`${tools}#2`), tools, `${tools}#2`, "Import state from S3", true, null]);
        assert.match(two.url, /fixture-org\/tools\/issues\/2$/);
        const links = two.links.map((l) => [l.role, l.to.readable && l.to.ref]).sort();
        assert.deepEqual(links, [["blocked", `${tools}#3`], ["blocker", `${tools}#1`], ["child", `${tools}#4`], ["parent", `${plans}#7`]]);
        const names = new Map(two.links.map((l) => [l.role, l.name]));
        assert.equal(new Set(names.values()).size, 4, `a name for each kind: ${JSON.stringify([...names])}`);
        assert.ok([...names.values()].every((name) => name.length > 0));
        assert.deepEqual(two.closingRequests.map((r) => [r.ref, r.draft, r.author]), [[`${tools}#40`, true, "fixture-bot"]]);
        assert.deepEqual([...two.mentionedBy].sort(), [ids.get(`${tools}#3`), ids.get(`${tools}#4`)].sort(), "Issues naming it, not the ones it names");
        assert.deepEqual(two.unread, {});
      });

      test("reads the same Issue by its URL", async () => {
        const byRef = await issue(world, `${tools}#2`);
        const byUrl = await issue(world, byRef.url);
        assert.equal(byUrl.id, byRef.id);
      });

      test("reads a closed Issue and says how it closed", async () => {
        const five = await issue(world, `${tools}#5`);
        assert.deepEqual([five.open, five.closedAs], [false, "not planned"]);
      });

      test("reads an Issue in another Project on the same Tracker", async () => {
        const seven = await issue(world, `${plans}#7`);
        assert.deepEqual([seven.project, seven.title, seven.open], [plans, "Q3 importer epic", true]);
      });

      test("a login that can't read Closing Requests still reads the Issue, and says why none are given", async () => {
        const two = await issue({ ...world, readsClosingRequests: false }, `${tools}#2`);
        assert.deepEqual(two.closingRequests, []);
        assert.match(two.unread.closingRequests ?? "", /pull|merge/i);
      });

      test("says there's no such Issue when it doesn't exist, this login can't read it, or the locator names none", async () => {
        const hidden: World = { ...world, projects: [...world.projects!, { path: "fixture-org/private", number: 3, open: 1, issues: [{ number: 9, hidden: true }] }] };
        for (const locator of [`${tools}#99`, "fixture-org/private#9", "nobody/nothing#1", "#2", "not a reference"]) {
          assert.equal((await (await trackerIn(hidden)).issue(locator)).kind, "not-found", locator);
        }
      });

      test("refuses when the Tracker rejects the login, and can't tell when it can't be reached", async () => {
        for (const [trouble, kind] of [[{ login: "refused" }, "refused"], [{ network: "down" }, "cant-tell"]] as const) {
          assert.equal((await (await trackerIn({ ...world, ...trouble })).issue(`${tools}#2`)).kind, kind);
        }
      });
    });
  });
}
