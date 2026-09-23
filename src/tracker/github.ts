/** The GitHub adapter: reads through `gh`'s login and its raw-API call (ADR 0001). */
import { parseJson as parse, type AdapterDeps, type Cli } from "./boundary.ts";
import type { CliResult } from "./boundary.ts";
import type { CantAnswer, ClosingRequest, FarEnd, Identification, IssueAnswer, IssuePage, NamedLink, OpenIssue, Project, ProjectResolution, Tracker, TrackerKind, Unread, ViewerAnswer } from "./tracker.ts";

const PRODUCT = "GitHub";

const PROJECT_QUERY = `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    ...project
    parent { ...project }
  }
}
fragment project on Repository {
  databaseId nameWithOwner url hasIssuesEnabled
  issues(states: OPEN) { totalCount }
}`;

const VIEWER_QUERY = `query { viewer { login } }`;

/** What the Map reads of every Issue, with its Links and open Closing Requests. */
const ISSUE_FIELDS = `fragment issue on Issue {
  id number title url createdAt
  assignees(first: 10) { nodes { login } }
  milestone { dueOn }
  parent { ...end }
  trackedInIssues(first: 100) { nodes { ...end } }
  subIssues(first: 100) { nodes { ...end } }
  trackedIssues(first: 100) { nodes { ...end } }
  blockedBy(first: 100) { nodes { ...end } }
  blocking(first: 100) { nodes { ...end } }
  closedByPullRequestsReferences(first: 10, includeClosedPrs: false) {
    nodes { number url isDraft state author { login } repository { nameWithOwner } }
  }
}
fragment end on Issue { id number title url state repository { nameWithOwner } }`;

/**
 * Needs 3, 4 and 7 in one request a page. GitHub allows 100 sub-issues a
 * parent, 50 blockers each way and 10 assignees, so only task-list Links
 * past the 100th are left unread. Closing Requests past the 10th are too.
 */
const ISSUES_QUERY = `query($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    issues(states: OPEN, first: 100, after: $after, orderBy: {field: CREATED_AT, direction: ASC}) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes { ...issue }
    }
  }
}
${ISSUE_FIELDS}`;

/**
 * One Issue for its card, open or closed, with the Issues that name it. The
 * Tracker notes a Mention on the Issue named, not the one naming it; only
 * the first 100 are read, pull requests that name it among them.
 */
const ISSUE_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      ...issue
      state stateReason
      repository { nameWithOwner }
      timelineItems(itemTypes: [CROSS_REFERENCED_EVENT], first: 100) {
        nodes { ... on CrossReferencedEvent { source { __typename ... on Issue { id } } } }
      }
    }
  }
}
${ISSUE_FIELDS}`;

interface IssueNode {
  id: string;
  number: number;
  title: string;
  url: string;
  createdAt: string;
  assignees: { nodes: { login: string }[] };
  milestone: { dueOn: string | null } | null;
  parent: EndNode | null;
  trackedInIssues: { nodes: (EndNode | null)[] };
  subIssues: { nodes: (EndNode | null)[] };
  trackedIssues: { nodes: (EndNode | null)[] };
  blockedBy: { nodes: (EndNode | null)[] };
  blocking: { nodes: (EndNode | null)[] };
  /** `null` for a login that can't read pull requests. */
  closedByPullRequestsReferences: { nodes: (PullNode | null)[] } | null;
}

interface OneIssueNode extends IssueNode {
  state: "OPEN" | "CLOSED";
  stateReason: "COMPLETED" | "NOT_PLANNED" | "DUPLICATE" | "REOPENED" | null;
  repository: { nameWithOwner: string };
  timelineItems: { nodes: ({ source?: { __typename: string; id?: string } | null } | null)[] };
}

interface PullNode {
  number: number;
  url: string;
  isDraft: boolean;
  state: "OPEN" | "CLOSED" | "MERGED";
  /** `null` once the account that opened it is deleted; GitHub then shows it as opened by `ghost`, and so does the Map. */
  author: { login: string } | null;
  repository: { nameWithOwner: string };
}

interface EndNode {
  id: string;
  number: number;
  title: string;
  url: string;
  state: "OPEN" | "CLOSED";
  repository: { nameWithOwner: string };
}

interface Repository {
  databaseId: number;
  nameWithOwner: string;
  url: string;
  hasIssuesEnabled: boolean;
  issues: { totalCount: number };
  parent?: Repository | null;
}

export function github(deps: AdapterDeps): TrackerKind {
  const { cli, http, env } = deps;
  let loggedInHosts: Promise<string[]> | undefined;

  /**
   * `gh` sends GH_ENTERPRISE_TOKEN to whatever host it is pointed at, so a
   * host found only by probing is never read: it could be any server that
   * answers like GitHub.
   */
  const trackerAt = (host: string, version: string | null, loginIsFor: boolean): Tracker => ({
    product: PRODUCT,
    host,
    version,
    resolveProject: async (path) => (loginIsFor ? resolveProject(cli, host, path) : noLogin(host)),
    viewer: async () => (loginIsFor ? viewer(cli, host) : noLogin(host)),
    openIssues: async (project, after) => (loginIsFor ? openIssues(cli, host, project, after) : noLogin(host)),
    issue: async (locator) => (loginIsFor ? issue(cli, host, locator) : noLogin(host)),
  });

  return {
    product: PRODUCT,

    async recognise(host) {
      // github.com, and GHEC with data residency at *.ghe.com: neither is versioned.
      return host === "github.com" || host.endsWith(".ghe.com") ? trackerAt(host, null, true) : null;
    },

    async probe(host): Promise<Identification> {
      loggedInHosts ??= hostsGhKnows(cli);
      const known = env.GH_HOST === host || (await loggedInHosts).includes(host);
      const answer = await http(`https://${host}/api/v3/meta`);
      if (answer.kind === "unreachable") {
        return known
          ? { kind: "identified", tracker: trackerAt(host, null, true) }
          : { kind: "cant-tell", reason: `couldn't reach ${host} (${answer.reason})` };
      }
      // A GHES in private mode refuses the meta call but still marks its answer as GitHub's.
      const version =
        jsonField(answer.body, "installed_version") ??
        answer.headers["x-github-enterprise-version"]?.replace(/^enterprise-server@/, "") ??
        null;
      if (version || answer.headers["x-github-request-id"] || known) {
        return { kind: "identified", tracker: trackerAt(host, version, known) };
      }
      return { kind: "not-this-kind" };
    },
  };
}

async function hostsGhKnows(cli: Cli): Promise<string[]> {
  const answer = await cli("gh", ["auth", "status", "--json", "hosts"]);
  if (answer.kind !== "exited") return [];
  try {
    return Object.keys((JSON.parse(answer.stdout) as { hosts?: object }).hosts ?? {});
  } catch {
    return [];
  }
}

async function resolveProject(cli: Cli, host: string, path: string): Promise<ProjectResolution> {
  const [owner, name, ...rest] = path.split("/");
  if (!owner || !name || rest.length > 0) {
    return { kind: "not-found", reason: `${host}/${path} isn't a GitHub repository path` };
  }
  const answer = await graphql(cli, host, PROJECT_QUERY, { owner, name });
  if (answer.kind === "missing") return ghMissing(host);
  const body = parse(answer.stdout);
  const repository = (body?.data as { repository?: Repository | null } | undefined)?.repository;
  if (answer.code === 0 && repository) {
    return { kind: "project", project: project(host, repository), parent: repository.parent ? project(host, repository.parent) : null };
  }
  return failure(answer, body, host, path);
}

async function viewer(cli: Cli, host: string): Promise<ViewerAnswer> {
  const answer = await graphql(cli, host, VIEWER_QUERY, {});
  if (answer.kind === "missing") return ghMissing(host);
  const body = parse(answer.stdout);
  const login = (body?.data as { viewer?: { login?: string } } | undefined)?.viewer?.login;
  if (answer.code === 0 && login) return { kind: "viewer", login };
  const failed = failure(answer, body, host, "the viewer");
  return failed.kind === "not-found" ? { kind: "cant-tell", reason: failed.reason } : failed;
}

async function openIssues(cli: Cli, host: string, { path }: Project, after: string | null): Promise<IssuePage> {
  const [owner = "", name = ""] = path.split("/");
  const answer = await graphql(cli, host, ISSUES_QUERY, after === null ? { owner, name } : { owner, name, after });
  if (answer.kind === "missing") return ghMissing(host);
  const body = parse(answer.stdout);
  const issues = (body?.data as { repository?: { issues?: { totalCount: number; pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: IssueNode[] } } | null } | undefined)?.repository?.issues;
  // An Issue this login can't see comes back as a `null` with an error at its path; the rest of the page still stands.
  const errors = (body?.errors ?? []) as { type?: string; path?: (string | number)[] }[];
  const onlyHidden = errors.every((e) => e.type === "FORBIDDEN" && e.path?.[2] === "nodes");
  if (issues && (answer.code === 0 || onlyHidden)) {
    const hiddenParents = new Set(errors.filter((e) => e.path?.[4] === "parent").map((e) => e.path?.[3]));
    const unread: Unread = {};
    // A token without pull request access, such as a fine-grained one scoped to Issues, is refused this field on every Issue.
    if (errors.some((e) => e.path?.[4] === "closedByPullRequestsReferences" && e.path.length === 5)) {
      unread.closingRequests = "this login can't read pull requests";
    }
    return {
      kind: "page",
      issues: issues.nodes.map((node, index) => openIssue(node, hiddenParents.has(index))),
      total: issues.totalCount,
      next: issues.pageInfo.hasNextPage ? issues.pageInfo.endCursor : null,
      unread,
    };
  }
  return failure(answer, body, host, path);
}

/** Each Link under GitHub's own name for its kind, as the Issue's page shows it. */
function linksOf(node: IssueNode, hiddenParent: boolean): NamedLink[] {
  const links: NamedLink[] = [];
  const seen = new Set<string>();
  let hidden = 0;
  const add = (role: NamedLink["role"], name: string, end: EndNode | null) => {
    const to: FarEnd = end
      ? { id: end.id, readable: true, open: end.state === "OPEN", project: end.repository.nameWithOwner, ref: `${end.repository.nameWithOwner}#${end.number}`, title: end.title, url: end.url }
      : { id: `${node.id}/hidden/${hidden++}`, readable: false };
    // A sub-issue's parent can also track it in a task list: one Link, not two.
    if (seen.has(`${role} ${to.id}`)) return;
    seen.add(`${role} ${to.id}`);
    links.push({ role, name, to });
  };
  if (node.parent || hiddenParent) add("parent", "Parent issue", node.parent);
  for (const end of node.trackedInIssues.nodes) add("parent", "Tracked by", end);
  for (const end of node.subIssues.nodes) add("child", "Sub-issues", end);
  for (const end of node.trackedIssues.nodes) add("child", "Tracks", end);
  for (const end of node.blockedBy.nodes) add("blocker", "Blocked by", end);
  for (const end of node.blocking.nodes) add("blocked", "Blocking", end);
  return links;
}

function openIssue(node: IssueNode, hiddenParent: boolean): OpenIssue {
  return {
    id: node.id,
    ref: `#${node.number}`,
    title: node.title,
    url: node.url,
    createdAt: node.createdAt,
    assignees: node.assignees.nodes.map((a) => a.login),
    planned: node.milestone?.dueOn ?? null,
    // GitHub has no level below an ordinary Issue.
    taskLevel: false,
    links: linksOf(node, hiddenParent).map(({ role, to }) => ({ role, to })),
    closingRequests: closingRequests(node),
  };
}

function closingRequests(node: IssueNode): ClosingRequest[] {
  return (node.closedByPullRequestsReferences?.nodes ?? []).flatMap((pull): ClosingRequest[] =>
    pull?.state === "OPEN"
      ? [{ ref: `${pull.repository.nameWithOwner}#${pull.number}`, url: pull.url, draft: pull.isDraft, author: pull.author?.login ?? "ghost" }]
      : [],
  );
}

const CLOSED_AS = { COMPLETED: "completed", NOT_PLANNED: "not planned", DUPLICATE: "duplicate" } as const;

/** One Issue by its reference, `owner/name#123`, or its URL on this host. */
async function issue(cli: Cli, host: string, locator: string): Promise<IssueAnswer> {
  const escaped = host.replaceAll(".", "\\.");
  const found =
    /^([\w.-]+)\/([\w.-]+)#(\d+)$/.exec(locator) ?? new RegExp(`^https://${escaped}/([\\w.-]+)/([\\w.-]+)/issues/(\\d+)/?(?:[?#].*)?$`).exec(locator);
  if (!found) return { kind: "not-found", reason: `${locator} isn't a GitHub Issue's reference or URL on ${host}` };
  const [, owner = "", name = "", number = ""] = found;
  const answer = await graphql(cli, host, ISSUE_QUERY, { owner, name, number });
  if (answer.kind === "missing") return ghMissing(host);
  const body = parse(answer.stdout);
  const node = (body?.data as { repository?: { issue?: OneIssueNode | null } | null } | undefined)?.repository?.issue;
  // Fields this login can't see come back as `null`s with an error at each; the rest of the Issue still stands.
  const errors = (body?.errors ?? []) as { type?: string; path?: (string | number)[] }[];
  const onlyHidden = errors.every((e) => e.type === "FORBIDDEN" && e.path?.[1] === "issue" && e.path.length > 2);
  if (!node || !(answer.code === 0 || onlyHidden)) {
    const failed = failure(answer, body, host, `${owner}/${name}`);
    return failed.kind === "not-found" ? { kind: "not-found", reason: `no Issue ${owner}/${name}#${number} on ${host} that this login can read` } : failed;
  }
  const unread: Unread = {};
  if (errors.some((e) => e.path?.[2] === "closedByPullRequestsReferences" && e.path.length === 3)) {
    unread.closingRequests = "this login can't read pull requests";
  }
  const hiddenParent = errors.some((e) => e.path?.[2] === "parent");
  const mentionedBy = node.timelineItems.nodes.flatMap((item) => (item?.source?.__typename === "Issue" && item.source.id ? [item.source.id] : []));
  return {
    kind: "issue",
    issue: {
      id: node.id,
      project: node.repository.nameWithOwner,
      ref: `${node.repository.nameWithOwner}#${node.number}`,
      title: node.title,
      url: node.url,
      open: node.state === "OPEN",
      closedAs: node.state === "CLOSED" && node.stateReason && node.stateReason !== "REOPENED" ? CLOSED_AS[node.stateReason] : null,
      links: linksOf(node, hiddenParent),
      closingRequests: closingRequests(node),
      mentionedBy,
      unread,
    },
  };
}

function graphql(cli: Cli, host: string, query: string, variables: Record<string, string>): Promise<CliResult> {
  const fields = Object.entries(variables).flatMap(([key, value]) => ["-F", `${key}=${value}`]);
  return cli("gh", ["api", "--hostname", host, "graphql", "-f", `query=${query}`, ...fields]);
}

function noLogin(host: string): CantAnswer {
  return { kind: "refused", reason: `no login for ${host} — run \`gh auth login --hostname ${host}\`` };
}

function ghMissing(host: string): CantAnswer {
  return { kind: "refused", reason: `GitHub is read through the GitHub CLI, and \`gh\` isn't installed — install it and run \`gh auth login --hostname ${host}\`` };
}

/** Why a `gh` call didn't answer: no login, a refused login, no such Project, or no answer at all. */
function failure(answer: Extract<CliResult, { kind: "exited" }>, body: Record<string, unknown> | null, host: string, what: string): CantAnswer | { kind: "not-found"; reason: string } {
  if (answer.code === 4) {
    return { kind: "refused", reason: `not logged in to ${host} — run \`gh auth login --hostname ${host}\`` };
  }
  const errors = (body?.errors ?? []) as { type?: string; message?: string }[];
  if (errors.some((e) => e.type === "NOT_FOUND")) {
    return { kind: "not-found", reason: `no repository ${what} on ${host} that this login can see` };
  }
  const status = String(body?.status ?? "");
  if (status === "401" || status === "403") {
    return { kind: "refused", reason: `${host} refused this login: ${String(body?.message)} — run \`gh auth login --hostname ${host}\`` };
  }
  if (answer.stderr.startsWith("error connecting to")) {
    return { kind: "cant-tell", reason: `couldn't reach ${host}` };
  }
  const why = errors[0]?.message ?? answer.stderr.trim().split("\n")[0] ?? `gh exited with ${answer.code}`;
  return { kind: "cant-tell", reason: `${host} gave no answer for ${what}: ${why}` };
}

function project(host: string, repository: Repository): Project {
  return {
    id: `${host}#${repository.databaseId}`,
    host,
    path: repository.nameWithOwner,
    url: repository.url,
    issues: repository.hasIssuesEnabled ? { open: repository.issues.totalCount } : "off",
  };
}

function jsonField(text: string, field: string): string | null {
  const value = parse(text)?.[field];
  return typeof value === "string" ? value : null;
}
