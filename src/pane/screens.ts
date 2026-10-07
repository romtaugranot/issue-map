/**
 * What the Issue Map pane's screens say, from the data `issue-map pane`
 * prints (ADR 0014): which screen leads up to which, an Issue's state in the
 * word the chart writes beside it, and the counts the Map screen leads with.
 * Pure, with no Node, since the hooks module imports it.
 */
import type { PaneData } from "../map/pane.ts";
import type { PageGroup } from "../map/page.ts";

/**
 * The screen the pane shows. Each holds one thing and leads to the next;
 * going up follows the Map's own levels, never a trail of presses, so none
 * is kept. Issues are named by reference, not by place, so a screen still
 * names the same Issue once the data is read again.
 */
export type Screen =
  | { kind: "map" }
  /** The Group headed by `head`, opened: its outline from row `from`, with Issue `mark`, the one just left, outlined; `openedAt`, while it grows into the chart. */
  | { kind: "island"; head: string; from?: number; mark?: string; openedAt?: number }
  /** Issue `ref`, its Links from page `page`. */
  | { kind: "issue"; ref: string; page?: number }
  /** A list from page `page`, with Issue `mark`, the one just left, shown and marked. */
  | { kind: "list"; which: List; page?: number; mark?: string };

export type List = "next" | "groups" | "unlinked";

export const LISTS: Record<List, string> = { next: "Take next", groups: "Groups", unlinked: "Unlinked" };

/** A color the chart and the screens draw state in: Take next, Unblocked, Blocked, or neither. */
export type Tone = "pick" | "go" | "stop" | "muted";

export const count = (n: number) => n.toLocaleString("en-US");
export const plural = (n: number, noun: string) => `${count(n)} ${noun}${n === 1 ? "" : "s"}`;
/** 1st, 2nd, 3rd, 4th, 11th, 21st. */
export const ordinal = (n: number) => `${count(n)}${["th", "st", "nd", "rd"][n % 100 >= 11 && n % 100 <= 13 ? 0 : Math.min(n % 10, 4) % 4] ?? "th"}`;
/** A title as plain text: the backticks round its code spans dropped. */
export const plain = (title: string) => title.replace(/`/g, "");
export const isOutside = (d: PaneData, i: number) => d.issues[i]!.ref.startsWith("↗");
/** An Issue's name: its title, or for one this login can't read, its reference. */
export const nameOf = (d: PaneData, i: number) => plain(d.issues[i]!.title) || d.issues[i]!.ref;

/** The Issues of a Group: its head, its top, and each beneath another. */
export function membersOf(g: PageGroup): number[] {
  const all = new Set([g.head, ...g.top]);
  for (let j = 1; j < g.below.length; j += 3) all.add(g.below[j]!);
  return [...all];
}

/** The Group each Issue is first found in, by its place in `issues`. */
export function groupOf(d: PaneData): Map<number, number> {
  const of = new Map<number, number>();
  d.groups.forEach((g, k) => membersOf(g).forEach((i) => of.has(i) || of.set(i, k)));
  return of;
}

export const holdsNext = (d: PaneData, g: PageGroup) => membersOf(g).some((i) => d.issues[i]!.next !== undefined);

/** The Issue to start with: first in Take next. */
export const firstPick = (d: PaneData): number | undefined => d.next.picks[0]?.issue;

/** Whether an open Issue Blocks the Project's own Issue `i`. */
export const isBlocked = (d: PaneData, i: number) => (d.links[i] ?? []).some((l) => l.role === "blocker" && l.open);

/** An Issue's state in the word the chart writes beside it, and its color. */
export function stateOf(d: PaneData, i: number): { word: string; tone: Tone } | null {
  const issue = d.issues[i]!;
  if (isOutside(d, i)) return { word: "Outside", tone: "muted" };
  if (issue.next !== undefined) return { word: `${ordinal(issue.next)} in Take next`, tone: "pick" };
  if (issue.unblocked) return { word: "Unblocked", tone: "go" };
  if (isBlocked(d, i)) return { word: "Blocked", tone: "stop" };
  return null;
}

/** What a Group holds, as its island and its row say it. */
export const groupSaid = (g: PageGroup) => `${plural(g.size, "Issue")}, ${g.unblocked ? `${count(g.unblocked)} Unblocked` : "none Unblocked"}`;

/**
 * The Map screen's share bar: how many to take next, how many on the Map
 * wait, and how many Unlinked are left, Take next's own Unlinked Issues
 * counted once, in Take next.
 */
export function shares(d: PaneData): { next: number; waiting: number; unlinked: number; others: boolean } {
  const unlinked = new Set(d.unlinked);
  const linkedPicks = d.next.picks.filter((p) => !unlinked.has(p.issue)).length;
  const unlinkedPicks = d.next.picks.length - linkedPicks;
  return { next: d.next.picks.length, waiting: Math.max(0, d.onMap - linkedPicks), unlinked: d.unlinked.length - unlinkedPicks, others: unlinkedPicks > 0 };
}

/** Issue `ref`'s place in `issues`, or `undefined` once it's gone. */
export const issueAt = (d: PaneData, ref: string): number | undefined => {
  const i = d.issues.findIndex((issue) => issue.ref === ref);
  return i < 0 ? undefined : i;
};

/** The Group headed by `head`, or failing that the one it's now in, or `undefined` once it's gone. */
export function groupAt(d: PaneData, head: string): number | undefined {
  const k = d.groups.findIndex((g) => d.issues[g.head]!.ref === head);
  if (k >= 0) return k;
  const i = issueAt(d, head);
  return i === undefined ? undefined : groupOf(d).get(i);
}

/** The screen that opens Group `k`. */
export const island = (d: PaneData, k: number, more: { mark?: string; openedAt?: number } = {}): Screen => ({ kind: "island", head: d.issues[d.groups[k]!.head]!.ref, ...more });

/** The screen above `s` and the name its button gives it: an island or a list sits under the Map; an Issue in its island, or, in none, in the Unlinked list. */
export function upOf(d: PaneData, s: Screen): { to: Screen; label: string } | null {
  if (s.kind === "map") return null;
  if (s.kind !== "issue") return { to: { kind: "map" }, label: "Map" };
  const i = issueAt(d, s.ref);
  const k = i === undefined ? undefined : groupOf(d).get(i);
  if (k !== undefined) return { to: island(d, k, { mark: s.ref }), label: `Group ${count(k + 1)}` };
  if (i !== undefined && d.unlinked.includes(i)) return { to: { kind: "list", which: "unlinked", mark: s.ref }, label: "Unlinked" };
  return { to: { kind: "map" }, label: "Map" };
}

/** One row of an opened island's outline: Issue `i`, `depth` in, reached from Issue `from` by a Blocks Link (`blocks`) or a Parent Link. */
export interface OutlineRow {
  i: number;
  depth: number;
  from: number | null;
  blocks: boolean;
}

/** A Group as one column, each Issue once, indented under the one it was first reached from, as the HTML Picture draws a narrow screen. */
export function outline(g: PageGroup): OutlineRow[] {
  const beneath = new Map<number, [number, boolean][]>();
  for (let j = 0; j < g.below.length; j += 3) {
    const above = g.below[j]!;
    if (!beneath.has(above)) beneath.set(above, []);
    beneath.get(above)!.push([g.below[j + 1]!, g.below[j + 2] === 1]);
  }
  const rows: OutlineRow[] = [];
  const seen = new Set<number>();
  // A stack rather than recursion, so a deep Group can't run out of it.
  const stack: OutlineRow[] = [...g.top].reverse().map((i) => ({ i, depth: 0, from: null, blocks: false }));
  while (stack.length) {
    const row = stack.pop()!;
    if (seen.has(row.i)) continue;
    seen.add(row.i);
    rows.push({ ...row, depth: Math.min(row.depth, 4) });
    const under = beneath.get(row.i) ?? [];
    for (let j = under.length - 1; j >= 0; j--) stack.push({ i: under[j]![0], depth: row.depth + 1, from: row.i, blocks: under[j]![1] });
  }
  return rows;
}

/** What the Issue screen says of Issue `i` under its title: "Blocked by #1. Unassigned. 3rd in Take next." */
export function issueSaid(d: PaneData, i: number): { blocked: string | null; state: string; next: string | null } {
  const issue = d.issues[i]!;
  const next = issue.next === undefined ? null : `${ordinal(issue.next)} in Take next.`;
  if (isOutside(d, i)) return { blocked: null, state: "An Outside Issue.", next };
  const blockers = (d.links[i] ?? []).filter((l) => l.role === "blocker" && l.open).map((l) => l.ref);
  const assigned = d.assigned.includes(i) ? "Assigned." : "Unassigned.";
  if (blockers.length > 0) {
    const named = blockers.length > 2 ? `${blockers.slice(0, 2).join(", ")} and ${count(blockers.length - 2)} more` : blockers.join(" and ");
    return { blocked: `Blocked by ${named}.`, state: assigned, next };
  }
  return { blocked: null, state: `${issue.unblocked ? "Unblocked. " : ""}${assigned}`, next };
}

/** A Link's kind as the Issue screen lists it, from what the far end is to the Issue. */
export const ROLES = { blocker: "Blocked by", blocked: "Blocks", parent: "Parent", child: "Child", related: "Related" } as const;
