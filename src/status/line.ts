/**
 * The status line (#40): one row of the Home Project's Take next, from the
 * line the store keeps beside the Snapshot the background refresher keeps
 * warm. Claude Code cancels it on every new message, so it never reads a
 * Tracker, a Snapshot or anything else that could hold up the prompt, and
 * it imports nothing that takes long to load.
 */
import { checkoutRoot } from "../home/checkout.ts";
import { FRESH_MS, snapshotStore, type Glance } from "../snapshot/store.ts";
import { lastHomeOf, stateDir } from "../state.ts";
import type { Project } from "../tracker/tracker.ts";
import { age, count, ROW } from "../map/text.ts";

export interface StatusDeps {
  /** The git checkout a directory is in, or `null` outside one. */
  checkoutRoot(dir: string): Promise<string | null>;
  /** The Home Project last resolved for the checkout at `root`: moving never changes it. */
  lastHome(root: string): Promise<Project | undefined>;
  store: { glance(tracker: string, project: string): Promise<Glance> };
}

/** The Home Project's row for the checkout `dir` is in, from what this OS user keeps; empty outside a checkout. */
export function homeRowHere(dir: string): Promise<string> {
  return homeRow({ checkoutRoot, lastHome: (root) => lastHomeOf(root).get(), store: snapshotStore(stateDir(), { now: Date.now }) }, dir);
}

/** The Home Project's row for the checkout `dir` is in; empty outside a checkout. Past the Map's freshness window, it says how old it is. */
export async function homeRow(deps: StatusDeps, dir: string): Promise<string> {
  const root = await deps.checkoutRoot(dir);
  if (!root) return "";
  const home = await deps.lastHome(root);
  if (!home) return `${ROW} No Home Project yet · ask for the Map`;
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
      return glance.ageMs > FRESH_MS ? `${glance.line} · read ${age(glance.ageMs)} ago` : glance.line;
  }
}
