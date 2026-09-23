/**
 * Take next: the Unblocked Issues the viewer could take, in the order a fixed
 * rule gives them. Pure, and never Claude's judgement, so every draw of one
 * Snapshot gives the same list.
 */
import type { Snapshot } from "../snapshot/snapshot.ts";
import type { Link, OpenIssue } from "../tracker/tracker.ts";
import { isOpen, oldestFirst, type Layout } from "./links.ts";

/** How many open Issues wait on an Issue, as Take next counts them. */
export interface Waiting {
  /** Its own count, or that of the Parent it stands in for when that's more. */
  count: number;
  /** The Parent it stands in for, if any. */
  via: OpenIssue | null;
  /** Whether `count` is the Parent's rather than its own. */
  carried: boolean;
}

export interface Pick {
  issue: OpenIssue;
  waiting: Waiting;
  /** Assigned to the viewer, or the viewer wrote one of its open Closing Requests. */
  yours: boolean;
}

export type TakeNext =
  /** Without Blocks Links nothing can be called Unblocked, so there is no list at all. */
  | { kind: "blocks-unread"; reason: string }
  | {
      kind: "list";
      /** In the order to take them. */
      picks: Pick[];
      /** Unblocked Issues left out because someone else has them: assigned, or an open Closing Request. */
      takenByOthers: number;
      /** Why Closing Requests couldn't be read, when they couldn't: then none leaves an Issue out. */
      closingRequestsUnread: string | null;
    };

export function takeNext(snapshot: Snapshot, { onMap }: Layout): TakeNext {
  if (snapshot.unread.blocks !== undefined) return { kind: "blocks-unread", reason: snapshot.unread.blocks };
  const own = new Map(snapshot.issues.map((issue) => [issue.id, issue]));
  /** Blocks Links between open Issues, from the Issue that Blocks to the Issues it Blocks. */
  const blocks = new Map<string, Set<string>>();
  for (const issue of snapshot.issues) {
    for (const { role, to } of issue.links) {
      if (role !== "blocker" && role !== "blocked") continue;
      if (!isOpen(to)) continue;
      const [from, onto] = role === "blocker" ? [to.id, issue.id] : [issue.id, to.id];
      blocks.set(from, (blocks.get(from) ?? new Set()).add(onto));
    }
  }
  /** Every open Issue waits on the Issues that Block it, and on what they wait on; a wait stops at a closed Issue. */
  const waitingOn = (id: string) => {
    const found = new Set<string>();
    const stack = [id];
    while (stack.length > 0) {
      for (const next of blocks.get(stack.pop()!) ?? []) {
        if (next === id || found.has(next)) continue;
        found.add(next);
        stack.push(next);
      }
    }
    return found.size;
  };

  const viewer = snapshot.login;
  const takenByOthers = (issue: OpenIssue) =>
    (issue.assignees.length > 0 && !issue.assignees.includes(viewer)) || issue.closingRequests.some((request) => request.author !== viewer);
  const yours = (issue: OpenIssue) =>
    issue.assignees.includes(viewer) || issue.closingRequests.some((request) => request.author === viewer);

  const unblocked = new Set(onMap.filter((issue) => !linked(issue, "blocker", () => true)));
  /** The Parent's own open children that could stand in for it: not in another Project, and not Task-level. */
  const hasStandIns = (issue: OpenIssue) => linked(issue, "child", (id) => own.get(id)?.taskLevel === false);
  /** A Task-level child is a step inside its Parent, never an Issue to take on its own. */
  const insideParent = (issue: OpenIssue) => issue.taskLevel && linked(issue, "parent", () => true);
  const givesWay = (issue: OpenIssue) => unblocked.has(issue) && hasStandIns(issue);

  // A child under several Parents that give way takes the largest count; ties go to the oldest Parent.
  const counted = new Map<string, Waiting>();
  const counting = new Set<string>();
  const waitingFor = (issue: OpenIssue): Waiting => {
    const known = counted.get(issue.id);
    if (known) return known;
    counting.add(issue.id);
    let via: OpenIssue | null = null;
    let fromVia = -1;
    for (const { role, to } of issue.links) {
      const parent = role === "parent" ? own.get(to.id) : undefined;
      if (!parent || counting.has(parent.id) || !givesWay(parent)) continue;
      const count = waitingFor(parent).count;
      if (count > fromVia || (count === fromVia && via && oldestFirst(parent, via) < 0)) [via, fromVia] = [parent, count];
    }
    counting.delete(issue.id);
    const mine = waitingOn(issue.id);
    const waiting = { count: Math.max(mine, fromVia), via, carried: via !== null && fromVia >= mine };
    counted.set(issue.id, waiting);
    return waiting;
  };

  const candidates = [...unblocked].filter((issue) => !hasStandIns(issue) && !insideParent(issue));
  const free = candidates.filter((issue) => !takenByOthers(issue));
  const picks = free
    .map((issue) => ({ issue, waiting: waitingFor(issue), yours: yours(issue) }))
    .sort((a, b) => b.waiting.count - a.waiting.count || earliestPlanned(a.issue, b.issue) || oldestFirst(a.issue, b.issue));
  return { kind: "list", picks, takenByOthers: candidates.length - free.length, closingRequestsUnread: snapshot.unread.closingRequests ?? null };
}

/** Whether the Issue has a Link of this role to an open Issue whose identity passes `test`. */
function linked(issue: OpenIssue, role: Link["role"], test: (id: string) => boolean): boolean {
  return issue.links.some((link) => link.role === role && isOpen(link.to) && test(link.to.id));
}

/** An Issue with no Planned date comes after every Issue with one. */
function earliestPlanned(a: OpenIssue, b: OpenIssue): number {
  if (a.planned === b.planned) return 0;
  if (a.planned === null) return 1;
  if (b.planned === null) return -1;
  return a.planned.localeCompare(b.planned);
}
