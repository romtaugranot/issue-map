/**
 * The status line (#40): one row of the Home Project's Take next, from the
 * line the store keeps beside the Snapshot the background refresher keeps
 * warm. Claude Code cancels it on every new message, so it never reads a
 * Tracker, a Snapshot or anything else that could hold up the prompt, and
 * it imports nothing that takes long to load.
 */
import { checkoutRoot, gitCheckout } from "../home/checkout.ts";
import { remoteAddress } from "../home/remote-address.ts";
import { FRESH_MS, snapshotStore, type Glance } from "../snapshot/store.ts";
import { lastHomeOf, stateDir } from "../state.ts";
import type { Project } from "../tracker/tracker.ts";
import { age, count, oneLine, ROW } from "../map/text.ts";

export interface StatusDeps {
  /** The git checkout a directory is in, or `null` outside one. */
  checkoutRoot(dir: string): Promise<string | null>;
  /** The Home Project last resolved for the checkout at `root`: moving never changes it. */
  lastHome(root: string): Promise<Project | undefined>;
  /** The URLs of the remotes of the checkout at `root`. */
  remotes(root: string): Promise<string[]>;
  store: { glance(tracker: string, project: string): Promise<Glance> };
}

/** Hosts known by name to run no Tracker the Map can read: Bitbucket's, Gitea's and Codeberg's. */
const NO_TRACKER = new Set(["bitbucket.org", "gitea.com", "codeberg.org"]);

/** The Home Project's row for the checkout `dir` is in, from what this OS user keeps; empty outside a checkout. */
export function homeRowHere(dir: string): Promise<string> {
  return homeRow(
    {
      checkoutRoot,
      lastHome: (root) => lastHomeOf(root).get(),
      remotes: async (root) => (await gitCheckout(root).remotes()).map((r) => r.url),
      store: snapshotStore(stateDir(), { now: Date.now }),
    },
    dir,
  );
}

/** The Home Project's row for the checkout `dir` is in; empty outside a checkout, or in one whose remotes lead to no Tracker. Past the Map's freshness window, it says how old it is. */
export async function homeRow(deps: StatusDeps, dir: string): Promise<string> {
  const root = await deps.checkoutRoot(dir);
  if (!root) return "";
  const home = await deps.lastHome(root);
  if (!home) return (await mayLeadToTracker(deps, root)) ? `${ROW} No Home Project yet · ask for the Map` : "";
  const glance = await deps.store.glance(home.host, home.id);
  const head = `${ROW} ${home.path}`;
  switch (glance.kind) {
    case "none":
      return `${head} · ask for the Map to see Take next here`;
    case "reading": {
      const percent = glance.total > 0 ? Math.floor((100 * glance.read) / glance.total) : 0;
      return `${head} · reading it for the first time: ${count(glance.read)} of ${count(glance.total)} Issues (${percent}%)`;
    }
    case "ready":
      // A row kept by an earlier version may hold a title as it was typed.
      return `${oneLine(glance.line)}${glance.ageMs > FRESH_MS ? ` · read ${age(glance.ageMs)} ago` : ""}`;
  }
}

/**
 * Whether a remote of the checkout at `root` could lead to a Tracker, as
 * far as can be told without asking a host: SSH aliases aren't looked up,
 * and a self-hosted Bitbucket or Gitea can't be told from a GitLab.
 */
async function mayLeadToTracker(deps: StatusDeps, root: string): Promise<boolean> {
  return (await deps.remotes(root)).some((url) => {
    const address = remoteAddress(url, (alias) => alias);
    return address !== null && !NO_TRACKER.has(address.host);
  });
}
