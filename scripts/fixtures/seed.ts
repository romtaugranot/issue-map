/**
 * Seeds a Tracker with a Fixture (`test/live/fixtures.ts`): makes what's
 * missing so the Tracker holds what the Fixture declares, and never deletes.
 * An Issue is found again by its title, so a second run writes nothing.
 * Links are written through the adapters' own need 10, so seeding exercises
 * the write the Map makes; the rest goes through `gh api` and `glab api`.
 *
 * `node scripts/fixtures/seed.ts <github | gitlab-free | gitlab-oss> [--host <host>] [--create-namespaces]`
 *
 * It writes with whatever login `gh` or `glab` holds for the host, which
 * needs to be able to create Projects in the Fixture's namespaces. Only a
 * throwaway GitLab, such as one the version matrix runs, is seeded with
 * `--create-namespaces`: on github.com and gitlab.com the namespaces are
 * made by hand (docs/fixtures.md).
 */
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { anonymousHttp, processCli, type Cli } from "../../src/tracker/boundary.ts";
import { github } from "../../src/tracker/github.ts";
import { gitlab } from "../../src/tracker/gitlab.ts";
import { trackers, type IssueRead, type LinkKind, type Tracker } from "../../src/tracker/tracker.ts";
import { FIXTURES, title, type Fixture, type FixtureIssue, type FixtureName, type FixtureProject } from "../../test/live/fixtures.ts";

/** An Issue the Tracker holds: its identity as the adapters read it, and its reference as `issue` takes it. */
export interface Existing {
  id: string;
  ref: string;
  title: string;
  open: boolean;
}

/** What seeding does on a Tracker besides writing Links. */
export interface Seeding {
  /** Whether the organisation or group is there; made first when `create` says so, where the Tracker lets it be. */
  namespace(path: string, create: boolean): Promise<boolean>;
  /** Makes the Project at `path` when it's missing, with a first commit for a Closing Request's branch to start from. */
  project(path: string): Promise<void>;
  /** Every Issue of the Project or group, open or closed. */
  issues(project: FixtureProject): Promise<Existing[]>;
  create(project: FixtureProject, issue: FixtureIssue): Promise<Existing>;
  /** Closes it, and names the Issue it duplicates where it closes as a duplicate. */
  close(issue: Existing, how: "completed" | "not planned" | "duplicate", duplicateOf?: Existing): Promise<void>;
  /** Opens a request closing `issue`, from a branch named for `key`, unless an open one is there; says whether it opened one. */
  closingRequest(path: string, issue: Existing, key: string): Promise<boolean>;
}

export interface SeedDeps {
  seeding: Seeding;
  tracker: Pick<Tracker, "issue" | "link">;
  createNamespaces: boolean;
}

/** Seeds the Tracker with `fixture` and says what it wrote, one line each; throws at the first thing it can't. */
export async function seed(fixture: Fixture, { seeding, tracker, createNamespaces }: SeedDeps): Promise<string[]> {
  const wrote: string[] = [];
  for (const namespace of fixture.namespaces) {
    if (!(await seeding.namespace(namespace, createNamespaces))) {
      throw new Error(`${namespace} isn't there: make it by hand first, as docs/fixtures.md says`);
    }
  }
  const byKey = new Map<string, Existing>();
  for (const project of fixture.projects) {
    if (!project.namespace) await seeding.project(project.path);
    const there = await seeding.issues(project);
    for (const issue of project.issues) {
      let found = there.find((held) => held.title === title(issue));
      if (!found) {
        found = await seeding.create(project, issue);
        wrote.push(`created ${found.ref} ${found.title}`);
      }
      byKey.set(issue.key, found);
    }
  }
  const at = (key: string) => byKey.get(key) ?? fail(`no Issue with key ${key} in ${fixture.name}`);

  // Links go in before Issues close, since a Tracker may not take a new Link to a closed Issue.
  for (const [a, kind, b] of fixture.links) {
    const [from, to] = [at(a), at(b)];
    const read = await tracker.issue(to.ref);
    if (read.kind !== "issue") fail(`couldn't read ${to.ref}: ${read.reason}`);
    if (recorded(read.issue, kind, from)) continue;
    const answer = await tracker.link(from.ref, kind, to.ref);
    if (answer.kind !== "linked") fail(`couldn't write ${from.ref} ${kind} ${to.ref}: ${answer.reason}`);
    wrote.push(`linked ${from.ref} ${kind} ${to.ref}`);
  }

  for (const project of fixture.projects) {
    for (const issue of project.issues) {
      const held = at(issue.key);
      if (issue.closed && held.open) {
        const duplicate = typeof issue.closed === "object";
        await seeding.close(held, duplicate ? "duplicate" : (issue.closed as "completed" | "not planned"), duplicate ? at((issue.closed as { duplicateOf: string }).duplicateOf) : undefined);
        wrote.push(`closed ${held.ref}`);
      }
      if (issue.closingRequest && (await seeding.closingRequest(project.path, held, issue.key))) wrote.push(`opened a Closing Request for ${held.ref}`);
    }
  }
  return wrote;
}

/** Whether `to`, as read, already has the Link from `from`. */
function recorded(to: IssueRead, kind: LinkKind, from: Existing): boolean {
  const role = { blocks: "blocker", parent: "parent", related: "related" }[kind];
  return to.links.some((link) => link.role === role && (link.to.id === from.id || (link.to.readable && link.to.ref === from.ref)));
}

function fail(reason: string): never {
  throw new Error(reason);
}

/** `gh api` or `glab api` against one host: an answer's JSON, `null` for a 404, and a thrown error for anything else. */
function apiOf(cli: Cli, command: "gh" | "glab", host: string) {
  const call = async (args: string[]): Promise<unknown> => {
    const answer = await cli(command, ["api", "--hostname", host, ...args]);
    if (answer.kind === "missing") fail(`\`${command}\` isn't installed`);
    const said = `${answer.stdout}\n${answer.stderr}`;
    if (answer.code !== 0) {
      if (/\b404\b|Not Found/.test(said)) return null;
      fail(`${command} api ${args.join(" ")} failed: ${said.trim()}`);
    }
    return answer.stdout.trim() ? JSON.parse(answer.stdout) : {};
  };
  return call;
}

const encode = encodeURIComponent;

/** Seeding on a GitHub, through `gh api`. */
export function githubSeeding(cli: Cli, host: string): Seeding {
  const api = apiOf(cli, "gh", host);
  /** Each Issue's number and database id by reference, which a duplicate is closed against. */
  const ids = new Map<string, number>();
  type RestIssue = { id: number; node_id: string; number: number; title: string; state: string; pull_request?: unknown };
  const held = (path: string, issue: RestIssue): Existing => {
    const ref = `${path}#${issue.number}`;
    ids.set(ref, issue.id);
    return { id: issue.node_id, ref, title: issue.title, open: issue.state === "open" };
  };
  const split = (ref: string) => /^(.+)#(\d+)$/.exec(ref)!.slice(1) as [string, string];

  return {
    async namespace(path) {
      // Organisations are made on the web, never by the seeder.
      return (await api([`orgs/${path}`])) !== null;
    },
    async project(path) {
      if ((await api([`repos/${path}`])) !== null) return;
      const [org, name] = path.split("/") as [string, string];
      await api([`orgs/${org}/repos`, "--method", "POST", "-f", `name=${name}`, "-f", "visibility=public", "-F", "has_issues=true", "-F", "auto_init=true"]);
    },
    async issues({ path }) {
      const page = (await api([`repos/${path}/issues?state=all&per_page=100`])) as RestIssue[] | null;
      if (!page) fail(`${path} isn't there`);
      if (page.length === 100) fail(`${path} holds 100 Issues or more, more than any Fixture; the seeder reads one page`);
      return page.filter((issue) => !issue.pull_request).map((issue) => held(path, issue));
    },
    async create({ path }, issue) {
      return held(path, (await api([`repos/${path}/issues`, "--method", "POST", "-f", `title=${title(issue)}`])) as RestIssue);
    },
    async close(issue, how, duplicateOf) {
      const [path, number] = split(issue.ref);
      const reason = { completed: "completed", "not planned": "not_planned", duplicate: "duplicate" }[how];
      const duplicate = duplicateOf ? ["-F", `duplicate_issue_id=${ids.get(duplicateOf.ref) ?? fail(`no id for ${duplicateOf.ref}`)}`] : [];
      await api([`repos/${path}/issues/${number}`, "--method", "PATCH", "-f", "state=closed", "-f", `state_reason=${reason}`, ...duplicate]);
    },
    async closingRequest(path, issue, key) {
      const branch = `fixture/${key}`;
      const [owner] = path.split("/");
      const pulls = (await api([`repos/${path}/pulls?state=open&head=${encode(`${owner}:${branch}`)}`])) as unknown[];
      if (pulls.length > 0) return false;
      const { default_branch: base } = (await api([`repos/${path}`])) as { default_branch: string };
      if ((await api([`repos/${path}/git/ref/heads/${branch}`])) === null) {
        const { object } = (await api([`repos/${path}/git/ref/heads/${base}`])) as { object: { sha: string } };
        await api([`repos/${path}/git/refs`, "--method", "POST", "-f", `ref=refs/heads/${branch}`, "-f", `sha=${object.sha}`]);
      }
      const file = `fixtures/${key}.md`;
      if ((await api([`repos/${path}/contents/${file}?ref=${encode(branch)}`])) === null) {
        const content = Buffer.from(`A change that closes ${issue.ref} once merged. It is a fixture: never merge it.\n`).toString("base64");
        await api([`repos/${path}/contents/${file}`, "--method", "PUT", "-f", `message=Fixture change for ${key}`, "-f", `content=${content}`, "-f", `branch=${branch}`]);
      }
      const [, number] = split(issue.ref);
      await api([`repos/${path}/pulls`, "--method", "POST", "-f", `title=Fixture: closes ${key}`, "-f", `head=${branch}`, "-f", `base=${base}`, "-f", `body=Closes #${number}`]);
      return true;
    },
  };
}

/**
 * How long a GitLab gets to do what it does in the background: work out
 * which Issues a merge request it opened closes, and let its GraphQL find a
 * Project its REST just made.
 */
const TRIES = 60;
const EVERY_MS = 2000;

/**
 * Seeding on a GitLab, through `glab api`: REST for Projects and Issues, the
 * work-item GraphQL for tasks and epics. `wait` resolves after `ms`.
 */
export function gitlabSeeding(cli: Cli, host: string, wait: (ms: number) => Promise<unknown> = sleep): Seeding {
  const api = apiOf(cli, "glab", host);
  const graphql = async (query: string, variables: Record<string, string>) => {
    const body = (await api(["graphql", "-f", `query=${query}`, ...Object.entries(variables).flatMap(([name, value]) => ["-f", `${name}=${value}`])])) as {
      data?: Record<string, unknown>;
      errors?: { message: string }[];
    } | null;
    if (!body?.data || body.errors?.length) fail(`GitLab's GraphQL refused: ${JSON.stringify(body?.errors ?? body)}`);
    return body.data;
  };
  type Node = { id: string; iid: string; title: string; state: string; reference: string };
  const held = (node: Node): Existing => ({ id: node.id, ref: node.reference, title: node.title, open: node.state === "OPEN" });
  type RestIssue = { id: number; iid: number; title: string; state: string };
  const fromRest = (path: string, issue: RestIssue): Existing => ({ id: `gid://gitlab/WorkItem/${issue.id}`, ref: `${path}#${issue.iid}`, title: issue.title, open: issue.state === "opened" });
  const split = (ref: string) => /^(.+)[#&](\d+)$/.exec(ref)!.slice(1) as [string, string];
  /** A work item of the type `type` names, made in the Project or group at `path`. */
  const made = async (path: string, issue: FixtureIssue, type: string): Promise<Existing> => {
    const answer = await graphql(
      `mutation($path: ID!, $title: String!, $type: WorkItemsTypeID!) { workItemCreate(input: {namespacePath: $path, title: $title, workItemTypeId: $type}) { workItem { id iid title state reference(full: true) } errors } }`,
      { path, title: title(issue), type },
    );
    const created = answer.workItemCreate as { workItem: Node | null; errors: string[] };
    if (!created.workItem) fail(`GitLab didn't make ${title(issue)} in ${path}: ${created.errors.join("; ")}`);
    return held(created.workItem);
  };
  /** Resolves once `done` does, asking every `EVERY_MS`; `failure` stops the seeding if it never does. */
  const until = async (done: () => Promise<boolean>, failure: string): Promise<void> => {
    for (let tries = 1; !(await done()); tries++) {
      if (tries === TRIES) fail(failure);
      await wait(EVERY_MS);
    }
  };

  return {
    async namespace(path, create) {
      if ((await api([`groups/${encode(path)}`])) !== null) return true;
      if (!create) return false;
      await api(["groups", "--method", "POST", "-f", `name=${path}`, "-f", `path=${path}`, "-f", "visibility=public"]);
      return true;
    },
    async project(path) {
      if ((await api([`projects/${encode(path)}`])) !== null) return;
      const [group, name] = [path.slice(0, path.lastIndexOf("/")), path.slice(path.lastIndexOf("/") + 1)];
      const { id } = ((await api([`groups/${encode(group)}`])) as { id: number } | null) ?? fail(`${group} isn't there`);
      await api(["projects", "--method", "POST", "-f", `name=${name}`, "-f", `path=${name}`, "-F", `namespace_id=${id}`, "-f", "visibility=public", "-F", "initialize_with_readme=true"]);
      const found = async () => (await graphql(`query($path: ID!) { project(fullPath: $path) { id } }`, { path })).project != null;
      await until(found, `GitLab never found ${path} in its GraphQL, though it made it`);
    },
    async issues({ path, namespace }) {
      const container = namespace ? "group" : "project";
      const types = namespace ? ", types: [EPIC]" : "";
      const data = await graphql(
        `query($path: ID!) { ${container}(fullPath: $path) { workItems(first: 100${types}) { pageInfo { hasNextPage } nodes { id iid title state reference(full: true) } } } }`,
        { path },
      );
      const items = (data[container] as { workItems: { pageInfo: { hasNextPage: boolean }; nodes: Node[] } } | null)?.workItems ?? fail(`${path} isn't there`);
      if (items.pageInfo.hasNextPage) fail(`${path} holds 100 Issues or more, more than any Fixture; the seeder reads one page`);
      return items.nodes.map(held);
    },
    async create({ path }, issue) {
      if (issue.level === "epic") {
        const types = await graphql(`query($path: ID!) { group(fullPath: $path) { workItemTypes(name: EPIC) { nodes { id } } } }`, { path });
        const type = (types.group as { workItemTypes: { nodes: { id: string }[] } } | null)?.workItemTypes.nodes[0]?.id ?? fail(`${path} has no epics: it needs GitLab's Premium tier or above`);
        return made(path, issue, type);
      }
      if (issue.level === "task") {
        // GitLab's REST takes `issue_type=task` only in later versions; every promised one's work-item GraphQL makes one.
        const types = await graphql(`query($path: ID!) { project(fullPath: $path) { workItemTypes(first: 20) { nodes { id name } } } }`, { path });
        const nodes = (types.project as { workItemTypes: { nodes: { id: string; name: string }[] } } | null)?.workItemTypes.nodes ?? fail(`${path} isn't there`);
        const type = nodes.find((node) => node.name === "Task")?.id ?? fail(`${path} has no tasks`);
        return made(path, issue, type);
      }
      return fromRest(path, (await api([`projects/${encode(path)}/issues`, "--method", "POST", "-f", `title=${title(issue)}`])) as RestIssue);
    },
    async close(issue, how, duplicateOf) {
      const [path, iid] = split(issue.ref);
      // GitLab says how an Issue closed only when it closed as a duplicate, which its `/duplicate` quick action records.
      if (how === "duplicate" && duplicateOf) {
        await api([`projects/${encode(path)}/issues/${iid}/notes`, "--method", "POST", "-f", `body=/duplicate ${duplicateOf.ref}`]);
        return;
      }
      await api([`projects/${encode(path)}/issues/${iid}`, "--method", "PUT", "-f", "state_event=close"]);
    },
    async closingRequest(path, issue, key) {
      const branch = `fixture/${key}`;
      const project = `projects/${encode(path)}`;
      const open = (await api([`${project}/merge_requests?state=opened&source_branch=${encode(branch)}`])) as unknown[];
      if (open.length > 0) return false;
      const { default_branch: base } = (await api([project])) as { default_branch: string };
      if ((await api([`${project}/repository/branches/${encode(branch)}`])) === null) {
        await api([
          `${project}/repository/files/${encode(`fixtures/${key}.md`)}`,
          "--method", "POST",
          "-f", `branch=${branch}`,
          "-f", `start_branch=${base}`,
          "-f", `content=A change that closes ${issue.ref} once merged. It is a fixture: never merge it.`,
          "-f", `commit_message=Fixture change for ${key}`,
        ]);
      }
      const [, iid] = split(issue.ref);
      const request = (await api([`${project}/merge_requests`, "--method", "POST", "-f", `source_branch=${branch}`, "-f", `target_branch=${base}`, "-f", `title=Fixture: closes ${key}`, "-f", `description=Closes #${iid}`])) as { iid: number };
      // Until GitLab has worked out what it closes, a read would find no Closing Request.
      const closes = async () => ((await api([`${project}/merge_requests/${request.iid}/closes_issues`])) as { iid: number }[] | null)?.some((closed) => String(closed.iid) === iid) ?? false;
      await until(closes, `GitLab never said ${path}!${request.iid} closes ${issue.ref}`);
      return true;
    },
  };
}

async function main(argv: string[]): Promise<number> {
  const { positionals, values } = parseArgs({ args: argv, allowPositionals: true, options: { host: { type: "string" }, "create-namespaces": { type: "boolean" } } });
  const name = positionals[0] as FixtureName | undefined;
  const fixture = name ? FIXTURES[name] : undefined;
  if (!fixture || positionals.length > 1) {
    console.error(`usage: node scripts/fixtures/seed.ts <${Object.keys(FIXTURES).join(" | ")}> [--host <host>] [--create-namespaces]`);
    return 2;
  }
  const host = values.host ?? fixture.host;
  const deps = { cli: processCli, http: anonymousHttp, env: process.env };
  const found = await trackers([github(deps), gitlab(deps)]).at(host);
  if (found.kind !== "identified") {
    console.error(`no Tracker the Map reads at ${host}: ${found.kind === "cant-tell" ? found.reason : "it isn't GitHub or GitLab"}`);
    return 1;
  }
  const { tracker } = found;
  const seeding = tracker.product === "GitHub" ? githubSeeding(processCli, host) : gitlabSeeding(processCli, host);
  try {
    const wrote = await seed(fixture, { seeding, tracker, createNamespaces: values["create-namespaces"] ?? false });
    console.log(wrote.length > 0 ? wrote.join("\n") : `${fixture.name} on ${host} already holds everything; nothing written`);
    return 0;
  } catch (error) {
    console.error(`seeding ${fixture.name} on ${host} stopped: ${(error as Error).message}`);
    return 1;
  }
}

/** Kept apart from `seed` so a test never reaches a real Tracker. */
if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
