/**
 * The Map's reading of a Snapshot: which Issues are on it, and which Groups
 * they form. Pure, and where the Group rule of ADRs 0005 and 0008 lives.
 */
import type { Snapshot } from "../snapshot/snapshot.ts";
import type { FarEnd, OpenIssue } from "../tracker/tracker.ts";

/** The Issue a Group's line names: one of the Project's own, or an Outside Issue a Link reaches. */
export type Head =
  | { kind: "issue"; id: string; issue: OpenIssue }
  | { kind: "outside"; id: string; end: FarEnd };

export interface Group {
  /** The Project's own Issues in it, oldest first. */
  issues: OpenIssue[];
  /** The Outside Issues its Links reach. */
  outside: FarEnd[];
  /** The Issue its line names: the one at its top with most under it. */
  head: Head;
}

export interface Layout {
  /** Open Issues of the Project with a Link to another open Issue. */
  onMap: OpenIssue[];
  /** Open Issues of the Project with no Link to another open Issue. */
  unlinked: OpenIssue[];
  /** Largest first. */
  groups: Group[];
}

/** From an Issue's identity to the identities its Links of one kind reach. */
type LinkedTo = Map<string, Set<string>>;

export function layout(snapshot: Snapshot): Layout {
  const own = new Map(snapshot.issues.map((issue) => [issue.id, issue]));
  const outside = new Map<string, FarEnd>();
  /** Parent and Blocks Links between open Issues, both ways. */
  const parentOrBlocks: LinkedTo = new Map();
  /** Parent and Blocks Links one way: from the Parent, or the Issue that Blocks, to the Issue beneath it. */
  const beneath: LinkedTo = new Map();
  const related: LinkedTo = new Map();

  for (const issue of snapshot.issues) {
    for (const { role, to } of issue.links) {
      // A closed Issue joins nothing and puts nothing on the Map.
      if (!isOpen(to)) continue;
      if (to.id === issue.id) continue;
      if (!own.has(to.id)) outside.set(to.id, to);
      if (role === "related") {
        linkBoth(related, issue.id, to.id);
        continue;
      }
      linkBoth(parentOrBlocks, issue.id, to.id);
      const [above, below] = role === "parent" || role === "blocker" ? [to.id, issue.id] : [issue.id, to.id];
      linkOneWay(beneath, above, below);
    }
  }

  // An Issue with a Parent or Blocks Link sits in that tree; Related joins only Issues with neither (ADR 0008).
  const joins = (id: string): Iterable<string> => {
    const tree = parentOrBlocks.get(id);
    if (tree) return tree;
    return [...(related.get(id) ?? [])].filter((other) => !parentOrBlocks.has(other));
  };

  const seen = new Set<string>();
  const groups: Group[] = [];
  for (const issue of snapshot.issues) {
    if (seen.has(issue.id) || !(parentOrBlocks.has(issue.id) || related.has(issue.id))) continue;
    const members: string[] = [];
    const stack = [issue.id];
    seen.add(issue.id);
    while (stack.length > 0) {
      const id = stack.pop()!;
      members.push(id);
      for (const next of joins(id)) {
        if (seen.has(next)) continue;
        seen.add(next);
        stack.push(next);
      }
    }
    groups.push(group(members, own, outside, beneath));
  }
  groups.sort((a, b) => b.issues.length - a.issues.length || a.issues[0]!.createdAt.localeCompare(b.issues[0]!.createdAt));

  const linked = (issue: OpenIssue) => parentOrBlocks.has(issue.id) || related.has(issue.id);
  return {
    onMap: snapshot.issues.filter(linked),
    unlinked: snapshot.issues.filter((issue) => !linked(issue)),
    groups,
  };
}

function group(members: string[], own: Map<string, OpenIssue>, outside: Map<string, FarEnd>, beneath: LinkedTo): Group {
  const issues = members.flatMap((id) => own.get(id) ?? []).sort(oldestFirst);
  const reached = members.flatMap((id) => outside.get(id) ?? []);
  const inGroup = new Set(members);
  const below = (id: string) => {
    const found = new Set<string>();
    const stack = [id];
    while (stack.length > 0) {
      for (const next of beneath.get(stack.pop()!) ?? []) {
        if (next === id || found.has(next) || !inGroup.has(next)) continue;
        found.add(next);
        stack.push(next);
      }
    }
    return found.size;
  };
  // Most under it first; then the Project's own Issues before Outside Issues, oldest first.
  const ranked = members
    .map((id) => ({ id, weight: below(id), issue: own.get(id) }))
    .sort((a, b) => b.weight - a.weight || rank(a.issue) - rank(b.issue) || (a.issue && b.issue ? oldestFirst(a.issue, b.issue) : a.id.localeCompare(b.id)));
  const top = ranked[0]!;
  const head: Head = top.issue ? { kind: "issue", id: top.id, issue: top.issue } : { kind: "outside", id: top.id, end: outside.get(top.id)! };
  return { issues, outside: reached, head };
}

function rank(issue: OpenIssue | undefined): number {
  return issue ? 0 : 1;
}

/** An end this login can't read counts as open: something is there, and it may still be. */
export function isOpen(end: FarEnd): boolean {
  return !end.readable || end.open;
}

export function oldestFirst(a: OpenIssue, b: OpenIssue): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

function linkBoth(linked: LinkedTo, a: string, b: string): void {
  linkOneWay(linked, a, b);
  linkOneWay(linked, b, a);
}

function linkOneWay(linked: LinkedTo, from: string, to: string): void {
  let reached = linked.get(from);
  if (!reached) {
    reached = new Set();
    linked.set(from, reached);
  }
  reached.add(to);
}
