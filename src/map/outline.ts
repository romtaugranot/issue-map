/**
 * A Group's outline: what sits at its top, or directly beneath one of its
 * Issues, one level at a time. Pure. Related Links have no place in the
 * tree, so an Issue's are only counted (ADR 0008).
 */
import type { Snapshot } from "../snapshot/snapshot.ts";
import type { OpenIssue } from "../tracker/tracker.ts";
import { byRank, isOpen, under, type Beneath, type Group, type Layout, type Member } from "./links.ts";

export interface Entry {
  member: Member;
  /** How it sits beneath the Issue whose level this is; `null` at the top. */
  how: Beneath | null;
  /** The Project's own Issues anywhere beneath it. */
  under: number;
  /** Its Related Links to open Issues; an Outside Issue's are never read. */
  related: number;
}

export type Opened =
  | {
      kind: "level";
      /** Its place among the Groups, from 1, largest first. */
      place: number;
      /** How many Groups the Map has. */
      groups: number;
      group: Group;
      /** The Issue whose level this is, or `null` for the Group's top. */
      above: Member | null;
      /** Whether `above` is alone at the Group's top, so opening the Group opened the level beneath it. */
      alone: boolean;
      /** Most under it first. */
      entries: Entry[];
    }
  | { kind: "no-group"; groups: number }
  | { kind: "not-on-map"; ref: string; unlinked: boolean };

/** Group `place`'s top; when one Issue is alone there, the level beneath it instead. */
export function openGroup({ groups }: Layout, place: number): Opened {
  const group = groups[place - 1];
  if (!group) return { kind: "no-group", groups: groups.length };
  const tops = topOf(group);
  if (tops.length === 1 && group.beneath.has(tops[0]!.id)) return level(group, place, groups.length, tops[0]!, true);
  const entries = rank(tops.map((member) => entry(group, member, null)));
  return { kind: "level", place, groups: groups.length, group, above: null, alone: false, entries };
}

/** The level directly beneath the Issue `ref` names, in its Group. */
export function openUnder(snapshot: Snapshot, { groups, unlinked }: Layout, ref: string): Opened {
  const typed = ref.replace(/^↗\s*/, "");
  const names = namedBy(snapshot, typed);
  const named = (member: Member) => (member.kind === "issue" ? names(member.issue) : member.end.readable && (member.end.ref === typed || member.end.url === typed));
  for (const [i, group] of groups.entries()) {
    for (const member of group.members.values()) if (named(member)) return level(group, i + 1, groups.length, member, false);
  }
  return { kind: "not-on-map", ref: typed, unlinked: unlinked.some(names) };
}

/**
 * Whether what the user typed names one of the Project's own Issues: its
 * reference, alone or after the Project's path, its URL, or an Issue or
 * work-item URL in the Project with its number, the shapes the adapters
 * read, since a Tracker may serve one Issue at more than one. Host and path
 * match in any case, and a query or fragment, as on a comment's link, is
 * left aside.
 */
function namedBy({ project }: Snapshot, typed: string): (issue: OpenIssue) => boolean {
  const lower = typed.toLowerCase();
  const inProject = `${project.url.toLowerCase()}/`;
  const number = lower.startsWith(inProject) ? /^(?:-\/)?(?:issues|work_items)\/(\d+)\/?(?:[?#].*)?$/.exec(lower.slice(inProject.length))?.[1] : undefined;
  return (issue) => issue.ref === typed || `${project.path}${issue.ref}` === typed || issue.url === typed || (number !== undefined && issue.ref === `#${number}`);
}

function level(group: Group, place: number, groups: number, above: Member, alone: boolean): Opened {
  const entries = [...(group.beneath.get(above.id) ?? [])].map(([id, how]) => entry(group, group.members.get(id)!, how));
  return { kind: "level", place, groups, group, above, alone, entries: rank(entries) };
}

/**
 * The members nothing in the Group sits above. Where Links run in a circle
 * and leave some out of reach, the first of those by rank joins the top too.
 */
function topOf(group: Group): Member[] {
  const beneathSome = new Set([...group.beneath.values()].flatMap((below) => [...below.keys()]));
  const tops = [...group.members.values()].filter((member) => !beneathSome.has(member.id));
  const reached = new Set<string>();
  const reach = (id: string) => {
    const stack = [id];
    reached.add(id);
    while (stack.length > 0) {
      for (const next of group.beneath.get(stack.pop()!)?.keys() ?? []) {
        if (reached.has(next)) continue;
        reached.add(next);
        stack.push(next);
      }
    }
  };
  tops.forEach((top) => reach(top.id));
  for (;;) {
    const left = [...group.members.values()].filter((member) => !reached.has(member.id));
    if (left.length === 0) return tops;
    const first = left.map((member) => ({ member, under: under(group, member.id) })).sort((a, b) => b.under - a.under || byRank(a.member, b.member))[0]!.member;
    tops.push(first);
    reach(first.id);
  }
}

function entry(group: Group, member: Member, how: Beneath | null): Entry {
  return { member, how, under: under(group, member.id), related: related(member) };
}

function related(member: Member): number {
  if (member.kind !== "issue") return 0;
  const ends = member.issue.links.filter(({ role, to }) => role === "related" && isOpen(to) && to.id !== member.id);
  return new Set(ends.map(({ to }) => to.id)).size;
}

/** Most under it first; then the Project's own Issues before Outside Issues, oldest first. */
function rank(entries: Entry[]): Entry[] {
  return entries.sort((a, b) => b.under - a.under || byRank(a.member, b.member));
}
