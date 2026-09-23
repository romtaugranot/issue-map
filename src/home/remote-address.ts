/** Where a git remote leads: a host, and the Project's path on it. */
export interface Address {
  host: string;
  path: string;
}

/**
 * Reads a remote URL the way `gh` and `glab` do. Local paths and remote
 * helpers lead to no Tracker. The user and port are not part of the
 * address, and a secret in the URL is dropped with them.
 */
export function remoteAddress(remote: string, sshHostname: (alias: string) => string): Address | null {
  const parsed = parse(remote.trim());
  if (!parsed) return null;
  const host = canonicalHost(parsed.ssh ? sshHostname(parsed.host) : parsed.host);
  const path = parsed.path
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.git$/, "")
    .replace(/\.wiki$/, "");
  if (!host || !path) return null;
  return { host, path };
}

/** Hostnames the SSH names for a URL go by, as `ssh -G` would see them. */
export function sshHosts(remote: string): string[] {
  const parsed = parse(remote.trim());
  return parsed?.ssh ? [parsed.host] : [];
}

interface Parsed {
  host: string;
  path: string;
  ssh: boolean;
}

function parse(remote: string): Parsed | null {
  if (remote.includes("::")) return null;
  const url = /^([a-z][a-z0-9+.-]*):\/\//i.exec(remote);
  if (url) return parseUrl(remote, url[1]!.toLowerCase());
  // scp-like: [user@]host:path, only when no slash comes before the first colon.
  const colon = remote.indexOf(":");
  if (colon <= 0 || remote.slice(0, colon).includes("/")) return null;
  const host = remote.slice(0, colon).replace(/^.*@/, "");
  return { host, path: remote.slice(colon + 1), ssh: true };
}

function parseUrl(remote: string, scheme: string): Parsed | null {
  const transport = scheme.replace(/^git\+/, "").replace(/\+git$/, "");
  if (!["ssh", "https", "http", "git"].includes(transport)) return null;
  let url: URL;
  try {
    url = new URL(remote.replace(/^[^:]+/, transport === "ssh" ? "ssh" : "https"));
  } catch {
    return null;
  }
  return { host: url.hostname, path: decodeURIComponent(url.pathname), ssh: transport === "ssh" };
}

function canonicalHost(host: string): string {
  const lower = host.toLowerCase();
  if (lower === "github.com" || lower.endsWith(".github.com")) return "github.com";
  if (lower === "altssh.gitlab.com") return "gitlab.com";
  return lower;
}
