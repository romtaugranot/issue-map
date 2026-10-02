/**
 * The Issue card: what the Map shows about one Issue, read live. Pure. Its
 * Links are offered as the choices to move along, any open Issue is offered
 * to start work on, and an unassigned one in the Project is offered to the
 * viewer, where the Map writes (ADR 0003).
 */
import type { IssueRead, NamedLink, WriteAnswer } from "../tracker/tracker.ts";
import { wontWrite, type Band } from "./band.ts";
import { isOpen } from "./links.ts";
import { count, howClosed, OUTSIDE, plainTitle, plural, short, title } from "./text.ts";
import type { Drawing } from "./draw.ts";

/** A choice to offer in a picker: its label is what opens it, typed as it is. */
export interface Choice {
  label: string;
  description: string;
}

export interface Card extends Drawing {
  /** The card's Links that can be followed, in the order it shows them. */
  choices: Choice[];
  /** A move to the Map of the Project an Outside Issue is in; `target` is what `go` takes to make it. */
  move?: Move;
  /** An offer to assign the Issue to the viewer; `ref` is what `assign` takes to make it. */
  assign?: Assign;
  /** An offer to start work on the Issue; `ref` is what `start` takes to make it. */
  start?: Start;
}

export interface Move extends Choice {
  target: string;
}

export interface Assign extends Choice {
  ref: string;
}

export interface Start extends Choice {
  ref: string;
}

/** What the card knows besides the Issue. */
export interface CardContext {
  /** The viewer's login, where it's known. */
  viewer?: string;
  /** Where it was asked: the Tracker's product, the Project's band, and whether this login can write there. */
  writes?: { product: string; band: Band; write: WriteAnswer };
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
export function drawCard(issue: IssueRead, project: string, page = 1, context: CardContext = {}): Card {
  // Hard breaks, so each of the first lines renders as a line of its own.
  const head = [`**${short(issue.ref, project)} ${title(issue.title)}**\\`, `${issue.url}\\`];
  const outside = issue.project !== project;
  if (outside || !issue.open) {
    const state = issue.open ? "Open" : `Closed${issue.closedAs ? ` as ${issue.closedAs}` : ""}`;
    const why = outside
      ? ` · an Outside Issue, in ${issue.project}. The Map hasn't read that Project, so this card shows none of its Links.`
      : ". A closed Issue isn't on the Map, so this card shows none of its Links.";
    const text = [...head, `${state}${why}`].join("\n");
    if (!outside) return { text, choices: [] };
    // Its own Project's Map reads its Links, so the move lands on its card there.
    const start = issue.open ? { start: startOffer(short(issue.ref, project), issue.ref) } : {};
    return { text, choices: [], ...start, move: { label: `Open ${issue.project}'s Map`, description: "on this Issue's card there, which shows its Links", target: issue.url } };
  }
  const lines = [...head, `${blocked(issue)} · ${assigned(issue, context.viewer)}`];
  const choices: Choice[] = [];
  const assign = offer(issue, project, context);
  const start = startOffer(short(issue.ref, project));
  const kinds = byName(issue.links);
  const pages = Math.max(1, ...kinds.map(([, links]) => Math.ceil(links.length / PER_KIND)));
  const at = Math.min(Math.max(1, page), pages);
  const from = (at - 1) * PER_KIND;
  for (const [name, links] of kinds) {
    const shown = links.slice(from, from + PER_KIND);
    if (shown.length === 0) continue;
    const range = at > 1 ? ` · ${from + 1}–${from + shown.length}` : "";
    // A blank line before each kind, so none reads as part of the list above it.
    lines.push("", links.length > 1 ? `**${name}: ${count(links.length)}**${range}` : `**${name}**`);
    for (const { to } of shown) {
      if (!to.readable) {
        lines.push(`- ${OUTSIDE} an Issue this login can't read`);
        continue;
      }
      const ref = short(to.ref, project);
      const how = howClosed(to.closedAs);
      const closed = to.open ? "" : how ? `closed ${how}` : "closed";
      lines.push(`- ${ref} ${title(to.title)}${closed ? ` — ${closed}` : ""}`);
      const outside = ref.startsWith(OUTSIDE);
      choices.push({
        label: outside ? to.ref : ref,
        description: [name, closed, `${outside ? `${OUTSIDE} ` : ""}${plainTitle(to.title)}`].filter(Boolean).join(" · "),
      });
    }
    const left = links.length - from - shown.length;
    if (left > 0) lines.push(`- … ${count(left)} more — \`more\` for the next ${PER_KIND}`);
  }
  const offered = { ...(assign ? { assign } : {}), start };
  if (at > 1) return { text: lines.join("\n"), choices, ...offered };
  if (issue.unread.children !== undefined) lines.push("", `**Child items: more unread** — ${issue.unread.children}`);
  lines.push(...closingRequests(issue));
  const mentions = mentionedOnly(issue);
  if (issue.unread.mentions !== undefined) lines.push("", `**Mentions: unread** — ${issue.unread.mentions}`);
  if (mentions > 0) {
    lines.push("", `Mentioned by ${plural(mentions, "other Issue")} — Mentions aren't Links. Ask for Link Suggestions to see whether any should be.`);
  }
  return { text: lines.join("\n"), choices, ...offered };
}

/** Whom it's assigned to, the viewer first, as you. */
function assigned({ assignees }: IssueRead, viewer: string | undefined): string {
  if (assignees.length === 0) return "unassigned";
  const names = viewer !== undefined && assignees.includes(viewer) ? ["you", ...assignees.filter((a) => a !== viewer)] : assignees;
  return `assigned to ${names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`}`;
}

/**
 * The offer to assign an unassigned Issue to the viewer: only on a Promised
 * Project, where the Map writes, and where this login can write or the
 * Tracker can't say, when the write stops at the first refusal.
 */
function offer(issue: IssueRead, project: string, { viewer, writes }: CardContext): Assign | undefined {
  if (viewer === undefined || !writes || wontWrite(writes.band, writes.write) !== null || issue.assignees.length > 0) return undefined;
  const ref = short(issue.ref, project);
  const write = `writes to ${writes.product}: assigns ${ref} to ${viewer}`;
  const unsure = writes.write.kind === "cant-tell" ? `. ${writes.product} doesn't say whether this login may (${writes.write.reason}), so it stops at the first refusal` : "";
  return { label: `Assign ${ref} to me`, description: `${write}${unsure}`, ref };
}

/**
 * The offer to start work on an open Issue, an Outside Issue among them: it
 * only reads, so it's offered on every band. `shown` is its reference as the
 * card shows it, `ref` as `start` takes it.
 */
function startOffer(shown: string, ref = shown): Start {
  return { label: `Start work on ${shown}`, description: "reads its body and comments to brief you; makes no branch and opens no editor", ref };
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
  return new Set(mentionedBy.filter((other) => other.id !== id && !linked.has(other.id)).map((other) => other.id)).size;
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
