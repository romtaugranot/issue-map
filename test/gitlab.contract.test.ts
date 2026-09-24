/**
 * The contract suite against the GitLab adapter, with `glab` and the network
 * stood in for (`fakes/fake-glab.ts`), and what each self-hosted version
 * leaves unread.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { ChangesAnswer, IssueAnswer, IssuePage, OpenIssue, ProjectResolution } from "../src/tracker/tracker.ts";
import { trackerContract, type ProjectSpec, type World } from "./contract/tracker-contract.ts";
import { arrange, LATEST } from "./fakes/fake-glab.ts";

trackerContract({
  product: "GitLab",
  wellKnownHost: "gitlab.com",
  currentVersion: "19.4.0",
  records: {
    related: true,
    taskLevel: true,
    multipleParents: "a GitLab work item has at most one parent",
    namespaceIssues: true,
    projectsWithoutBlocks: true,
    changeFeed: "GitLab marks a Link change on both Issues' update times, so its record is the Issues themselves",
  },
  saysClosedAs: ["duplicate"],
  requestRef: (path, n) => `${path}!${n}`,
  arrange,
});

describe("GitLab by version: a self-hosted GitLab from 16.0 is asked only for what its version has, and reads every Link kind", () => {
  const host = "git.example.com";
  const tools = "fixture-org/tools";
  const upstream: ProjectSpec = { path: "fixture-org/upstream", number: 9, open: 0 };
  const epic: ProjectSpec = { path: "fixture-org", number: 2, open: 1, namespace: true, issues: [{ number: 12, title: "Q3 importer epic" }] };
  const world = (version: string, more: World = {}): World => ({
    servers: { [host]: { runs: "this-kind", version } },
    loggedInTo: [host],
    projects: [
      { path: tools, number: 1, open: 4, parent: upstream, issues: [{ number: 1 }, { number: 2 }, { number: 3, taskLevel: true }, { number: 4 }, { number: 5, closed: true, closedAs: "duplicate", duplicateOf: `${tools}#2` }] },
      upstream,
      epic,
    ],
    links: [
      [`${tools}#1`, "blocks", `${tools}#2`],
      [`${tools}#1`, "parent", `${tools}#3`],
      [`${tools}#4`, "related", `${tools}#1`],
      ["fixture-org#12", "parent", `${tools}#1`],
      ["fixture-org#12", "parent", `${tools}#2`],
    ],
    closingRequests: [{ closes: `${tools}#2`, number: 40, author: "fixture-bot" }],
    mentions: [[`${tools}#4`, `${tools}#2`]],
    ...more,
  });

  async function read(world: World) {
    const { kind, loginsSentTo } = arrange(world);
    const probed = await kind.probe(host);
    assert.equal(probed.kind, "identified");
    const tracker = (probed as Extract<typeof probed, { kind: "identified" }>).tracker;
    const resolved = await tracker.resolveProject(tools);
    assert.equal(resolved.kind, "project", JSON.stringify(resolved));
    const { project, parent } = resolved as Extract<ProjectResolution, { kind: "project" }>;
    const page = await tracker.openIssues(project, null);
    assert.equal(page.kind, "page", JSON.stringify(page));
    const card = await tracker.issue(`${tools}#2`);
    assert.equal(card.kind, "issue", JSON.stringify(card));
    return { tracker, project, parent, page: page as Extract<IssuePage, { kind: "page" }>, card: (card as Extract<IssueAnswer, { kind: "issue" }>).issue, loginsSentTo: loginsSentTo() };
  }

  const issue = (issues: OpenIssue[], ref: string) => issues.find((i) => i.ref === ref)!;
  const roles = (issues: OpenIssue[], ref: string) => issue(issues, ref).links.map((l) => l.role).sort();

  for (const version of ["16.0.0", "16.3.0", "16.7.0", "17.1.0", "17.2.0", "17.7.0", "17.8.0", "18.0.0", "18.3.0", LATEST]) {
    test(`${version}: every Link kind, the epic an Issue is in, and the Project it was forked from`, async () => {
      const { tracker, project, parent, page, card, loginsSentTo } = await read(world(version));
      assert.ok(loginsSentTo.includes(host));
      assert.equal(parent?.path, upstream.path);
      assert.deepEqual(project.issues, { open: 4 });
      assert.equal(page.unread.blocks, undefined);
      assert.deepEqual(roles(page.issues, "#1"), ["blocked", "child", "parent", "related"]);
      assert.equal(issue(page.issues, "#3").taskLevel, true);
      assert.equal(issue(page.issues, "#1").taskLevel, false);

      const epicOf = (ref: string) => issue(page.issues, ref).links.find((l) => l.role === "parent")!.to;
      const shared = epicOf("#1");
      assert.equal(shared.readable && shared.title, "Q3 importer epic");
      assert.equal(shared.readable && shared.project, "fixture-org");
      assert.equal(epicOf("#2").id, shared.id, "the Issues in one epic share it as a far end");

      assert.deepEqual(card.links.map((l) => `${l.role} ${l.name}`).sort(), ["blocker Blocked by", "parent Parent"], "a duplicate is no Link");
      const byMention = issue(page.issues, "#4").id;
      assert.deepEqual(card.mentionedBy, version < "16.7" ? [] : [byMention]);

      assert.ok(shared.readable);
      const epicCard = await tracker.issue(shared.url);
      assert.equal(epicCard.kind, "issue", JSON.stringify(epicCard));
      const epicRead = (epicCard as Extract<IssueAnswer, { kind: "issue" }>).issue;
      assert.equal(epicRead.id, shared.id);
      assert.deepEqual(epicRead.links.map((l) => l.role), ["child", "child"]);

      const changes = await tracker.changes(project, "2020-01-01T00:00:00Z", [shared.id]);
      assert.equal(changes.kind, "changes", JSON.stringify(changes));
      const ends = (changes as Extract<ChangesAnswer, { kind: "changes" }>).ends;
      assert.equal(ends.find((e) => e.id === shared.id)?.readable, true, "an Outside epic is read again by its identity");
    });
  }

  test("before 18.3 a Project's tier is told by whether REST gives an Issue's weight", async () => {
    assert.deepEqual((await read(world("18.2.0"))).page.unread, {});
    const free = await read(world("18.2.0", { recordsBlocks: false }));
    assert.match(free.page.unread.blocks ?? "", /can't record Blocks/);
    assert.match(free.card.unread.blocks ?? "", /can't record Blocks/);
  });

  test("before 17.1 Closing Requests are unread, and say why", async () => {
    const { page, card } = await read(world("17.0.0"));
    assert.match(page.unread.closingRequests ?? "", /17\.0\.0/);
    assert.deepEqual(card.closingRequests, []);
    assert.match(card.unread.closingRequests ?? "", /merge requests/);
  });
});

describe("GitLab's environment token goes only to the host glab takes it for", () => {
  const selfHosted = { runs: "this-kind", version: LATEST } as const;
  const servers = { "git.example.com": selfHosted, "git.example.org": selfHosted };
  const tofu: ProjectSpec = { path: "opentofu/opentofu", number: 1, open: 0 };
  const hosts = ["gitlab.com", "git.example.com", "git.example.org"];

  async function sentTo(env: Record<string, string>, issuedFor: string) {
    const { kind, tokenSentTo, loginsSentTo } = arrange({ servers, loggedInTo: hosts.slice(1), projects: [tofu], envTokenFor: issuedFor }, env);
    for (const host of hosts) {
      const found = (await kind.recognise(host)) ?? (await kind.probe(host));
      const tracker = "kind" in found ? (found.kind === "identified" ? found.tracker : null) : found;
      assert.equal((await tracker!.resolveProject(tofu.path)).kind, "project", host);
    }
    return { token: [...new Set(tokenSentTo())].sort(), logins: [...new Set(loginsSentTo())].sort() };
  }

  test("GITLAB_URI names the host as GITLAB_HOST does", async () => {
    assert.deepEqual((await sentTo({ GITLAB_TOKEN: "t", GITLAB_URI: "https://git.example.org" }, "git.example.org")).token, ["git.example.org"]);
    assert.deepEqual((await sentTo({ OAUTH_TOKEN: "t", GL_HOST: "git.example.com" }, "git.example.com")).token, ["git.example.com"]);
  });

  test("in CI with glab's auto-login, the job's token goes only to the job's server", async () => {
    const ci = { GLAB_ENABLE_CI_AUTOLOGIN: "true", GITLAB_CI: "true", CI_JOB_TOKEN: "t", CI_SERVER_FQDN: "git.example.com", GITLAB_HOST: "git.example.org" };
    assert.deepEqual((await sentTo(ci, "git.example.com")).token, ["git.example.com"]);
  });

  test("an API host set for one GitLab isn't where another's requests go", async () => {
    const { logins } = await sentTo({ GITLAB_HOST: "git.example.com", GITLAB_API_HOST: "git.example.com" }, "git.example.com");
    assert.deepEqual(logins, ["git.example.com", "git.example.org"]);
  });

  test("GITLAB_HOST alone, with no token, is no login for its host, so a server that isn't GitLab isn't taken for one", async () => {
    const { kind } = arrange({ servers: { "git.example.com": { runs: "something-else" } } }, { GITLAB_HOST: "git.example.com" });
    assert.equal((await kind.probe("git.example.com")).kind, "not-this-kind");
  });
});
