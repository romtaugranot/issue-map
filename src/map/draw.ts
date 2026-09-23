/**
 * The drawing module: pure. It takes a Snapshot and a command and returns
 * the text to print. No network, no wall clock, no `gh`/`glab`.
 */
import type { Snapshot } from "../snapshot/snapshot.ts";
import type { OpenIssue } from "../tracker/tracker.ts";
import { layout, type Group, type Layout, type Member } from "./links.ts";
import { openGroup, openUnder, type Entry, type Opened } from "./outline.ts";
import { takeNext, type Pick } from "./take-next.ts";
import { count, OUTSIDE, plural, trim } from "./text.ts";

export type Command =
  | { kind: "overview" }
  /** Pages count from 1. */
  | { kind: "unlinked"; page: number }
  /** A Group's outline, by its place on the overview counting from 1. */
  | { kind: "group"; group: number; page: number }
  /** The level beneath the Issue a reference or URL names, in its Group. */
  | { kind: "under"; ref: string; page: number };

export interface Drawing {
  text: string;
}

/** Take next lines on the overview. */
const TAKE_NEXT_LINES = 5;
/** Children standing in for one Parent in Take next; the rest are held in a count, so one Parent can't fill it. */
const STAND_INS = 3;
/** Group lines on the overview; the rest are held in a count. */
const GROUP_LINES = 8;
/** Unlinked Issues a page. */
const PAGE = 15;
/** Issues a page of one level of an outline. */
const OUTLINE_PAGE = 10;

export function draw(snapshot: Snapshot, command: Command): Drawing {
  switch (command.kind) {
    case "overview":
      return { text: overview(snapshot) };
    case "unlinked":
      return { text: unlinkedPage(layout(snapshot).unlinked, command.page).join("\n") };
    case "group":
      return { text: outline(snapshot, openGroup(layout(snapshot), command.group), command.page) };
    case "under":
      return { text: outline(snapshot, openUnder(snapshot, layout(snapshot), command.ref), command.page) };
  }
}

/** How far a first read has got; `elapsedMs` is the time it has spent reading so far. */
export interface ReadProgress {
  read: number;
  total: number;
  elapsedMs: number;
  /** Why it stopped, when it has. */
  stopped?: string;
}

/** A first read draws no Map at all, only progress, because a partial Snapshot is never drawn (ADR 0006). */
export function drawProgress(project: string, { read, total, elapsedMs, stopped }: ReadProgress): Drawing {
  const percent = total > 0 ? Math.floor((100 * read) / total) : 0;
  let line = `⏳ ${count(read)} of ${count(total)} Issues read (${percent}%)`;
  if (read > 0 && !stopped) line += ` · ${timeLeft((elapsedMs / read) * Math.max(0, total - read))}`;
  return {
    text: [
      `**${project}** · ${count(total)} open · reading it for the first time`,
      "",
      line,
      stopped
        ? `The read stopped: ${stopped}. Asking for the Map again resumes it where it stopped.`
        : "The Map draws when the read finishes, since part of one would be wrong. Ask for the Map again to see how far it's got.",
    ].join("\n"),
  };
}

function timeLeft(ms: number): string {
  const seconds = ms / 1000;
  return seconds > 90 ? `about ${Math.round(seconds / 60)} min left` : `about ${Math.round(seconds)}s left`;
}

function overview(snapshot: Snapshot): string {
  const laidOut = layout(snapshot);
  const { onMap, unlinked, groups } = laidOut;
  const header = `**${snapshot.project.path}** · ${count(snapshot.issues.length)} open · ${count(onMap.length)} on the Map · ${count(unlinked.length)} Unlinked`;
  const unlinkedLine = `**Unlinked: ${count(unlinked.length)}** — no Link to another open Issue. Ask to list them.`;
  if (onMap.length === 0) return [header, "", "No Issue here has a Link, so there's no Map to draw.", "", unlinkedLine].join("\n");
  const lines = [
    header,
    "",
    ...takeNextSection(snapshot, laidOut),
    "",
    `**Groups: ${count(groups.length)}** — largest first`,
    ...groups.slice(0, GROUP_LINES).map(groupLine),
  ];
  const rest = groups.slice(GROUP_LINES);
  if (rest.length > 0) {
    lines.push(`- … ${count(rest.length)} more Groups, ${plural(rest.reduce((sum, g) => sum + g.issues.length, 0), "Issue")}`);
  }
  lines.push("", unlinkedLine);
  return lines.join("\n");
}

function takeNextSection(snapshot: Snapshot, laidOut: Layout): string[] {
  const next = takeNext(snapshot, laidOut);
  if (next.kind === "blocks-unread") {
    return [`**Take next: none** — the Map can't read this Project's Blocks Links (${next.reason}), so it calls no Issue Unblocked`];
  }
  const { picks, takenByOthers, closingRequestsUnread } = next;
  const unread = closingRequestsUnread === null ? "" : ` · Closing Requests unread (${closingRequestsUnread}), so none leaves an Issue out`;
  if (picks.length === 0 && takenByOthers > 0) {
    return [`**Take next: 0** — all ${plural(takenByOthers, "Unblocked Issue")} ${takenByOthers === 1 ? "is" : "are"} taken by others${unread}`];
  }
  if (picks.length === 0) return [`**Take next: 0** — every Issue on the Map is Blocked, or a Parent of Blocked Issues${unread}`];
  const taken = takenByOthers > 0 ? ` · ${count(takenByOthers)} taken by others` : "";
  return [`**Take next: ${count(picks.length)}** — most waited on first${taken}${unread}`, ...pickLines(picks)];
}

/** Take next's lines, where the children standing in for one Parent past the first few are held in a count. */
function pickLines(picks: Pick[]): string[] {
  const lines: string[] = [];
  const shownUnder = new Map<OpenIssue, number>();
  for (const pick of picks) {
    if (lines.length === TAKE_NEXT_LINES) break;
    const parent = pick.waiting.via;
    if (!parent) {
      lines.push(pickLine(pick));
      continue;
    }
    const shown = shownUnder.get(parent) ?? 0;
    shownUnder.set(parent, shown + 1);
    if (shown < STAND_INS) lines.push(pickLine(pick));
    else if (shown === STAND_INS) lines.push(`- … ${count(picks.filter((p) => p.waiting.via === parent).length - STAND_INS)} more under ${parent.ref}`);
  }
  return lines;
}

function pickLine({ issue, waiting: { count: n, via, carried }, yours }: Pick): string {
  const waits = n === 0 ? "" : carried ? `▶${count(n)} via ${via!.ref}` : `▶${count(n)} wait on it`;
  const standsIn = via && !(n > 0 && carried) ? `via ${via.ref}` : "";
  const reasons = [waits, standsIn, issue.planned ? `due ${issue.planned.slice(0, 10)}` : "", yours ? "yours" : ""].filter(Boolean);
  return `- ${issue.ref} ${trim(issue.title)}${reasons.length > 0 ? ` — ${reasons.join(" · ")}` : ""}`;
}

function unlinkedPage(unlinked: OpenIssue[], page: number): string[] {
  const pages = Math.max(1, Math.ceil(unlinked.length / PAGE));
  const at = Math.min(Math.max(1, page), pages);
  const newestFirst = [...unlinked].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  const shown = newestFirst.slice((at - 1) * PAGE, at * PAGE);
  return [
    `**Unlinked: ${count(unlinked.length)}** — newest first, page ${count(at)} of ${count(pages)}`,
    ...shown.map((issue) => `- ${issue.ref} ${trim(issue.title)}`),
    at < pages ? `_\`more\` for the next ${PAGE}_` : "_That's all of them. `map` for the Map._",
  ];
}

function outline(snapshot: Snapshot, opened: Opened, page: number): string {
  if (opened.kind === "no-group") {
    if (opened.groups === 0) return "No Issue here has a Link, so there's no Group to open. `map` for the Map.";
    return `There ${opened.groups === 1 ? "is" : "are"} only ${plural(opened.groups, "Group")} on the Map of ${snapshot.project.path}. \`map\` for the Map.`;
  }
  if (opened.kind === "not-on-map") {
    if (opened.unlinked) return `${opened.ref} is Unlinked: it has no Link to another open Issue, so it's in no Group.`;
    return `No Issue on the Map of ${snapshot.project.path} is ${opened.ref}. \`map\` for the Map.`;
  }
  const { place, groups, group, above, alone, entries } = opened;
  const head = `${name(group.head)}${group.head.kind === "outside" ? " (an Outside Issue)" : ""}`;
  const lines = [`**Group ${count(place)} of ${count(groups)}** · ${head} — ${groupSize(group)}`, ""];
  if (above && entries.length === 0) {
    lines.push(`Nothing sits beneath ${label(above)} in this Group.`, "_`map` for the Map_");
    return lines.join("\n");
  }
  const pages = Math.max(1, Math.ceil(entries.length / OUTLINE_PAGE));
  const at = Math.min(Math.max(1, page), pages);
  const where = above ? `Under ${label(above)}${alone ? ", alone at the top" : ""}` : "At the top";
  lines.push(`**${where}: ${count(entries.length)}** — most under it first${pages > 1 ? ` · page ${count(at)} of ${count(pages)}` : ""}`);
  const shown = entries.slice((at - 1) * OUTLINE_PAGE, at * OUTLINE_PAGE);
  lines.push(...shown.map(entryLine));
  const hints = [
    at < pages ? `\`more\` for the next ${OUTLINE_PAGE}` : "",
    entries.some((e) => e.under > 0 || e.how === null) ? "name one to open the level below it" : "",
    "`map` for the Map",
  ].filter(Boolean);
  const hint = hints.join(" · ");
  lines.push(`_${hint[0]!.toUpperCase()}${hint.slice(1)}_`);
  return lines.join("\n");
}

function entryLine({ member, how, under, related }: Entry): string {
  const reasons = [how === "blocked" ? "Blocked by it" : "", under > 0 ? `${count(under)} under it` : "", related > 0 ? `${count(related)} Related` : ""];
  const said = reasons.filter(Boolean);
  return `- ${name(member)}${said.length > 0 ? ` — ${said.join(" · ")}` : ""}`;
}

/** How an outline names the Issue whose level it is: by its reference alone. */
function label(member: Member): string {
  if (member.kind === "issue") return member.issue.ref;
  return member.end.readable ? `${OUTSIDE}${member.end.ref}` : `${OUTSIDE} an Outside Issue this login can't read`;
}

function groupLine(group: Group): string {
  return `- ${name(group.head)} — ${groupSize(group)}`;
}

function groupSize(group: Group): string {
  const outside = group.outside.length > 0 ? `, ${group.outside.length}${OUTSIDE}` : "";
  return `${plural(group.issues.length, "Issue")}${outside}`;
}

function name(member: Member): string {
  if (member.kind === "issue") return `${member.issue.ref} ${trim(member.issue.title)}`;
  if (!member.end.readable) return `${OUTSIDE} an Issue this login can't read`;
  return `${OUTSIDE}${member.end.ref} ${trim(member.end.title)}`;
}
