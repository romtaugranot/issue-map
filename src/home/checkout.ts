/** The local git checkout Claude Code is running in: its remotes and its local config. */
import { processCli, type Cli } from "../tracker/boundary.ts";

export interface Remote {
  name: string;
  /** The fetch URL, or the push URL where a remote has only that; `insteadOf` already applied. */
  url: string;
}

export interface Checkout {
  /** In the order git lists them. */
  remotes(): Promise<Remote[]>;
  get(key: string): Promise<string | undefined>;
  /** Writes to this checkout's local config only. */
  set(key: string, value: string): Promise<{ saved: true } | { saved: false; reason: string }>;
  unset(key: string): Promise<void>;
}

export function gitCheckout(dir: string, cli: Cli = processCli): Checkout {
  const git = async (...args: string[]) => {
    const answer = await cli("git", ["-C", dir, ...args]);
    if (answer.kind === "missing") return { code: 127, stdout: "", stderr: "git isn't installed" };
    return answer;
  };

  return {
    async remotes() {
      // `git remote -v` applies insteadOf rewrites, as gh and glab rely on.
      const { stdout } = await git("remote", "-v");
      const found = new Map<string, { fetch?: string; push?: string }>();
      for (const line of stdout.split("\n")) {
        const match = /^(\S+)\t(.+) \((fetch|push)\)$/.exec(line);
        if (!match) continue;
        const [, name, url, direction] = match as unknown as [string, string, string, "fetch" | "push"];
        const remote = found.get(name) ?? {};
        remote[direction] = url;
        found.set(name, remote);
      }
      return [...found].flatMap(([name, { fetch, push }]) => {
        const url = fetch ?? push;
        return url ? [{ name, url }] : [];
      });
    },

    async get(key) {
      const { code, stdout } = await git("config", "--local", "--get", key);
      return code === 0 ? stdout.trim() : undefined;
    },

    async set(key, value) {
      const { code, stderr } = await git("config", "--local", key, value);
      return code === 0 ? { saved: true } : { saved: false, reason: stderr.trim() || `git exited with ${code}` };
    },

    async unset(key) {
      await git("config", "--local", "--unset-all", key);
    },
  };
}

/** The git repository containing a directory, or `null` when it isn't in one. */
export async function checkoutRoot(dir: string, cli: Cli = processCli): Promise<string | null> {
  const answer = await cli("git", ["-C", dir, "rev-parse", "--show-toplevel"]);
  return answer.kind === "exited" && answer.code === 0 ? answer.stdout.trim() : null;
}
