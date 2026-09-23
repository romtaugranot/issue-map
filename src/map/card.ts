/**
 * The Issue card: what the Map shows about one Issue, read live. Pure. Its
 * Links are offered as the choices to move along.
 */
import type { IssueRead, NamedLink } from "../tracker/tracker.ts";
import { isOpen } from "./links.ts";
import { count, OUTSIDE, plural, trim } from "./text.ts";
import type { Drawing } from "./draw.ts";

/** A choice to offer in a picker: its label is what opens it, typed as it is. */
export interface Choice {
  label: string;
  description: string;
}

export interface Card extends Drawing {
  /** The card's Links that can be followed, in the order it shows them. */
  choices: Choice[];
}

/** Where a Link's kind comes on the card: up the tree and what holds it back first, then what it holds. */
const ROLE_ORDER: NamedLink["role"][] = ["parent", "blocker", "blocked", "child", "related"];
/** Links of one kind on a card; the rest are held in a count. */
const PER_KIND = 10;

/**
 * `project` is the path of the Project whose Map the card opens from; an
 * Issue in any other is an Outside Issue. Page 2 on shows the next 10 Links
 * of each kind that has more, and nothing else.
 */
export function drawCard(issue: IssueRead, project: string, page = 1): Card {
  const head = [`**${short(issue.ref, project)} ${trim(issue.title)}**`, issue.url];
  const outside = issue.project !== project;
  if (outside || !issue.open) {
    const state = issue.open ? "Open" : `Closed${issue.closedAs ? ` as ${issue.closedAs}` : ""}`;
    const why = outside
      ? ` · an Outside Issue, in ${issue.project}. The Map hasn't read that Project, so this card shows none of its Links.`
      : ". A closed Issue isn't on the Map, so this card shows none of its Links.";
    return { text: [...head, `${state}${why}`].join("\n"), choices: [] };
  }
  const lines = [...head, blocked(issue)];
  const choices: Choice[] = [];
  const kinds = byName(issue.links);
  const pages = Math.max(1, ...kinds.map(([, links]) => Math.ceil(links.length / PER_KIND)));
  const at = Math.min(Math.max(1, page), pages);
  const from = (at - 1) * PER_KIND;
  if (kinds.length > 0) lines.push("");
  for (const [name, links] of kinds) {
    const shown = links.slice(from, from + PER_KIND);
    if (shown.length === 0) continue;
    const range = at > 1 ? ` · ${from + 1}–${from + shown.length}` : "";
    lines.push(links.length > 1 ? `**${name}: ${count(links.length)}**${range}` : `**${name}**`);
    for (const { to } of shown) {
      if (!to.readable) {
        lines.push(`- ${OUTSIDE} an Issue this login can't read`);
        continue;
      }
      const ref = short(to.ref, project);
      lines.push(`- ${ref} ${trim(to.title)}${to.open ? "" : " — closed"}`);
      const outside = ref.startsWith(OUTSIDE);
      choices.push({
        label: outside ? to.ref : ref,
        description: [name, to.open ? "" : "closed", `${outside ? `${OUTSIDE} ` : ""}${trim(to.title)}`].filter(Boolean).join(" · "),
      });
    }
    const left = links.length - from - shown.length;
    if (left > 0) lines.push(`- … ${count(left)} more — \`more\` for the next ${PER_KIND}`);
  }
  if (at > 1) return { text: lines.join("\n"), choices };
  lines.push(...closingRequests(issue));
  const mentions = mentionedOnly(issue);
  if (mentions > 0) {
    lines.push("", `Mentioned by ${plural(mentions, "other Issue")} — Mentions aren't Links. Ask for Link Suggestions to see whether any should be.`);
  }
  return { text: lines.join("\n"), choices };
}

function closingRequests({ closingRequests, unread }: IssueRead): string[] {
  if (unread.closingRequests !== undefined) return ["", `**Closing Requests: unread** — ${unread.closingRequests}`];
  if (closingRequests.length === 0) return [];
  return [
    "",
    `**Closing Requests: ${count(closingRequests.length)} open** — not Issues, so never followed`,
    ...closingRequests.map(({ ref, url, draft, author }) => `- ${ref} by ${author}${draft ? ", draft" : ""} ${url}`),
  ];
}

/** The other Issues whose text names it and that no Link joins it to. */
function mentionedOnly({ id, links, mentionedBy }: IssueRead): number {
  const linked = new Set(links.map(({ to }) => to.id));
  return new Set(mentionedBy.filter((other) => other !== id && !linked.has(other))).size;
}

function blocked({ links, unread }: IssueRead): string {
  if (unread.blocks !== undefined) return `Blocked: can't tell — ${unread.blocks}`;
  const blockers = links.filter((link) => link.role === "blocker" && isOpen(link.to)).length;
  return blockers > 0 ? `**Blocked** — ${plural(blockers, "open Issue")} ${blockers === 1 ? "Blocks" : "Block"} it` : "Not Blocked";
}

/**
 * The Links under each of the Tracker's names for their kind, in the card's
 * order of kinds; open Issues first, then in the order the Tracker gave them.
 */
function byName(links: NamedLink[]): [string, NamedLink[]][] {
  const named = new Map<string, NamedLink[]>();
  const openFirst = [...links].sort((a, b) => Number(!isOpen(a.to)) - Number(!isOpen(b.to)));
  for (const role of ROLE_ORDER) {
    for (const link of openFirst) if (link.role === role) named.set(link.name, [...(named.get(link.name) ?? []), link]);
  }
  return [...named];
}

/** A reference inside the Project as users type it there, such as `#12`; one outside it marked as an Outside Issue. */
function short(ref: string, project: string): string {
  return ref.startsWith(`${project}#`) ? ref.slice(project.length) : `${OUTSIDE}${ref}`;
}
