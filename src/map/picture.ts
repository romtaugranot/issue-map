/**
 * A Picture of a Group: the whole Group drawn as rows, one Issue each,
 * joined by their Parent and Blocks Links, when it fits a budget. Pure.
 * Related Links are counted on a row, never drawn (ADR 0008); an Outside
 * Issue's own Links are never read (ADR 0005); an Issue reached a second
 * time is named where it was drawn, not drawn again. A Group that doesn't
 * fit is left to its outline, so a Picture never grows past what one screen
 * holds (#22).
 */
import { byRank, under, type Beneath, type Group, type Member } from "./links.ts";
import { related, topOf } from "./outline.ts";
import { clip, OUTSIDE, oneLine } from "./text.ts";

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
  const rows: string[] = [];
  /** Each member drawn, by the reference of the Issue it was first drawn beneath; `null` at the top. */
  const drawn = new Map<string, string | null>();
  let fits = true;
  const place = (member: Member, above: Member | null, how: Beneath | null, indent: string, last: boolean) => {
    const lead = `${indent}${how === null ? "" : `${last ? "└" : "├"}${how === "blocked" ? "▶" : "─"} `}`;
    const first = drawn.get(member.id);
    if (first !== undefined) {
      const again = `${lead}${ref(member)} also ${first === null ? "at the top" : `under ${first}`}, drawn above`;
      if (again.length > PICTURE_COLUMNS) fits = false;
      rows.push(again);
      return;
    }
    drawn.set(member.id, above && ref(above));
    const row = rowOf(lead, member);
    if (row === null) fits = false;
    rows.push(row ?? "");
    const below = [...(group.beneath.get(member.id) ?? [])].map(([id, how]) => ({ member: group.members.get(id)!, how })).sort((a, b) => ranked(a.member, b.member));
    const deeper = how === null ? indent : `${indent}${last ? "   " : "│  "}`;
    below.forEach((next, i) => place(next.member, member, next.how, deeper, i === below.length - 1));
  };
  /** As the outline orders a level: most under it first, then the Project's own Issues before Outside Issues, oldest first. */
  const ranked = (a: Member, b: Member) => under(group, b.id) - under(group, a.id) || byRank(a, b);
  for (const top of topOf(group).sort(ranked)) place(top, null, null, "", true);
  return fits && rows.length <= PICTURE_ROWS ? rows : null;
}

/** A row naming `member` after `lead`, its title cut to fit; `null` when too little room is left for one. */
function rowOf(lead: string, member: Member): string | null {
  const title = member.kind === "issue" ? member.issue.title : member.end.readable ? member.end.title : null;
  if (title === null) {
    const row = `${lead}${ref(member)}`;
    return row.length > PICTURE_COLUMNS ? null : row;
  }
  const n = related(member);
  const head = `${lead}${ref(member)}${n > 0 ? ` (${n} Related)` : ""}`;
  const room = PICTURE_COLUMNS - head.length - 1;
  if (room >= TITLE_MIN) return `${head} ${clip(oneLine(title), room)}`;
  // A long Outside Issue's path, or a deep row, keeps its reference and leaves its title to its card.
  return head.length > PICTURE_COLUMNS ? null : head;
}

function ref(member: Member): string {
  if (member.kind === "issue") return member.issue.ref;
  return member.end.readable ? `${OUTSIDE}${member.end.ref}` : `${OUTSIDE} an Issue this login can't read`;
}
