/** The GitHub adapter: reads through `gh`'s login and its raw-API call (ADR 0001). */
import { parseJson as parse, type AdapterDeps, type Cli } from "./boundary.ts";
import type { Identification, Project, ProjectResolution, Tracker, TrackerKind } from "./tracker.ts";

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
    resolveProject: async (path) =>
      loginIsFor
        ? resolveProject(cli, host, path)
        : { kind: "refused", reason: `no login for ${host} — run \`gh auth login --hostname ${host}\`` },
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
  const answer = await cli("gh", [
    "api", "--hostname", host, "graphql",
    "-f", `query=${PROJECT_QUERY}`, "-F", `owner=${owner}`, "-F", `name=${name}`,
  ]);
  if (answer.kind === "missing") {
    return { kind: "refused", reason: `GitHub is read through the GitHub CLI, and \`gh\` isn't installed — install it and run \`gh auth login --hostname ${host}\`` };
  }
  if (answer.code === 4) {
    return { kind: "refused", reason: `not logged in to ${host} — run \`gh auth login --hostname ${host}\`` };
  }
  const body = parse(answer.stdout);
  const repository = (body?.data as { repository?: Repository | null } | undefined)?.repository;
  if (answer.code === 0 && repository) {
    return { kind: "project", project: project(host, repository), parent: repository.parent ? project(host, repository.parent) : null };
  }
  const errors = (body?.errors ?? []) as { type?: string; message?: string }[];
  if (errors.some((e) => e.type === "NOT_FOUND")) {
    return { kind: "not-found", reason: `no repository ${path} on ${host} that this login can see` };
  }
  const status = String(body?.status ?? "");
  if (status === "401" || status === "403") {
    return { kind: "refused", reason: `${host} refused this login: ${String(body?.message)} — run \`gh auth login --hostname ${host}\`` };
  }
  if (answer.stderr.startsWith("error connecting to")) {
    return { kind: "cant-tell", reason: `couldn't reach ${host}` };
  }
  const why = errors[0]?.message ?? answer.stderr.trim().split("\n")[0] ?? `gh exited with ${answer.code}`;
  return { kind: "cant-tell", reason: `${host} gave no answer for ${path}: ${why}` };
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
