/**
 * The contract suite against the GitHub adapter, with `gh` and the network
 * stood in for by replies in the shapes github.com and GHES give.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { github } from "../src/tracker/github.ts";
import type { IssueAnswer, IssuePage, ProjectResolution, Tracker } from "../src/tracker/tracker.ts";
import { CALL_SECONDS, type HttpResult } from "../src/tracker/boundary.ts";
import { authStatus, ghApi, newer, probe } from "./fakes/fake-gh.ts";
import { trackerContract, type World } from "./contract/tracker-contract.ts";

trackerContract({
  product: "GitHub",
  wellKnownHost: "github.com",
  untestedVersion: "3.17.0",
  currentVersion: "3.20.0",
  records: {
    related: "GitHub records no Related Links",
    taskLevel: "GitHub has no level below an ordinary Issue",
    multipleParents: true,
    namespaceIssues: "every GitHub Issue belongs to a repository",
    projectsWithoutBlocks: "every repository on github.com records Blocks Links",
    changeFeed: true,
  },
  saysClosedAs: ["completed", "not planned", "duplicate"],
  requestRef: (path, n) => `${path}#${n}`,
  arrange(given) {
    // A write changes the World, so each Tracker gets its own.
    const world = structuredClone(given);
    let requests = 0;
    const loginsSentTo: string[] = [];
    const tokenSentTo: string[] = [];
    // gh sends GH_TOKEN to github.com, and GH_ENTERPRISE_TOKEN to any other host, before a login it stores.
    const env = world.envTokenFor === undefined ? {} : world.envTokenFor === "github.com" ? { GH_TOKEN: "env-token" } : { GH_ENTERPRISE_TOKEN: "env-token", GH_HOST: world.envTokenFor };
    const kind = github({
      env,
      cli: async (command, args, unset = [], seconds = CALL_SECONDS) => {
        if (command !== "gh" || (world.cli ?? "installed") === "missing") return { kind: "missing" };
        // Read from gh's own config, without the network.
        if (args[0] === "auth") return authStatus(world, args);
        requests++;
        const host = args[args.indexOf("--hostname") + 1]!;
        loginsSentTo.push(host);
        const token = host === "github.com" ? "GH_TOKEN" : "GH_ENTERPRISE_TOKEN";
        if (token in env && !unset.includes(token)) {
          tokenSentTo.push(host);
          if (host !== world.envTokenFor) return ghApi({ ...world, login: "refused" }, args);
        }
        const answer = ghApi(world, args);
        return world.network === "hangs" ? { kind: "exited", code: 1, stdout: "", stderr: "", timedOut: seconds } : answer;
      },
      http: async (url) => {
        requests++;
        return probe(world, new URL(url));
      },
    });
    return { kind, requests: () => requests, loginsSentTo: () => loginsSentTo.filter((h) => h !== "github.com"), tokenSentTo: () => tokenSentTo };
  },
});

describe("GHES by release: each Link kind is known from the GHES's own schema, never from an error's shape", () => {
  const host = "ghes.example.com";
  const tools = "fixture-org/tools";

  /**
   * A GHES of `version` with #1 the Parent of #2, and #3 Blocking #2 where
   * the release records Blocks; in private mode, it doesn't say its release.
   */
  async function ghes(version: string, privateMode = false) {
    const links: NonNullable<World["links"]> = [];
    if (newer(version, "3.17")) links.push([`${tools}#1`, "parent", `${tools}#2`]);
    if (newer(version, "3.19")) links.push([`${tools}#3`, "blocks", `${tools}#2`]);
    const world: World = {
      servers: { [host]: { runs: "this-kind", version } },
      loggedInTo: [host],
      projects: [{ path: tools, number: 1, open: 3, issues: [{ number: 1 }, { number: 2 }, { number: 3 }] }],
      links,
    };
    const privately: HttpResult = { kind: "response", status: 401, headers: { "x-github-request-id": "0000:0000:0000000:0000000:00000000" }, body: "" };
    const kind = github({ env: {}, cli: async (command, args) => (args[0] === "auth" ? authStatus(world, args) : ghApi(world, args)), http: async (url) => (privateMode ? privately : probe(world, new URL(url))) });
    const probed = await kind.probe(host);
    assert.equal(probed.kind, "identified");
    const tracker: Tracker = (probed as Extract<typeof probed, { kind: "identified" }>).tracker;
    const resolved = (await tracker.resolveProject(tools)) as Extract<ProjectResolution, { kind: "project" }>;
    const page = (await tracker.openIssues(resolved.project, null)) as Extract<IssuePage, { kind: "page" }>;
    assert.equal(page.kind, "page", JSON.stringify(page));
    const card = (await tracker.issue(`${tools}#2`)) as Extract<IssueAnswer, { kind: "issue" }>;
    assert.equal(card.kind, "issue", JSON.stringify(card));
    const said = await tracker.capabilities(resolved.project);
    assert.equal(said.kind, "capabilities", JSON.stringify(said));
    const changes = await tracker.changes(resolved.project, "2020-01-01T00:00:00Z", []);
    assert.equal(changes.kind, "changes", JSON.stringify(changes));
    const two = page.issues.find((i) => i.ref === "#2")!;
    return { tracker, page, card: card.issue, two: two.links.map((l) => l.role).sort(), ...(said as Extract<typeof said, { kind: "capabilities" }>) };
  }

  test("a supported release from 3.19 reads Parent and Blocks Links, and is tested", async () => {
    for (const version of ["3.19.0", "3.22.1"]) {
      const { tracker, page, two, links } = await ghes(version);
      assert.equal(tracker.untested, null);
      assert.deepEqual(two, ["blocker", "parent"], version);
      assert.deepEqual([links.blocks, links.parent, page.unread], [{ kind: "readable" }, { kind: "readable" }, {}]);
      assert.equal(links.related.kind, "cant-record");
    }
  });

  test("3.18 is supported but can't record Blocks Links, so a read says so and no Issue is Unblocked", async () => {
    const { tracker, page, card, two, links } = await ghes("3.18.2");
    assert.equal(tracker.untested, null);
    assert.deepEqual(two, ["parent"]);
    const why = "GHES 3.18.2 can't record Blocks Links; 3.19 and later can";
    assert.deepEqual(links.blocks, { kind: "cant-record", reason: why });
    assert.deepEqual([page.unread.blocks, card.unread.blocks], [why, why]);
  });

  test("3.17, which GitHub no longer supports, still reads Parent Links, untested", async () => {
    const { tracker, two, links } = await ghes("3.17.4");
    assert.equal(tracker.untested, "GHES 3.17.4 is older than 3.18, the oldest release GitHub still supports");
    assert.deepEqual([two, links.parent.kind, links.blocks.kind], [["parent"], "readable", "cant-record"]);
  });

  test("a GHES whose release can't be learnt is read by what its own schema has: untested, not Refused", async () => {
    const { tracker, two, links } = await ghes("3.19.0", true);
    assert.equal(tracker.version, null);
    assert.match(tracker.untested ?? "", /release/);
    assert.deepEqual([two, links.blocks, links.parent], [["blocker", "parent"], { kind: "readable" }, { kind: "readable" }]);
    const older = await ghes("3.18.0", true);
    assert.deepEqual([older.two, older.links.blocks.kind], [["parent"], "cant-record"]);
    assert.match(older.links.blocks.kind === "cant-record" ? older.links.blocks.reason : "", /schema/);
  });

  test("before 3.17 GHES records no Link kind the Map can read", async () => {
    const { links } = await ghes("3.16.3");
    assert.deepEqual(Object.values(links).map((l) => l.kind), ["cant-record", "cant-record", "cant-record"]);
  });
});

describe("a classic token with only the public_repo scope writes public repositories only", () => {
  async function write(isPrivate: boolean) {
    const world: World = { token: "public-writes", projects: [{ path: "fixture-org/tools", number: 1, open: 1, private: isPrivate }] };
    const kind = github({ env: {}, cli: async (_command, args) => (args[0] === "auth" ? authStatus(world, args) : ghApi(world, args)), http: async (url) => probe(world, new URL(url)) });
    const tracker = (await kind.recognise("github.com"))!;
    const resolved = (await tracker.resolveProject("fixture-org/tools")) as Extract<ProjectResolution, { kind: "project" }>;
    const said = await tracker.capabilities(resolved.project);
    assert.equal(said.kind, "capabilities", JSON.stringify(said));
    return (said as Extract<typeof said, { kind: "capabilities" }>).write;
  }

  test("on a public repository it can", async () => {
    assert.deepEqual(await write(false), { kind: "can" });
  });

  test("on a private repository it can't, and says which scope it lacks", async () => {
    const answer = await write(true);
    assert.equal(answer.kind, "cant");
    assert.match(answer.kind === "cant" ? answer.reason : "", /`repo` scope/);
  });
});

test("GH_HOST names its host in mixed case or with a scheme, so a GHES it names that can't be reached is still known", async () => {
  for (const GH_HOST of ["GHES.Example.com", "https://ghes.example.com/"]) {
    const kind = github({ env: { GH_HOST }, cli: async (_command, args) => authStatus({}, args), http: async () => ({ kind: "unreachable", reason: "ETIMEDOUT" }) });
    assert.equal((await kind.probe("ghes.example.com")).kind, "identified", GH_HOST);
  }
});

test("GitHub: only the repository itself missing is not-found, not a pull request gone from a page mid-read", async () => {
  const tools = "fixture-org/tools";
  const world: World = { projects: [{ path: tools, number: 1, open: 1, issues: [{ number: 1 }] }], closingRequests: [{ closes: `${tools}#1`, number: 40, author: "fixture-bot" }] };
  const gone = { type: "NOT_FOUND", path: ["repository", "issues", "nodes", 0, "closedByPullRequestsReferences", "nodes", 0], message: "Could not resolve to a PullRequest." };
  const cli = async (_: string, args: string[]) => {
    if (args[0] === "auth") return authStatus(world, args);
    const answer = ghApi(world, args);
    if (answer.kind !== "exited" || !args.some((a) => a.includes("issues(states: OPEN, first:"))) return answer;
    const body = JSON.parse(answer.stdout) as { errors?: object[] };
    return { ...answer, code: 1, stdout: JSON.stringify({ ...body, errors: [...(body.errors ?? []), gone] }) };
  };
  const tracker = (await github({ env: {}, cli, http: async (url) => probe(world, new URL(url)) }).recognise("github.com"))!;
  const resolved = (await tracker.resolveProject(tools)) as Extract<ProjectResolution, { kind: "project" }>;
  const page = await tracker.openIssues(resolved.project, null);
  assert.notEqual(page.kind, "not-found", JSON.stringify(page));
  assert.equal((await tracker.issue(`${tools}#9`)).kind, "not-found", "a missing Issue still is");
  assert.equal((await tracker.resolveProject("fixture-org/gone")).kind, "not-found", "a missing repository still is");
});
