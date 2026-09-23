/**
 * The contract suite against the GitHub adapter, with `gh` and the network
 * stood in for by replies in the shapes github.com and GHES give.
 */
import { github } from "../src/tracker/github.ts";
import type { CliResult, HttpResult } from "../src/tracker/boundary.ts";
import { trackerContract, type ProjectSpec, type World } from "./contract/tracker-contract.ts";

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
  const path = `${field("owner")}/${field("name")}`;
  const spec = (world.projects ?? []).find((p) => [p.path, ...(p.oldPaths ?? [])].some((known) => known.toLowerCase() === path.toLowerCase()));
  if (!spec) {
    const message = `Could not resolve to a Repository with the name '${path}'.`;
    return exited(1, JSON.stringify({ data: { repository: null }, errors: [{ type: "NOT_FOUND", path: ["repository"], message }] }), `gh: ${message}\n`);
  }
  return exited(0, JSON.stringify({ data: { repository: { ...repository(spec, host), parent: spec.parent ? repository(spec.parent, host) : null } } }));
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
