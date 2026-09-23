/**
 * The GitLab adapter, reading through `glab`'s login (ADR 0001). So far it
 * only identifies GitLab at a host; reading its Projects comes with the
 * rest of the adapter.
 */
import { parseJson as parse, type AdapterDeps, type Cli } from "./boundary.ts";
import type { Identification, Tracker, TrackerKind } from "./tracker.ts";

const PRODUCT = "GitLab";

export function gitlab(deps: AdapterDeps): TrackerKind {
  const { cli, http, env } = deps;

  const trackerAt = (host: string, version: string | null): Tracker => ({
    product: PRODUCT,
    host,
    version,
    resolveProject: async () => ({
      kind: "cant-tell",
      reason: "this version of the plugin doesn't read GitLab Projects yet",
    }),
  });

  return {
    product: PRODUCT,

    async recognise(host) {
      return host === "gitlab.com" || host.endsWith(".gitlab-dedicated.com") ? trackerAt(host, null) : null;
    },

    async probe(host): Promise<Identification> {
      // glab sends its environment token to any host, so only a host it holds a login for is asked for the version.
      const known = env.GITLAB_HOST === host || (await glabHasLoginFor(cli, host));
      // GitLab answers its API in its own JSON even anonymously, but gives its version only to a login.
      const answer = await http(`https://${host}/api/v4/version`);
      if (answer.kind === "unreachable") {
        return known
          ? { kind: "identified", tracker: trackerAt(host, null) }
          : { kind: "cant-tell", reason: `couldn't reach ${host} (${answer.reason})` };
      }
      const anonymousVersion = versionIn(answer.body);
      const isGitLab = anonymousVersion !== null || (answer.status === 401 && isGitLabUnauthorized(answer.body));
      if (!isGitLab && !known) return { kind: "not-this-kind" };
      return { kind: "identified", tracker: trackerAt(host, anonymousVersion ?? (known ? await versionWithLogin(cli, host) : null)) };
    },
  };
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
