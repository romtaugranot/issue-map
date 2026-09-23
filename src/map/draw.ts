/**
 * The drawing module: pure. It takes a Snapshot and a command and returns
 * the text to print. No network, no wall clock, no `gh`/`glab`.
 */
import type { Snapshot } from "../snapshot/snapshot.ts";
import type { OpenIssue } from "../tracker/tracker.ts";
import { layout, type Group, type Head, type Layout } from "./links.ts";
import { takeNext, type Pick } from "./take-next.ts";

export type Command =
  | { kind: "overview" }
  /** Pages count from 1. */
  | { kind: "unlinked"; page: number };

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
/** Titles are trimmed to a fixed length, since the client does the wrapping. */
const TITLE = 60;
const OUTSIDE = "↗";

export function draw(snapshot: Snapshot, command: Command): Drawing {
  switch (command.kind) {
    case "overview":
      return { text: overview(snapshot) };
    case "unlinked":
      return { text: unlinkedPage(layout(snapshot).unlinked, command.page).join("\n") };
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

function groupLine(group: Group): string {
  const outside = group.outside.length > 0 ? `, ${group.outside.length}${OUTSIDE}` : "";
  return `- ${name(group.head)} — ${plural(group.issues.length, "Issue")}${outside}`;
}

function name(head: Head): string {
  if (head.kind === "issue") return `${head.issue.ref} ${trim(head.issue.title)}`;
  if (!head.end.readable) return `${OUTSIDE} an Issue this login can't read`;
  return `${OUTSIDE}${head.end.ref} ${trim(head.end.title)}`;
}

function trim(title: string): string {
  return title.length <= TITLE ? title : `${title.slice(0, TITLE - 1)}…`;
}

function count(n: number): string {
  return n.toLocaleString("en-US");
}

function plural(n: number, noun: string): string {
  return `${count(n)} ${noun}${n === 1 ? "" : "s"}`;
}
