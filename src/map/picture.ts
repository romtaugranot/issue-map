/**
 * A Picture of a Group: the whole Group drawn as rows, one Issue each,
 * joined by their Parent and Blocks Links, when it fits a budget. Pure.
 * Related Links are counted on a row, never drawn (ADR 0008); an Outside
 * Issue's own Links are never read (ADR 0005); an Issue reached a second
 * time is named where it was drawn, not drawn again. A Group that doesn't
 * fit is left to its outline, so a Picture never grows past what one screen
 * holds (#22); the Picture around one of its Issues still draws.
 */
import { byRank, under, type Beneath, type Group, type Member } from "./links.ts";
import { related, topOf } from "./outline.ts";
import { clip, count, OUTSIDE, oneLine } from "./text.ts";

/** Issues a Picture draws at most, Outside Issues among them: about 99% of recorded Groups hold no more. */
export const PICTURE_ISSUES = 25;
/** Rows a Picture holds at most, those naming an Issue drawn above among them. */
export const PICTURE_ROWS = 30;
/** Characters a row holds at most, its title cut to fit; wide characters, such as CJK, take two columns, so a row of them runs wider. */
export const PICTURE_COLUMNS = 72;
/** The fewest characters a title is cut to; a row that leaves less shows no title. */
const TITLE_MIN = 16;

/** The Group's rows, top first; `null` when it doesn't fit the budget. */
export function picture(group: Group): string[] | null {
  if (group.members.size > PICTURE_ISSUES) return null;
  const drawn = rowsOf(group, topOf(group).sort(ranked(group)), (member) => ({ next: beneathOf(group, member), more: 0 }));
  return drawn && drawn.rows;
}

/** Steps a Picture around an Issue goes above and beneath it at most. */
export const AROUND_STEPS = 3;
/** Issues a step of a Picture around an Issue holds at most, above it in all and beneath each Issue; the rest are counted. */
export const AROUND_STEP = 5;

/**
 * The Picture around one member of a Group (#82): it, marked, in the middle;
 * above it, its Parents and what it waits on; beneath it, its children and
 * what waits on it; each up to a few steps, each step capped, the rest
 * counted, and nothing beside it. Its rows and the members drawn; `null`
 * only when not even one step each way, one Issue a step, fits the budget.
 * It revisits #22, which rejected drawing only what waits on what: the
 * recorded 7-step Blocks chains are too deep to read a level at a time.
 */
export function around(group: Group, center: Member): { rows: string[]; drawn: Member[] } | null {
  // Where the most fails the budget, fewer steps or fewer Issues a step may fit.
  for (const [steps, cap] of [[AROUND_STEPS, AROUND_STEP], [AROUND_STEPS, 3], [2, 2], [1, 1]] as const) {
    const drawn = aroundWithin(group, center, steps, cap);
    if (drawn) return drawn;
  }
  return null;
}

function aroundWithin(group: Group, center: Member, steps: number, cap: number): { rows: string[]; drawn: Member[] } | null {
  const above = new Map<string, Member[]>();
  for (const [id, below] of group.beneath) for (const next of below.keys()) above.set(next, [...(above.get(next) ?? []), group.members.get(id)!]);
  // Above it, step by step, nearest first: the step each Issue drawn there is at.
  const stepOf = new Map<string, number>([[center.id, 0]]);
  let step = [center];
  for (let k = 1; k <= steps && step.length > 0; k++) {
    const reached = new Map(step.flatMap(({ id }) => above.get(id) ?? []).filter(({ id }) => !stepOf.has(id)).map((m) => [m.id, m]));
    step = [...reached.values()].sort(ranked(group)).slice(0, cap);
    for (const { id } of step) stepOf.set(id, k);
  }
  // Everything above it, however far, so what isn't drawn there is counted.
  const all = new Set<string>([center.id]);
  const reach = [center.id];
  while (reach.length > 0) {
    for (const { id } of above.get(reach.pop()!) ?? []) {
      if (all.has(id)) continue;
      all.add(id);
      reach.push(id);
    }
  }
  const untold = [...all].filter((id) => !stepOf.has(id)).length;
  // The top: each Issue drawn above it that nothing drawn sits above.
  const tops = [...stepOf].filter(([id, k]) => !(above.get(id) ?? []).some((m) => stepOf.get(m.id) === k + 1)).map(([id]) => group.members.get(id)!);
  tops.sort((a, b) => stepOf.get(b.id)! - stepOf.get(a.id)! || ranked(group)(a, b));
  let centerAt = 0;
  const drawn = rowsOf(
    group,
    tops,
    (member, depth) => {
      const k = member === center ? undefined : stepOf.get(member.id);
      // Above it, each Issue leads only toward it, a step at a time.
      if (k !== undefined) return { next: beneathOf(group, member).filter((next) => stepOf.get(next.member.id) === k - 1), more: 0 };
      if (member === center) centerAt = depth;
      if (depth - centerAt >= steps) return { cut: under(group, member.id) };
      const next = beneathOf(group, member);
      return { next: next.slice(0, cap), more: next.length - Math.min(next.length, cap) };
    },
    center,
  );
  if (!drawn) return null;
  const rows = untold > 0 ? [`… ${untold} more above`, ...drawn.rows] : drawn.rows;
  return rows.length > PICTURE_ROWS ? null : { rows, drawn: drawn.members };
}

/** What a row has beneath it: the members to draw there, and how many more are left out; or, where its branch is cut, how many sit under it. */
type Below = { next: Next[]; more: number } | { cut: number };
type Next = { member: Member; how: Beneath };

/** The members directly beneath one, in the order a level of the outline gives them. */
function beneathOf(group: Group, member: Member): Next[] {
  return [...(group.beneath.get(member.id) ?? [])].map(([id, how]) => ({ member: group.members.get(id)!, how })).sort((a, b) => ranked(group)(a.member, b.member));
}

/** As the outline orders a level: most under it first, then the Project's own Issues before Outside Issues, oldest first. */
function ranked(group: Group): (a: Member, b: Member) => number {
  return (a, b) => under(group, b.id) - under(group, a.id) || byRank(a, b);
}

/**
 * Rows drawing `tops` and what `below` puts beneath each, depth first; a
 * member reached a second time is named where it was drawn. `marked` is
 * drawn with `●`. `null` when a row or the rows run past the budget.
 */
function rowsOf(group: Group, tops: Member[], below: (member: Member, depth: number) => Below, marked?: Member): { rows: string[]; members: Member[] } | null {
  const rows: string[] = [];
  /** Each member drawn, by the reference of the Issue it was first drawn beneath; `null` at the top. */
  const drawn = new Map<string, string | null>();
  const members: Member[] = [];
  let fits = true;
  const place = (member: Member, above: Member | null, how: Beneath | null, indent: string, last: boolean, depth: number) => {
    const lead = `${indent}${how === null ? "" : `${last ? "└" : "├"}${how === "blocked" ? "▶" : "─"} `}`;
    const first = drawn.get(member.id);
    if (first !== undefined) {
      const again = `${lead}${ref(member)} also ${first === null ? "at the top" : `under ${first}`}, drawn above`;
      if (again.length > PICTURE_COLUMNS) fits = false;
      rows.push(again);
      return;
    }
    drawn.set(member.id, above && ref(above));
    members.push(member);
    const beneath = below(member, depth);
    const row = rowOf(`${lead}${member === marked ? "● " : ""}`, member, "cut" in beneath ? beneath.cut : 0);
    if (row === null) fits = false;
    rows.push(row ?? "");
    if ("cut" in beneath) return;
    const deeper = how === null ? indent : `${indent}${last ? "   " : "│  "}`;
    beneath.next.forEach((next, i) => place(next.member, member, next.how, deeper, i === beneath.next.length - 1 && beneath.more === 0, depth + 1));
    if (beneath.more > 0) rows.push(`${deeper}└ … ${count(beneath.more)} more`);
  };
  for (const top of tops) place(top, null, null, "", true, 0);
  return fits && rows.length <= PICTURE_ROWS ? { rows, members } : null;
}

/** A row naming `member` after `lead`, its title cut to fit; `null` when too little room is left for one. */
function rowOf(lead: string, member: Member, cut = 0): string | null {
  const title = member.kind === "issue" ? member.issue.title : member.end.readable ? member.end.title : null;
  if (title === null) {
    const row = `${lead}${ref(member)}`;
    return row.length > PICTURE_COLUMNS ? null : row;
  }
  const n = related(member);
  const said = [cut > 0 ? `${count(cut)} under it` : "", n > 0 ? `${n} Related` : ""].filter(Boolean);
  const head = `${lead}${ref(member)}${said.length > 0 ? ` (${said.join(" · ")})` : ""}`;
  const room = PICTURE_COLUMNS - head.length - 1;
  if (room >= TITLE_MIN) return `${head} ${clip(oneLine(title), room)}`;
  // A long Outside Issue's path, or a deep row, keeps its reference and leaves its title to its card.
  return head.length > PICTURE_COLUMNS ? null : head;
}

function ref(member: Member): string {
  if (member.kind === "issue") return member.issue.ref;
  return member.end.readable ? `${OUTSIDE}${member.end.ref}` : `${OUTSIDE} an Issue this login can't read`;
}
