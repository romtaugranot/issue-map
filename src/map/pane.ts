/**
 * What the Issue Map pane is drawn from (ADR 0014): the HTML Picture's own
 * data, so the two never disagree on Take next or the Groups, and each of the
 * Project's own Issues' Links and whether it's assigned, which its Issue
 * screen shows. Pure.
 */
import type { Snapshot } from "../snapshot/snapshot.ts";
import type { Link } from "../tracker/tracker.ts";
import type { Stale } from "./draw.ts";
import { layout } from "./links.ts";
import { pageData, type PageData } from "./page.ts";
import { takeNext, type Pick } from "./take-next.ts";
import { ago, count, OUTSIDE, oneLine, short } from "./text.ts";

/** One Link of an Issue, as its Issue screen lists it. */
export interface PaneLink {
  /** What the far end is to the Issue. */
  role: Link["role"];
  /** The far end's place in `issues`, where the pane can open it: open, and named on the page. */
  to?: number;
  /** As the Map writes it: `#12` inside the Project, `↗owner/name#3` outside it. */
  ref: string;
  title: string;
  open: boolean;
}

export interface PaneData extends PageData {
  /** Why each Issue in Take next is there, in its order, in as few words as say it: "4 wait on its parent #3414", or "" when nothing is said. */
  because: string[];
  /** The Links of each of the Project's own Issues, by its place in `issues`. */
  links: PaneLink[][];
  /** The places in `issues` of the Project's own Issues that someone is assigned. */
  assigned: number[];
}

export function paneData(snapshot: Snapshot, context: { stale?: Stale } = {}): PaneData {
  const page = pageData(snapshot, context);
  // The Project's own Issues come first in `issues`, in the Snapshot's order.
  const at = new Map(snapshot.issues.map((issue, i) => [issue.id, i]));
  const named = new Map(page.issues.map((issue, i) => [issue.ref, i] as const).filter(([ref]) => ref.startsWith(OUTSIDE)));
  const links = snapshot.issues.map((issue) =>
    issue.links.map(({ role, to }): PaneLink => {
      if (!to.readable) return { role, ref: "an Issue this login can't read", title: "", open: true };
      const inside = to.project === snapshot.project.path;
      const ref = inside ? to.ref.slice(to.ref.lastIndexOf("#")) : `${OUTSIDE}${to.ref}`;
      const place = to.open ? (inside ? at.get(to.id) : named.get(ref)) : undefined;
      return { role, ...(place === undefined ? {} : { to: place }), ref, title: oneLine(to.title), open: to.open };
    }),
  );
  const assigned = snapshot.issues.flatMap((issue, i) => (issue.assignees.length > 0 ? [i] : []));
  const next = takeNext(snapshot, layout(snapshot));
  const because = next.kind === "list" ? next.picks.map((pick) => reason(pick, snapshot)) : [];
  return { ...page, because, links, assigned };
}

/** Why `pick` is in Take next: what waits on it, or the Parent it's a first step of, and when its blocker closed. */
function reason({ issue, waiting: { count: n, via, carried }, closedBlockers }: Pick, { readAt, project }: Snapshot): string {
  const parts: string[] = [];
  if (n > 0) parts.push(carried && via ? `${count(n)} wait on its parent ${via.ref}` : `${count(n)} wait on it`);
  if (via && !(n > 0 && carried)) parts.push(`a first step of ${via.ref}`);
  const last = closedBlockers[0];
  if (last) parts.push(last.closedAt ? `its blocker closed ${ago(last.closedAt, readAt)}` : `${short(last.ref, project.path)} closed`);
  if (issue.planned) parts.push(`due ${issue.planned.slice(0, 10)}`);
  const said = parts.join(", ");
  return said.charAt(0).toUpperCase() + said.slice(1);
}
