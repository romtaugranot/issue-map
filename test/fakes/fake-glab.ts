/**
 * `glab` and the network, stood in for by replies in the shapes gitlab.com
 * and self-hosted GitLab give. The shapes were read from gitlab.com's
 * work-item GraphQL and REST; a self-hosted version answers only the fields
 * its schema has, as each release's GraphQL reference lists them, and every
 * answer holds only the widgets and fields the query asked for.
 */
import { gitlab } from "../../src/tracker/gitlab.ts";
import { CALL_SECONDS, type CliResult, type HttpResult } from "../../src/tracker/boundary.ts";
import type { IssueSpec, ProjectSpec, World } from "../contract/tracker-contract.ts";

/** Environment variables `glab` takes a token from, before the login it stores for a host. */
const TOKEN_VARIABLES = ["GITLAB_TOKEN", "GITLAB_ACCESS_TOKEN", "OAUTH_TOKEN"];

/** Before 17.7 an epic isn't a work item: it's the Parent of the Issues in it only through REST. */
const EPIC_WORK_ITEMS = "17.7";

/**
 * The GitLab adapter against a World, with what the contract's Stage counts.
 * `env` stands in for the environment the World's token is set in.
 */
export function arrange(given: World, env: Record<string, string> = envFor(given)) {
  // A write changes the World, so each Tracker gets its own.
  const world = structuredClone(given);
  let requests = 0;
  const loginsSentTo: string[] = [];
  const tokenSentTo: string[] = [];
  const queries: string[] = [];
  const kind = gitlab({
    env,
    cli: async (command, args, unset = [], seconds = CALL_SECONDS) => {
      if (command !== "glab" || (world.cli ?? "installed") === "missing") return { kind: "missing" };
      const set = (name: string) => (name in env && !unset.includes(name) ? env[name] : undefined);
      const host = args[args.indexOf(args[0] === "config" ? "--host" : "--hostname") + 1]!;
      // Every request for a host goes to the API host the environment names, if it names one.
      const apiHost = set("GITLAB_API_HOST") ?? host;
      const envToken = TOKEN_VARIABLES.some((name) => set(name) !== undefined) || (set("GLAB_ENABLE_CI_AUTOLOGIN") === "true" && set("GITLAB_CI") === "true" && set("CI_JOB_TOKEN") !== undefined);
      const stored = host === "gitlab.com" ? world.login !== "none" : (world.loggedInTo ?? []).includes(host);
      // Read from glab's own config, without the network.
      if (args[0] === "config") return exited(0, stored && !envToken ? `${world.viewer ?? "fixture-viewer"}\n` : "\n");
      if (envToken) tokenSentTo.push(apiHost);
      // Checks the token it would use against the host.
      if (args[0] === "auth") return envToken || stored ? exited(0, "") : exited(1, "", `x ${host} has not been authenticated with glab.\n`);
      requests++;
      loginsSentTo.push(apiHost);
      const query = args.find((a) => a.startsWith("query="));
      if (query !== undefined) queries.push(query.slice("query=".length));
      const login = envToken ? (apiHost === world.envTokenFor ? "ok" : "refused") : stored ? (world.login === "refused" ? "refused" : "ok") : "none";
      const answer = glabApi(world, apiHost, login, args);
      return world.network === "hangs" ? { kind: "exited", code: 1, stdout: "", stderr: "", timedOut: seconds } : answer;
    },
    http: async (url) => {
      requests++;
      return probe(world, new URL(url));
    },
  });
  return { kind, requests: () => requests, loginsSentTo: () => loginsSentTo.filter((h) => h !== "gitlab.com"), tokenSentTo: () => tokenSentTo, queries: () => queries };
}

/** glab takes GITLAB_TOKEN for every host, and GITLAB_HOST names the one it's meant for. */
function envFor(world: World): Record<string, string> {
  if (world.envTokenFor === undefined) return {};
  return world.envTokenFor === "gitlab.com" ? { GITLAB_TOKEN: "env-token" } : { GITLAB_TOKEN: "env-token", GITLAB_HOST: world.envTokenFor };
}

/** The release gitlab.com runs. */
export const LATEST = "19.4.0";
const LONG_AGO = "2025-01-01T00:00:00Z";

/** `glab api`'s answer: it prints the body, and on an error exits 1 with the first message on stderr. */
function glabApi(world: World, host: string, login: "ok" | "none" | "refused", args: string[]): CliResult {
  const server = host === "gitlab.com" ? { runs: "this-kind" as const, version: LATEST } : world.servers?.[host];
  if (!server || server.runs !== "this-kind" || (host === "gitlab.com" && (world.network ?? "up") === "down")) {
    return exited(1, "", `glab: Post "https://${host}/api/graphql": dial tcp: lookup ${host}: no such host\n`);
  }
  if (login === "refused") return exited(1, JSON.stringify({ message: "401 Unauthorized" }), "glab: 401 Unauthorized (HTTP 401)\n");
  if (world.rateLimited) return exited(1, "Retry later\n", "glab: 429 Too Many Requests (HTTP 429)\n");
  const field = (name: string) => args.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);
  const endpoint = args[3]!;
  const query = field("query") ?? "";
  if (endpoint !== "graphql" && args.includes("POST")) return restPost(new Gitlab(world, host, server.version, login, ""), endpoint, field);
  if (endpoint !== "graphql") return restApi(new Gitlab(world, host, server.version, login, ""), endpoint);
  return graphql(new Gitlab(world, host, server.version, login, query), query, field);
}

/** A World as one GitLab at one host shows it to one login. */
class Gitlab {
  readonly world: World;
  readonly host: string;
  readonly version: string;
  readonly login: "ok" | "none";
  /** The GraphQL query being answered, whose fields are all an answer holds. */
  readonly query: string;

  constructor(world: World, host: string, version: string, login: "ok" | "none", query: string) {
    this.world = world;
    this.host = host;
    this.version = version;
    this.login = login;
    this.query = query;
  }

  at(version: string): boolean {
    return newer(this.version, version);
  }

  find(addr: string): { spec: ProjectSpec; issue: IssueSpec } | null {
    const [path, n] = addr.split(/[#&]/) as [string, string];
    const spec = this.world.projects?.find((p) => p.path === path);
    const issue = spec?.issues?.find((i) => i.number === Number(n));
    return spec && issue ? { spec, issue } : null;
  }

  project(path: string): ProjectSpec | null {
    if (this.login === "none") return null;
    return this.world.projects?.find((p) => !p.namespace && p.path.toLowerCase() === path.toLowerCase()) ?? null;
  }

  group(path: string): ProjectSpec | null {
    if (this.login === "none") return null;
    return this.world.projects?.find((p) => p.namespace && p.path === path) ?? null;
  }

  addr(spec: ProjectSpec, issue: IssueSpec): string {
    return `${spec.path}#${issue.number}`;
  }

  /** Links as GitLab records them: `/duplicate` also relates the two. */
  links(): [string, "blocks" | "parent" | "related", string, string?][] {
    const duplicates = (this.world.projects ?? []).flatMap((spec) =>
      (spec.issues ?? []).flatMap((issue) => (issue.duplicateOf ? [[this.addr(spec, issue), "related", issue.duplicateOf] as [string, "related", string]] : [])),
    );
    return [...(this.world.links ?? []).filter(([, kind]) => kind !== "blocks" || this.world.recordsBlocks !== false), ...duplicates];
  }

  /** A Link made or removed touches both Issues. */
  updatedAt(spec: ProjectSpec, issue: IssueSpec): string {
    const self = this.addr(spec, issue);
    const touches = [...this.links(), ...(this.world.removedLinks ?? [])].filter(([a, , b]) => a === self || b === self).map(([, , , at]) => at ?? LONG_AGO);
    return [issue.updatedAt ?? closedAt(issue) ?? createdAt(issue), ...touches].sort().at(-1)!;
  }

  end(spec: ProjectSpec, issue: IssueSpec) {
    const duplicate = issue.duplicateOf ? this.find(issue.duplicateOf) : null;
    return {
      id: gid(spec, issue),
      iid: String(issue.number),
      title: title(issue),
      webUrl: webUrl(this.host, spec, issue),
      state: issue.closed ? "CLOSED" : "OPEN",
      closedAt: closedAt(issue),
      ...(this.query.includes("duplicatedToWorkItemUrl") ? { duplicatedToWorkItemUrl: duplicate ? webUrl(this.host, duplicate.spec, duplicate.issue) : null } : {}),
      reference: this.addr(spec, issue),
      namespace: { fullPath: spec.path },
      workItemType: { name: spec.namespace ? "Epic" : issue.taskLevel ? "Task" : "Issue" },
    };
  }

  /** An end this login may see, or `null`. */
  readable(addr: string) {
    const found = this.found(addr);
    return found.issue.hidden ? null : this.end(found.spec, found.issue);
  }

  found(addr: string) {
    const found = this.find(addr);
    if (!found) throw new Error(`the World has no ${addr}`);
    return found;
  }

  /** The Issue's Parent, where it has one; before 17.7 an epic Parent isn't a work item's. */
  parentOf(self: string, asWorkItem: boolean): string | undefined {
    const parent = this.links().find(([, kind, b]) => kind === "parent" && b === self)?.[0];
    const epic = parent !== undefined && !!this.found(parent).spec.namespace;
    return epic && asWorkItem && !this.at(EPIC_WORK_ITEMS) ? undefined : parent;
  }

  /** The Blocks and Related Links an Issue is at one end of, as `[kind as GitLab names it, far end]`. */
  linkedTo(self: string): [string, string][] {
    return this.links().flatMap(([a, kind, b]): [string, string][] => {
      if (kind === "parent" || (a !== self && b !== self)) return [];
      return [[kind === "related" ? "relates_to" : a === self ? "blocks" : "is_blocked_by", a === self ? b : a]];
    });
  }

  /**
   * A work item with the widgets `query` asks for, as gitlab.com gives
   * them: in a list, with an empty one for each widget not asked for.
   */
  item(spec: ProjectSpec, issue: IssueSpec, query: string) {
    const self = this.addr(spec, issue);
    const parent = this.parentOf(self, true);
    const children = this.links().filter(([a, kind]) => kind === "parent" && a === self).map(([, , b]) => this.readable(b)).filter((c) => c !== null);
    const linked = this.linkedTo(self).map(([linkType, to]) => ({ linkType, workItem: this.readable(to) }));
    const reads = this.world.readsClosingRequests !== false;
    const requests = (this.world.closingRequests ?? []).filter((r) => r.closes === self && reads);
    const mentions = (this.world.mentions ?? []).filter(([, b]) => b === self).map(([a]) => ({
      body: `mentioned in issue ${a.startsWith(`${spec.path}#`) ? a.slice(spec.path.length) : a}`,
      systemNoteMetadata: { action: "cross_reference" },
    }));
    const noted = (this.world.closingRequests ?? []).filter((r) => r.closes === self).map((r) => ({ body: `mentioned in merge request ${spec.path}!${r.number}`, systemNoteMetadata: { action: "cross_reference" } }));
    return {
      ...this.end(spec, issue),
      createdAt: createdAt(issue),
      updatedAt: this.updatedAt(spec, issue),
      widgets: [
        ["WorkItemWidgetDescription", { description: issue.body ?? null }],
        ["WorkItemWidgetAssignees", { assignees: { nodes: (issue.assignees ?? []).map((username) => ({ username })) } }],
        ["WorkItemWidgetMilestone", { milestone: issue.planned ? { dueDate: issue.planned.slice(0, 10) } : null }],
        [
          "WorkItemWidgetHierarchy",
          { ...(this.query.includes("hasParent") ? { hasParent: parent !== undefined } : {}), parent: parent ? this.readable(parent) : null, children: { nodes: children } },
        ],
        // Before 16.7, the linked-items widget answers only where an administrator turned its flag on.
        ["WorkItemWidgetLinkedItems", { linkedItems: this.at("16.7") ? { nodes: linked } : null }],
        [
          "WorkItemWidgetDevelopment",
          {
            closingMergeRequests: {
              nodes: requests.map((r) => ({
                mergeRequest: { reference: `${spec.path}!${r.number}`, webUrl: `https://${this.host}/${spec.path}/-/merge_requests/${r.number}`, draft: r.draft ?? false, state: r.state === "open" || !r.state ? "opened" : r.state, author: { username: r.author } },
              })),
            },
          },
        ],
        [
          "WorkItemWidgetNotes",
          query.includes("filter: ONLY_COMMENTS") ? commentsWidget(issue, query) : notesWidget([{ body: "changed the description", systemNoteMetadata: { action: "description" } }, ...mentions, ...noted]),
        ],
      ].map(([type, widget]) => (query.includes(`on ${type as string} `) ? widget : {})),
    };
  }
}

/** The notes widget: a flat list from 17.11, and discussions of notes in every version. */
function notesWidget(notes: { body: string; systemNoteMetadata: { action: string } }[]) {
  return { notes: { nodes: notes }, discussions: { nodes: notes.map((note) => ({ notes: { nodes: [note] } })) } };
}

/**
 * The comments widget: the first `n` discussions the query asks for, in the
 * order it asks for, oldest first unless it sorts them newest first; each
 * comment in the World starts a discussion, and its first reply is in the
 * same one.
 */
function commentsWidget(issue: IssueSpec, query: string) {
  const first = Number(/filter: ONLY_COMMENTS[^)]*first: (\d+)/.exec(query)?.[1] ?? 20);
  const note = (c: NonNullable<IssueSpec["comments"]>[number]) => ({ body: c.body, createdAt: c.at, author: { username: c.author } });
  const comments = issue.comments ?? [];
  const discussions = comments.map((c) => ({ notes: { nodes: [note(c)] } }));
  const ordered = query.includes("sort: CREATED_DESC") ? [...discussions].reverse() : discussions;
  return { discussions: { pageInfo: { hasNextPage: ordered.length > first }, nodes: ordered.slice(0, first) } };
}

/**
 * What each version's schema lacks, from each release's GraphQL reference;
 * asking for one fails the whole query, as GitLab's GraphQL does.
 */
const SINCE: [RegExp, string, string][] = [
  [/on WorkItemWidgetLinkedItems\b/, "16.3", "No such type WorkItemWidgetLinkedItems, so it can't be a fragment condition"],
  [/\bgroup\(fullPath[^]*workItems\(iids/, "16.4", "Field 'workItems' doesn't accept argument 'iids'"],
  [/\bworkItemsByReference\b/, "16.7", "Field 'workItemsByReference' doesn't exist on type 'Query'"],
  [/\bclosingMergeRequests\b/, "17.1", "Field 'closingMergeRequests' doesn't exist on type 'WorkItemWidgetDevelopment'"],
  [/\bhasParent\b/, "17.2", "Field 'hasParent' doesn't exist on type 'WorkItemWidgetHierarchy'"],
  [/\bcount\b/, "17.2", "Field 'count' doesn't exist on type 'WorkItemConnection'"],
  [/\bduplicatedToWorkItemUrl\b/, "17.8", "Field 'duplicatedToWorkItemUrl' doesn't exist on type 'WorkItem'"],
  [/on WorkItemWidgetNotes \{ notes\b/, "17.11", "Field 'notes' doesn't exist on type 'WorkItemWidgetNotes'"],
  [/\bmaxAccessLevel\b/, "16.9", "Field 'maxAccessLevel' doesn't exist on type 'Project'"],
  [/\bforkedFrom\b/, "18.0", "Field 'forkedFrom' doesn't exist on type 'Project'"],
  [/\bavailableFeatures\b/, "18.3", "Field 'availableFeatures' doesn't exist on type 'Namespace'"],
  // Discussions page forward only, on every version: the latest come first once they can be sorted.
  [/\bdiscussions\([^)]*\blast:/, "999.0", "Field 'discussions' doesn't accept argument 'last'"],
  [/\bdiscussions\([^)]*\bsort:/, "18.4", "Field 'discussions' doesn't accept argument 'sort'"],
];

function graphql(gl: Gitlab, query: string, field: (name: string) => string | undefined): CliResult {
  for (const [pattern, since, message] of SINCE) {
    if (pattern.test(query) && !gl.at(since)) return answer(null, [{ message }]);
  }
  if (/^\s*mutation\b/.test(query)) return mutation(gl, query, field);
  // Measured on gitlab.com: a page of 100 work items with their widgets is about 90 of the 200 an
  // anonymous query may cost, and anything more with a page of its own, such as merge requests, takes
  // it past 250; so does a page of 100 asked for by iid.
  if ((/workItems\([^)]*first: 100/.test(query) && query.includes("mergeRequests(")) || /workItems\(iids: [^)]*first: 100/.test(query)) {
    return answer(null, [{ message: "Query has complexity of 325, which exceeds max complexity of 250" }]);
  }
  const data: Record<string, unknown> = {};
  const errors: { message: string; path: string[] }[] = [];
  if (query.includes("currentUser")) data.currentUser = gl.login === "ok" ? { username: gl.world.viewer ?? "fixture-viewer" } : null;
  if (query.includes("availableFeatures")) data.namespace = { availableFeatures: { hasBlockedIssuesFeature: gl.world.recordsBlocks !== false } };
  for (const [, alias, id] of query.matchAll(/(\w+): workItem\(id: ("[^"]*")\)/g)) {
    const wanted = JSON.parse(id!) as string;
    const found = (gl.world.projects ?? []).flatMap((spec) => (spec.issues ?? []).map((issue) => ({ spec, issue }))).find(({ spec, issue }) => gid(spec, issue) === wanted);
    if (found && !found.issue.hidden && gl.login === "ok") data[alias!] = gl.end(found.spec, found.issue);
    else {
      data[alias!] = null;
      errors.push({ message: "The resource that you are attempting to access does not exist or you don't have permission to perform this action", path: [alias!] });
    }
  }
  const byReference = /workItemsByReference\(contextNamespacePath: ("[^"]*"), refs: (\[[^\]]*\])/.exec(query);
  if (byReference) {
    const context = JSON.parse(byReference[1]!) as string;
    const refs = JSON.parse(byReference[2]!) as string[];
    const nodes = refs.flatMap((ref) => {
      const found = gl.find(ref.startsWith("#") ? `${context}${ref}` : ref);
      return found && !found.issue.hidden ? [{ id: gid(found.spec, found.issue), reference: gl.addr(found.spec, found.issue) }] : [];
    });
    // GitLab resolves at most ten references a request, and refuses more below the top of its answer.
    const refused = refs.length > 10 ? "Number of references exceeds the limit of 10." : gl.world.mentionsFail ? "Internal server error" : null;
    data.workItemsByReference = refused ? null : { nodes };
    if (refused) errors.push({ message: refused, path: ["workItemsByReference"] });
  }
  const path = field("path");
  if (path !== undefined && /\bproject\(fullPath/.test(query)) data.project = projectAnswer(gl, query, path, field);
  if (path !== undefined && /\bgroup\(fullPath/.test(query)) {
    const group = gl.group(path);
    data.group = group && { workItems: { nodes: gl.at(EPIC_WORK_ITEMS) ? byIids(gl, group, query) : [] } };
  }
  return answer(data, errors);
}

/** What GitLab answers a token that may only read, for any write. */
function insufficientScope(): CliResult {
  const body = { error: "insufficient_scope", error_description: "The request requires higher privileges than provided by the access token.", scope: "api" };
  return exited(1, JSON.stringify(body), "glab: 403 Forbidden (HTTP 403)\n");
}

const NO_ACCESS = "The resource that you are attempting to access does not exist or you don't have permission to perform this action";

/**
 * `issueSetAssignees`, appending the named login, and `workItemUpdate`,
 * setting a work item's parent. A token that may only read is refused any
 * mutation; an Issue that doesn't exist, or that this login may not write,
 * is refused in the same words.
 */
function mutation(gl: Gitlab, query: string, field: (name: string) => string | undefined): CliResult {
  if (gl.world.token === "reads") return insufficientScope();
  if (query.includes("workItemUpdate(")) return setParent(gl, field("id")!, field("parent")!);
  if (!query.includes("issueSetAssignees(")) return answer(null, [{ message: "unknown mutation" }]);
  const issue = gl.project(field("path") ?? "")?.issues?.find((i) => i.number === Number(field("iid")));
  if (!issue || issue.hidden || gl.world.role === "reader") {
    const message = "The resource that you are attempting to access does not exist or you don't have permission to perform this action";
    return answer({ issueSetAssignees: null }, [{ message, path: ["issueSetAssignees"] }]);
  }
  issue.assignees = [...new Set([...(issue.assignees ?? []), field("viewer")!])];
  return answer({ issueSetAssignees: { issue: { assignees: { nodes: issue.assignees.map((username) => ({ username })) } }, errors: [] } }, []);
}

/**
 * `workItemUpdate` with a parent, as GitLab does it: a work item that has
 * a parent is moved to the new one. Only a task goes under an Issue; an
 * epic takes Issues.
 */
function setParent(gl: Gitlab, id: string, parentId: string): CliResult {
  const all = (gl.world.projects ?? []).flatMap((spec) => (spec.issues ?? []).map((issue) => ({ spec, issue })));
  const [child, parent] = [id, parentId].map((wanted) => all.find(({ spec, issue }) => gid(spec, issue) === wanted));
  if (!child || !parent || child.issue.hidden || parent.issue.hidden || gl.world.role === "reader") {
    return answer({ workItemUpdate: null }, [{ message: NO_ACCESS, path: ["workItemUpdate"] }]);
  }
  if (!parent.spec.namespace && !child.issue.taskLevel) {
    return answer({ workItemUpdate: { workItem: null, errors: [`${gl.addr(child.spec, child.issue)} cannot be added: it's not allowed to add this type of parent item`] } }, []);
  }
  const self = gl.addr(child.spec, child.issue);
  gl.world.links = [...(gl.world.links ?? []).filter(([, kind, b]) => !(kind === "parent" && b === self)), [gl.addr(parent.spec, parent.issue), "parent", self]];
  return answer({ workItemUpdate: { workItem: { id }, errors: [] } }, []);
}

function projectAnswer(gl: Gitlab, query: string, path: string, field: (name: string) => string | undefined) {
  const spec = gl.project(path);
  if (!spec) return null;
  const project = (spec: ProjectSpec) => ({
    id: `gid://gitlab/Project/${projectId(spec)}`,
    fullPath: spec.path,
    webUrl: `https://${gl.host}/${spec.path}`,
    issuesEnabled: spec.open !== "off",
    openIssuesCount: spec.open === "off" ? 0 : spec.open,
    workItems: { count: spec.open === "off" ? 0 : spec.open },
  });
  if (query.includes("...project")) return { ...project(spec), forkedFrom: spec.parent ? project(spec.parent) : null };
  const PAGE = 100;
  const start = Number(field("after") ?? 0);
  const page = <T>(all: T[]) => ({ nodes: all.slice(start, start + PAGE), pageInfo: { hasNextPage: start + PAGE < all.length, endCursor: String(start + PAGE) } });
  const answer: Record<string, unknown> = { id: project(spec).id, userPermissions: { readMergeRequest: gl.world.readsClosingRequests !== false } };
  // The effective role: Developer, or no access at all.
  if (query.includes("maxAccessLevel")) answer.maxAccessLevel = { integerValue: gl.world.role === "reader" ? 0 : 30 };
  const issues = (spec.issues ?? []).filter((i) => !i.hidden);
  if (query.includes("sort: CREATED_ASC")) {
    const open = issues.filter((i) => !i.closed);
    answer.workItems = { count: open.length, ...page(open.map((i) => gl.item(spec, i, query))) };
  } else if (query.includes("workItems(sort: UPDATED_DESC")) {
    const all = issues.map((i) => gl.item(spec, i, query)).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    answer.workItems = page(all);
  } else if (query.includes("iids:")) {
    answer.workItems = { nodes: byIids(gl, spec, query) };
  }
  const iid = /\bissue\(iid: "(\d+)"\)/.exec(query)?.[1];
  if (iid !== undefined) {
    const one = issues.find((i) => i.number === Number(iid));
    answer.issue = one ? { id: `gid://gitlab/Issue/${gidNumber(spec, one)}` } : null;
  }
  if (query.includes("mergeRequests(updatedAfter:")) {
    const since = Date.parse(field("since")!);
    // A World lists a merge request once for each Issue it closes; GitLab lists it once.
    const requests = (gl.world.closingRequests ?? [])
      .filter((r, i, all) => r.closes.startsWith(`${spec.path}#`) && Date.parse(r.updatedAt ?? LONG_AGO) >= since && all.findIndex((o) => o.number === r.number && o.closes.startsWith(`${spec.path}#`)) === i)
      .sort((a, b) => Date.parse(b.updatedAt ?? LONG_AGO) - Date.parse(a.updatedAt ?? LONG_AGO))
      .map((r) => ({ iid: String(r.number), reference: `${spec.path}!${r.number}`, updatedAt: r.updatedAt }));
    answer.mergeRequests = { nodes: requests.slice(0, PAGE), pageInfo: { hasNextPage: requests.length > PAGE, endCursor: "x" } };
  }
  return answer;
}

function byIids(gl: Gitlab, spec: ProjectSpec, query: string) {
  const iids = JSON.parse(/iids: (\[[^\]]*\])/.exec(query)![1]!) as string[];
  return (spec.issues ?? []).filter((i) => !i.hidden && !i.vanished && iids.includes(String(i.number))).map((i) => gl.item(spec, i, query));
}

/**
 * `POST projects/:id/issues/:iid/links`: a Blocks or Related Link from one
 * of a Project's Issues to another's, answered with the kind recorded.
 */
function restPost(gl: Gitlab, endpoint: string, field: (name: string) => string | undefined): CliResult {
  const { world } = gl;
  const [kind, encoded, issues, iid, links] = endpoint.split("/");
  const notFound = exited(1, JSON.stringify({ message: "404 Not found" }), "glab: 404 Not Found (HTTP 404)\n");
  if (kind !== "projects" || issues !== "issues" || links !== "links" || gl.login !== "ok") return notFound;
  if (world.token === "reads") return insufficientScope();
  const from = gl.find(`${decodeURIComponent(encoded!)}#${iid}`);
  const to = gl.find(`${field("target_project_id")}#${field("target_issue_iid")}`);
  if (!from || !to || from.issue.hidden || to.issue.hidden) return notFound;
  if (world.role === "reader") return exited(1, JSON.stringify({ message: "403 Forbidden" }), "glab: 403 Forbidden (HTTP 403)\n");
  const type = field("link_type") ?? "relates_to";
  const [a, b] = [gl.addr(from.spec, from.issue), gl.addr(to.spec, to.issue)];
  // GitLab keeps one Link between two Issues, whatever its type.
  const joined = (world.links ?? []).some(([x, kind, y]) => kind !== "parent" && ((x === a && y === b) || (x === b && y === a)));
  if (joined) return exited(1, JSON.stringify({ message: "Issue(s) already assigned" }), "glab: 409 Conflict (HTTP 409)\n");
  world.links =[...(world.links ?? []), [a, type === "blocks" ? "blocks" : "related", b]];
  return exited(0, JSON.stringify({ source_issue: restIssue(gl, from.spec, from.issue), target_issue: restIssue(gl, to.spec, to.issue), link_type: type }));
}

/**
 * GitLab's REST API: a Project by any path it had, the Issues a merge request
 * closes, Issues with their epic and licence-only fields, an Issue's Links,
 * and a group's legacy epics.
 */
function restApi(gl: Gitlab, endpoint: string): CliResult {
  const { world, host } = gl;
  if (endpoint === "version") {
    const server = world.servers?.[host];
    if (server?.runs === "this-kind" && server.hidesVersion) return exited(1, JSON.stringify({ message: "403 Forbidden" }), "glab: 403 Forbidden (HTTP 403)\n");
    return exited(0, JSON.stringify({ version: gl.version, revision: "0000000" }));
  }
  if (endpoint === "personal_access_tokens/self") {
    // From 15.5, for a personal access token; any other kind of token is a bad request.
    if (!gl.at("15.5")) return exited(1, JSON.stringify({ error: "404 Not Found" }), "glab: 404 Not Found (HTTP 404)\n");
    // A CI job's token may ask only a few endpoints.
    if (gl.world.token === "cant-ask") return exited(1, JSON.stringify({ message: "401 Unauthorized" }), "glab: 401 Unauthorized (HTTP 401)\n");
    if ((gl.world.token ?? "writes") === "unknown") return exited(1, JSON.stringify({ message: "400 Bad request - Token type not supported" }), "glab: 400 Bad request (HTTP 400)\n");
    return exited(0, JSON.stringify({ name: "glab", scopes: (gl.world.token ?? "writes") === "reads" ? ["read_api"] : ["api"] }));
  }
  const url = new URL(endpoint, "https://api.invalid/");
  const [, kind, encoded, ...rest] = url.pathname.split("/");
  const path = decodeURIComponent(encoded ?? "");
  const notFound = exited(1, JSON.stringify({ message: "404 Not Found" }), "glab: 404 Not Found (HTTP 404)\n");
  if (gl.login !== "ok") return notFound;
  const licensed = world.recordsBlocks !== false;
  if (kind === "groups") {
    const group = world.projects?.find((p) => p.namespace && (p.path === path || String(projectId(p)) === path));
    const epic = group?.issues?.find((i) => i.number === Number(rest[1]));
    if (!group || !epic || epic.hidden || rest[0] !== "epics" || !licensed) return notFound;
    if (rest[2] === "notes") return restNotes(gl, group, epic, url);
    if (rest[2] === "issues") {
      const self = gl.addr(group, epic);
      const children = gl.links().filter(([a, k]) => k === "parent" && a === self).map(([, , b]) => gl.found(b)).filter((c) => !c.issue.hidden);
      return exited(0, JSON.stringify(pageOf(url, children.map((c) => restIssue(gl, c.spec, c.issue)))));
    }
    return exited(0, JSON.stringify(restEpic(gl, group, epic)));
  }
  const spec = world.projects?.find((p) => !p.namespace && [p.path, ...(p.oldPaths ?? [])].includes(path));
  if (kind !== "projects" || !spec) return exited(1, JSON.stringify({ message: "404 Project Not Found" }), "glab: 404 Project Not Found (HTTP 404)\n");
  if (rest.length === 0) {
    const fork = spec.parent ? { forked_from_project: { id: projectId(spec.parent), path_with_namespace: spec.parent.path } } : {};
    // Direct membership only: access through a shared group isn't said.
    const permissions = { project_access: world.role === "reader" ? null : { access_level: 30 }, group_access: null };
    const issues = { issues_enabled: spec.open !== "off", open_issues_count: spec.open === "off" ? 0 : spec.open };
    return exited(0, JSON.stringify({ id: projectId(spec), path_with_namespace: spec.path, web_url: `https://${host}/${spec.path}`, ...issues, ...fork, permissions }));
  }
  if (rest[0] === "merge_requests" && rest[2] === "closes_issues") {
    const closes = (world.closingRequests ?? []).filter((r) => r.number === Number(rest[1]) && r.closes.startsWith(`${spec.path}#`));
    if (closes.length === 0 || closes.some((r) => r.vanished)) return notFound;
    return exited(0, JSON.stringify(pageOf(url, closes.map((r) => {
      const iid = Number(r.closes.split("#")[1]);
      return { id: gidNumber(spec, { number: iid }), iid, project_id: projectId(spec) };
    }))));
  }
  // `weight` and `epic` are given only where the tier that has them is licensed.
  const withTier = (issue: IssueSpec) => {
    const epic = gl.parentOf(gl.addr(spec, issue), false);
    const found = epic === undefined ? null : gl.found(epic);
    const epicOf = found?.spec.namespace && !found.issue.hidden ? { id: epicId(found.spec, found.issue), iid: found.issue.number, group_id: projectId(found.spec), title: title(found.issue) } : null;
    return { ...restIssue(gl, spec, issue), ...(licensed ? { weight: null, epic: epicOf } : {}) };
  };
  if (rest[0] === "issues" && rest.length === 1) {
    const param = (name: string) => url.searchParams.get(name);
    const iids = url.searchParams.getAll("iids[]").map(Number);
    const perPage = Number(param("per_page") ?? 20);
    const page = Number(param("page") ?? 1);
    const state = { opened: false, closed: true }[param("state") ?? ""];
    const updatedAfter = param("updated_after");
    const order = param("order_by") === "updated_at" ? (i: IssueSpec) => gl.updatedAt(spec, i) : createdAt;
    const issues = (spec.issues ?? [])
      .filter((i) => !i.hidden && (iids.length === 0 || iids.includes(i.number)) && (state === undefined || !!i.closed === state))
      .filter((i) => updatedAfter === null || Date.parse(gl.updatedAt(spec, i)) >= Date.parse(updatedAfter))
      .sort((a, b) => order(a).localeCompare(order(b)) * (param("sort") === "desc" ? -1 : 1));
    return exited(0, JSON.stringify(issues.slice((page - 1) * perPage, page * perPage).map(withTier)));
  }
  if (rest[0] === "issues" && rest.length === 2) {
    const issue = spec.issues?.find((i) => i.number === Number(rest[1]));
    return issue && !issue.hidden && !issue.vanished ? exited(0, JSON.stringify(withTier(issue))) : notFound;
  }
  if (rest[0] === "issues" && rest[2] === "notes") {
    const issue = spec.issues?.find((i) => i.number === Number(rest[1]));
    return issue && !issue.hidden && !issue.vanished ? restNotes(gl, spec, issue, url) : notFound;
  }
  if (rest[0] === "issues" && rest[2] === "links") {
    const issue = spec.issues?.find((i) => i.number === Number(rest[1]));
    // REST's Issue Links don't know a task, as the matrix found on 16.0.
    if (!issue || issue.hidden || issue.vanished || issue.taskLevel) return notFound;
    const linked = gl.linkedTo(gl.addr(spec, issue)).flatMap(([linkType, to]) => {
      const end = gl.found(to);
      // REST leaves out an Issue this login can't read.
      return end.issue.hidden || end.spec.namespace ? [] : [{ ...restIssue(gl, end.spec, end.issue), link_type: linkType }];
    });
    return exited(0, JSON.stringify(linked));
  }
  return notFound;
}

/** The page of `all` a REST request asks for: 20 to a page unless it says. */
function pageOf<T>(url: URL, all: T[]): T[] {
  const perPage = Number(url.searchParams.get("per_page") ?? 20);
  const page = Number(url.searchParams.get("page") ?? 1);
  return all.slice((page - 1) * perPage, page * perPage);
}

/** An Issue's or an epic's notes, a page at a time in the order asked for: the notes GitLab makes by itself, marked `system`, and the comments. */
function restNotes(gl: Gitlab, spec: ProjectSpec, issue: IssueSpec, url: URL): CliResult {
  const self = gl.addr(spec, issue);
  const system = (gl.world.mentions ?? []).filter(([, b]) => b === self).map(([a]) => ({ body: `mentioned in issue ${a}`, created_at: LONG_AGO, system: true, author: { username: "fixture-dev" } }));
  const comments = (issue.comments ?? []).map((c) => ({ body: c.body, created_at: c.at, system: false, author: { username: c.author } }));
  const notes = [...system, ...comments].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  if (url.searchParams.get("sort") === "desc") notes.reverse();
  const perPage = Number(url.searchParams.get("per_page") ?? 20);
  const page = Number(url.searchParams.get("page") ?? 1);
  return exited(0, JSON.stringify(notes.slice((page - 1) * perPage, page * perPage)));
}

function restIssue(gl: Gitlab, spec: ProjectSpec, issue: IssueSpec) {
  const duplicate = issue.duplicateOf ? gl.found(issue.duplicateOf) : null;
  return {
    id: gidNumber(spec, issue),
    iid: issue.number,
    project_id: projectId(spec),
    title: title(issue),
    description: issue.body ?? null,
    state: issue.closed ? "closed" : "opened",
    closed_at: closedAt(issue),
    web_url: `https://${gl.host}/${spec.path}/-/issues/${issue.number}`,
    references: { full: gl.addr(spec, issue) },
    issue_type: issue.taskLevel ? "task" : "issue",
    created_at: createdAt(issue),
    updated_at: gl.updatedAt(spec, issue),
    assignees: (issue.assignees ?? []).map((username) => ({ username })),
    milestone: issue.planned ? { title: "next", due_date: issue.planned.slice(0, 10) } : null,
    _links: { closed_as_duplicate_of: duplicate ? `https://${gl.host}/api/v4/projects/${projectId(duplicate.spec)}/issues/${duplicate.issue.number}` : null },
  };
}

function restEpic(gl: Gitlab, group: ProjectSpec, epic: IssueSpec) {
  return {
    id: epicId(group, epic),
    iid: epic.number,
    group_id: projectId(group),
    title: title(epic),
    description: epic.body ?? null,
    state: epic.closed ? "closed" : "opened",
    closed_at: closedAt(epic),
    web_url: `https://${gl.host}/groups/${group.path}/-/epics/${epic.number}`,
    references: { full: `${group.path}&${epic.number}` },
  };
}

function probe(world: World, url: URL): HttpResult {
  const server = world.servers?.[url.hostname];
  if (!server) return { kind: "unreachable", reason: "ENOTFOUND" };
  if (server.runs === "something-else") return { kind: "response", status: 404, headers: { "content-type": "text/html" }, body: "<h1>Not Found</h1>" };
  if (!url.pathname.startsWith("/api/v4/")) return { kind: "response", status: 404, headers: {}, body: "" };
  return { kind: "response", status: 401, headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "401 Unauthorized" }) };
}

/** The GraphQL answer: `glab api` exits 1 when it holds an error. */
function answer(data: object | null, errors: { message: string; path?: string[] }[]): CliResult {
  const body = { ...(errors.length > 0 ? { errors } : {}), data };
  return exited(errors.length > 0 ? 1 : 0, JSON.stringify(body), errors.length > 0 ? `glab: ${errors[0]!.message}\n` : "");
}

function newer(version: string, than: string): boolean {
  const [a, b] = [version, than].map((v) => v.split(".").map(Number));
  for (let i = 0; i < 3; i++) if ((a![i] ?? 0) !== (b![i] ?? 0)) return (a![i] ?? 0) > (b![i] ?? 0);
  return true;
}

function projectId(spec: ProjectSpec): number {
  return 34_675_000 + spec.number;
}

function gidNumber(spec: ProjectSpec, issue: IssueSpec): number {
  return projectId(spec) * 100_000 + issue.number;
}

/** A legacy epic's own id, apart from the work item it later became. */
function epicId(spec: ProjectSpec, issue: IssueSpec): number {
  return projectId(spec) * 1_000 + issue.number;
}

function gid(spec: ProjectSpec, issue: IssueSpec): string {
  return `gid://gitlab/WorkItem/${gidNumber(spec, issue)}`;
}

function webUrl(host: string, spec: ProjectSpec, issue: IssueSpec): string {
  return `https://${host}/${spec.namespace ? "groups/" : ""}${spec.path}/-/work_items/${issue.number}`;
}

function createdAt(issue: IssueSpec): string {
  return issue.createdAt ?? new Date(Date.UTC(2026, 0, issue.number)).toISOString();
}

function closedAt(issue: IssueSpec): string | null {
  if (!issue.closed) return null;
  return issue.closedAt ?? new Date(Date.UTC(2026, 0, issue.number + 1)).toISOString();
}

function title(issue: IssueSpec): string {
  return issue.title ?? `Issue ${issue.number}`;
}

function exited(code: number, stdout: string, stderr = ""): CliResult {
  return { kind: "exited", code, stdout, stderr };
}
