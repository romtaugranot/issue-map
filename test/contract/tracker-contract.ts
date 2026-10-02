/**
 * One contract suite for every Tracker adapter (spec, Seam B), covering
 * needs 1 to 11 including their "can't" answers, for a whole Project, for
 * only what changed in it, for one Issue read for its card, for one Issue's
 * thread read to start work on it, and for the writes.
 * Each adapter supplies a Stage that stands a World up behind its own
 * boundary. Where kinds of Tracker differ in what they record, a Stage says
 * so, and a test of what its kind can't record is skipped with the reason.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { CALL_SECONDS, PAGE_SECONDS } from "../../src/tracker/boundary.ts";
import type { CapabilitiesAnswer, ChangesAnswer, FarEnd, IssueAnswer, IssueRead, OpenIssue, Project, ProjectResolution, Thread, Tracker, TrackerKind, Unread } from "../../src/tracker/tracker.ts";

export interface ProjectSpec {
  path: string;
  /** Distinct per Project in a World; not the Project's identity as the Tracker states it. */
  number: number;
  open: number | "off";
  parent?: ProjectSpec;
  /** Paths the Project had before it was renamed or moved. */
  oldPaths?: string[];
  issues?: IssueSpec[];
  /** Not a Project but a namespace above them, such as a GitLab group, holding Issues of its own such as epics. */
  namespace?: boolean;
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
  /** How it closed; `completed` by default. One closed as a duplicate names the Issue it duplicates in `duplicateOf`. */
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
  /** Deleted mid-read: it's listed, but a read of it alone finds nothing. */
  vanished?: boolean;
  /** At the Tracker's smallest level, such as a GitLab task; its Parent is set with a `parent` Link. */
  taskLevel?: boolean;
  /** Closed as a duplicate of this Issue, as the Tracker marks it. */
  duplicateOf?: IssueAddress;
  /** Its description; none by default. */
  body?: string;
  /** Its comments, oldest first; `at` is an ISO date. */
  comments?: { author: string; body: string; at: string }[];
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
  /**
   * Whether the well-known host can be reached. `hangs`: each request
   * reaches it and does what it asks, but the CLI never exits, so it's
   * killed once its time is up.
   */
  network?: "up" | "down" | "hangs";
  /**
   * `[a, "blocks", b]` reads "a Blocks b"; `[a, "parent", b]` reads "a is the
   * Parent of b"; `[a, "related", b]` reads "a is Related to b". A fourth
   * element is when the Link was made, as an ISO date; long ago by default.
   * A kind the Tracker can't record is left out of it.
   */
  links?: [IssueAddress, "blocks" | "parent" | "related", IssueAddress, string?][];
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
  /** `vanished`: deleted mid-read, after it's listed and before the Issues it closes are read. */
  closingRequests?: { closes: IssueAddress; number: number; author: string; draft?: boolean; state?: "open" | "closed" | "merged"; updatedAt?: string; vanished?: boolean }[];
  /** `false` for a login that may read Issues but not pull or merge requests. */
  readsClosingRequests?: boolean;
  /** `[a, b]` reads "a names b in its text". */
  mentions?: [IssueAddress, IssueAddress][];
  /** The Tracker answers which Issues mention one with an error below the top of its answer, leaving them `null`. */
  mentionsFail?: boolean;
  /** `false` where the Project's tier can't record Blocks Links, such as GitLab Free. */
  recordsBlocks?: boolean;
  /** The host a token in the environment was issued for, set the way the CLI documents. */
  envTokenFor?: string;
  /** The login's role in every Project: one that may write Links, the default, or one that may only read them. */
  role?: "writer" | "reader";
  /**
   * What the login's token may do: write, the default; only read; or not
   * say, as a GitHub fine-grained token doesn't. `cant-ask`: asking fails,
   * as with a `gh` too old to answer in JSON, or a CI job's token GitLab
   * answers nothing about.
   */
  token?: "writes" | "reads" | "unknown" | "cant-ask";
}

export interface Stage {
  product: string;
  /** A host this kind is known to run at by name alone. */
  wellKnownHost: string;
  /** A version of this kind's self-hosted Tracker that the Map promises everything on. */
  currentVersion: string;
  /** A version of this kind's self-hosted Tracker that the Map reads but isn't tested on. */
  untestedVersion: string;
  /** What this kind records where kinds differ: `true`, or why it doesn't. */
  records: {
    related: true | string;
    taskLevel: true | string;
    /** More than one Parent Link to one Issue. */
    multipleParents: true | string;
    /** Issues that belong to a namespace above Projects rather than to a Project, such as a GitLab group's epics. */
    namespaceIssues: true | string;
    /** Projects whose tier can't record Blocks Links. */
    projectsWithoutBlocks: true | string;
    /** A record of changes, apart from the Issues' own update times, that can run out before a refresh reaches back. */
    changeFeed: true | string;
  };
  /** Which of the World's ways of closing the Tracker says; the others read as not said. */
  saysClosedAs: readonly ("completed" | "not planned" | "duplicate")[];
  /** The reference users type for Closing Request `n` of the Project at `path`. */
  requestRef(path: string, n: number): string;
  /**
   * Builds the adapter against a World, counts requests that left the
   * machine, lists the hosts the CLI's login was sent to, and lists the
   * hosts the environment's token was sent to.
   */
  arrange(world: World): { kind: TrackerKind; requests(): number; loginsSentTo(): string[]; tokenSentTo(): string[] };
}

/** A test's options: skipped, with why, where the Stage's kind records what it needs not to. */
function skipIf(record: true | string, why: string): { skip?: string } {
  return record === true ? { skip: why } : {};
}

/** A test's options: skipped, with why, where the Stage's kind doesn't record what it needs. */
function skipUnless(record: true | string): { skip?: string } {
  return record === true ? {} : { skip: record };
}

/** How a closed Issue closed, as the Stage's kind says it; `undefined` where it doesn't say. */
function said(stage: Stage, way: "completed" | "not planned" | "duplicate"): string | undefined {
  return stage.saysClosedAs.includes(way) ? way : undefined;
}

/** An Issue's URL on a Tracker, whichever of the paths the Tracker gives it. */
function issueUrl(path: string, n: number): RegExp {
  return new RegExp(`${path.replaceAll("/", "\\/")}\\/(-\\/)?(issues|work_items)\\/${n}$`);
}

/** The whole contract: every need an adapter answers. */
export function trackerContract(stage: Stage): void {
  identifyContract(stage);
  resolveContract(stage);
  readContract(stage);
  changesContract(stage);
  cardContract(stage);
  capabilitiesContract(stage);
  threadContract(stage);
  assignContract(stage);
  linkContract(stage);
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

      test("a token in the environment goes only to the host it was issued for", async () => {
        const selfHosted = { runs: "this-kind", version: stage.currentVersion } as const;
        const servers = { "git.example.com": selfHosted, "git.example.org": selfHosted };
        const readAt = async (world: World, hosts: string[]) => {
          const { kind, tokenSentTo } = stage.arrange(world);
          for (const host of hosts) {
            const probed = (await kind.recognise(host)) ?? (await kind.probe(host));
            const tracker = "kind" in probed ? (probed.kind === "identified" ? probed.tracker : null) : probed;
            assert.ok(tracker, host);
            assert.equal((await tracker.resolveProject("opentofu/opentofu")).kind, "project", host);
          }
          return [...new Set(tokenSentTo())].sort();
        };
        const loggedInTo = ["git.example.com", "git.example.org"];
        assert.deepEqual(await readAt({ servers, loggedInTo, projects: [tofu], envTokenFor: wellKnownHost }, [wellKnownHost, ...loggedInTo]), [wellKnownHost]);
        assert.deepEqual(await readAt({ servers, loggedInTo, projects: [tofu], envTokenFor: "git.example.com" }, [wellKnownHost, ...loggedInTo]), ["git.example.com"]);
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

      test("can't tell when the CLI never answers, and says how long it waited", async () => {
        const answer = await (await trackerIn({ network: "hangs" })).viewer();
        assert.deepEqual([answer.kind, (answer as { reason: string }).reason], ["cant-tell", `${wellKnownHost} didn't answer in ${CALL_SECONDS} s`]);
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
        assert.match(five.url, issueUrl(tools, 5));
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

      test("an Issue can have more than one Parent", skipUnless(stage.records.multipleParents), async () => {
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
              issues: [{ number: 1 }, { number: 2, closed: true, closedAt: "2026-09-21T08:00:00Z" }, { number: 3, closed: true, closedAs: "duplicate", duplicateOf: `${tools}#1`, closedAt: "2026-09-22T08:00:00Z" }],
            },
          ],
          links: [[`${tools}#2`, "blocks", `${tools}#1`], [`${tools}#3`, "blocks", `${tools}#1`]],
        };
        const one = byRef((await readAll(world, tools)).issues, "#1");
        const [two, three] = [linkTo(one, "blocker", `${tools}#2`), linkTo(one, "blocker", `${tools}#3`)];
        assert.deepEqual(two.readable && [two.open, two.closedAt, two.closedAs], [false, "2026-09-21T08:00:00Z", said(stage, "completed")]);
        assert.deepEqual(three.readable && [three.open, three.closedAt, three.closedAs], [false, "2026-09-22T08:00:00Z", said(stage, "duplicate")]);
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

      test("reads Related Links from both ends, with no direction", skipUnless(stage.records.related), async () => {
        const world: World = {
          projects: [{ path: tools, number: 1, open: 3, issues: [{ number: 1 }, { number: 2 }, { number: 3 }] }],
          links: [[`${tools}#1`, "related", `${tools}#2`]],
        };
        const { issues } = await readAll(world, tools);
        const [one, two] = [byRef(issues, "#1"), byRef(issues, "#2")];
        assert.equal(linkTo(one, "related", `${tools}#2`).id, two.id);
        assert.equal(linkTo(two, "related", `${tools}#1`).id, one.id);
        assert.deepEqual(byRef(issues, "#3").links, []);
      });

      test("tells a task-level child from an ordinary child", skipUnless(stage.records.taskLevel), async () => {
        const world: World = {
          projects: [{ path: tools, number: 1, open: 3, issues: [{ number: 1 }, { number: 2, taskLevel: true }, { number: 3 }] }],
          links: [[`${tools}#1`, "parent", `${tools}#2`], [`${tools}#1`, "parent", `${tools}#3`]],
        };
        const { issues } = await readAll(world, tools);
        assert.deepEqual(issues.map((i) => [i.ref, i.taskLevel]), [["#1", false], ["#2", true], ["#3", false]]);
        linkTo(byRef(issues, "#1"), "child", `${tools}#2`);
        linkTo(byRef(issues, "#1"), "child", `${tools}#3`);
        linkTo(byRef(issues, "#2"), "parent", `${tools}#1`);
      });

      test("a namespace's own Issue, such as a GitLab group's epic, is a far end outside the Project that the Issues it parents share", skipUnless(stage.records.namespaceIssues), async () => {
        const world: World = {
          projects: [
            { path: tools, number: 1, open: 3, issues: [{ number: 1 }, { number: 2 }, { number: 3 }] },
            { path: "fixture-org", number: 2, open: 1, namespace: true, issues: [{ number: 12, title: "Q3 importer epic" }] },
          ],
          links: [["fixture-org#12", "parent", `${tools}#1`], ["fixture-org#12", "parent", `${tools}#2`]],
        };
        const { issues } = await readAll(world, tools);
        assert.deepEqual(issues.map((i) => i.ref), ["#1", "#2", "#3"], "the namespace's Issue isn't listed");
        const ends = [byRef(issues, "#1"), byRef(issues, "#2")].map((i) => i.links.find((l) => l.role === "parent")?.to);
        assert.equal(ends[0]?.id, ends[1]?.id, "both Links name the same Issue");
        const epic = ends[0];
        assert.deepEqual(epic?.readable && [epic.open, epic.project, epic.title], [true, "fixture-org", "Q3 importer epic"]);
        assert.match(epic?.readable ? epic.ref : "", /^fixture-org[#&]12$/);
      });

      test("need 5: a Project whose tier can't record Blocks Links says so", skipUnless(stage.records.projectsWithoutBlocks), async () => {
        const world: World = { projects: [{ path: tools, number: 1, open: 2, issues: [{ number: 1 }, { number: 2 }] }], recordsBlocks: false };
        const { issues, unread } = await readAll(world, tools);
        assert.equal(issues.length, 2);
        assert.match(unread.blocks ?? "", /Blocks/);
        const recorded = await readAll({ ...world, recordsBlocks: true }, tools);
        assert.equal(recorded.unread.blocks, undefined);
      });

      test("an Issue closed as a duplicate has no Link to the Issue it duplicates", async () => {
        const world: World = {
          projects: [{ path: tools, number: 1, open: 1, issues: [{ number: 1 }, { number: 2, closed: true, closedAs: "duplicate", duplicateOf: `${tools}#1` }] }],
        };
        assert.deepEqual(byRef((await readAll(world, tools)).issues, "#1").links, []);
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
          [[stage.requestRef(tools, 40), false, "fixture-bot"], [stage.requestRef(tools, 41), true, "fixture-viewer"]],
        );
        assert.match(byRef(issues, "#1").closingRequests[0]!.url, /fixture-org\/tools\/(-\/)?(pull|merge_requests)\/40$/);
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

      test("waits longer for a page than for other calls before saying the Tracker didn't answer", async () => {
        const world: World = { projects: [{ path: tools, number: 1, open: 1, issues: [{ number: 1 }] }] };
        const resolved = await project(world, tools);
        const page = await (await trackerIn({ ...world, network: "hangs" })).openIssues(resolved.project, null);
        assert.deepEqual(page, { kind: "cant-tell", reason: `${wellKnownHost} didn't answer in ${PAGE_SECONDS} s` });
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
        assert.deepEqual(read.ends.map((e) => e.readable && [e.ref, e.open, e.closedAs, e.closedAt]), [[`${tools}#3`, false, said(stage, "not planned"), after]]);
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
        assert.deepEqual([...requests].sort(), [stage.requestRef(tools, 40), stage.requestRef(tools, 41)], "so an Issue a request no longer closes can be told apart");
        assert.deepEqual(open.find((i) => i.ref === "#4")!.closingRequests.map((r) => [r.ref, r.author]), [[stage.requestRef(tools, 40), "fixture-bot"]]);
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

      test("says so when its record of what changed doesn't reach back far enough", skipUnless(stage.records.changeFeed), async () => {
        const world: World = { projects: [{ path: tools, number: 1, open: 6, issues: six }], changesKeptFrom: "2026-09-22T00:00:00Z" };
        assert.equal((await changes(world)).caughtUp, false);
      });

      test("says so when more changed since than one refresh reads", async () => {
        const many: IssueSpec[] = Array.from({ length: 1001 }, (_, i) => ({ number: i + 1, updatedAt: after }));
        const read = await changes({ projects: [{ path: tools, number: 1, open: 1001, issues: many }] });
        assert.equal(read.caughtUp, false);
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
        for (const [trouble, kind] of [[{ login: "refused" }, "refused"], [{ network: "down" }, "cant-tell"], [{ network: "hangs" }, "cant-tell"], [{ rateLimited: true }, "cant-tell"]] as const) {
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
          { path: tools, number: 1, open: 4, issues: [{ number: 1 }, { number: 2, title: "Import state from S3", assignees: ["fixture-dev"] }, { number: 3 }, { number: 4 }, { number: 5, closed: true, closedAs: "not planned" }] },
          { path: plans, number: 2, open: 1, issues: [{ number: 7, title: "Q3 importer epic" }] },
        ],
        links: [[`${tools}#1`, "blocks", `${tools}#2`], [`${tools}#2`, "blocks", `${tools}#3`], [`${plans}#7`, "parent", `${tools}#2`], [`${tools}#2`, "parent", `${tools}#4`]],
        closingRequests: [{ closes: `${tools}#2`, number: 40, author: "fixture-bot", draft: true }, { closes: `${tools}#2`, number: 41, author: "fixture-bot", state: "merged" }],
        mentions: [[`${tools}#3`, `${tools}#2`], [`${tools}#4`, `${tools}#2`], [`${tools}#2`, `${tools}#1`]],
      };

      test("reads an Issue by its reference: its name, URL, state, assignees, Links with the Tracker's name for each kind, Closing Requests and Mentions", async () => {
        const two = await issue(world, `${tools}#2`);
        const ids = await listedIds(world, tools);
        assert.deepEqual([two.id, two.project, two.ref, two.title, two.open, two.closedAs, two.assignees], [ids.get(`${tools}#2`), tools, `${tools}#2`, "Import state from S3", true, null, ["fixture-dev"]]);
        assert.deepEqual((await issue(world, `${tools}#3`)).assignees, []);
        assert.match(two.url, issueUrl(tools, 2));
        const links = two.links.map((l) => [l.role, l.to.readable && l.to.ref]).sort();
        assert.deepEqual(links, [["blocked", `${tools}#3`], ["blocker", `${tools}#1`], ["child", `${tools}#4`], ["parent", `${plans}#7`]]);
        const names = new Map(two.links.map((l) => [l.role, l.name]));
        assert.equal(new Set(names.values()).size, 4, `a name for each kind: ${JSON.stringify([...names])}`);
        assert.ok([...names.values()].every((name) => name.length > 0));
        assert.deepEqual(two.closingRequests.map((r) => [r.ref, r.draft, r.author]), [[stage.requestRef(tools, 40), true, "fixture-bot"]]);
        const mentions = two.mentionedBy.map((m) => [m.id, m.ref]).sort();
        assert.deepEqual(mentions, [[ids.get(`${tools}#3`), `${tools}#3`], [ids.get(`${tools}#4`), `${tools}#4`]].sort(), "Issues naming it, not the ones it names");
        assert.deepEqual(two.unread, {});
      });

      test("reads every Issue that mentions it, past ten, and each once though the Tracker notes it twice", async () => {
        const many: World = {
          projects: [{ path: tools, number: 1, open: 17, issues: Array.from({ length: 17 }, (_, i) => ({ number: i + 1 })) }],
          mentions: [...Array.from({ length: 15 }, (_, i): [string, string] => [`${tools}#${i + 3}`, `${tools}#2`]), [`${tools}#3`, `${tools}#2`]],
        };
        const two = await issue(many, `${tools}#2`);
        assert.deepEqual(two.mentionedBy.map((m) => m.ref).sort(), Array.from({ length: 15 }, (_, i) => `${tools}#${i + 3}`).sort());
        assert.deepEqual(two.unread, {});
      });

      test("names a Related Link the way the Tracker does, apart from the other kinds", skipUnless(stage.records.related), async () => {
        const two = await issue({ ...world, links: [...world.links!, [`${tools}#3`, "related", `${tools}#2`]] }, `${tools}#2`);
        const related = two.links.filter((l) => l.role === "related");
        assert.deepEqual(related.map((l) => l.to.readable && l.to.ref), [`${tools}#3`]);
        assert.ok(related[0]!.name.length > 0 && two.links.every((l) => l.role === "related" || l.name !== related[0]!.name));
      });

      test("need 5: says so when the Issue's Project can't record Blocks Links", skipUnless(stage.records.projectsWithoutBlocks), async () => {
        const two = await issue({ ...world, recordsBlocks: false }, `${tools}#2`);
        assert.match(two.unread.blocks ?? "", /Blocks/);
      });

      test("reads a namespace's own Issue, such as a GitLab group's epic", skipUnless(stage.records.namespaceIssues), async () => {
        const grouped: World = { ...world, projects: [...world.projects!, { path: "fixture-org", number: 3, open: 1, namespace: true, issues: [{ number: 12, title: "Q3 importer epic" }] }] };
        const epic = await issue(grouped, "fixture-org#12");
        assert.deepEqual([epic.project, epic.title, epic.open], ["fixture-org", "Q3 importer epic", true]);
        assert.equal((await issue(grouped, epic.url)).id, epic.id);
      });

      test("reads the same Issue by its URL", async () => {
        const byRef = await issue(world, `${tools}#2`);
        const byUrl = await issue(world, byRef.url);
        assert.equal(byUrl.id, byRef.id);
      });

      test("reads a closed Issue and says how it closed", async () => {
        const five = await issue(world, `${tools}#5`);
        assert.deepEqual([five.open, five.closedAs], [false, said(stage, "not planned") ?? null]);
      });

      test("a Link to an Issue closed as a duplicate names the Issue it duplicates, which reads by it", skipUnless(said(stage, "duplicate") ? true : "the Tracker doesn't say an Issue closed as a duplicate"), async () => {
        const duplicated: World = {
          projects: [{ path: tools, number: 1, open: 2, issues: [{ number: 1 }, { number: 2, closed: true, closedAs: "duplicate", duplicateOf: `${tools}#3` }, { number: 3 }, { number: 4, closed: true }] }],
          links: [[`${tools}#2`, "blocks", `${tools}#1`], [`${tools}#4`, "blocks", `${tools}#1`]],
        };
        const one = await issue(duplicated, `${tools}#1`);
        const ends = new Map(one.links.map((l) => [l.to.readable && l.to.ref, l.to]));
        const two = ends.get(`${tools}#2`);
        assert.ok(two?.readable && two.duplicateOf, JSON.stringify(two));
        assert.equal((await issue(duplicated, two.duplicateOf)).ref, `${tools}#3`);
        const four = ends.get(`${tools}#4`);
        assert.equal(four?.readable && "duplicateOf" in four, false, "one closed otherwise duplicates nothing");
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

export function capabilitiesContract(stage: Stage): void {
  const { product, wellKnownHost } = stage;
  const tools = "fixture-org/tools";
  const project: ProjectSpec = { path: tools, number: 1, open: 2, issues: [{ number: 1 }, { number: 2 }] };

  async function trackerIn(world: World): Promise<Tracker> {
    const tracker = await stage.arrange(world).kind.recognise(wellKnownHost);
    assert.ok(tracker, `${product} recognises ${wellKnownHost}`);
    return tracker;
  }

  async function asked(world: World): Promise<CapabilitiesAnswer> {
    const ready = await trackerIn({ projects: [project], ...world });
    const resolved = await (await trackerIn({ projects: [project] })).resolveProject(tools);
    assert.equal(resolved.kind, "project", JSON.stringify(resolved));
    return ready.capabilities((resolved as Extract<ProjectResolution, { kind: "project" }>).project);
  }

  async function capabilities(world: World = {}): Promise<Extract<CapabilitiesAnswer, { kind: "capabilities" }>> {
    const answer = await asked(world);
    assert.equal(answer.kind, "capabilities", JSON.stringify(answer));
    return answer as Extract<CapabilitiesAnswer, { kind: "capabilities" }>;
  }

  describe(`${product} Tracker contract`, () => {
    describe("need 5: say per Link kind whether the Project records it and the Map can read it", () => {
      test("on its well-known host the Map is tested, it reads every kind the Tracker records, and says why of any it can't record", async () => {
        assert.equal((await trackerIn({})).untested, null);
        const { links } = await capabilities();
        assert.deepEqual([links.blocks, links.parent], [{ kind: "readable" }, { kind: "readable" }]);
        if (stage.records.related === true) assert.deepEqual(links.related, { kind: "readable" });
        else assert.deepEqual(links.related, { kind: "cant-record", reason: stage.records.related });
      });

      test("tells a Project whose tier can't record Blocks Links from one that records them and has none", skipUnless(stage.records.projectsWithoutBlocks), async () => {
        assert.deepEqual((await capabilities()).links.blocks, { kind: "readable" });
        const { blocks } = (await capabilities({ recordsBlocks: false })).links;
        assert.equal(blocks.kind, "cant-record");
        assert.match(blocks.kind === "cant-record" ? blocks.reason : "", /Blocks/);
      });

      test("a self-hosted Tracker on a version the Map is tested on says so; on an older one it still reads, says why it isn't", async () => {
        const at = async (version: string) => {
          const answer = await stage.arrange({ servers: { "git.example.com": { runs: "this-kind", version } }, loggedInTo: ["git.example.com"] }).kind.probe("git.example.com");
          assert.equal(answer.kind, "identified");
          return (answer as Extract<typeof answer, { kind: "identified" }>).tracker.untested;
        };
        assert.equal(await at(stage.currentVersion), null);
        assert.match((await at(stage.untestedVersion)) ?? "", new RegExp(stage.untestedVersion.replaceAll(".", "\\.")));
      });
    });

    describe("need 9: say whether this login can write a Link or assign", () => {
      test("a login whose role and token both may write can", async () => {
        assert.deepEqual((await capabilities()).write, { kind: "can" });
      });

      test("a login whose role may only read can't, and says why", async () => {
        const { write } = await capabilities({ role: "reader" });
        assert.equal(write.kind, "cant");
        assert.match(write.kind === "cant" ? write.reason : "", /fixture-org\/tools/);
      });

      test("a login whose token may only read can't, and says why", async () => {
        const { write } = await capabilities({ token: "reads" });
        assert.equal(write.kind, "cant");
        assert.match(write.kind === "cant" ? write.reason : "", /token/);
      });

      test("a token that doesn't say what it may write can't be told, and says why", async () => {
        const { write } = await capabilities({ token: "unknown" });
        assert.equal(write.kind, "cant-tell");
        assert.match(write.kind === "cant-tell" ? write.reason : "", /token/);
      });
    });

    test("a login it can't ask what its token may write can't be told, and the Project still reads", async () => {
      const { links, write } = await capabilities({ token: "cant-ask" });
      assert.deepEqual(links.blocks, { kind: "readable" });
      assert.equal(write.kind, "cant-tell");
      assert.match(write.kind === "cant-tell" ? write.reason : "", /token/);
    });

    test("needs 5 and 9 refuse when the Tracker rejects the login, can't tell when it can't be reached, and say when the Project is gone", async () => {
      for (const [trouble, kind] of [[{ login: "refused" }, "refused"], [{ network: "down" }, "cant-tell"]] as const) {
        assert.equal((await asked(trouble)).kind, kind, JSON.stringify(trouble));
      }
      const resolved = (await (await trackerIn({ projects: [project] })).resolveProject(tools)) as Extract<ProjectResolution, { kind: "project" }>;
      assert.equal((await (await trackerIn({ projects: [project] })).capabilities({ ...resolved.project, path: "fixture-org/gone" })).kind, "not-found");
    });
  });
}

export function assignContract(stage: Stage): void {
  const { product, wellKnownHost } = stage;
  const tools = "fixture-org/tools";
  const world: World = {
    projects: [{ path: tools, number: 1, open: 3, issues: [{ number: 1 }, { number: 2, assignees: ["fixture-dev"] }, { number: 3, taskLevel: stage.records.taskLevel === true }, { number: 9, hidden: true }] }],
  };

  async function trackerIn(more: World = {}): Promise<Tracker> {
    const tracker = await stage.arrange({ ...world, ...more }).kind.recognise(wellKnownHost);
    assert.ok(tracker, `${product} recognises ${wellKnownHost}`);
    return tracker;
  }

  async function assigneesOf(tracker: Tracker, locator: string): Promise<string[]> {
    const answer = await tracker.issue(locator);
    assert.equal(answer.kind, "issue", JSON.stringify(answer));
    return (answer as Extract<IssueAnswer, { kind: "issue" }>).issue.assignees;
  }

  describe(`${product} Tracker contract`, () => {
    describe("need 11: assign an Issue to the viewer", () => {
      test("assigns an unassigned Issue to the viewer, and the Issue read again says so", async () => {
        const tracker = await trackerIn();
        assert.deepEqual(await tracker.assign(`${tools}#1`, "fixture-viewer"), { kind: "assigned", assignees: ["fixture-viewer"] });
        assert.deepEqual(await assigneesOf(tracker, `${tools}#1`), ["fixture-viewer"]);
      });

      test("assigns a task-level child like any other Issue", skipUnless(stage.records.taskLevel), async () => {
        const tracker = await trackerIn();
        assert.deepEqual(await tracker.assign(`${tools}#3`, "fixture-viewer"), { kind: "assigned", assignees: ["fixture-viewer"] });
      });

      test("keeps whoever else it's assigned to", async () => {
        const tracker = await trackerIn();
        const answer = await tracker.assign(`${tools}#2`, "fixture-viewer");
        assert.equal(answer.kind, "assigned", JSON.stringify(answer));
        assert.deepEqual([...(answer as Extract<typeof answer, { kind: "assigned" }>).assignees].sort(), ["fixture-dev", "fixture-viewer"]);
      });

      test("a login whose role may only read is refused the write, says why, and the Issue stays as it was", async () => {
        const tracker = await trackerIn({ role: "reader" });
        const answer = await tracker.assign(`${tools}#1`, "fixture-viewer");
        assert.equal(answer.kind, "not-allowed", JSON.stringify(answer));
        assert.match((answer as { reason: string }).reason, /fixture-org\/tools/);
        assert.deepEqual(await assigneesOf(tracker, `${tools}#1`), []);
      });

      test("a login whose token may only read is refused the write, says why, and the Issue stays as it was", async () => {
        const tracker = await trackerIn({ token: "reads" });
        const answer = await tracker.assign(`${tools}#1`, "fixture-viewer");
        assert.equal(answer.kind, "not-allowed", JSON.stringify(answer));
        assert.match((answer as { reason: string }).reason, /token/);
        assert.deepEqual(await assigneesOf(tracker, `${tools}#1`), []);
      });

      test("says there's no such Issue when it doesn't exist, this login can't read it, or the locator names none", async () => {
        for (const locator of [`${tools}#99`, `${tools}#9`, "not a reference"]) {
          assert.equal((await (await trackerIn()).assign(locator, "fixture-viewer")).kind, "not-found", locator);
        }
      });

      test("refuses when the Tracker rejects the login, and can't tell when it can't be reached", async () => {
        for (const [trouble, kind] of [[{ login: "refused" }, "refused"], [{ network: "down" }, "cant-tell"]] as const) {
          assert.equal((await (await trackerIn(trouble)).assign(`${tools}#1`, "fixture-viewer")).kind, kind, JSON.stringify(trouble));
        }
      });

      test("can't tell, rather than waiting forever, when the write reaches the Tracker but the CLI never answers", async () => {
        const answer = await (await trackerIn({ network: "hangs" })).assign(`${tools}#1`, "fixture-viewer");
        assert.deepEqual(answer, { kind: "cant-tell", reason: `${wellKnownHost} didn't answer in ${CALL_SECONDS} s` });
      });
    });
  });
}

export function threadContract(stage: Stage): void {
  const { product, wellKnownHost } = stage;
  const tools = "fixture-org/tools";
  const long = Array.from({ length: 130 }, (_, i) => ({ author: i % 2 === 0 ? "fixture-bot" : "fixture-dev", body: `Comment ${i + 1}`, at: new Date(Date.UTC(2026, 1, 1, 0, i)).toISOString() }));
  const world: World = {
    projects: [
      {
        path: tools,
        number: 1,
        open: 3,
        issues: [
          {
            number: 1,
            title: "Import state from S3",
            body: "State lives in S3.\n\n```\nError: access denied\n```",
            comments: [
              { author: "fixture-dev", body: "I can take this.", at: "2026-02-01T10:00:00Z" },
              { author: "fixture-bot", body: "Reproduced on main.", at: "2026-02-02T10:00:00Z" },
            ],
          },
          { number: 2, comments: long },
          { number: 3 },
          { number: 4, closed: true, body: "Done already." },
          { number: 9, hidden: true },
        ],
      },
    ],
    mentions: [[`${tools}#3`, `${tools}#1`]],
    closingRequests: [{ closes: `${tools}#1`, number: 40, author: "fixture-bot" }],
  };

  async function trackerIn(given: World): Promise<Tracker> {
    const tracker = await stage.arrange(given).kind.recognise(wellKnownHost);
    assert.ok(tracker, `${product} recognises ${wellKnownHost}`);
    return tracker;
  }

  async function thread(given: World, locator: string): Promise<Thread> {
    const answer = await (await trackerIn(given)).thread(locator);
    assert.equal(answer.kind, "thread", JSON.stringify(answer));
    return (answer as Extract<typeof answer, { kind: "thread" }>).thread;
  }

  describe(`${product} Tracker contract`, () => {
    describe("need 8: read an Issue's body and comments", () => {
      test("reads an Issue's body and its comments, oldest first, with who wrote each and when; a Mention or a Closing Request isn't a comment", async () => {
        const one = await thread(world, `${tools}#1`);
        assert.deepEqual([one.ref, one.title, one.open, one.body, one.earlier], [`${tools}#1`, "Import state from S3", true, "State lives in S3.\n\n```\nError: access denied\n```", false]);
        assert.match(one.url, issueUrl(tools, 1));
        assert.deepEqual(one.comments, [
          { author: "fixture-dev", at: "2026-02-01T10:00:00Z", body: "I can take this." },
          { author: "fixture-bot", at: "2026-02-02T10:00:00Z", body: "Reproduced on main." },
        ]);
      });

      test("reads the same thread by the Issue's URL", async () => {
        const one = await thread(world, `${tools}#1`);
        assert.deepEqual(await thread(world, one.url), one);
      });

      test("on a long thread, reads the latest 100 comments and says there are earlier ones it didn't read", async () => {
        const two = await thread(world, `${tools}#2`);
        assert.equal(two.comments.length, 100);
        assert.deepEqual([two.comments[0]!.body, two.comments.at(-1)!.body, two.earlier], ["Comment 31", "Comment 130", true]);
      });

      test("an Issue with no body and no comments reads as empty", async () => {
        const three = await thread(world, `${tools}#3`);
        assert.deepEqual([three.body, three.comments, three.earlier], ["", [], false]);
      });

      test("reads a closed Issue's thread", async () => {
        const four = await thread(world, `${tools}#4`);
        assert.deepEqual([four.open, four.body], [false, "Done already."]);
      });

      test("reads a namespace's own Issue, such as a GitLab group's epic", skipUnless(stage.records.namespaceIssues), async () => {
        const grouped: World = { ...world, projects: [...world.projects!, { path: "fixture-org", number: 3, open: 1, namespace: true, issues: [{ number: 12, title: "Q3 importer epic", body: "Every importer this quarter.", comments: [{ author: "fixture-dev", body: "S3 first.", at: "2026-03-01T09:00:00Z" }] }] }] };
        const epic = await thread(grouped, "fixture-org#12");
        assert.deepEqual([epic.title, epic.body, epic.comments.map((c) => c.body)], ["Q3 importer epic", "Every importer this quarter.", ["S3 first."]]);
      });

      test("says there's no such Issue when it doesn't exist, this login can't read it, or the locator names none", async () => {
        for (const locator of [`${tools}#99`, `${tools}#9`, "nobody/nothing#1", "not a reference"]) {
          assert.equal((await (await trackerIn(world)).thread(locator)).kind, "not-found", locator);
        }
      });

      test("refuses when the Tracker rejects the login, and can't tell when it can't be reached", async () => {
        for (const [trouble, kind] of [[{ login: "refused" }, "refused"], [{ network: "down" }, "cant-tell"]] as const) {
          assert.equal((await (await trackerIn({ ...world, ...trouble })).thread(`${tools}#1`)).kind, kind, JSON.stringify(trouble));
        }
      });
    });
  });
}

export function linkContract(stage: Stage): void {
  const { product, wellKnownHost } = stage;
  const tools = "fixture-org/tools";
  // A task-level child is the one Issue any Tracker lets be put under an ordinary Issue.
  const child = { taskLevel: stage.records.taskLevel === true };
  const world: World = {
    projects: [
      {
        path: tools,
        number: 1,
        open: 6,
        issues: [{ number: 1 }, { number: 2 }, { number: 3, ...child }, { number: 4 }, { number: 5, ...child }, { number: 6 }, { number: 9, hidden: true }],
      },
    ],
    links: [[`${tools}#4`, "parent", `${tools}#5`]],
  };

  async function trackerIn(more: World = {}): Promise<Tracker> {
    const tracker = await stage.arrange({ ...world, ...more }).kind.recognise(wellKnownHost);
    assert.ok(tracker, `${product} recognises ${wellKnownHost}`);
    return tracker;
  }

  /** The Links the Issue `locator` names has, as `role far-end` read again from the Tracker. */
  async function linksOf(tracker: Tracker, locator: string): Promise<string[]> {
    const answer = await tracker.issue(locator);
    assert.equal(answer.kind, "issue", JSON.stringify(answer));
    return (answer as Extract<IssueAnswer, { kind: "issue" }>).issue.links.map((l) => `${l.role} ${l.to.readable ? l.to.ref : "?"}`).sort();
  }

  describe(`${product} Tracker contract`, () => {
    describe("need 10: write a Link of a kind the Project records", () => {
      test("writes a Blocks Link, and both Issues read again show it, each from its own end", async () => {
        const tracker = await trackerIn();
        assert.deepEqual(await tracker.link(`${tools}#1`, "blocks", `${tools}#2`), { kind: "linked" });
        assert.deepEqual(await linksOf(tracker, `${tools}#2`), [`blocker ${tools}#1`]);
        assert.deepEqual(await linksOf(tracker, `${tools}#1`), [`blocked ${tools}#2`]);
      });

      test("writes a Parent Link, and both Issues read again show it", async () => {
        const tracker = await trackerIn();
        assert.deepEqual(await tracker.link(`${tools}#1`, "parent", `${tools}#3`), { kind: "linked" });
        assert.deepEqual(await linksOf(tracker, `${tools}#3`), [`parent ${tools}#1`]);
        assert.deepEqual(await linksOf(tracker, `${tools}#1`), [`child ${tools}#3`]);
      });

      test("writes a Related Link, and both Issues read again show it", skipUnless(stage.records.related), async () => {
        const tracker = await trackerIn();
        assert.deepEqual(await tracker.link(`${tools}#1`, "related", `${tools}#2`), { kind: "linked" });
        assert.deepEqual(await linksOf(tracker, `${tools}#2`), [`related ${tools}#1`]);
        assert.deepEqual(await linksOf(tracker, `${tools}#1`), [`related ${tools}#2`]);
      });

      test("puts an Issue under a namespace's own Issue, such as a GitLab group's epic", skipUnless(stage.records.namespaceIssues), async () => {
        const grouped: World = { projects: [...world.projects!, { path: "fixture-org", number: 3, open: 1, namespace: true, issues: [{ number: 12, title: "Q3 importer epic" }] }] };
        const tracker = await trackerIn(grouped);
        assert.deepEqual(await tracker.link("fixture-org#12", "parent", `${tools}#1`), { kind: "linked" });
        assert.deepEqual(await linksOf(tracker, `${tools}#1`), ["parent fixture-org#12"]);
      });

      test("a kind the Tracker can't record isn't written, and says why", skipIf(stage.records.related, "every kind the contract names is one this Tracker records"), async () => {
        const answer = await (await trackerIn()).link(`${tools}#1`, "related", `${tools}#2`);
        assert.deepEqual(answer, { kind: "cant-record", reason: stage.records.related });
      });

      test("never moves an Issue from the Parent it has: that write is refused, says why, and its Parent stays", async () => {
        const tracker = await trackerIn();
        const answer = await tracker.link(`${tools}#1`, "parent", `${tools}#5`);
        assert.equal(answer.kind, "not-allowed", JSON.stringify(answer));
        assert.match((answer as { reason: string }).reason, /Parent/);
        assert.deepEqual(await linksOf(tracker, `${tools}#5`), [`parent ${tools}#4`]);
      });

      test("a login whose role may only read is refused the write, says why, and nothing is written", async () => {
        const tracker = await trackerIn({ role: "reader" });
        const answer = await tracker.link(`${tools}#1`, "blocks", `${tools}#2`);
        assert.equal(answer.kind, "not-allowed", JSON.stringify(answer));
        assert.match((answer as { reason: string }).reason, /fixture-org\/tools/);
        assert.deepEqual(await linksOf(tracker, `${tools}#2`), []);
      });

      test("a login whose token may only read is refused the write, says why, and nothing is written", async () => {
        const tracker = await trackerIn({ token: "reads" });
        const answer = await tracker.link(`${tools}#1`, "parent", `${tools}#3`);
        assert.equal(answer.kind, "not-allowed", JSON.stringify(answer));
        assert.match((answer as { reason: string }).reason, /token/);
        assert.deepEqual(await linksOf(tracker, `${tools}#3`), []);
      });

      test("says there's no such Issue when either end doesn't exist, this login can't read it, or its locator names none", async () => {
        for (const [from, to] of [[`${tools}#1`, `${tools}#99`], [`${tools}#99`, `${tools}#1`], [`${tools}#1`, `${tools}#9`], ["not a reference", `${tools}#1`]] as const) {
          for (const kind of ["blocks", "parent"] as const) {
            assert.equal((await (await trackerIn()).link(from, kind, to)).kind, "not-found", `${from} ${kind} ${to}`);
          }
        }
      });

      test("refuses when the Tracker rejects the login, and can't tell when it can't be reached", async () => {
        for (const [trouble, kind] of [[{ login: "refused" }, "refused"], [{ network: "down" }, "cant-tell"]] as const) {
          assert.equal((await (await trackerIn(trouble)).link(`${tools}#1`, "blocks", `${tools}#2`)).kind, kind, JSON.stringify(trouble));
        }
      });

      test("can't tell, rather than waiting forever, when the CLI never answers", async () => {
        const answer = await (await trackerIn({ network: "hangs" })).link(`${tools}#1`, "blocks", `${tools}#2`);
        assert.deepEqual(answer, { kind: "cant-tell", reason: `${wellKnownHost} didn't answer in ${CALL_SECONDS} s` });
      });
    });
  });
}
