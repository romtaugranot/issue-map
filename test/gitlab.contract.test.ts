/**
 * Need 1 of the contract suite against the GitLab adapter, with `glab` and
 * the network stood in for by replies in the shapes GitLab gives. The rest
 * of the contract joins when the adapter reads Projects.
 */
import { gitlab } from "../src/tracker/gitlab.ts";
import type { CliResult, HttpResult } from "../src/tracker/boundary.ts";
import { identifyContract, type World } from "./contract/tracker-contract.ts";

identifyContract({
  product: "GitLab",
  wellKnownHost: "gitlab.com",
  arrange(world) {
    let requests = 0;
    const loginsSentTo: string[] = [];
    const kind = gitlab({
      env: {},
      cli: async (command, args) => {
        if (command !== "glab" || (world.cli ?? "installed") === "missing") return { kind: "missing" };
        const host = args[args.indexOf("--hostname") + 1]!;
        if (args[0] === "auth") return (world.loggedInTo ?? []).includes(host) ? exited(0, "") : exited(1, "", `x ${host} has not been authenticated with glab.\n`);
        requests++;
        loginsSentTo.push(host);
        return glabApi(world, args);
      },
      http: async (url) => {
        requests++;
        return probe(world, new URL(url));
      },
    });
    return { kind, requests: () => requests, loginsSentTo: () => loginsSentTo.filter((h) => h !== "gitlab.com") };
  },
});

function glabApi(world: World, args: string[]): CliResult {
  const host = args[args.indexOf("--hostname") + 1]!;
  const server = world.servers?.[host];
  if (!server || server.runs !== "this-kind") return exited(1, "", `glab: dial tcp: lookup ${host}: no such host\n`);
  if (world.login === "none") return exited(1, "", `glab: 401 Unauthorized\n`);
  if (args.includes("version")) return exited(0, JSON.stringify({ version: server.version, revision: "0000000" }));
  return exited(1, "", "glab: 404 Not Found\n");
}

function probe(world: World, url: URL): HttpResult {
  const server = world.servers?.[url.hostname];
  if (!server) return { kind: "unreachable", reason: "ENOTFOUND" };
  if (server.runs === "something-else") return { kind: "response", status: 404, headers: { "content-type": "text/html" }, body: "<h1>Not Found</h1>" };
  if (!url.pathname.startsWith("/api/v4/")) return { kind: "response", status: 404, headers: {}, body: "" };
  return { kind: "response", status: 401, headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "401 Unauthorized" }) };
}

function exited(code: number, stdout: string, stderr = ""): CliResult {
  return { kind: "exited", code, stdout, stderr };
}
