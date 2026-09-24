/**
 * The contract suite against the GitLab adapter, with `glab` and the network
 * stood in for (`fakes/fake-glab.ts`), and what each self-hosted version
 * leaves unread.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { ChangesAnswer, IssueAnswer, IssuePage, OpenIssue, ProjectResolution, ThreadAnswer } from "../src/tracker/tracker.ts";
import { trackerContract, type ProjectSpec, type World } from "./contract/tracker-contract.ts";
import { arrange, LATEST } from "./fakes/fake-glab.ts";

trackerContract({
  product: "GitLab",
  wellKnownHost: "gitlab.com",
  untestedVersion: "15.4.0",
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
      assert.deepEqual(card.mentionedBy, version < "16.7" ? [] : [{ id: byMention, ref: `${tools}#4` }]);

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

describe("GitLab before 16.0: Best effort, read from REST", () => {
  const host = "git.example.com";
  const tools = "fixture-org/tools";
  const epic: ProjectSpec = { path: "fixture-org", number: 2, open: 1, namespace: true, issues: [{ number: 12, title: "Q3 importer epic" }] };
  const world = (version: string, more: World = {}): World => ({
    servers: { [host]: { runs: "this-kind", version } },
    loggedInTo: [host],
    projects: [
      { path: tools, number: 1, open: 4, issues: [{ number: 1, assignees: ["fixture-bot"], planned: "2026-10-01T00:00:00Z" }, { number: 2 }, { number: 3, taskLevel: true }, { number: 4, updatedAt: "2026-09-21T00:00:00Z" }, { number: 5, closed: true, closedAt: "2026-09-22T00:00:00Z" }] },
      epic,
    ],
    links: [
      [`${tools}#1`, "blocks", `${tools}#2`],
      [`${tools}#1`, "parent", `${tools}#3`],
      [`${tools}#4`, "related", `${tools}#1`],
      ["fixture-org#12", "parent", `${tools}#1`],
    ],
    ...more,
  });

  async function trackerAt(world: World) {
    const probed = await arrange(world).kind.probe(host);
    assert.equal(probed.kind, "identified");
    const tracker = (probed as Extract<typeof probed, { kind: "identified" }>).tracker;
    const resolved = await tracker.resolveProject(tools);
    assert.equal(resolved.kind, "project", JSON.stringify(resolved));
    return { tracker, project: (resolved as Extract<ProjectResolution, { kind: "project" }>).project };
  }

  test("15.11 reads Blocks and Related Links and the epic an Issue is in, marked untested; a task's Parent can't be read, and says why", async () => {
    const { tracker, project } = await trackerAt(world("15.11.3"));
    assert.equal(tracker.untested, "GitLab 15.11.3 is older than 16.0, the oldest the Map is tested on");
    assert.deepEqual(project.issues, { open: 4 });
    const page = await tracker.openIssues(project, null);
    assert.equal(page.kind, "page", JSON.stringify(page));
    const { issues, next, unread } = page as Extract<IssuePage, { kind: "page" }>;
    assert.equal(next, null);
    assert.deepEqual(issues.map((i) => i.ref), ["#1", "#2", "#3", "#4"]);
    const one = issues[0]!;
    assert.deepEqual([one.assignees, one.planned?.slice(0, 10), one.links.map((l) => l.role).sort()], [["fixture-bot"], "2026-10-01", ["blocked", "parent", "related"]]);
    assert.equal(issues[2]!.taskLevel, true);
    assert.equal(unread.blocks, undefined);
    assert.match(unread.closingRequests ?? "", /15\.11\.3/);

    const said = await tracker.capabilities(project);
    assert.equal(said.kind, "capabilities", JSON.stringify(said));
    const { links } = said as Extract<typeof said, { kind: "capabilities" }>;
    assert.deepEqual([links.blocks, links.related], [{ kind: "readable" }, { kind: "readable" }]);
    assert.equal(links.parent.kind, "cant-read");
    assert.match(links.parent.kind === "cant-read" ? links.parent.reason : "", /task/);

    const card = await tracker.issue(`${tools}#2`);
    assert.equal(card.kind, "issue", JSON.stringify(card));
    assert.deepEqual((card as Extract<IssueAnswer, { kind: "issue" }>).issue.links.map((l) => `${l.role} ${l.name}`), ["blocker Blocked by"]);

    const changes = await tracker.changes(project, "2026-09-20T00:00:00Z", []);
    assert.equal(changes.kind, "changes", JSON.stringify(changes));
    const { open, ends } = changes as Extract<ChangesAnswer, { kind: "changes" }>;
    assert.deepEqual([open.map((i) => i.ref), ends.map((e) => e.readable && e.ref)], [["#4"], [`${tools}#5`]]);
  });

  test("a tier without Blocks Links says so from 13.4", async () => {
    const { tracker, project } = await trackerAt(world("13.4.0", { recordsBlocks: false }));
    const said = await tracker.capabilities(project);
    assert.equal(said.kind === "capabilities" && said.links.blocks.kind, "cant-record");
  });

  test("before 13.4 the Map reads no Link kind", async () => {
    const { tracker, project } = await trackerAt(world("13.3.0"));
    const said = await tracker.capabilities(project);
    assert.equal(said.kind, "capabilities");
    const { links } = said as Extract<typeof said, { kind: "capabilities" }>;
    assert.deepEqual(Object.values(links), Array(3).fill({ kind: "cant-read", reason: "GitLab 13.3.0 is older than 13.4, the oldest the Map reads" }));
  });
});

describe("GitLab by version: an Issue's body and comments (need 8)", () => {
  const host = "git.example.com";
  const tools = "fixture-org/tools";
  const comments = [
    { author: "fixture-dev", body: "I can take this.", at: "2026-02-01T10:00:00Z" },
    { author: "fixture-bot", body: "Reproduced on main.", at: "2026-02-02T10:00:00Z" },
  ];
  const world = (version: string): World => ({
    servers: { [host]: { runs: "this-kind", version } },
    loggedInTo: [host],
    projects: [
      { path: tools, number: 1, open: 2, issues: [{ number: 1, title: "Import state from S3", body: "State lives in S3.", comments }, { number: 2, comments: Array.from({ length: 120 }, (_, i) => ({ author: "fixture-dev", body: `Comment ${i + 1}`, at: new Date(Date.UTC(2026, 1, 1, 0, i)).toISOString() })) }] },
      { path: "fixture-org", number: 2, open: 1, namespace: true, issues: [{ number: 12, title: "Q3 importer epic", body: "Every importer this quarter.", comments: [comments[0]!] }] },
    ],
    mentions: [[`${tools}#2`, `${tools}#1`]],
  });

  async function thread(version: string, locator: string) {
    const probed = await arrange(world(version)).kind.probe(host);
    assert.equal(probed.kind, "identified");
    const answer = await (probed as Extract<typeof probed, { kind: "identified" }>).tracker.thread(locator);
    assert.equal(answer.kind, "thread", JSON.stringify(answer));
    return (answer as Extract<ThreadAnswer, { kind: "thread" }>).thread;
  }

  for (const version of ["13.4.0", "15.11.3", "16.0.0", LATEST]) {
    test(`${version}: the body and comments, oldest first, without the notes GitLab makes by itself`, async () => {
      const one = await thread(version, `${tools}#1`);
      assert.deepEqual([one.ref, one.title, one.open, one.body, one.earlier], [`${tools}#1`, "Import state from S3", true, "State lives in S3.", false]);
      assert.deepEqual(one.comments.map((c) => [c.author, c.at, c.body]), comments.map((c) => [c.author, c.at, c.body]));
      const two = await thread(version, `${tools}#2`);
      assert.deepEqual([two.comments.length, two.comments[0]!.body, two.earlier], [100, "Comment 21", true]);
    });
  }

  for (const version of ["17.2.0", LATEST]) {
    test(`${version}: an epic's body and comments, as a legacy epic before 17.7 and a work item after`, async () => {
      const epic = await thread(version, "fixture-org&12");
      assert.deepEqual([epic.title, epic.body, epic.comments.map((c) => c.body)], ["Q3 importer epic", "Every importer this quarter.", ["I can take this."]]);
    });
  }
});

describe("GitLab by version: whether this login can write, and whether a Project records Blocks", () => {
  const host = "git.example.com";
  const tools = "fixture-org/tools";
  async function capabilities(version: string, more: World = {}, issues: ProjectSpec["issues"] = [{ number: 1 }]) {
    const world: World = { servers: { [host]: { runs: "this-kind", version } }, loggedInTo: [host], projects: [{ path: tools, number: 1, open: issues?.length ?? 0, issues }], ...more };
    const probed = await arrange(world).kind.probe(host);
    const tracker = (probed as Extract<typeof probed, { kind: "identified" }>).tracker;
    const { project } = (await tracker.resolveProject(tools)) as Extract<ProjectResolution, { kind: "project" }>;
    const said = await tracker.capabilities(project);
    assert.equal(said.kind, "capabilities", JSON.stringify(said));
    return said as Extract<typeof said, { kind: "capabilities" }>;
  }
  const write = async (version: string, more: World = {}) => (await capabilities(version, more)).write;

  test("before 18.3 a Project with no Issue to tell its tier by can't say whether it records Blocks, so the Map can't read them", async () => {
    const { blocks } = (await capabilities("18.2.0", {}, [])).links;
    assert.equal(blocks.kind, "cant-read");
    assert.match(blocks.kind === "cant-read" ? blocks.reason : "", /no Issue to tell by/);
  });

  test("before 16.9 the role comes from REST, which misses access through a shared group, so a login it finds none for can't be told", async () => {
    assert.deepEqual(await write("16.5.0"), { kind: "can" });
    assert.equal((await write("16.5.0", { role: "reader" })).kind, "cant-tell");
  });

  test("before 15.5 GitLab doesn't say what a token may write", async () => {
    assert.equal((await write("15.4.0")).kind, "cant-tell");
  });
});

describe("GitLab: writing a Link (need 10)", () => {
  const tools = "fixture-org/tools";
  const epic: ProjectSpec = { path: "fixture-org", number: 2, open: 1, namespace: true, issues: [{ number: 12, title: "Q3 importer epic" }] };
  const world = (version: string): World => ({
    servers: { "git.example.com": { runs: "this-kind", version } },
    loggedInTo: ["git.example.com"],
    projects: [{ path: tools, number: 1, open: 2, issues: [{ number: 1 }, { number: 2 }] }, epic],
  });
  async function trackerAt(version: string) {
    const probed = await arrange(world(version)).kind.probe("git.example.com");
    return (probed as Extract<typeof probed, { kind: "identified" }>).tracker;
  }

  test("only a task goes under an Issue: GitLab's refusal to put one Issue under another is said, and nothing is written", async () => {
    const tracker = await trackerAt(LATEST);
    const answer = await tracker.link(`${tools}#1`, "parent", `${tools}#2`);
    assert.equal(answer.kind, "not-allowed", JSON.stringify(answer));
    assert.match((answer as { reason: string }).reason, /not allowed to add this type of parent/);
    const two = (await tracker.issue(`${tools}#2`)) as Extract<IssueAnswer, { kind: "issue" }>;
    assert.deepEqual(two.issue.links, []);
  });

  test("GitLab keeps one Link between two Issues: a Blocks Link where a Related one is recorded isn't said to be written", async () => {
    const related: World = { ...world(LATEST), links: [[`${tools}#1`, "related", `${tools}#2`]] };
    const probed = await arrange(related).kind.probe("git.example.com");
    const tracker = (probed as Extract<typeof probed, { kind: "identified" }>).tracker;
    const answer = await tracker.link(`${tools}#1`, "blocks", `${tools}#2`);
    assert.equal(answer.kind, "cant-record", JSON.stringify(answer));
    assert.match((answer as { reason: string }).reason, /already Linked/);
    const one = (await tracker.issue(`${tools}#1`)) as Extract<IssueAnswer, { kind: "issue" }>;
    assert.deepEqual(one.issue.links.map((link) => link.role), ["related"]);
  });

  test("before 17.7 an epic isn't a work item, so no Issue is put under one", async () => {
    const answer = await (await trackerAt("17.6.0")).link("fixture-org&12", "parent", `${tools}#1`);
    assert.equal(answer.kind, "cant-record", JSON.stringify(answer));
    assert.match((answer as { reason: string }).reason, /17\.7/);
    assert.deepEqual(await (await trackerAt("17.7.0")).link("fixture-org#12", "parent", `${tools}#1`), { kind: "linked" });
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
