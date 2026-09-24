/**
 * The status line (#40): one row of the Home Project's Take next, from the
 * line the store keeps beside the Snapshot the background refresher keeps
 * warm. Claude Code cancels it on every new message, so it never reads a
 * Tracker, a Snapshot or anything else that could hold up the prompt, and
 * it imports nothing that takes long to load.
 */
import type { Glance } from "../snapshot/store.ts";
import type { Project } from "../tracker/tracker.ts";
import { age, count, ROW } from "../map/text.ts";

export interface StatusDeps {
  /** The git checkout a directory is in, or `null` outside one. */
  checkoutRoot(dir: string): Promise<string | null>;
  /** The Home Project last resolved for the checkout at `root`: moving never changes it. */
  lastHome(root: string): Promise<Project | undefined>;
  store: { glance(tracker: string, project: string): Promise<Glance> };
}

/** How long a Snapshot is fresh, as the Map counts it: past this, the row says how old it is. */
const FRESH_MS = 2 * 60_000;

/** The Map's row for the checkout `dir` is in; empty outside a checkout. */
export async function statusLine(deps: StatusDeps, dir: string): Promise<string> {
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
