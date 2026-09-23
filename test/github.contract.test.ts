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
  const field = (name: string) => args.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);
  const query = field("query") ?? "";
  if (/^\s*(query\s*)?\{\s*viewer\b/.test(query)) return exited(0, JSON.stringify({ data: { viewer: { login: world.viewer ?? "fixture-viewer" } } }));
  const path = `${field("owner")}/${field("name")}`;
  const spec = (world.projects ?? []).find((p) => [p.path, ...(p.oldPaths ?? [])].some((known) => known.toLowerCase() === path.toLowerCase()));
  if (!spec) {
    const message = `Could not resolve to a Repository with the name '${path}'.`;
    return exited(1, JSON.stringify({ data: { repository: null }, errors: [{ type: "NOT_FOUND", path: ["repository"], message }] }), `gh: ${message}\n`);
  }
  if (query.includes("issues(states: OPEN, first:")) return issuesPage(world, spec, host, field("after"));
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
  const stateReason = issue.closed ? { completed: "COMPLETED", "not planned": "NOT_PLANNED", duplicate: "DUPLICATE" }[issue.closedAs ?? "completed"] : null;
  const node = {
    ...issueNode(world, spec, host, issue, at, errors),
    state: issue.closed ? "CLOSED" : "OPEN",
    stateReason,
    repository: { nameWithOwner: spec.path },
    timelineItems: { nodes: [...mentions, ...pulls] },
  };
  return answer({ repository: { issue: node } }, errors);
}

type GraphqlError = { type: string; path: (string | number)[]; message: string };

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
    return { id: nodeId(project, issue.number), number: issue.number, title: title(issue), url: `https://${host}/${project}/issues/${issue.number}`, state: issue.closed ? "CLOSED" : "OPEN", repository: { nameWithOwner: project } };
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
    createdAt: issue.createdAt ?? new Date(Date.UTC(2026, 0, issue.number)).toISOString(),
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
