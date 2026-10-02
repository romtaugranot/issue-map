import { hostNamed } from "../tracker/boundary.ts";

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
  const host = hostNamed(alias(parsed) ? sshHostname(parsed.host) : parsed.host);
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
  return parsed && alias(parsed) ? [parsed.host] : [];
}

interface Parsed {
  host: string;
  path: string;
  ssh: boolean;
}

/** An SSH host other than an IPv6 address may be an alias in the user's SSH config. */
function alias(parsed: Parsed): boolean {
  return parsed.ssh && !parsed.host.startsWith("[");
}

function parse(remote: string): Parsed | null {
  // A remote helper's `transport::address`, as git tells it apart.
  if (/^[a-z0-9][a-z0-9+.-]*::/i.test(remote)) return null;
  const url = /^([a-z][a-z0-9+.-]*):\/\//i.exec(remote);
  if (url) return parseUrl(remote, url[1]!.toLowerCase());
  // A Windows drive path is local.
  if (/^[a-z]:[\\/]/i.test(remote)) return null;
  // scp-like: [user@]host:path, with an IPv6 host in brackets, only when no slash comes before the colon.
  const scp = /^(?:[^@/:[]*@)?(\[[^\]/]*\]|[^/:[]+):(.*)$/s.exec(remote);
  return scp ? { host: scp[1]!, path: scp[2]!, ssh: true } : null;
}

function parseUrl(remote: string, scheme: string): Parsed | null {
  const transport = scheme.replace(/^git\+/, "").replace(/\+git$/, "");
  if (!["ssh", "https", "http", "git"].includes(transport)) return null;
  try {
    const url = new URL(remote.replace(/^[^:]+/, transport === "ssh" ? "ssh" : "https"));
    return { host: url.hostname, path: decodeURIComponent(url.pathname), ssh: transport === "ssh" };
  } catch {
    // An unparseable URL, or a malformed percent-escape in its path, which `gh` passes over too.
    return null;
  }
}
