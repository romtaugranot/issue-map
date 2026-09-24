/**
 * The fixture Projects' manifest, and the seeder that writes it to a
 * Tracker: a second run writes nothing, and nothing is ever deleted.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Cli, CliResult } from "../src/tracker/boundary.ts";
import type { IssueAnswer, LinkAnswer, LinkKind, NamedLink } from "../src/tracker/tracker.ts";
import { githubSeeding, gitlabSeeding, seed, type Existing, type Seeding } from "../scripts/fixtures/seed.ts";
import { FIXTURES, NAMESPACES, title, type Fixture } from "./live/fixtures.ts";

describe("the fixture manifest", () => {
  for (const fixture of Object.values(FIXTURES)) {
    test(`${fixture.name}: every Link and duplicate names an Issue it declares, and keys and titles are unique`, () => {
      const issues = fixture.projects.flatMap((p) => p.issues);
      const keys = issues.map((i) => i.key);
      assert.equal(new Set(keys).size, keys.length);
      for (const project of fixture.projects) assert.equal(new Set(project.issues.map(title)).size, project.issues.length);
      const named = [...fixture.links.flatMap(([a, , b]) => [a, b]), ...issues.flatMap((i) => (typeof i.closed === "object" ? [i.closed.duplicateOf] : []))];
      for (const key of named) assert.ok(keys.includes(key), `${fixture.name} names ${key}, which it doesn't declare`);
    });

    test(`${fixture.name}: every Project lives in a project-owned namespace, and only Link kinds its Tracker records are declared`, () => {
      const owned: string[] = [...Object.values(NAMESPACES.github), ...Object.values(NAMESPACES.gitlab)];
      for (const namespace of fixture.namespaces) assert.ok(owned.includes(namespace), namespace);
      for (const { path } of fixture.projects) assert.ok(fixture.namespaces.some((n) => path === n || path.startsWith(`${n}/`)), path);
      for (const [, kind] of fixture.links) assert.equal(fixture.expect.links[kind], "readable", `${fixture.name} can't record ${kind}`);
    });
  }

  test("between them, the Fixtures hold every Link shape the tests assert on", () => {
    const all = Object.values(FIXTURES);
    const issues = all.flatMap((f) => f.projects.flatMap((p) => p.issues));
    const kinds = new Set(all.flatMap((f) => f.links.map(([, kind]) => kind)));
    assert.deepEqual([...kinds].sort(), ["blocks", "parent", "related"]);
    assert.ok(issues.some((i) => i.level === "task"), "a Task-level child");
    assert.ok(issues.some((i) => i.level === "epic"), "an epic");
    assert.ok(issues.some((i) => i.closingRequest), "a Closing Request");
    assert.deepEqual(new Set(issues.flatMap((i) => (i.closed ? [typeof i.closed === "object" ? "duplicate" : i.closed] : []))), new Set(["completed", "not planned", "duplicate"]));
    // A closed blocker, and a Link reaching another Project.
    const projectOf = (f: Fixture, key: string) => f.projects.find((p) => p.issues.some((i) => i.key === key))!.path;
    assert.ok(all.some((f) => f.links.some(([a, kind]) => kind === "blocks" && f.projects.some((p) => p.issues.some((i) => i.key === a && i.closed)))));
    assert.ok(all.every((f) => f.links.some(([a, , b]) => projectOf(f, a) !== projectOf(f, b))), "an Outside Issue in every Fixture");
  });
});

/** A Tracker held in memory: its Issues, and the Links written to it, each as `[from, kind, to]` by reference. */
function memoryTracker() {
  const issues = new Map<string, Existing & { project: string; closedAs?: string }>();
  const links: [string, LinkKind, string][] = [];
  let writes = 0;
  const seeding = (namespaces: string[]): Seeding => ({
    async namespace(path, create) {
      if (create && !namespaces.includes(path)) {
        writes++;
        namespaces.push(path);
      }
      return namespaces.includes(path);
    },
    async project() {},
    async issues({ path }) {
      return [...issues.values()].filter((i) => i.project === path);
    },
    async create({ path, namespace }, issue) {
      writes++;
      const n = [...issues.values()].filter((i) => i.project === path).length + 1;
      const made = { id: `id-${path}-${n}`, ref: `${path}${namespace ? "&" : "#"}${n}`, title: title(issue), open: true, project: path };
      issues.set(made.ref, made);
      return made;
    },
    async close(issue, how, duplicateOf) {
      writes++;
      Object.assign(issues.get(issue.ref)!, { open: false, closedAs: duplicateOf ? `duplicate of ${duplicateOf.ref}` : how });
    },
    async closingRequest(path, issue) {
      const held = issues.get(issue.ref)! as { request?: boolean };
      if (held.request) return false;
      writes++;
      held.request = true;
      return true;
    },
  });
  const role = (kind: LinkKind, near: "from" | "to"): NamedLink["role"] =>
    kind === "related" ? "related" : near === "to" ? (kind === "blocks" ? "blocker" : "parent") : kind === "blocks" ? "blocked" : "child";
  const tracker = {
    async issue(ref: string): Promise<IssueAnswer> {
      const held = issues.get(ref);
      if (!held) return { kind: "not-found", reason: `no ${ref}` };
      const end = (other: string) => {
        const o = issues.get(other)!;
        return { id: o.id, readable: true as const, open: o.open, project: o.project, ref: o.ref, title: o.title, url: "" };
      };
      const named = links.flatMap(([a, kind, b]): NamedLink[] => [
        ...(b === ref ? [{ role: role(kind, "to"), name: kind, to: end(a) }] : []),
        ...(a === ref ? [{ role: role(kind, "from"), name: kind, to: end(b) }] : []),
      ]);
      return { kind: "issue", issue: { id: held.id, project: held.project, ref, title: held.title, url: "", open: held.open, assignees: [], closedAs: null, links: named, closingRequests: [], mentionedBy: [], unread: {} } };
    },
    async link(from: string, kind: LinkKind, to: string): Promise<LinkAnswer> {
      writes++;
      links.push([from, kind, to]);
      return { kind: "linked" };
    },
  };
  return { issues, links, seeding, tracker, writes: () => writes };
}

describe("seeding a Fixture", () => {
  for (const fixture of Object.values(FIXTURES)) {
    test(`${fixture.name}: the Tracker ends up holding what the Fixture declares, and a second run writes nothing`, async () => {
      const memory = memoryTracker();
      const seeding = memory.seeding([...fixture.namespaces]);
      const first = await seed(fixture, { seeding, tracker: memory.tracker, createNamespaces: false });
      const declared = fixture.projects.flatMap((p) => p.issues);
      assert.equal(memory.issues.size, declared.length);
      const refOf = (key: string) => [...memory.issues.values()].find((i) => i.title === title(declared.find((d) => d.key === key)!))!.ref;
      assert.deepEqual(memory.links, fixture.links.map(([a, kind, b]) => [refOf(a), kind, refOf(b)]));
      for (const issue of declared) {
        const held = [...memory.issues.values()].find((i) => i.title === title(issue))!;
        const closedAs = issue.closed === undefined ? undefined : typeof issue.closed === "object" ? `duplicate of ${refOf(issue.closed.duplicateOf)}` : issue.closed;
        assert.deepEqual([held.open, held.closedAs], [issue.closed === undefined, closedAs], issue.key);
      }
      assert.ok(first.length > 0);

      const before = memory.writes();
      assert.deepEqual(await seed(fixture, { seeding, tracker: memory.tracker, createNamespaces: false }), []);
      assert.equal(memory.writes(), before);
    });
  }

  test("a namespace that isn't there stops it before anything is written, unless it may make one", async () => {
    const fixture = FIXTURES["gitlab-free"];
    const memory = memoryTracker();
    await assert.rejects(seed(fixture, { seeding: memory.seeding([]), tracker: memory.tracker, createNamespaces: false }), /isn't there: make it by hand/);
    assert.equal(memory.writes(), 0);
    await seed(fixture, { seeding: memory.seeding([]), tracker: memory.tracker, createNamespaces: true });
    assert.ok(memory.issues.size > 0);
  });

  test("a Link the Tracker won't write stops it, saying which", async () => {
    const memory = memoryTracker();
    const tracker = { ...memory.tracker, link: async (): Promise<LinkAnswer> => ({ kind: "cant-record", reason: "this Project's GitLab tier can't record Blocks Links" }) };
    await assert.rejects(seed(FIXTURES["gitlab-oss"], { seeding: memory.seeding([NAMESPACES.gitlab.oss]), tracker, createNamespaces: false }), /couldn't write .*blocks.*tier can't record/);
  });
});

/** A CLI that answers each call from `routes`, the first whose pattern matches `METHOD endpoint`, and records every call. */
function scripted(routes: [RegExp, (args: string[]) => unknown][]) {
  const calls: string[] = [];
  const cli: Cli = async (_command, args): Promise<CliResult> => {
    const endpoint = args[3]!;
    const method = args.includes("--method") ? args[args.indexOf("--method") + 1]! : "GET";
    const call = `${method} ${endpoint} ${args.slice(4).filter((a) => a !== "--method" && a !== method).join(" ")}`.trim();
    calls.push(call);
    const route = routes.find(([pattern]) => pattern.test(`${method} ${endpoint}`));
    if (!route) return { kind: "exited", code: 1, stdout: "", stderr: "gh: Not Found (HTTP 404)" };
    return { kind: "exited", code: 0, stdout: JSON.stringify(route[1](args)), stderr: "" };
  };
  return { cli, calls };
}

describe("seeding GitHub through gh", () => {
  test("a duplicate closes against the database id of the Issue it duplicates", async () => {
    const { cli, calls } = scripted([
      [/^GET repos\/o\/map\/issues\?/, () => [
        { id: 101, node_id: "I_1", number: 1, title: "[d1] Crash on empty input", state: "open" },
        { id: 103, node_id: "I_3", number: 3, title: "[c3] Crash when the input is empty", state: "open" },
        { id: 104, node_id: "PR_4", number: 4, title: "a pull request", state: "open", pull_request: {} },
      ]],
      [/^PATCH /, () => ({})],
    ]);
    const seeding = githubSeeding(cli, "github.com");
    const [d1, c3] = await seeding.issues({ path: "o/map", issues: [] });
    assert.deepEqual([d1?.id, c3?.ref], ["I_1", "o/map#3"]);
    await seeding.close(c3!, "duplicate", d1);
    assert.equal(calls.at(-1), "PATCH repos/o/map/issues/3 -f state=closed -f state_reason=duplicate -F duplicate_issue_id=101");
  });

  test("a Closing Request is opened from a branch of its own, with a change on it, once", async () => {
    let open: unknown[] = [];
    const { cli, calls } = scripted([
      [/^GET repos\/o\/map\/pulls/, () => open],
      [/^GET repos\/o\/map$/, () => ({ default_branch: "main" })],
      [/^GET repos\/o\/map\/git\/ref\/heads\/main$/, () => ({ object: { sha: "abc" } })],
      [/^POST repos\/o\/map\/pulls$/, () => ((open = [{ number: 9 }]), {})],
      [/^(POST|PUT) /, () => ({})],
    ]);
    const seeding = githubSeeding(cli, "github.com");
    const issue = { id: "I_5", ref: "o/map#5", title: "[r1] Fix the typo in the README", open: true };
    assert.equal(await seeding.closingRequest("o/map", issue, "r1"), true);
    const writes = calls.filter((c) => !c.startsWith("GET"));
    assert.deepEqual(writes.map((c) => c.split(" -")[0]), ["POST repos/o/map/git/refs", "PUT repos/o/map/contents/fixtures/r1.md", "POST repos/o/map/pulls"]);
    assert.match(writes[0]!, /ref=refs\/heads\/fixture\/r1 -f sha=abc/);
    assert.match(writes[2]!, /head=fixture\/r1 -f base=main -f body=Closes #5$/);
    assert.equal(await seeding.closingRequest("o/map", issue, "r1"), false);
    assert.equal(calls.filter((c) => !c.startsWith("GET")).length, 3);
  });

  test("an organisation is never made by the seeder, even when asked", async () => {
    const { cli, calls } = scripted([]);
    assert.equal(await githubSeeding(cli, "github.com").namespace("issue-map-fixtures", true), false);
    assert.deepEqual(calls, ["GET orgs/issue-map-fixtures"]);
  });
});

describe("seeding GitLab through glab", () => {
  const graphqlAnswer = (data: object) => () => ({ data });

  test("a task is made as a task, and an epic as the group's own work item", async () => {
    const { cli, calls } = scripted([
      [/^POST projects\/g%2Fmap\/issues$/, () => ({ id: 77, iid: 4, title: "[t1a] Add the lint job", state: "opened" })],
      [/^GET graphql$/, (args) =>
        args.some((a) => a.includes("workItemTypes"))
          ? { data: { group: { workItemTypes: { nodes: [{ id: "gid://gitlab/WorkItems::Type/8" }] } } } }
          : { data: { workItemCreate: { workItem: { id: "gid://gitlab/WorkItem/9", iid: "2", title: "[e1] Ship version two", state: "OPEN", reference: "g&2" }, errors: [] } } }],
    ]);
    const seeding = gitlabSeeding(cli, "gitlab.com");
    const task = await seeding.create({ path: "g/map", issues: [] }, { key: "t1a", title: "Add the lint job", level: "task" });
    assert.deepEqual(task, { id: "gid://gitlab/WorkItem/77", ref: "g/map#4", title: "[t1a] Add the lint job", open: true });
    assert.match(calls[0]!, /-f title=\[t1a\] Add the lint job -f issue_type=task$/);
    const epic = await seeding.create({ path: "g", namespace: true, issues: [] }, { key: "e1", title: "Ship version two", level: "epic" });
    assert.equal(epic.ref, "g&2");
    assert.match(calls.at(-1)!, /workItemCreate\(input: \{namespacePath: \$path.*-f path=g -f title=\[e1\] Ship version two -f type=gid:\/\/gitlab\/WorkItems::Type\/8$/s);
  });

  test("a duplicate closes through GitLab's /duplicate, the one close it says how of", async () => {
    const { cli, calls } = scripted([[/^POST /, () => ({})], [/^PUT /, () => ({})]]);
    const seeding = gitlabSeeding(cli, "gitlab.example.com");
    const d1 = { id: "gid://gitlab/WorkItem/2", ref: "g/map#2", title: "[d1] Footer link goes nowhere", open: true };
    const m1 = { id: "gid://gitlab/WorkItem/1", ref: "g/map#1", title: "[m1] Fix the broken link in the footer", open: true };
    await seeding.close(d1, "duplicate", m1);
    await seeding.close(m1, "completed");
    assert.deepEqual(calls, ["POST projects/g%2Fmap/issues/2/notes -f body=/duplicate g/map#1", "PUT projects/g%2Fmap/issues/1 -f state_event=close"]);
  });

  test("a group is made only when it may be, as on the version matrix's own GitLab", async () => {
    const { cli, calls } = scripted([[/^POST groups$/, () => ({ id: 1 })]]);
    const seeding = gitlabSeeding(cli, "gitlab.test");
    assert.equal(await seeding.namespace("issue-map-fixtures", false), false);
    assert.equal(await seeding.namespace("issue-map-fixtures", true), true);
    assert.deepEqual(calls.filter((c) => c.startsWith("POST")), ["POST groups -f name=issue-map-fixtures -f path=issue-map-fixtures -f visibility=public"]);
  });

  test("Issues already there are read from the work-item GraphQL, closed ones included", async () => {
    const nodes = [{ id: "gid://gitlab/WorkItem/1", iid: "1", title: "[r1] Draft the style guide", state: "CLOSED", reference: "g/map#1" }];
    const { cli } = scripted([[/^GET graphql$/, graphqlAnswer({ project: { workItems: { pageInfo: { hasNextPage: false }, nodes } } })]]);
    assert.deepEqual(await gitlabSeeding(cli, "gitlab.com").issues({ path: "g/map", issues: [] }), [{ id: "gid://gitlab/WorkItem/1", ref: "g/map#1", title: "[r1] Draft the style guide", open: false }]);
  });
});
