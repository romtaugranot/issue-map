/**
 * The contract suite against the GitHub adapter, with `gh` and the network
 * stood in for by replies in the shapes github.com and GHES give.
 */
import { github } from "../src/tracker/github.ts";
import type { CliResult, HttpResult } from "../src/tracker/boundary.ts";
import { trackerContract, type IssueSpec, type ProjectSpec, type World } from "./contract/tracker-contract.ts";

trackerContract({
  product: "GitHub",
  wellKnownHost: "github.com",
  arrange(world) {
    let requests = 0;
    const loginsSentTo: string[] = [];
    const kind = github({
      env: {},
      cli: async (command, args) => {
        if (command !== "gh" || (world.cli ?? "installed") === "missing") return { kind: "missing" };
        if (args[0] === "auth") {
          const hosts = [...(world.login === "none" ? [] : ["github.com"]), ...(world.loggedInTo ?? [])];
          return exited(0, JSON.stringify({ hosts: Object.fromEntries(hosts.map((h) => [h, []])) }));
        }
        requests++;
        loginsSentTo.push(args[args.indexOf("--hostname") + 1]!);
        return ghApi(world, args);
      },
      http: async (url) => {
        requests++;
        return probe(world, new URL(url));
      },
    });
    return { kind, requests: () => requests, loginsSentTo: () => loginsSentTo.filter((h) => h !== "github.com") };
  },
});

function ghApi(world: World, args: string[]): CliResult {
  const host = args[args.indexOf("--hostname") + 1]!;
  if ((world.network ?? "up") === "down")
    return exited(1, "", `error connecting to ${host}\ncheck your internet connection or https://githubstatus.com\n`);
  if (world.login === "none")
    return exited(4, "", "To get started with GitHub CLI, please run:  gh auth login\n");
  if (world.login === "refused")
    return exited(1, JSON.stringify({ message: "Bad credentials", documentation_url: "https://docs.github.com/rest", status: "401" }), "gh: Bad credentials (HTTP 401)\n");
  if (world.rateLimited) {
    const message = "API rate limit exceeded for user ID 1. If you reach out to GitHub Support for help, please include the request ID.";
    return exited(1, JSON.stringify({ message, documentation_url: "https://docs.github.com/rest/overview/rate-limits-for-the-rest-api", status: "403" }), `gh: ${message} (HTTP 403)\n`);
  }
  const field = (name: string) => args.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);
  const list = (name: string) => args.filter((a) => a.startsWith(`${name}[]=`)).map((a) => a.slice(name.length + 3));
  const rest = args.find((a) => a.startsWith("repos/"));
  if (rest) return restApi(world, rest);
  const query = field("query") ?? "";
  if (/^\s*(query\s*)?\{\s*viewer\b/.test(query)) return exited(0, JSON.stringify({ data: { viewer: { login: world.viewer ?? "fixture-viewer" } } }));
  if (query.includes("changed: nodes(ids:")) return nodesById(world, host, list("changed"), list("outside"));
  const path = `${field("owner")}/${field("name")}`;
  const spec = (world.projects ?? []).find((p) => [p.path, ...(p.oldPaths ?? [])].some((known) => known.toLowerCase() === path.toLowerCase()));
  if (!spec) {
    const message = `Could not resolve to a Repository with the name '${path}'.`;
    return exited(1, JSON.stringify({ data: { repository: null }, errors: [{ type: "NOT_FOUND", path: ["repository"], message }] }), `gh: ${message}\n`);
  }
  if (query.includes("issues(states: OPEN, first:")) return issuesPage(world, spec, host, field("after"));
  if (query.includes("filterBy: {since:")) {
    const since = field("since")!;
    const changes = changedSince(world, spec, host, since, field("withIssues") === "true" ? (field("issuesAfter") ?? "0") : null, field("withPulls") === "true" ? (field("pullsAfter") ?? "0") : null);
    return withOutside(world, host, changes, list("outside"));
  }
  if (query.includes("issue(number:")) return oneIssue(world, spec, host, Number(field("number")));
  return exited(0, JSON.stringify({ data: { repository: { ...repository(spec, host), parent: spec.parent ? repository(spec.parent, host) : null } } }));
}

/**
 * One page of open Issues in the shape github.com gives: a sub-issue parent,
 * then task-list parents, and a `null` where the login can't see. A token
 * without pull request access gets `null` for each Issue's closing pull
 * requests, with an error at each.
 */
function issuesPage(world: World, spec: ProjectSpec, host: string, after: string | undefined): CliResult {
  const PAGE = 100;
  const open = (spec.issues ?? []).filter((i) => !i.closed);
  const start = after ? Number(after) : 0;
  const errors: GraphqlError[] = [];
  const nodes = open.slice(start, start + PAGE).map((issue, index) => issueNode(world, spec, host, issue, ["repository", "issues", "nodes", index], errors));
  const next = start + PAGE < open.length ? String(start + PAGE) : null;
  return answer({ repository: { issues: { totalCount: open.length, pageInfo: { hasNextPage: next !== null, endCursor: next ?? "end" }, nodes } } }, errors);
}

/** One Issue, open or closed, with what the card reads besides: its state, and the Issues and pull requests that name it. */
function oneIssue(world: World, spec: ProjectSpec, host: string, number: number): CliResult {
  const issue = spec.issues?.find((i) => i.number === number);
  if (!issue || issue.hidden) {
    const message = `Could not resolve to an issue or pull request with the number of ${number}.`;
    return answer({ repository: { issue: null } }, [{ type: "NOT_FOUND", path: ["repository", "issue"], message }]);
  }
  const errors: GraphqlError[] = [];
  const self = `${spec.path}#${number}`;
  const at = ["repository", "issue"];
  const mentions = (world.mentions ?? []).filter(([, b]) => b === self).map(([a]) => {
    const [path, n] = a.split("#") as [string, string];
    return { source: { __typename: "Issue", id: nodeId(path, Number(n)) } };
  });
  // A pull request that closes an Issue names it too, and is no Mention.
  const pulls = (world.closingRequests ?? []).filter((r) => r.closes === self).map((r) => ({ source: { __typename: "PullRequest", id: `PR_${r.number}` } }));
  const node = {
    ...issueNode(world, spec, host, issue, at, errors),
    state: issue.closed ? "CLOSED" : "OPEN",
    stateReason: stateReason(issue),
    repository: { nameWithOwner: spec.path },
    timelineItems: { nodes: [...mentions, ...pulls] },
  };
  return answer({ repository: { issue: node } }, errors);
}

/**
 * What changed since `since`: the Issues updated since, oldest update first,
 * and pull requests, most recently updated first, each with the Issues it
 * closes. A stream is left out when its cursor is `null`.
 */
function changedSince(world: World, spec: ProjectSpec, host: string, since: string, issuesAfter: string | null, pullsAfter: string | null): CliResult {
  const PAGE = 100;
  const errors: GraphqlError[] = [];
  const repository: Record<string, unknown> = {};
  if (issuesAfter !== null) {
    const updated = (spec.issues ?? [])
      .filter((i) => !i.hidden && Date.parse(updatedAt(i)) >= Date.parse(since))
      .sort((a, b) => Date.parse(updatedAt(a)) - Date.parse(updatedAt(b)));
    const start = Number(issuesAfter);
    const nodes = updated.slice(start, start + PAGE).map((issue, index) => changedNode(world, spec, host, issue, ["repository", "issues", "nodes", index], errors));
    const next = start + PAGE < updated.length ? String(start + PAGE) : null;
    repository.issues = { pageInfo: { hasNextPage: next !== null, endCursor: next ?? "end" }, nodes };
  }
  if (pullsAfter !== null) {
    if (world.readsClosingRequests === false) {
      errors.push({ type: "FORBIDDEN", path: ["repository", "pullRequests"], message: "Resource not accessible by personal access token" });
      repository.pullRequests = null;
    } else {
      const pulls = (world.closingRequests ?? [])
        .filter((r) => r.closes.startsWith(`${spec.path}#`))
        .map((r) => ({ ...r, updatedAt: r.updatedAt ?? LONG_AGO }))
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
      const start = Number(pullsAfter);
      const nodes = pulls.slice(start, start + PAGE).map((r) => {
        const [path, n] = r.closes.split("#") as [string, string];
        return { number: r.number, updatedAt: r.updatedAt, repository: { nameWithOwner: spec.path }, closingIssuesReferences: { nodes: [{ id: nodeId(path, Number(n)) }] } };
      });
      const next = start + PAGE < pulls.length ? String(start + PAGE) : null;
      repository.pullRequests = { pageInfo: { hasNextPage: next !== null, endCursor: next ?? "end" }, nodes };
    }
  }
  return answer({ repository }, errors);
}

/** An answer with the Outside Issues asked for alongside it, as far ends. */
function withOutside(world: World, host: string, changes: CliResult, outside: string[]): CliResult {
  if (changes.kind !== "exited") return changes;
  const body = JSON.parse(changes.stdout) as { data: object; errors?: GraphqlError[] };
  const nodes = JSON.parse((nodesById(world, host, [], outside) as Extract<CliResult, { kind: "exited" }>).stdout) as { data: { outside: unknown[] }; errors?: GraphqlError[] };
  return answer({ ...body.data, outside: nodes.data.outside }, [...(body.errors ?? []), ...(nodes.errors ?? [])]);
}

/** Issues by identity: the changed ones read whole, the outside ones as far ends; `null`, with an error, for one this login can't read. */
function nodesById(world: World, host: string, changed: string[], outside: string[]): CliResult {
  const errors: GraphqlError[] = [];
  const byId = (id: string) => {
    for (const spec of world.projects ?? []) for (const issue of spec.issues ?? []) if (nodeId(spec.path, issue.number) === id) return { spec, issue };
    return null;
  };
  const read = (field: string, ids: string[], node: (spec: ProjectSpec, issue: IssueSpec, at: (string | number)[]) => object) =>
    ids.map((id, index) => {
      const found = byId(id);
      if (!found || found.issue.hidden) {
        errors.push({ type: found ? "FORBIDDEN" : "NOT_FOUND", path: [field, index], message: `Could not resolve to a node with the global id of '${id}'` });
        return null;
      }
      return node(found.spec, found.issue, [field, index]);
    });
  return answer(
    {
      changed: read("changed", changed, (spec, issue, at) => changedNode(world, spec, host, issue, at, errors)),
      outside: read("outside", outside, (spec, issue) => endNode(spec.path, issue, host)),
    },
    errors,
  );
}

/**
 * The repository's issue-events feed, newest first, 100 a page: GitHub
 * notes a Link made or removed here and on neither Issue's `updatedAt`.
 * It begins with an event from long ago, unless the World keeps no record
 * that far back.
 */
function restApi(world: World, rest: string): CliResult {
  const url = new URL(rest, "https://api.invalid/");
  const [, , owner, name] = url.pathname.split("/");
  const spec = (world.projects ?? []).find((p) => p.path === `${owner}/${name}`);
  if (!spec || !url.pathname.endsWith("/issues/events")) return exited(1, JSON.stringify({ message: "Not Found", status: "404" }), "gh: Not Found (HTTP 404)\n");
  const event = (event: string, addr: string, at: string) => {
    const [path, n] = addr.split("#") as [string, string];
    return { id: 0, event, created_at: at, issue: { number: Number(n), node_id: nodeId(path, Number(n)) } };
  };
  const linkEvents = (a: string, kind: "blocks" | "parent", b: string, at: string, done: "added" | "removed") =>
    kind === "blocks" ? [event(`blocked_by_${done}`, b, at), event(`blocking_${done}`, a, at)] : [event(`sub_issue_${done}`, a, at), event(`parent_issue_${done}`, b, at)];
  const first = spec.issues?.[0];
  const events = [
    ...(first ? [event("labeled", `${spec.path}#${first.number}`, LONG_AGO)] : []),
    ...(world.links ?? []).flatMap(([a, kind, b, at]) => (at && a.startsWith(`${spec.path}#`) ? linkEvents(a, kind, b, at, "added") : [])),
    ...(world.removedLinks ?? []).flatMap(([a, kind, b, at]) => (a.startsWith(`${spec.path}#`) ? linkEvents(a, kind, b, at, "removed") : [])),
  ]
    .filter((e) => !world.changesKeptFrom || Date.parse(e.created_at) >= Date.parse(world.changesKeptFrom))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const page = Number(url.searchParams.get("page") ?? 1);
  const size = Number(url.searchParams.get("per_page") ?? 30);
  return exited(0, JSON.stringify(events.slice((page - 1) * size, page * size)));
}

/** An Issue read whole, open or closed, as a refresh reads it again. */
function changedNode(world: World, spec: ProjectSpec, host: string, issue: IssueSpec, at: (string | number)[], errors: GraphqlError[]) {
  return { ...issueNode(world, spec, host, issue, at, errors), state: issue.closed ? "CLOSED" : "OPEN", closedAt: closedAt(issue), stateReason: stateReason(issue), repository: { nameWithOwner: spec.path } };
}

function endNode(path: string, issue: IssueSpec, host: string) {
  return { id: nodeId(path, issue.number), number: issue.number, title: title(issue), url: `https://${host}/${path}/issues/${issue.number}`, state: issue.closed ? "CLOSED" : "OPEN", closedAt: closedAt(issue), stateReason: stateReason(issue), repository: { nameWithOwner: path } };
}

const LONG_AGO = "2025-01-01T00:00:00Z";

function updatedAt(issue: IssueSpec): string {
  return issue.updatedAt ?? closedAt(issue) ?? createdAt(issue);
}

function createdAt(issue: IssueSpec): string {
  return issue.createdAt ?? new Date(Date.UTC(2026, 0, issue.number)).toISOString();
}

type GraphqlError = { type: string; path: (string | number)[]; message: string };

function stateReason(issue: IssueSpec): string | null {
  return issue.closed ? { completed: "COMPLETED", "not planned": "NOT_PLANNED", duplicate: "DUPLICATE" }[issue.closedAs ?? "completed"] : null;
}

/** When a closed Issue closed: as it says, or the day after it was created. */
function closedAt(issue: IssueSpec): string | null {
  if (!issue.closed) return null;
  return issue.closedAt ?? new Date(Date.UTC(2026, 0, issue.number + 1)).toISOString();
}

/** One Issue node as github.com gives it, with an error for each field this login can't see at `at`. */
function issueNode(world: World, spec: ProjectSpec, host: string, issue: IssueSpec, at: (string | number)[], errors: GraphqlError[]) {
  const subIssueParent = (child: string) => (world.links ?? []).find(([, kind, b]) => kind === "parent" && b === child)?.[0];
  const find = (addr: string): { path: string; issue: IssueSpec } => {
    const [path, n] = addr.split("#") as [string, string];
    const issue = world.projects?.find((p) => p.path === path)?.issues?.find((i) => i.number === Number(n));
    if (!issue) throw new Error(`the World has no ${addr}`);
    return { path, issue };
  };
  const end = (addr: string, path: (string | number)[]) => {
    const { path: project, issue } = find(addr);
    if (issue.hidden) {
      errors.push({ type: "FORBIDDEN", path, message: "Resource not accessible by integration" });
      return null;
    }
    return endNode(project, issue, host);
  };
  // Asked for with `includeClosedPrs: false`, which leaves out closed pull requests but not merged ones.
  const closingPulls = (self: string, path: (string | number)[]) => {
    if (world.readsClosingRequests === false) {
      errors.push({ type: "FORBIDDEN", path, message: "Resource not accessible by personal access token" });
      return null;
    }
    const pulls = (world.closingRequests ?? []).filter((r) => r.closes === self && r.state !== "closed");
    return {
      nodes: pulls.map((r) => ({
        number: r.number,
        url: `https://${host}/${spec.path}/pull/${r.number}`,
        isDraft: r.draft ?? false,
        state: (r.state ?? "open").toUpperCase(),
        author: { login: r.author },
        repository: { nameWithOwner: spec.path },
      })),
    };
  };
  const self = `${spec.path}#${issue.number}`;
  const links = world.links ?? [];
  const parents = links.filter(([, kind, b]) => kind === "parent" && b === self).map(([a]) => a);
  const list = (name: string, addrs: string[]) => ({ nodes: addrs.map((a, j) => end(a, [...at, name, "nodes", j])) });
  const children = links.filter(([a, kind]) => kind === "parent" && a === self).map(([, , b]) => b);
  // A sub-issue has one parent; any further Parent is recorded by a task list.
  const [parent, ...trackedIn] = parents;
  return {
    id: nodeId(spec.path, issue.number),
    number: issue.number,
    title: title(issue),
    url: `https://${host}/${spec.path}/issues/${issue.number}`,
    createdAt: createdAt(issue),
    assignees: { nodes: (issue.assignees ?? []).map((login) => ({ login })) },
    milestone: issue.planned ? { title: "next", dueOn: issue.planned } : null,
    parent: parent ? end(parent, [...at, "parent"]) : null,
    trackedInIssues: list("trackedInIssues", trackedIn),
    subIssues: list("subIssues", children.filter((c) => subIssueParent(c) === self)),
    trackedIssues: list("trackedIssues", children.filter((c) => subIssueParent(c) !== self)),
    blockedBy: list("blockedBy", links.filter(([, kind, b]) => kind === "blocks" && b === self).map(([a]) => a)),
    blocking: list("blocking", links.filter(([a, kind]) => kind === "blocks" && a === self).map(([, , b]) => b)),
    closedByPullRequestsReferences: closingPulls(self, [...at, "closedByPullRequestsReferences"]),
  };
}

/** `gh api graphql`'s answer: it exits 1 when the body holds any error, and prints the first. */
function answer(data: object, errors: GraphqlError[]): CliResult {
  const body = { data, ...(errors.length > 0 ? { errors } : {}) };
  return exited(errors.length > 0 ? 1 : 0, JSON.stringify(body), errors.length > 0 ? `gh: ${errors[0]!.message}\n` : "");
}

function nodeId(path: string, number: number): string {
  return `I_${Buffer.from(`${path}#${number}`).toString("base64url")}`;
}

function title(issue: IssueSpec): string {
  return issue.title ?? `Issue ${issue.number}`;
}

function repository(spec: ProjectSpec, host: string) {
  return {
    databaseId: 679421000 + spec.number,
    nameWithOwner: spec.path,
    url: `https://${host}/${spec.path}`,
    hasIssuesEnabled: spec.open !== "off",
    issues: { totalCount: spec.open === "off" ? 0 : spec.open },
  };
}

function probe(world: World, url: URL): HttpResult {
  const server = world.servers?.[url.hostname];
  if (!server) return { kind: "unreachable", reason: "ENOTFOUND" };
  if (server.runs === "something-else") return { kind: "response", status: 404, headers: { "content-type": "text/html" }, body: "<h1>Not Found</h1>" };
  if (url.pathname !== "/api/v3/meta") return { kind: "response", status: 404, headers: {}, body: "" };
  return {
    kind: "response",
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-github-request-id": "0000:0000:0000000:0000000:00000000",
      "x-github-enterprise-version": `enterprise-server@${server.version}`,
    },
    body: JSON.stringify({ verifiable_password_authentication: false, installed_version: server.version }),
  };
}

function exited(code: number, stdout: string, stderr = ""): CliResult {
  return { kind: "exited", code, stdout, stderr };
}
