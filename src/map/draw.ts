/**
 * The drawing module: pure. It takes a Snapshot and a command and returns
 * the text to print. No network, no wall clock, no `gh`/`glab`.
 */
import type { Snapshot } from "../snapshot/snapshot.ts";
import type { OpenIssue } from "../tracker/tracker.ts";
import { layout, type Group, type Head } from "./links.ts";

export type Command =
  | { kind: "overview" }
  /** Pages count from 1. */
  | { kind: "unlinked"; page: number };

export interface Drawing {
  text: string;
}

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
  const { onMap, unlinked, groups } = layout(snapshot);
  const header = `**${snapshot.project.path}** · ${count(snapshot.issues.length)} open · ${count(onMap.length)} on the Map · ${count(unlinked.length)} Unlinked`;
  const unlinkedLine = `**Unlinked: ${count(unlinked.length)}** — no Link to another open Issue. Ask to list them.`;
  if (onMap.length === 0) return [header, "", "No Issue here has a Link, so there's no Map to draw.", "", unlinkedLine].join("\n");
  const lines = [
    header,
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
