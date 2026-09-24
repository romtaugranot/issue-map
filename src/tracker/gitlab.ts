/**
 * The GitLab adapter: reads through `glab`'s login and its raw-API call
 * (ADR 0001), from GitLab's work-item GraphQL, which gives tasks, epics and
 * every Link kind in one request a page. A self-hosted GitLab is asked only
 * for the fields its version has; what an older one's GraphQL leaves out,
 * its REST API fills in.
 */
import { atLeast, hostNamed, parseJson as parse, type AdapterDeps, type Cli, type CliResult } from "./boundary.ts";
import type { AssignAnswer, CantAnswer, CapabilitiesAnswer, ChangesAnswer, ClosingRequest, FarEnd, Identification, IssueAnswer, IssuePage, KindAnswer, LinkAnswer, LinkKind, Mention, NamedLink, OpenIssue, Project, ProjectResolution, ThreadAnswer, Tracker, TrackerKind, Unread, ViewerAnswer, WriteAnswer } from "./tracker.ts";

const PRODUCT = "GitLab";

/** Where `glab` takes a token from before the login it stores for a host; it sends it to every host. */
const TOKEN_VARIABLES = ["GITLAB_TOKEN", "GITLAB_ACCESS_TOKEN", "OAUTH_TOKEN"];

/**
 * What `glab` applies to every host but is meant for one: the tokens, the
 * CI job's token, and the API host every request would be sent to.
 */
const FOR_ONE_HOST = [...TOKEN_VARIABLES, "CI_JOB_TOKEN", "GITLAB_API_HOST"];

/** Why no Issue is Unblocked in a Project whose tier can't record Blocks Links, such as GitLab Free. */
const CANT_RECORD_BLOCKS = "this Project's GitLab tier can't record Blocks Links";

/** The oldest GitLab the Map reads Links from: its REST API gives each Link's kind from 13.4. */
const READS_FROM = "13.4";

/** The oldest GitLab the Map is tested on (ADR 0003). */
const TESTED_FROM = "16.0";

/** GitLab's access levels for the roles that may write a Link: Guest from 17.0, Reporter before. */
const GUEST = 10;
const REPORTER = 20;
const GUEST_WRITES_LINKS = "17.0";

/** The first version that says what a personal access token may do. */
const TOKEN_SCOPES = "15.5";

/** Pages one refresh reads before it gives up proving it caught up. */
const REFRESH_PAGES = 10;

/** Outside Issues read again in one request. */
const OUTSIDE_BATCH = 50;

/** Work items read by iid in one request. */
const IID_BATCH = 20;

/** Comments a thread reads, the latest. */
const THREAD_COMMENTS = 100;

/** REST requests one read keeps in flight, where an older GitLab gives an Issue's Links only one Issue at a time. */
const REST_AT_ONCE = 4;

/**
 * The first version whose GraphQL gives each thing the Map reads, from each
 * release's GraphQL reference. Where a version doesn't, REST gives it.
 */
const SINCE = {
  /** Issues as work items, and a task's Parent; before it, Issues are read from REST. */
  workItems: TESTED_FROM,
  workItemsByReference: "16.7",
  closingMergeRequests: "17.1",
  hasParent: "17.2",
  /** A page of work items' `count`; before it, the Project's open Issues count stands in. */
  workItemCount: "17.2",
  /** Epics as group work items, on by default; before it, an epic is the Parent of the Issues in it only in REST. */
  epicWorkItems: "17.7",
  /**
   * `duplicatedToWorkItemUrl`, without which a Related Link `/duplicate`
   * made can't be told from any other. Before it, Blocks and Related Links
   * are read from REST, which says, though the linked-items widget has
   * answered since 16.7.
   */
  duplicatedTo: "17.8",
  /** The role this login has in a Project, however it came by it; before it, REST, which misses a role through a shared group. */
  maxAccessLevel: "16.9",
  forkedFrom: "18.0",
  /** `availableFeatures { hasBlockedIssuesFeature }`; before it, REST's `weight` key stands in (ADR 0003). */
  availableFeatures: "18.3",
};

/** Whether this GitLab gives each thing in `SINCE` through GraphQL. */
type Has = Record<keyof typeof SINCE, boolean>;

const VIEWER_QUERY = `query { currentUser { username } }`;

interface Ctx {
  cli: Cli;
  host: string;
  /** `null` where GitLab runs its latest code, as gitlab.com and Dedicated do. */
  version: string | null;
  has: Has;
}

interface EndNode {
  id: string;
  iid: string;
  title: string;
  webUrl: string;
  state: "OPEN" | "CLOSED";
  closedAt: string | null;
  /** Asked for from 17.8; before, only a Link read from REST says. */
  duplicatedToWorkItemUrl?: string | null;
  reference: string;
  namespace: { fullPath: string };
  workItemType: { name: string };
}

interface ItemNode extends EndNode {
  createdAt: string;
  updatedAt: string;
  widgets: Widgets[];
}

/** The widgets a read asks for, each in its own element of the list GitLab gives; the rest come back empty. */
interface Widgets {
  assignees?: { nodes: { username: string }[] };
  milestone?: { dueDate: string | null } | null;
  hasParent?: boolean;
  parent?: EndNode | null;
  children?: { nodes: (EndNode | null)[] };
  /** `null` where an administrator turned its flag off. */
  linkedItems?: { nodes: { linkType: string; workItem: EndNode | null }[] } | null;
  closingMergeRequests?: { nodes: ({ mergeRequest: MergeNode | null } | null)[] };
  discussions?: { nodes: { notes: { nodes: { body: string; systemNoteMetadata: { action: string } | null }[] } }[] };
}

interface MergeNode {
  reference: string;
  webUrl: string;
  draft: boolean;
  state: "opened" | "closed" | "merged" | "locked";
  /** `null` once the account is deleted; GitLab then shows it as the ghost user's. */
  author: { username: string } | null;
}

interface ProjectNode {
  id: string;
  fullPath: string;
  webUrl: string;
  issuesEnabled: boolean;
  /** From 17.2; before, `openIssuesCount`. */
  workItems?: { count: number };
  openIssuesCount?: number;
  forkedFrom?: ProjectNode | null;
}

/** An Issue as GitLab's REST API gives it, as a Link's far end. */
interface RestIssue {
  id: number;
  iid: number;
  title: string;
  state: "opened" | "closed";
  closed_at: string | null;
  web_url: string;
  references: { full: string };
  issue_type?: string;
  _links?: { closed_as_duplicate_of?: string | null };
  link_type?: string;
  /** Where the tier that has epics is licensed, and this login can read the Issue's epic. */
  epic?: { iid: number; group_id: number } | null;
}

/** A group's epic before 17.7, as GitLab's REST API gives it. */
interface RestEpic {
  iid: number;
  group_id: number;
  title: string;
  state: "opened" | "closed";
  closed_at: string | null;
  web_url: string;
  references: { full: string };
}

interface Page<T> {
  pageInfo: { hasNextPage: boolean; endCursor: string };
  nodes: T[];
}

type GraphqlError = { message?: string; path?: (string | number)[] };

type Failure = CantAnswer | { kind: "not-found"; reason: string };

export function gitlab(deps: AdapterDeps): TrackerKind {
  const { cli, http, env } = deps;
  const tokenHost = hostGlabTakes(env);
  // glab sends its environment token to any host; it goes only to the one it was issued for.
  const glabAt = (host: string): Cli => (command, args) => cli(command, args, host === tokenHost ? [] : FOR_ONE_HOST);
  const envTokenFor = (host: string) => host === tokenHost && [...TOKEN_VARIABLES, "CI_JOB_TOKEN"].some((name) => env[name]);

  /** A host found only by probing is never read: it could be any server that answers like GitLab. */
  const trackerAt = (host: string, version: string | null, loginIsFor: boolean): Tracker => {
    const ctx: Ctx = { cli: glabAt(host), host, version, has: schemaOf(version) };
    return {
      product: PRODUCT,
      host,
      version,
      untested: untested(version),
      resolveProject: async (path) => (loginIsFor ? resolveProject(ctx, path) : noLogin(host)),
      viewer: async () => (loginIsFor ? viewer(ctx) : noLogin(host)),
      openIssues: async (project, after) => (loginIsFor ? openIssues(ctx, project, after) : noLogin(host)),
      changes: async (project, since, outside) => (loginIsFor ? changes(ctx, project, since, outside) : noLogin(host)),
      issue: async (locator) => (loginIsFor ? issue(ctx, locator) : noLogin(host)),
      capabilities: async (project) => (loginIsFor ? capabilities(ctx, project) : noLogin(host)),
      thread: async (locator) => (loginIsFor ? thread(ctx, locator) : noLogin(host)),
      assign: async (locator, viewer) => (loginIsFor ? assign(ctx, locator, viewer) : noLogin(host)),
      link: async (from, kind, to) => (loginIsFor ? link(ctx, from, kind, to) : noLogin(host)),
    };
  };

  return {
    product: PRODUCT,

    async recognise(host) {
      return host === "gitlab.com" || host.endsWith(".gitlab-dedicated.com") ? trackerAt(host, null, true) : null;
    },

    async probe(host): Promise<Identification> {
      const known = envTokenFor(host) || (await glabHasLoginFor(glabAt(host), host));
      // GitLab answers its API in its own JSON even anonymously, but gives its version only to a login.
      const answer = await http(`https://${host}/api/v4/version`);
      if (answer.kind === "unreachable") {
        return known
          ? { kind: "identified", tracker: trackerAt(host, null, true) }
          : { kind: "cant-tell", reason: `couldn't reach ${host} (${answer.reason})` };
      }
      const anonymousVersion = versionIn(answer.body);
      const isGitLab = anonymousVersion !== null || (answer.status === 401 && isGitLabUnauthorized(answer.body));
      if (!isGitLab && !known) return { kind: "not-this-kind" };
      const version = anonymousVersion ?? (known ? await versionWithLogin(glabAt(host), host) : null);
      return { kind: "identified", tracker: trackerAt(host, version, known) };
    },
  };
}

/**
 * The host `glab` takes the environment's token for: the one its host
 * variables name, most preferred first, or in CI with its auto-login on, the
 * job's server; else gitlab.com.
 */
function hostGlabTakes(env: AdapterDeps["env"]): string {
  const ci = env.GLAB_ENABLE_CI_AUTOLOGIN === "true" && env.GITLAB_CI === "true";
  const named = (ci ? [env.CI_SERVER_FQDN] : [env.GITLAB_HOST, env.GITLAB_URI, env.GL_HOST]).map(hostNamed).find((host) => host !== null);
  return named ?? "gitlab.com";
}

async function glabHasLoginFor(cli: Cli, host: string): Promise<boolean> {
  const answer = await cli("glab", ["auth", "status", "--hostname", host]);
  return answer.kind === "exited" && answer.code === 0;
}

async function versionWithLogin(cli: Cli, host: string): Promise<string | null> {
  const answer = await cli("glab", ["api", "--hostname", host, "version"]);
  return answer.kind === "exited" && answer.code === 0 ? versionIn(answer.stdout) : null;
}

function versionIn(text: string): string | null {
  const value = parse(text)?.version;
  return typeof value === "string" ? value : null;
}

function isGitLabUnauthorized(text: string): boolean {
  return parse(text)?.message === "401 Unauthorized";
}

/** What a GitLab of this version gives through GraphQL; one that states no version runs GitLab's latest. */
function schemaOf(version: string | null): Has {
  return Object.fromEntries(Object.entries(SINCE).map(([name, since]) => [name, version === null || atLeast(version, since)])) as Has;
}

/** Why the Map is untested on this GitLab, or `null` where it's tested (ADR 0003). */
function untested(version: string | null): string | null {
  return version === null || atLeast(version, TESTED_FROM) ? null : `GitLab ${version} is older than ${TESTED_FROM}, the oldest the Map is tested on`;
}

/** A Link's far end, as every read asks for it. */
function endFragment(ctx: Ctx): string {
  return `fragment end on WorkItem {
  id iid title webUrl state closedAt ${ctx.has.duplicatedTo ? "duplicatedToWorkItemUrl" : ""} reference(full: true)
  namespace { fullPath } workItemType { name }
}`;
}

/** What the Map reads of every work item, with the widgets this version has. */
function itemFragment(ctx: Ctx, extra = ""): string {
  const linked = ctx.has.duplicatedTo ? `... on WorkItemWidgetLinkedItems { linkedItems(first: 100) { nodes { linkType workItem { ...end } } } }` : "";
  const closing = ctx.has.closingMergeRequests
    ? `... on WorkItemWidgetDevelopment { closingMergeRequests(first: 10) { nodes { mergeRequest { reference(full: true) webUrl draft state author { username } } } } }`
    : "";
  return `fragment item on WorkItem {
  ...end createdAt updatedAt
  widgets {
    ... on WorkItemWidgetAssignees { assignees(first: 10) { nodes { username } } }
    ... on WorkItemWidgetMilestone { milestone { dueDate } }
    ... on WorkItemWidgetHierarchy { ${ctx.has.hasParent ? "hasParent" : ""} parent { ...end } children(first: 100) { nodes { ...end } } }
    ${linked}
    ${closing}
    ${extra}
  }
}
${endFragment(ctx)}`;
}

/** Whether the Project can record Blocks Links, asked alongside a read where the version can say. */
function blocksField(ctx: Ctx): string {
  return ctx.has.availableFeatures ? `namespace(fullPath: $path) { availableFeatures { hasBlockedIssuesFeature } }` : "";
}

function projectQuery(ctx: Ctx): string {
  return `query($path: ID!) {
  currentUser { username }
  project(fullPath: $path) { ...project ${ctx.has.forkedFrom ? "forkedFrom { ...project }" : ""} }
}
fragment project on Project { id fullPath webUrl issuesEnabled ${ctx.has.workItemCount ? "workItems(state: opened) { count }" : "openIssuesCount"} }`;
}

async function resolveProject(ctx: Ctx, path: string): Promise<ProjectResolution> {
  if (!path.includes("/")) return { kind: "not-found", reason: `${ctx.host}/${path} isn't a GitLab Project path` };
  const answer = await graphql(ctx, projectQuery(ctx), { path }, path);
  if ("kind" in answer) return answer;
  const found = answer.data.project as ProjectNode | null;
  if (!found) {
    // GraphQL finds a Project only by its current path; REST follows the old ones.
    const moved = await rest(ctx, `projects/${encodeURIComponent(path)}`, path);
    if ("kind" in moved) return moved;
    const current = (moved.json as { path_with_namespace?: string } | null)?.path_with_namespace;
    return current && current !== path ? resolveProject(ctx, current) : { kind: "not-found", reason: `no Project ${path} on ${ctx.host} that this login can see` };
  }
  const parent = ctx.has.forkedFrom ? (found.forkedFrom ?? null) : await forkedFrom(ctx, found.fullPath);
  if (parent && "kind" in parent) return parent;
  return { kind: "project", project: project(ctx.host, found), parent: parent ? project(ctx.host, parent) : null };
}

/** The Project this one was forked from, from REST, before GraphQL says (18.0). */
async function forkedFrom(ctx: Ctx, path: string): Promise<ProjectNode | CantAnswer | null> {
  const answer = await rest(ctx, `projects/${encodeURIComponent(path)}`, path);
  if ("kind" in answer) return answer.kind === "not-found" ? null : answer;
  const upstream = (answer.json as { forked_from_project?: { path_with_namespace: string } | null } | null)?.forked_from_project?.path_with_namespace;
  if (!upstream) return null;
  const read = await graphql(ctx, projectQuery(ctx), { path: upstream }, upstream);
  if ("kind" in read) return read.kind === "not-found" ? null : read;
  return read.data.project as ProjectNode | null;
}

async function viewer(ctx: Ctx): Promise<ViewerAnswer> {
  const answer = await graphql(ctx, VIEWER_QUERY, {}, "the viewer");
  if (!("kind" in answer)) return { kind: "viewer", login: (answer.data.currentUser as { username: string }).username };
  const cant: CantAnswer = answer.kind === "not-found" ? { kind: "cant-tell", reason: answer.reason } : answer;
  const held = await heldLogin(ctx);
  return held ? { ...cant, login: held } : cant;
}

/** The login `glab` holds for a host, from its own config, without the network. */
async function heldLogin(ctx: Ctx): Promise<string | null> {
  const answer = await ctx.cli("glab", ["config", "get", "user", "--host", ctx.host]);
  return answer.kind === "exited" && answer.code === 0 ? answer.stdout.trim() || null : null;
}

async function openIssues(ctx: Ctx, found: Project, after: string | null): Promise<IssuePage> {
  if (!ctx.has.workItems) return openIssuesFromRest(ctx, found, after);
  const first = after === null;
  const query = `query($path: ID!, $after: String) {
  currentUser { username }
  project(fullPath: $path) {
    userPermissions { readMergeRequest }
    workItems(state: opened, sort: CREATED_ASC, first: 100, after: $after) {
      ${ctx.has.workItemCount ? "count" : ""}
      pageInfo { hasNextPage endCursor }
      nodes { ...item }
    }
  }
  ${first ? blocksField(ctx) : ""}
}
${itemFragment(ctx)}`;
  const answer = await graphql(ctx, query, first ? { path: found.path } : { path: found.path, after }, found.path);
  if ("kind" in answer) return answer;
  const project = answer.data.project as { userPermissions: { readMergeRequest: boolean }; workItems: Page<ItemNode> & { count?: number } } | null;
  if (!project) return gone(ctx, found.path);
  const filled = await fillFromRest(ctx, found, project.workItems.nodes);
  if (filled) return filled;
  const unread = closingRequestsUnread(ctx, project.userPermissions, found.path);
  if (first) {
    const blocks = await readBlocksUnread(ctx, found.path, answer.data, unread);
    if (blocks) return blocks;
  }
  return {
    kind: "page",
    issues: project.workItems.nodes.map(openIssue),
    total: project.workItems.count ?? (found.issues === "off" ? 0 : found.issues.open),
    next: project.workItems.pageInfo.hasNextPage ? project.workItems.pageInfo.endCursor : null,
    unread,
  };
}

/**
 * Only what changed in a Project since `since`. GitLab marks a Link made or
 * removed on both Issues' update times, so the Project's work items,
 * newest update first, are read back until one older than `since`. A
 * merge request's closing Issues mark neither, so the merge requests
 * updated since are read too, and the Issues each closes.
 */
async function changes(ctx: Ctx, found: Project, since: string, outside: string[]): Promise<ChangesAnswer> {
  if (!ctx.has.workItems) return changesFromRest(ctx, found, since, outside);
  const changed = new Map<string, ItemNode>();
  const unread: Unread = {};
  let caughtUp = false;
  let after: string | null = null;
  for (let pages = 0; pages < REFRESH_PAGES && !caughtUp; pages++) {
    const query = `query($path: ID!, $after: String) {
  currentUser { username }
  project(fullPath: $path) {
    userPermissions { readMergeRequest }
    workItems(sort: UPDATED_DESC, first: 100, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { ...item }
    }
  }
}
${itemFragment(ctx)}`;
    const answer = await graphql(ctx, query, after === null ? { path: found.path } : { path: found.path, after }, found.path);
    if ("kind" in answer) return answer;
    const project = answer.data.project as { userPermissions: { readMergeRequest: boolean }; workItems: Page<ItemNode> } | null;
    if (!project) return gone(ctx, found.path);
    Object.assign(unread, closingRequestsUnread(ctx, project.userPermissions, found.path));
    for (const node of project.workItems.nodes) {
      if (Date.parse(node.updatedAt) < Date.parse(since)) {
        caughtUp = true;
        break;
      }
      changed.set(node.id, node);
    }
    caughtUp ||= !project.workItems.pageInfo.hasNextPage;
    after = project.workItems.pageInfo.endCursor;
  }
  // In a request of its own: beside a page of work items, it's past GitLab's complexity limit.
  const merges = await graphql(
    ctx,
    `query($path: ID!, $since: Time!) {
  currentUser { username }
  project(fullPath: $path) {
    mergeRequests(updatedAfter: $since, sort: UPDATED_DESC, first: 100) { pageInfo { hasNextPage endCursor } nodes { iid reference(full: true) } }
  }
}`,
    { path: found.path, since },
    found.path,
  );
  if ("kind" in merges) return merges;
  const mergeRequests = (merges.data.project as { mergeRequests: Page<{ iid: string; reference: string }> } | null)?.mergeRequests;
  if (!mergeRequests) return gone(ctx, found.path);
  const requests = mergeRequests.nodes.map((m) => m.reference);
  // More merge requests changed than one page holds, so some of the Issues they close may be missed.
  if (mergeRequests.pageInfo.hasNextPage) caughtUp = false;
  const closing = await closedBy(ctx, found, mergeRequests.nodes.map((m) => m.iid));
  if (!Array.isArray(closing)) return closing;
  const reread = closing.filter((iid) => ![...changed.values()].some((node) => node.iid === iid));
  if (reread.length > 0) {
    const read = await byIids(ctx, found.path, reread);
    if (!Array.isArray(read)) return read;
    for (const node of read) changed.set(node.id, node);
  }
  const filled = await fillFromRest(ctx, found, [...changed.values()].filter((node) => node.state === "OPEN"));
  if (filled) return filled;
  const ends = await readEnds(ctx, outside);
  if (!Array.isArray(ends)) return ends;
  const open: OpenIssue[] = [];
  for (const node of changed.values()) {
    if (node.state === "OPEN") open.push(openIssue(node));
    else ends.push(farEnd(node));
  }
  return { kind: "changes", open, ends, requests, caughtUp, unread };
}

/** The iids of the Project's Issues that these merge requests close, from REST, which alone says. */
async function closedBy(ctx: Ctx, found: Project, iids: string[]): Promise<string[] | Failure> {
  const projectId = numberIn(found.id);
  const closes = new Set<string>();
  for (const iid of iids) {
    const answer = await rest(ctx, `projects/${encodeURIComponent(found.path)}/merge_requests/${iid}/closes_issues`, found.path);
    if ("kind" in answer) return answer;
    for (const issue of Array.isArray(answer.json) ? (answer.json as { iid: number; project_id: number }[]) : []) {
      if (issue.project_id === projectId) closes.add(String(issue.iid));
    }
  }
  return [...closes];
}

/**
 * Work items of a Project by iid, read whole. A page of 100 asked for by
 * iid costs more than GitLab lets one query cost, so they're read 20 at a time.
 */
async function byIids(ctx: Ctx, path: string, iids: string[]): Promise<ItemNode[] | Failure> {
  const nodes: ItemNode[] = [];
  for (let at = 0; at < iids.length; at += IID_BATCH) {
    const batch = iids.slice(at, at + IID_BATCH);
    const query = `query($path: ID!) {
  project(fullPath: $path) { workItems(iids: ${JSON.stringify(batch)}, first: ${batch.length}) { nodes { ...item } } }
}
${itemFragment(ctx)}`;
    const answer = await graphql(ctx, query, { path }, path, false);
    if ("kind" in answer) return answer;
    const project = answer.data.project as { workItems: { nodes: ItemNode[] } } | null;
    if (!project) return gone(ctx, path);
    nodes.push(...project.workItems.nodes);
  }
  return nodes;
}

/**
 * Issues by identity as far ends: work items from GraphQL, epics before
 * 17.7 from REST. One that can't be found, or isn't GitLab's identity at
 * all, can't be read.
 */
async function readEnds(ctx: Ctx, ids: string[]): Promise<FarEnd[] | Failure> {
  const ends: FarEnd[] = [];
  for (let at = 0; at < ids.length; at += OUTSIDE_BATCH) {
    const batch = ids.slice(at, at + OUTSIDE_BATCH);
    const asked = batch.filter((id) => /^gid:\/\/gitlab\/WorkItem\/\d+$/.test(id));
    let data: Record<string, unknown> = {};
    if (asked.length > 0) {
      const query = `query {\n${asked.map((id, i) => `  o${i}: workItem(id: ${JSON.stringify(id)}) { ...end }`).join("\n")}\n}\n${endFragment(ctx)}`;
      const answer = await graphql(ctx, query, {}, "Outside Issues", false);
      if ("kind" in answer) return answer;
      data = answer.data;
    }
    for (const id of batch) {
      const epic = legacyEpicAt(id);
      const node = epic ? await readLegacyEpic(ctx, epic.group, epic.iid) : (data[`o${asked.indexOf(id)}`] as EndNode | null | undefined);
      if (node && "kind" in node) return node;
      ends.push(node ? farEnd(node) : { id, readable: false });
    }
  }
  return ends;
}

/** One Issue by its reference, `group/project#123` or `group&12`, or its URL on this host. */
async function issue(ctx: Ctx, locator: string): Promise<IssueAnswer> {
  const at = itemAt(ctx, locator);
  if ("kind" in at) return at;
  const { path, iid, inGroup } = at;
  if (inGroup && !ctx.has.epicWorkItems) return legacyEpicCard(ctx, path, iid, locator);
  if (!ctx.has.workItems) return issueFromRest(ctx, path, iid, locator);
  const notes = `... on WorkItemWidgetNotes { discussions(filter: ONLY_ACTIVITY, first: 100) { nodes { notes { nodes { body systemNoteMetadata { action } } } } } }`;
  const within = (container: string) => `query($path: ID!) {
  currentUser { username }
  ${container}(fullPath: $path) {
    ${container === "project" ? "id userPermissions { readMergeRequest }" : ""}
    workItems(iids: ${JSON.stringify([iid])}, first: 1) { nodes { ...item } }
  }
  ${blocksField(ctx)}
}
${itemFragment(ctx, notes)}`;
  const found = await workItemIn<{ id?: string; userPermissions?: { readMergeRequest: boolean }; workItems: { nodes: ItemNode[] } }>(ctx, path, inGroup, within);
  if ("kind" in found) return notFound(found, ctx, locator);
  const { answer, container } = found;
  const node = container?.workItems.nodes[0];
  if (!node) return { kind: "not-found", reason: `no Issue ${path}#${iid} on ${ctx.host} that this login can read` };
  const { id, userPermissions } = container!;
  if (id) {
    const filled = await fillFromRest(ctx, { path, id }, [node]);
    if (filled) return filled;
  }
  const unread: Unread = userPermissions ? closingRequestsUnread(ctx, userPermissions, path) : {};
  // Before 18.3 only a Project's Issues tell by REST whether it can record Blocks.
  const canTellBlocks = userPermissions !== undefined || ctx.has.availableFeatures;
  if (canTellBlocks) {
    const failed = await readBlocksUnread(ctx, path, answer.data, unread);
    if (failed) return failed;
  }
  const mentionedBy = await mentions(ctx, node);
  if (!Array.isArray(mentionedBy)) return mentionedBy;
  return card(node, mentionedBy, unread);
}

/** The Project or group and the iid `locator` names: a reference, `group/project#123` or `group&12`, or a URL on this host. */
function itemAt(ctx: Ctx, locator: string): { path: string; iid: string; inGroup: boolean } | { kind: "not-found"; reason: string } {
  const escaped = ctx.host.replaceAll(".", "\\.");
  const byUrl = new RegExp(`^https://${escaped}/(groups/)?(.+?)/-/(?:issues|work_items|epics)/(\\d+)/?(?:[?#].*)?$`).exec(locator);
  const byRef = /^([\w.-]+(?:\/[\w.-]+)*)([#&])(\d+)$/.exec(locator);
  if (!byUrl && !byRef) return { kind: "not-found", reason: `${locator} isn't a GitLab Issue's reference or URL on ${ctx.host}` };
  const [path, iid] = byUrl ? [byUrl[2]!, byUrl[3]!] : [byRef![1]!, byRef![3]!];
  return { path, iid, inGroup: byUrl ? !!byUrl[1] : byRef![2] === "&" };
}

/**
 * Asks `within` of the Project or group at `path`, as `inGroup` says; a
 * group's own Issue, such as an epic, has a `#` reference like any other
 * now, so a Project that isn't there is asked of as a group.
 */
async function workItemIn<T>(ctx: Ctx, path: string, inGroup: boolean, within: (container: "project" | "group") => string): Promise<{ answer: { data: Record<string, unknown> }; container: T | null } | Failure> {
  let answer = await graphql(ctx, within(inGroup ? "group" : "project"), { path }, path);
  if ("kind" in answer) return answer;
  let container = (inGroup ? answer.data.group : answer.data.project) as T | null;
  if (!container && !inGroup && ctx.has.epicWorkItems) {
    answer = await graphql(ctx, within("group"), { path }, path);
    if ("kind" in answer) return answer;
    container = answer.data.group as T | null;
  }
  return { answer, container };
}

/**
 * Need 8: one Issue's description and latest comments, from the work-item
 * GraphQL; before 16.0, or for an epic before it was a work item, from REST.
 * A comment's replies are comments too; the notes GitLab makes by itself,
 * such as a Mention, aren't.
 */
async function thread(ctx: Ctx, locator: string): Promise<ThreadAnswer> {
  const at = itemAt(ctx, locator);
  if ("kind" in at) return at;
  const { path, iid, inGroup } = at;
  if (inGroup && !ctx.has.epicWorkItems) return threadFromRest(ctx, `groups/${encodeURIComponent(path)}/epics/${iid}`, path, locator);
  if (!ctx.has.workItems) return threadFromRest(ctx, `projects/${encodeURIComponent(path)}/issues/${iid}`, path, locator);
  const within = (container: string) => `query($path: ID!) {
  currentUser { username }
  ${container}(fullPath: $path) {
    workItems(iids: ${JSON.stringify([iid])}, first: 1) {
      nodes {
        reference(full: true) title webUrl state
        widgets {
          ... on WorkItemWidgetDescription { description }
          ... on WorkItemWidgetNotes { discussions(filter: ONLY_COMMENTS, last: ${THREAD_COMMENTS}) { pageInfo { hasPreviousPage } nodes { notes { nodes { body createdAt author { username } } } } } }
        }
      }
    }
  }
}`;
  const found = await workItemIn<{ workItems: { nodes: ThreadNode[] } }>(ctx, path, inGroup, within);
  if ("kind" in found) return notFound(found, ctx, locator);
  const node = found.container?.workItems.nodes[0];
  if (!node) return { kind: "not-found", reason: `no Issue ${path}#${iid} on ${ctx.host} that this login can read` };
  const widgets = Object.assign({}, ...node.widgets) as ThreadWidgets;
  const notes = (widgets.discussions?.nodes ?? []).flatMap((d) => d.notes.nodes).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  return {
    kind: "thread",
    thread: {
      ref: node.reference,
      title: node.title,
      url: node.webUrl,
      open: node.state === "OPEN",
      body: widgets.description ?? "",
      comments: notes.slice(-THREAD_COMMENTS).map((n) => ({ author: n.author?.username ?? null, at: n.createdAt, body: n.body })),
      earlier: (widgets.discussions?.pageInfo.hasPreviousPage ?? false) || notes.length > THREAD_COMMENTS,
    },
  };
}

/** One Issue's thread from REST, at `base`: a Project's Issue, or a group's epic. Its newest page of notes is read, so there may be earlier comments when it's full. */
async function threadFromRest(ctx: Ctx, base: string, path: string, locator: string): Promise<ThreadAnswer> {
  const item = await rest(ctx, base, path);
  if ("kind" in item) return notFound(item, ctx, locator);
  const notes = await rest(ctx, `${base}/notes?sort=desc&order_by=created_at&per_page=${THREAD_COMMENTS}`, path);
  if ("kind" in notes) return notFound(notes, ctx, locator);
  const found = item.json as { title: string; web_url: string; state: string; description: string | null; references: { full: string } };
  const page = notes.json as { body: string; created_at: string; system: boolean; author: { username: string } | null }[];
  return {
    kind: "thread",
    thread: {
      ref: found.references.full,
      title: found.title,
      url: found.web_url,
      open: found.state === "opened",
      body: found.description ?? "",
      comments: page.filter((n) => !n.system).reverse().map((n) => ({ author: n.author?.username ?? null, at: n.created_at, body: n.body })),
      earlier: page.length === THREAD_COMMENTS,
    },
  };
}

interface ThreadNode {
  reference: string;
  title: string;
  webUrl: string;
  state: "OPEN" | "CLOSED";
  widgets: Partial<ThreadWidgets>[];
}

interface ThreadWidgets {
  description?: string | null;
  discussions?: { pageInfo: { hasPreviousPage: boolean }; nodes: { notes: { nodes: { body: string; createdAt: string; author: { username: string } | null }[] } }[] };
}

function card(node: ItemNode, mentionedBy: Mention[], unread: Unread): IssueAnswer {
  return {
    kind: "issue",
    issue: {
      id: node.id,
      project: node.namespace.fullPath,
      ref: node.reference,
      title: node.title,
      url: node.webUrl,
      open: node.state === "OPEN",
      assignees: (widgetsOf(node).assignees?.nodes ?? []).map((a) => a.username),
      closedAs: node.state === "CLOSED" ? (closedAs(node) ?? null) : null,
      links: linksOf(node),
      closingRequests: closingRequests(node),
      mentionedBy,
      unread,
    },
  };
}

/**
 * Need 11, from GraphQL, which adds the viewer to the Issue's assignees by
 * name and answers with them all. GitLab refuses an Issue that doesn't
 * exist and a write this login may not make in the same words, so a read
 * then tells them apart. An epic isn't assigned.
 */
async function assign(ctx: Ctx, locator: string, viewer: string): Promise<AssignAnswer> {
  const escaped = ctx.host.replaceAll(".", "\\.");
  const found = new RegExp(`^https://${escaped}/(?!groups/)(.+?)/-/(?:issues|work_items)/(\\d+)/?(?:[?#].*)?$`).exec(locator) ?? /^([\w.-]+(?:\/[\w.-]+)+)#(\d+)$/.exec(locator);
  if (!found) return { kind: "not-found", reason: `${locator} isn't a GitLab Issue's reference or URL in a Project on ${ctx.host}` };
  const [, path = "", iid = ""] = found;
  const ref = `${path}#${iid}`;
  const mutation = `mutation($path: ID!, $iid: String!, $viewer: String!) {
  issueSetAssignees(input: {projectPath: $path, iid: $iid, assigneeUsernames: [$viewer], operationMode: APPEND}) {
    issue { assignees { nodes { username } } }
    errors
  }
}`;
  const answer = await ctx.cli("glab", ["api", "--hostname", ctx.host, "graphql", "-f", `query=${mutation}`, "-f", `path=${path}`, "-f", `iid=${iid}`, "-f", `viewer=${viewer}`]);
  if (answer.kind === "missing") return glabMissing(ctx.host);
  // A token that may only read is refused every mutation, before GitLab looks at the Issue.
  if (/insufficient_scope/.test(`${answer.stdout}\n${answer.stderr}`)) {
    return { kind: "not-allowed", reason: `this login's token can't write: it has no \`api\` scope — run \`glab auth login --hostname ${ctx.host}\` with a token that has it` };
  }
  const body = parse(answer.stdout);
  const set = (body?.data as { issueSetAssignees?: { issue: { assignees: { nodes: { username: string }[] } } | null; errors: string[] } | null } | null | undefined)?.issueSetAssignees;
  if (set?.errors.length) return { kind: "not-allowed", reason: `GitLab refused to assign ${ref}: ${set.errors.join("; ")}` };
  if (set?.issue) {
    const assignees = set.issue.assignees.nodes.map((a) => a.username);
    if (assignees.includes(viewer)) return { kind: "assigned", assignees };
    return { kind: "not-allowed", reason: `GitLab didn't assign ${ref} to ${viewer}` };
  }
  const errors = (body?.errors ?? []) as GraphqlError[];
  if (!body?.data || !errors.some((e) => e.path?.[0] === "issueSetAssignees")) return failure(ctx, answer, body, path);
  const read = await graphql(ctx, `query($path: ID!) {\n  currentUser { username }\n  project(fullPath: $path) { issue(iid: ${JSON.stringify(iid)}) { id } }\n}`, { path }, path);
  const gone: AssignAnswer = { kind: "not-found", reason: `no Issue ${ref} on ${ctx.host} that this login can read` };
  if ("kind" in read) return read.kind === "not-found" ? gone : read;
  if (!(read.data.project as { issue: { id: string } | null } | null)?.issue) return gone;
  return { kind: "not-allowed", reason: `GitLab refused to let this login assign ${ref}: assigning in ${path} takes at least the Reporter role` };
}

/** A Link end as need 10 reads it: its identity, and the Parent it has. */
interface LinkEnd {
  id: string;
  reference: string;
  widgets: { parent?: { id: string; reference: string } | null }[];
}

/**
 * Need 10. Blocks and Related Links are written through REST, between a
 * Project's Issues, from the one at `from`; GitLab answers with the kind it
 * recorded. A Parent is written through the work-item GraphQL once both
 * ends are read, so the far end is never moved from a Parent it has, which
 * GitLab itself would do; before 17.7 an epic isn't a work item, and isn't
 * written to.
 */
async function link(ctx: Ctx, from: string, kind: LinkKind, to: string): Promise<LinkAnswer> {
  const [a, b] = [itemAt(ctx, from), itemAt(ctx, to)];
  if ("kind" in a) return a;
  if ("kind" in b) return b;
  const [fromRef, toRef] = [`${a.path}#${a.iid}`, `${b.path}#${b.iid}`];
  const tokenReads = (answer: Extract<CliResult, { kind: "exited" }>): LinkAnswer | null =>
    /insufficient_scope/.test(`${answer.stdout}\n${answer.stderr}`)
      ? { kind: "not-allowed", reason: `this login's token can't write: it has no \`api\` scope — run \`glab auth login --hostname ${ctx.host}\` with a token that has it` }
      : null;
  const refused = (path: string): LinkAnswer => ({
    kind: "not-allowed",
    reason: `GitLab refused to let this login link ${fromRef} to ${toRef}: it takes at least the ${ctx.version === null || atLeast(ctx.version, GUEST_WRITES_LINKS) ? "Guest" : "Reporter"} role in ${path}`,
  });

  if (kind !== "parent") {
    const grouped = a.inGroup ? fromRef : b.inGroup ? toRef : null;
    if (grouped) return { kind: "cant-record", reason: `the Map writes Blocks and Related Links only between Projects' Issues, and ${grouped} is a group's` };
    const type = kind === "blocks" ? "blocks" : "relates_to";
    const endpoint = `projects/${encodeURIComponent(a.path)}/issues/${a.iid}/links`;
    const answer = await ctx.cli("glab", ["api", "--hostname", ctx.host, endpoint, "--method", "POST", "-f", `target_project_id=${b.path}`, "-f", `target_issue_iid=${b.iid}`, "-f", `link_type=${type}`]);
    if (answer.kind === "missing") return glabMissing(ctx.host);
    const scope = tokenReads(answer);
    if (scope) return scope;
    const body = parse(answer.stdout);
    if (answer.code === 0) {
      if (body?.link_type === type) return { kind: "linked" };
      return { kind: "not-allowed", reason: `GitLab recorded ${fromRef} and ${toRef} as ${LINK_NAMES[String(body?.link_type)] ?? String(body?.link_type)} rather than ${LINK_NAMES[type]}` };
    }
    const said = `${answer.stdout}\n${answer.stderr}`;
    // GitLab keeps one Link between two Issues, whatever its type, so the one there may not be this.
    if (/\b409\b|already assigned/i.test(said)) return { kind: "cant-record", reason: `${fromRef} and ${toRef} are already Linked, and GitLab keeps one Link between two Issues` };
    if (/\b404\b/.test(said)) return { kind: "not-found", reason: `no Issue ${fromRef} or ${toRef} on ${ctx.host} that this login can read` };
    if (/\b403\b/.test(said)) return refused(a.path);
    return failure(ctx, answer, body, a.path);
  }

  if (!ctx.has.workItems) return { kind: "cant-record", reason: `GitLab ${ctx.version} writes a Parent only from ${SINCE.workItems}` };
  const epic = a.inGroup ? fromRef : b.inGroup ? toRef : null;
  if (epic && !ctx.has.epicWorkItems) return { kind: "cant-record", reason: `GitLab ${ctx.version} keeps ${epic}, a group's epic, apart from work items until ${SINCE.epicWorkItems}, and the Map doesn't write it` };
  const ends: LinkEnd[] = [];
  for (const [at, ref] of [[a, fromRef], [b, toRef]] as const) {
    const within = (container: string) => `query($path: ID!) {
  currentUser { username }
  ${container}(fullPath: $path) {
    workItems(iids: ${JSON.stringify([at.iid])}, first: 1) { nodes { id reference(full: true) widgets { ... on WorkItemWidgetHierarchy { parent { id reference(full: true) } } } } }
  }
}`;
    const found = await workItemIn<{ workItems: { nodes: LinkEnd[] } }>(ctx, at.path, at.inGroup, within);
    if ("kind" in found) return notFound(found, ctx, ref);
    const node = found.container?.workItems.nodes[0];
    if (!node) return { kind: "not-found", reason: `no Issue ${ref} on ${ctx.host} that this login can read` };
    ends.push(node);
  }
  const [parent, child] = ends as [LinkEnd, LinkEnd];
  const has = Object.assign({}, ...child.widgets).parent as LinkEnd["widgets"][number]["parent"];
  if (has) {
    if (has.id === parent.id) return { kind: "linked" };
    return { kind: "not-allowed", reason: `${toRef} already has a Parent, ${has.reference}, and the Map never moves an Issue from its Parent` };
  }
  const mutation = `mutation($id: WorkItemID!, $parent: WorkItemID!) {
  workItemUpdate(input: {id: $id, hierarchyWidget: {parentId: $parent}}) { workItem { id } errors }
}`;
  const answer = await ctx.cli("glab", ["api", "--hostname", ctx.host, "graphql", "-f", `query=${mutation}`, "-f", `id=${child.id}`, "-f", `parent=${parent.id}`]);
  if (answer.kind === "missing") return glabMissing(ctx.host);
  const scope = tokenReads(answer);
  if (scope) return scope;
  const body = parse(answer.stdout);
  const update = (body?.data as { workItemUpdate?: { workItem: { id: string } | null; errors: string[] } | null } | null | undefined)?.workItemUpdate;
  if (update?.errors.length) return { kind: "not-allowed", reason: `GitLab refused to put ${toRef} under ${fromRef}: ${update.errors.join("; ")}` };
  if (update?.workItem) return { kind: "linked" };
  // Both ends were just read, so a refusal at the mutation is of the write.
  if (((body?.errors ?? []) as GraphqlError[]).some((e) => e.path?.[0] === "workItemUpdate")) return refused(b.path);
  return failure(ctx, answer, body, b.path);
}

function notFound(answer: Failure, ctx: Ctx, locator: string): Failure {
  return answer.kind === "not-found" ? { kind: "not-found", reason: `no Issue ${locator} on ${ctx.host} that this login can read` } : answer;
}

/**
 * The identities of the Issues whose text names this one. GitLab notes a
 * Mention on the Issue named, as "mentioned in issue #12"; only the first
 * 100 notes of its activity are read, and merge requests and commits that
 * name it aren't Issues.
 */
async function mentions(ctx: Ctx, node: ItemNode): Promise<Mention[] | Failure> {
  const notes = (widgetsOf(node).discussions?.nodes ?? []).flatMap((discussion) => discussion.notes.nodes);
  const refs = notes.flatMap((note) => {
    if (note.systemNoteMetadata?.action !== "cross_reference") return [];
    const ref = /^mentioned in (?!merge request|commit)[\w ]*? (\S+)$/.exec(note.body.trim())?.[1];
    return ref ? [ref] : [];
  });
  if (refs.length === 0 || !ctx.has.workItemsByReference) return [];
  const context = node.namespace.fullPath;
  const query = `query {\n  workItemsByReference(contextNamespacePath: ${JSON.stringify(context)}, refs: ${JSON.stringify(refs)}) { nodes { id reference(full: true) } }\n}`;
  const answer = await graphql(ctx, query, {}, context, false);
  if ("kind" in answer) return answer;
  return ((answer.data.workItemsByReference as { nodes: ({ id: string; reference: string } | null)[] } | null)?.nodes ?? []).flatMap((n) => (n ? [{ id: n.id, ref: n.reference }] : []));
}

/** Need 5 for Blocks, into `unread`: nothing where the Project can record them, else why not. */
async function readBlocksUnread(ctx: Ctx, path: string, data: Record<string, unknown>, unread: Unread): Promise<Failure | undefined> {
  const blocks = await blocksAnswer(ctx, path, data);
  if (blocks.kind === "readable") return undefined;
  if (blocks.kind === "cant-record" || blocks.kind === "cant-read") unread.blocks = blocks.reason;
  else return blocks;
  return undefined;
}

/** Need 5 for Blocks: whether the Project can record them, from `blocksField` where the version says. */
async function blocksAnswer(ctx: Ctx, path: string, data: Record<string, unknown>): Promise<KindAnswer | Failure> {
  if (ctx.has.availableFeatures) {
    const recordable = (data.namespace as { availableFeatures?: { hasBlockedIssuesFeature?: boolean } } | null)?.availableFeatures?.hasBlockedIssuesFeature;
    if (recordable === undefined) return { kind: "cant-read", reason: `GitLab doesn't say whether ${path} can record Blocks Links` };
    return recordable ? { kind: "readable" } : { kind: "cant-record", reason: CANT_RECORD_BLOCKS };
  }
  // Before 18.3, REST gives an Issue's `weight` only where the tier that records Blocks Links is licensed (ADR 0003).
  const answer = await rest(ctx, `projects/${encodeURIComponent(path)}/issues?per_page=1&issue_type=issue`, path);
  if ("kind" in answer) return answer;
  const [first] = Array.isArray(answer.json) ? (answer.json as Record<string, unknown>[]) : [];
  if (!first) return { kind: "cant-read", reason: `GitLab ${ctx.version} doesn't say whether ${path} can record Blocks Links, and it has no Issue to tell by` };
  return "weight" in first ? { kind: "readable" } : { kind: "cant-record", reason: CANT_RECORD_BLOCKS };
}

/**
 * Needs 5 and 9: which Link kinds the Map reads in this Project, and
 * whether this login can write one. Before 13.4 it reads none; before 16.0,
 * no task's Parent.
 */
async function capabilities(ctx: Ctx, found: Project): Promise<CapabilitiesAnswer> {
  const query = `query($path: ID!) {
  currentUser { username }
  project(fullPath: $path) { id ${ctx.has.maxAccessLevel ? "maxAccessLevel { integerValue }" : ""} }
  ${blocksField(ctx)}
}`;
  const answer = await graphql(ctx, query, { path: found.path }, found.path);
  if ("kind" in answer) return answer;
  const project = answer.data.project as { maxAccessLevel?: { integerValue: number } } | null;
  if (!project) return gone(ctx, found.path);
  const blocks = await blocksAnswer(ctx, found.path, answer.data);
  if (!isKindAnswer(blocks)) return blocks;
  const write = await writes(ctx, found.path, project.maxAccessLevel?.integerValue);
  const { version } = ctx;
  if (version !== null && !atLeast(version, READS_FROM)) {
    const none: KindAnswer = { kind: "cant-read", reason: `GitLab ${version} is older than ${READS_FROM}, the oldest the Map reads` };
    return { kind: "capabilities", links: { blocks: none, parent: none, related: none }, write };
  }
  const parent: KindAnswer = ctx.has.workItems
    ? { kind: "readable" }
    : { kind: "cant-read", reason: `GitLab ${version} doesn't say which Issue a task is in, so the Map reads only the epic an Issue is in` };
  return { kind: "capabilities", links: { blocks, parent, related: { kind: "readable" } } satisfies Record<LinkKind, KindAnswer>, write };
}

function isKindAnswer(answer: KindAnswer | Failure): answer is KindAnswer {
  return answer.kind === "readable" || answer.kind === "cant-record" || answer.kind === "cant-read";
}

/**
 * Need 9: whether this login's role in the Project and its token both let
 * it write a Link. The role comes from GraphQL from 16.9, before from REST;
 * what the token may do, only where it's a personal access token, from 15.5.
 * Where GitLab doesn't answer, it can't be told: only a write needs it.
 */
async function writes(ctx: Ctx, path: string, level: number | undefined): Promise<WriteAnswer> {
  const role = await roleIn(ctx, path, level);
  if (role.kind === "cant") return role;
  const token = await tokenWrites(ctx);
  if (token.kind === "cant") return token;
  return role.kind === "cant-tell" ? role : token;
}

async function roleIn(ctx: Ctx, path: string, level: number | undefined): Promise<WriteAnswer> {
  const guest = ctx.version === null || atLeast(ctx.version, GUEST_WRITES_LINKS);
  let held = level;
  if (held === undefined) {
    const answer = await rest(ctx, `projects/${encodeURIComponent(path)}`, path);
    if ("kind" in answer) return cantTell(`GitLab didn't say this login's role in ${path}: ${answer.reason}`);
    const { permissions } = answer.json as { permissions?: Record<"project_access" | "group_access", { access_level: number } | null> };
    const levels = [permissions?.project_access, permissions?.group_access].flatMap((access) => (access ? [access.access_level] : []));
    // REST names a role held in the Project or its own group, but not one through a group the Project is shared with.
    if (levels.length === 0) return cantTell(`GitLab ${ctx.version} names no role this login has in ${path}, and wouldn't name one it has through a shared group`);
    held = Math.max(...levels);
  }
  if (held >= (guest ? GUEST : REPORTER)) return { kind: "can" };
  return { kind: "cant", reason: `this login can only read ${path}: writing a Link there takes the ${guest ? "Guest" : "Reporter"} role` };
}

/** Whether this login's token may write; GitLab says only of a personal access token, from 15.5. */
async function tokenWrites(ctx: Ctx): Promise<WriteAnswer> {
  if (ctx.version !== null && !atLeast(ctx.version, TOKEN_SCOPES)) return cantTell(`GitLab ${ctx.version} doesn't say what this login's token may write`);
  const answer = await rest(ctx, "personal_access_tokens/self", "this login's token");
  // It answers only for a personal access token, not for glab's OAuth login or a CI job's token.
  if ("kind" in answer) return cantTell("GitLab says what a token may write only of a personal access token, and this login's token isn't one");
  const scopes = (answer.json as { scopes?: string[] } | null)?.scopes ?? [];
  if (scopes.includes("api")) return { kind: "can" };
  return { kind: "cant", reason: `this login's token can't write: it has no \`api\` scope — run \`glab auth login --hostname ${ctx.host}\` with a token that has it` };
}

function cantTell(reason: string): WriteAnswer {
  return { kind: "cant-tell", reason };
}

function closingRequestsUnread(ctx: Ctx, permissions: { readMergeRequest: boolean }, path: string): Unread {
  if (!ctx.has.closingMergeRequests) return { closingRequests: `GitLab ${ctx.version} doesn't list merge requests with the Issues they close` };
  return permissions.readMergeRequest ? {} : { closingRequests: `this login can't read merge requests in ${path}` };
}

/**
 * What an older GitLab's GraphQL leaves out, filled in from REST: before
 * 17.8, Blocks and Related Links, an Issue at a time, with the Issue each
 * closed as a duplicate of; before 17.7, the epic each Issue is in, as its
 * Parent.
 */
async function fillFromRest(ctx: Ctx, project: { path: string; id: string }, nodes: ItemNode[]): Promise<Failure | undefined> {
  if (!ctx.has.epicWorkItems && nodes.length > 0) {
    const epics = await epicsOf(ctx, project.path, nodes);
    if (!(epics instanceof Map)) return epics;
    for (const node of nodes) {
      const epic = epics.get(node.iid);
      if (epic && !widgetsOf(node).parent) node.widgets.push({ parent: epic });
    }
  }
  const unlinked = nodes.filter((node) => !widgetsOf(node).linkedItems);
  for (let at = 0; at < unlinked.length; at += REST_AT_ONCE) {
    const turn = unlinked.slice(at, at + REST_AT_ONCE);
    const answers = await Promise.all(turn.map((node) => rest(ctx, `projects/${encodeURIComponent(project.path)}/issues/${node.iid}/links`, project.path)));
    for (const [i, answer] of answers.entries()) {
      if ("kind" in answer) return answer;
      const node = turn[i]!;
      // REST names the Issue a duplicate closed as a duplicate of by its API address.
      const self = `/projects/${numberIn(project.id)}/issues/${node.iid}`;
      const linked = (answer.json as RestIssue[]).map((issue) => {
        const end = restEnd(issue);
        return { linkType: issue.link_type ?? "relates_to", workItem: end.duplicatedToWorkItemUrl?.endsWith(self) ? { ...end, duplicatedToWorkItemUrl: node.webUrl } : end };
      });
      node.widgets.push({ linkedItems: { nodes: linked } });
    }
  }
  return undefined;
}

/** The epic each of these Issues is in before 17.7, by iid, from REST, which gives it only where the tier has epics. */
async function epicsOf(ctx: Ctx, path: string, nodes: ItemNode[]): Promise<Map<string, EndNode> | Failure> {
  const epics = new Map<string, EndNode>();
  const read = new Map<string, EndNode | null>();
  for (let at = 0; at < nodes.length; at += 100) {
    const iids = nodes.slice(at, at + 100).map((node) => `iids[]=${node.iid}`).join("&");
    const answer = await rest(ctx, `projects/${encodeURIComponent(path)}/issues?${iids}&per_page=100`, path);
    if ("kind" in answer) return answer;
    for (const issue of answer.json as RestIssue[]) {
      if (!issue.epic) continue;
      const id = legacyEpicId(issue.epic.group_id, issue.epic.iid);
      if (!read.has(id)) {
        const epic = await readLegacyEpic(ctx, issue.epic.group_id, issue.epic.iid);
        if (epic && "kind" in epic) return epic;
        read.set(id, epic);
      }
      const epic = read.get(id);
      if (epic) epics.set(String(issue.iid), epic);
    }
  }
  return epics;
}

/**
 * An epic's identity before 17.7, when it isn't a work item: its group's and
 * its own number, which are what REST reads it again by.
 */
function legacyEpicId(group: number, iid: number): string {
  return `legacy-epic:${group}&${iid}`;
}

function legacyEpicAt(id: string): { group: number; iid: number } | null {
  const match = /^legacy-epic:(\d+)&(\d+)$/.exec(id);
  return match ? { group: Number(match[1]), iid: Number(match[2]) } : null;
}

/** An epic before 17.7 as a far end, from REST; `null` where this login can't read it. */
async function readLegacyEpic(ctx: Ctx, group: number | string, iid: number): Promise<EndNode | Failure | null> {
  const answer = await rest(ctx, `groups/${encodeURIComponent(String(group))}/epics/${iid}`, `${group}&${iid}`);
  if ("kind" in answer) return answer.kind === "not-found" ? null : answer;
  const epic = answer.json as RestEpic;
  return {
    id: legacyEpicId(epic.group_id, epic.iid),
    iid: String(epic.iid),
    title: epic.title,
    webUrl: epic.web_url,
    state: epic.state === "opened" ? "OPEN" : "CLOSED",
    closedAt: epic.closed_at,
    reference: epic.references.full,
    namespace: { fullPath: epic.references.full.replace(/&\d+$/, "") },
    workItemType: { name: "Epic" },
  };
}

/** A group's epic before 17.7, for its card, from REST: the Issues in it are the Links read. */
async function legacyEpicCard(ctx: Ctx, group: string, iid: string, locator: string): Promise<IssueAnswer> {
  const epic = await readLegacyEpic(ctx, group, Number(iid));
  if (epic === null) return { kind: "not-found", reason: `no Issue ${locator} on ${ctx.host} that this login can read` };
  if ("kind" in epic) return epic;
  const children = await rest(ctx, `groups/${encodeURIComponent(group)}/epics/${iid}/issues?per_page=100`, locator);
  if ("kind" in children) return notFound(children, ctx, locator);
  return {
    kind: "issue",
    issue: {
      id: epic.id,
      project: epic.namespace.fullPath,
      ref: epic.reference,
      title: epic.title,
      url: epic.webUrl,
      open: epic.state === "OPEN",
      // A legacy epic has no assignees.
      assignees: [],
      closedAs: null,
      links: (children.json as RestIssue[]).map((child): NamedLink => ({ role: "child", name: "Child items", to: farEnd(restEnd(child)) })),
      closingRequests: [],
      mentionedBy: [],
      unread: { blocks: `GitLab ${ctx.version} keeps epics apart from Issues, and the Map doesn't read the Links between epics` },
    },
  };
}

/** An Issue as GitLab's REST API gives it, with what the Map reads of an Issue in the Project. */
interface RestItem extends RestIssue {
  project_id: number;
  created_at: string;
  updated_at: string;
  assignees: { username: string }[];
  milestone: { due_date: string | null } | null;
}

/** Issues REST gives in one page. */
const REST_PAGE = 100;

/**
 * Before 16.0 Issues are read from REST, oldest first, a page by its
 * number; their Links and the epic each is in are filled in as for an
 * older GitLab's GraphQL. A task's Parent isn't read.
 */
async function openIssuesFromRest(ctx: Ctx, found: Project, after: string | null): Promise<IssuePage> {
  const page = after === null ? 1 : Number(after);
  const read = await restItems(ctx, found, `state=opened&order_by=created_at&sort=asc&page=${page}`);
  if (!Array.isArray(read)) return read;
  const unread = closingRequestsUnread(ctx, { readMergeRequest: true }, found.path);
  if (page === 1) {
    const blocks = await readBlocksUnread(ctx, found.path, {}, unread);
    if (blocks) return blocks;
  }
  return {
    kind: "page",
    issues: read.map(openIssue),
    total: found.issues === "off" ? 0 : found.issues.open,
    next: read.length === REST_PAGE ? String(page + 1) : null,
    unread,
  };
}

/**
 * What changed since `since`, from REST before 16.0: the Issues updated
 * since, oldest update first, so that one updated during the read moves
 * later, not past the page being read.
 */
async function changesFromRest(ctx: Ctx, found: Project, since: string, outside: string[]): Promise<ChangesAnswer> {
  const changed: ItemNode[] = [];
  let caughtUp = false;
  for (let page = 1; page <= REFRESH_PAGES && !caughtUp; page++) {
    const read = await restItems(ctx, found, `updated_after=${encodeURIComponent(since)}&order_by=updated_at&sort=asc&page=${page}`, (node) => node.state === "OPEN");
    if (!Array.isArray(read)) return read;
    changed.push(...read);
    caughtUp = read.length < REST_PAGE;
  }
  const ends = await readEnds(ctx, outside);
  if (!Array.isArray(ends)) return ends;
  const open = changed.filter((node) => node.state === "OPEN");
  ends.push(...changed.filter((node) => node.state !== "OPEN").map(farEnd));
  // No merge request is read with the Issues it closes before 17.1, so none is named as changed.
  return { kind: "changes", open: open.map(openIssue), ends, requests: [], caughtUp, unread: closingRequestsUnread(ctx, { readMergeRequest: true }, found.path) };
}

/** One Issue of a Project from REST before 16.0, with no Mentions: only its notes name them. */
async function issueFromRest(ctx: Ctx, path: string, iid: string, locator: string): Promise<IssueAnswer> {
  const answer = await rest(ctx, `projects/${encodeURIComponent(path)}/issues/${iid}`, path);
  if ("kind" in answer) return notFound(answer, ctx, locator);
  const found = answer.json as RestItem;
  const node = restItem(found);
  const filled = await fillFromRest(ctx, { path, id: String(found.project_id) }, [node]);
  if (filled) return filled;
  const unread = closingRequestsUnread(ctx, { readMergeRequest: true }, path);
  const failed = await readBlocksUnread(ctx, path, {}, unread);
  if (failed) return failed;
  return card(node, [], unread);
}

/** A page of a Project's Issues from REST, as work items, with the Links of those `fill` picks filled in. */
async function restItems(ctx: Ctx, found: Project, params: string, fill: (node: ItemNode) => boolean = () => true): Promise<ItemNode[] | Failure> {
  const answer = await rest(ctx, `projects/${encodeURIComponent(found.path)}/issues?${params}&per_page=${REST_PAGE}`, found.path);
  if ("kind" in answer) return answer;
  const nodes = (answer.json as RestItem[]).map(restItem);
  const filled = await fillFromRest(ctx, found, nodes.filter(fill));
  return filled ?? nodes;
}

/** An Issue from REST as GitLab's GraphQL gives a work item, before its Links are filled in. */
function restItem(issue: RestItem): ItemNode {
  return {
    ...restEnd(issue),
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    widgets: [{ assignees: { nodes: issue.assignees.map(({ username }) => ({ username })) } }, { milestone: issue.milestone && { dueDate: issue.milestone.due_date } }],
  };
}

/** An Issue as REST gives it, as a far end; a duplicate names the Issue it duplicates by its API address. */
function restEnd(issue: RestIssue): EndNode {
  return {
    id: `gid://gitlab/WorkItem/${issue.id}`,
    iid: String(issue.iid),
    title: issue.title,
    webUrl: issue.web_url,
    state: issue.state === "opened" ? "OPEN" : "CLOSED",
    closedAt: issue.closed_at,
    duplicatedToWorkItemUrl: issue._links?.closed_as_duplicate_of ?? null,
    reference: issue.references.full,
    namespace: { fullPath: issue.references.full.replace(/#\d+$/, "") },
    workItemType: { name: issue.issue_type === "task" ? "Task" : "Issue" },
  };
}

function widgetsOf(node: ItemNode): Widgets {
  return Object.assign({}, ...node.widgets) as Widgets;
}

const LINK_NAMES = { relates_to: "Relates to", blocks: "Blocks", is_blocked_by: "Blocked by" } as Record<string, string>;

/**
 * Each Link under GitLab's own name for its kind. A kind GitLab adds later
 * counts as Related and keeps its name. `/duplicate` relates the two
 * Issues as well as closing one, and that is no Link.
 */
function linksOf(node: ItemNode): NamedLink[] {
  const widgets = widgetsOf(node);
  const links: NamedLink[] = [];
  const seen = new Set<string>();
  const add = (role: NamedLink["role"], name: string, to: FarEnd) => {
    if (seen.has(`${role} ${to.id}`)) return;
    seen.add(`${role} ${to.id}`);
    links.push({ role, name, to });
  };
  if (widgets.parent) add("parent", "Parent", farEnd(widgets.parent));
  else if (widgets.hasParent) add("parent", "Parent", { id: `${node.id}/parent`, readable: false });
  for (const child of widgets.children?.nodes ?? []) if (child) add("child", "Child items", farEnd(child));
  (widgets.linkedItems?.nodes ?? []).forEach(({ linkType, workItem }, index) => {
    if (linkType === "relates_to" && workItem && (workItem.duplicatedToWorkItemUrl === node.webUrl || node.duplicatedToWorkItemUrl === workItem.webUrl)) return;
    const role = linkType === "blocks" ? "blocked" : linkType === "is_blocked_by" ? "blocker" : "related";
    add(role, LINK_NAMES[linkType] ?? linkType, workItem ? farEnd(workItem) : { id: `${node.id}/linked/${index}`, readable: false });
  });
  return links;
}

/** A Link's far end this login can read; once closed, with when and, where GitLab says, how. */
function farEnd(end: EndNode): FarEnd {
  const how = end.state === "CLOSED" ? closedAs(end) : undefined;
  return {
    id: end.id,
    readable: true,
    open: end.state === "OPEN",
    project: end.namespace.fullPath,
    ref: end.reference,
    title: end.title,
    url: end.webUrl,
    ...(end.state === "CLOSED" && end.closedAt ? { closedAt: end.closedAt } : {}),
    ...(how ? { closedAs: how } : {}),
    // Before 17.8 REST names the duplicated Issue only by its API address, which isn't one users type.
    ...(how && !/\/api\/v4\//.test(end.duplicatedToWorkItemUrl!) ? { duplicateOf: end.duplicatedToWorkItemUrl! } : {}),
  };
}

/** GitLab says how an Issue closed only when it closed as a duplicate. */
function closedAs(end: EndNode): string | undefined {
  return end.duplicatedToWorkItemUrl ? "duplicate" : undefined;
}

function openIssue(node: ItemNode): OpenIssue {
  const widgets = widgetsOf(node);
  const due = widgets.milestone?.dueDate;
  return {
    id: node.id,
    ref: `#${node.iid}`,
    title: node.title,
    url: node.webUrl,
    createdAt: node.createdAt,
    assignees: (widgets.assignees?.nodes ?? []).map((a) => a.username),
    planned: due ? new Date(due).toISOString() : null,
    taskLevel: node.workItemType.name === "Task",
    links: linksOf(node).map(({ role, to }) => ({ role, to })),
    closingRequests: closingRequests(node),
  };
}

function closingRequests(node: ItemNode): ClosingRequest[] {
  return (widgetsOf(node).closingMergeRequests?.nodes ?? []).flatMap((n): ClosingRequest[] => {
    const request = n?.mergeRequest;
    return request?.state === "opened" ? [{ ref: request.reference, url: request.webUrl, draft: request.draft, author: request.author?.username ?? "ghost" }] : [];
  });
}

function project(host: string, node: ProjectNode): Project {
  return {
    id: `${host}#${numberIn(node.id)}`,
    host,
    path: node.fullPath,
    url: node.webUrl,
    issues: node.issuesEnabled ? { open: node.workItems?.count ?? node.openIssuesCount ?? 0 } : "off",
  };
}

/** The number a GitLab identity ends in, such as a Project's in `gid://gitlab/Project/12` or `gitlab.com#12`. */
function numberIn(id: string): number {
  return Number(/(\d+)$/.exec(id)?.[1]);
}

function gone(ctx: Ctx, path: string): Failure {
  return { kind: "not-found", reason: `no Project ${path} on ${ctx.host} that this login can see` };
}

/**
 * One GraphQL request through `glab api`. It answers with the data, or with
 * why it couldn't: a login GitLab doesn't know reads as no user at all.
 * Errors below the top of the answer, for what this login can't read, leave
 * the rest standing.
 */
async function graphql(ctx: Ctx, query: string, variables: Record<string, string>, what: string, asViewer = true): Promise<{ data: Record<string, unknown> } | Failure> {
  const fields = Object.entries(variables).flatMap(([key, value]) => ["-f", `${key}=${value}`]);
  const answer = await ctx.cli("glab", ["api", "--hostname", ctx.host, "graphql", "-f", `query=${query}`, ...fields]);
  if (answer.kind === "missing") return glabMissing(ctx.host);
  const body = parse(answer.stdout);
  const data = body?.data as Record<string, unknown> | null | undefined;
  const errors = (body?.errors ?? []) as GraphqlError[];
  if (!data || errors.some((e) => (e.path?.length ?? 0) === 0)) return failure(ctx, answer, body, what);
  if (asViewer && !data.currentUser) return notLoggedIn(ctx.host);
  return { data };
}

/** One REST request through `glab api`, for what GraphQL doesn't give. */
async function rest(ctx: Ctx, endpoint: string, what: string): Promise<{ json: unknown } | Failure> {
  const answer = await ctx.cli("glab", ["api", "--hostname", ctx.host, endpoint]);
  if (answer.kind === "missing") return glabMissing(ctx.host);
  if (answer.code !== 0) return failure(ctx, answer, parse(answer.stdout), what);
  try {
    return { json: JSON.parse(answer.stdout) as unknown };
  } catch {
    return { kind: "cant-tell", reason: `${ctx.host} gave no answer for ${what}` };
  }
}

/** Why a `glab` call didn't answer: a refused login, no such Project, a used-up rate limit, or no answer at all. */
function failure(ctx: Ctx, answer: Extract<CliResult, { kind: "exited" }>, body: Record<string, unknown> | null, what: string): Failure {
  const said = `${answer.stderr}\n${answer.stdout}`;
  const { host } = ctx;
  if (/\b401\b|unauthorized|invalid[_ ]token/i.test(said)) {
    return { kind: "refused", reason: `${host} refused this login — run \`glab auth login --hostname ${host}\`` };
  }
  if (/glab auth login|not (been )?authenticated|no token/i.test(said)) return notLoggedIn(host);
  if (/\b404\b/.test(said)) return { kind: "not-found", reason: `no Project ${what} on ${host} that this login can see` };
  if (/\b429\b|rate limit|retry later/i.test(said)) return { kind: "cant-tell", reason: `${host}'s rate limit for this login is used up for now` };
  if (/dial tcp|no such host|connection refused|i\/o timeout|timed out|network is unreachable/i.test(said)) {
    return { kind: "cant-tell", reason: `couldn't reach ${host}` };
  }
  const errors = (body?.errors ?? []) as GraphqlError[];
  const why = errors[0]?.message ?? answer.stderr.trim().split("\n")[0] ?? `glab exited with ${answer.code}`;
  return { kind: "cant-tell", reason: `${host} gave no answer for ${what}: ${why}` };
}

function noLogin(host: string): CantAnswer {
  return { kind: "refused", reason: `no login for ${host} — run \`glab auth login --hostname ${host}\`` };
}

function notLoggedIn(host: string): CantAnswer {
  return { kind: "refused", reason: `not logged in to ${host} — run \`glab auth login --hostname ${host}\`` };
}

function glabMissing(host: string): CantAnswer {
  return { kind: "refused", reason: `GitLab is read through the GitLab CLI, and \`glab\` isn't installed — install it and run \`glab auth login --hostname ${host}\`` };
}
