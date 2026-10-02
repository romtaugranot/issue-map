/**
 * The drawing module: pure. It takes a Snapshot and a command and returns
 * the text to print. No network, no wall clock, no `gh`/`glab`.
 */
import type { Snapshot } from "../snapshot/snapshot.ts";
import type { OpenIssue, ReadableEnd } from "../tracker/tracker.ts";
import { bandName, bandOf, notes, refusal } from "./band.ts";
import { layout, ownBeneath, type Group, type Layout, type Member } from "./links.ts";
import { openGroup, openUnder, type Entry, type Opened } from "./outline.ts";
import { picture, PICTURE_ISSUES, PICTURE_ROWS } from "./picture.ts";
import { closedBlockers, takeNext, type Pick, type TakeNext } from "./take-next.ts";
import { age, ago, count, fence, howClosed, OUTSIDE, plural, short, title } from "./text.ts";

export type Command =
  | { kind: "overview" }
  /** Pages count from 1. */
  | { kind: "unlinked"; page: number }
  /** Every Group, largest first, each numbered by its place on the overview. */
  | { kind: "groups"; page: number }
  /** Every Issue in Take next, in its order. */
  | { kind: "next"; page: number }
  /** The Unblocked Issues taken by others, each with who has it, in Take next's order. */
  | { kind: "taken"; page: number }
  /** A Group's outline, by its place on the overview counting from 1. */
  | { kind: "group"; group: number; page: number }
  /** The level beneath the Issue a reference or URL names, in its Group. */
  | { kind: "under"; ref: string; page: number }
  /** A Group drawn whole, by its place on the overview counting from 1; its outline when it doesn't fit. */
  | { kind: "picture"; group: number };

export interface Drawing {
  text: string;
  /** The Project's Issues it shows, by the reference users type inside the Project, such as `#12`: what `suggest` reads. */
  issues?: string[];
}

/** Take next lines on the overview. */
const TAKE_NEXT_LINES = 5;
/** Children standing in for one Parent in Take next; the rest are held in a count, so one Parent can't fill it. */
const STAND_INS = 3;
/** Group lines on the overview; the rest are held in a count. */
const GROUP_LINES = 8;
/** Unlinked Issues, Groups, or Issues in Take next or taken by others, a page. */
const PAGE = 15;
/** Issues a page of one level of an outline. */
const OUTLINE_PAGE = 10;

/** A Snapshot older than it should be: the refresh a draw was due couldn't happen (ADR 0006). */
export interface Stale {
  ageMs: number;
  /** Why it couldn't be refreshed. */
  reason: string;
}

/** Where a drawing stands beyond its Snapshot. */
export interface Context {
  /** Opens the drawing with a line saying how old its Snapshot is and why; a fresh one shows no age. */
  stale?: Stale;
  /** The Home Project's path, while the Project drawn isn't it: the overview's header names it and how to return. */
  home?: string;
}

export function draw(snapshot: Snapshot, command: Command, { stale, home }: Context = {}): Drawing {
  const shown = new Set<string>();
  const text = drawn(snapshot, command, home, (issue) => shown.add(issue.ref));
  return { text: stale ? `⚠ read ${age(stale.ageMs)} ago — couldn't refresh it: ${stale.reason}\n${text}` : text, issues: [...shown] };
}

/** Called for each of the Project's Issues a drawing shows. */
type Shows = (issue: OpenIssue) => void;

function drawn(snapshot: Snapshot, command: Command, home: string | undefined, shows: Shows): string {
  const band = bandOf(snapshot.support);
  if (band.kind === "refused") return refusal(`${snapshot.tracker}/${snapshot.project.path}`, band);
  switch (command.kind) {
    case "overview":
      return overview(snapshot, home, shows);
    case "unlinked":
      return unlinkedPage(snapshot, layout(snapshot).unlinked, command.page, shows).join("\n");
    case "groups": {
      const laidOut = layout(snapshot);
      return groupsPage(laidOut.groups, unblockedIn(takeNext(snapshot, laidOut)), command.page, shows);
    }
    case "next":
    case "taken":
      return picksPage(snapshot, takeNext(snapshot, layout(snapshot)), command.kind, command.page, shows);
    case "group":
    case "under": {
      const laidOut = layout(snapshot);
      const opened = command.kind === "group" ? openGroup(laidOut, command.group) : openUnder(snapshot, laidOut, command.ref);
      return outline(snapshot, opened, unblockedIn(takeNext(snapshot, laidOut)), command.page, shows);
    }
    case "picture": {
      const laidOut = layout(snapshot);
      return pictured(snapshot, openGroup(laidOut, command.group), unblockedIn(takeNext(snapshot, laidOut)), shows);
    }
  }
}

/** Says how many of some of the Project's Issues are Unblocked, as Take next counts them, so it agrees with the overview; nothing of none, or where it calls no Issue Unblocked. */
type Unblocked = (issues: OpenIssue[]) => string;

function unblockedIn(next: TakeNext): Unblocked {
  if (next.kind === "blocks-unread") return () => "";
  return (issues) => (issues.length === 0 ? "" : `${count(issues.filter((issue) => next.unblocked.has(issue)).length)} Unblocked`);
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

function overview(snapshot: Snapshot, home: string | undefined, shows: Shows): string {
  const laidOut = layout(snapshot);
  const { onMap, unlinked, groups } = laidOut;
  const said = notes(snapshot.support);
  const header = [
    `**${snapshot.project.path}** · ${count(snapshot.issues.length)} open · ${count(onMap.length)} on the Map · ${count(unlinked.length)} Unlinked · ${bandName(bandOf(snapshot.support))}`,
    ...(home === undefined ? [] : [`⌂ Home: ${home} — \`home\` to return`]),
    ...(said.length > 0 ? [`⚠ ${said.join(" · ")}`] : []),
  ].join("\n");
  const unlinkedLine = `**Unlinked: ${count(unlinked.length)}** — no Link to another open Issue. Ask to list them.`;
  const next = takeNext(snapshot, laidOut);
  if (onMap.length === 0) {
    if (noMapToDraw(laidOut, next)) return [header, "", `${NO_MAP}.`, "", unlinkedLine].join("\n");
    const noGroups = "No Issue here has a Link to another open Issue, so there are no Groups to draw.";
    return [header, "", ...takeNextSection(snapshot, next, shows), "", noGroups, "", unlinkedLine].join("\n");
  }
  const shownGroups = groups.slice(0, GROUP_LINES);
  for (const { head } of shownGroups) if (head.kind === "issue") shows(head.issue);
  const unblocked = unblockedIn(next);
  const lines = [header, "", ...takeNextSection(snapshot, next, shows), "", `**Groups: ${count(groups.length)}** — largest first`, ...shownGroups.map((group) => groupLine(group, unblocked))];
  const rest = groups.slice(GROUP_LINES);
  if (rest.length > 0) {
    lines.push(`- … ${count(rest.length)} more Groups, ${plural(rest.reduce((sum, g) => sum + g.issues.length, 0), "Issue")}. Ask to list them.`);
  }
  lines.push("", unlinkedLine);
  return lines.join("\n");
}

/** Where the overview draws no Map at all. */
export const NO_MAP = "No Issue here has a Link, so there's no Map to draw";

/** Whether there's no Map to draw; an Unlinked Issue that a closed Issue Blocks is still Unblocked, so Take next can hold something with no Map. */
export function noMapToDraw({ onMap }: Layout, next: TakeNext): boolean {
  return onMap.length === 0 && (next.kind === "blocks-unread" || (next.picks.length === 0 && next.takenByOthers.length === 0));
}

/** Take next's headline and why, in the words the overview and the status line share. */
export function takeNextSaid(next: TakeNext): { head: string; why: string } {
  if (next.kind === "blocks-unread") return { head: "Take next: none", why: "the Map can't read this Project's Blocks Links" };
  const { picks, takenByOthers: { length: taken } } = next;
  if (picks.length > 0) return { head: `Take next: ${count(picks.length)}`, why: "most waited on first" };
  if (taken > 0) return { head: "Take next: 0", why: `all ${plural(taken, "Unblocked Issue")} ${taken === 1 ? "is" : "are"} taken by others` };
  return { head: "Take next: 0", why: "every Issue on the Map is Blocked, or a Parent of Blocked Issues" };
}

/** Ends a count of the Issues taken by others: `taken` lists them. */
const ASK_WHO = ", ask who has them";

function takeNextSection(snapshot: Snapshot, next: TakeNext, shows: Shows): string[] {
  const { head, why } = takeNextSaid(next);
  if (next.kind === "blocks-unread") return [`**${head}** — ${why} (${next.reason}), so it calls no Issue Unblocked`];
  const { picks, takenByOthers, closingRequestsUnread } = next;
  const unread = closingRequestsUnread === null ? "" : ` · Closing Requests unread (${closingRequestsUnread}), so none leaves an Issue out`;
  const taken = takenByOthers.length === 0 ? "" : picks.length > 0 ? ` · ${count(takenByOthers.length)} taken by others${ASK_WHO}` : ASK_WHO;
  const { lines, untold } = pickLines(picks, snapshot, shows);
  const more = untold > 0 ? ` · ${count(untold)} more not listed, ask to list them` : "";
  return [`**${head}** — ${why}${more}${taken}${unread}`, ...lines];
}

/** A page of Take next, or of the Unblocked Issues taken by others, in Take next's order and with its lines. */
function picksPage(snapshot: Snapshot, next: TakeNext, kind: "next" | "taken", page: number, shows: Shows): string {
  const list = next.kind === "list" ? (kind === "next" ? next.picks : next.takenByOthers) : [];
  if (list.length === 0) {
    if (kind === "taken" && next.kind === "list") return "No Unblocked Issue here is taken by others. `map` for the Map.";
    return `${takeNextSection(snapshot, next, shows)[0]}\n\n_\`map\` for the Map_`;
  }
  const pages = Math.ceil(list.length / PAGE);
  const at = Math.min(Math.max(1, page), pages);
  const { head, why } = takeNextSaid(next);
  const heading = kind === "next" ? `**${head}** — ${why}` : `**Taken by others: ${count(list.length)}** — Unblocked, but someone else has them; most waited on first`;
  return [
    `${heading}, page ${count(at)} of ${count(pages)}`,
    ...list.slice((at - 1) * PAGE, at * PAGE).map((pick) => `- ${pickLine(pick, snapshot, shows)}`),
    "",
    at < pages ? `_\`more\` for the next ${PAGE} · \`map\` for the Map_` : "_That's all of them. `map` for the Map._",
  ].join("\n");
}

/** Take next's lines, where the children standing in for one Parent past the first few are held in a count; and how many picks past the last line neither names nor counts. */
function pickLines(picks: Pick[], snapshot: Snapshot, shows: Shows): { lines: string[]; untold: number } {
  const lines: string[] = [];
  const shownUnder = new Map<OpenIssue, number>();
  let told = 0;
  for (const pick of picks) {
    if (lines.length === TAKE_NEXT_LINES) break;
    const parent = pick.waiting.via;
    const shown = parent ? (shownUnder.get(parent) ?? 0) : 0;
    if (parent) shownUnder.set(parent, shown + 1);
    if (shown < STAND_INS) {
      lines.push(`- ${pickLine(pick, snapshot, shows)}`);
      told++;
    } else if (shown === STAND_INS) {
      const rest = picks.filter((p) => p.waiting.via === parent).length - STAND_INS;
      lines.push(`- … ${count(rest)} more under ${parent!.ref}`);
      told += rest;
    }
  }
  return { lines, untold: picks.length - told };
}

/** One line of Take next, less its `- `: the overview's and, with its title `named` as plain text, the status line's alike. */
export function pickLine({ issue, waiting: { count: n, via, carried }, yours, closedBlockers, heldBy }: Pick, snapshot: Snapshot, shows: Shows = () => {}, named = title): string {
  shows(issue);
  const waits = n === 0 ? "" : carried ? `▶${count(n)} wait on it, via ${via!.ref}` : `▶${count(n)} wait on it`;
  const standsIn = via && !(n > 0 && carried) ? `via ${via.ref}` : "";
  const reasons = [
    waits,
    standsIn,
    ...unblockedBy(closedBlockers, snapshot),
    issue.planned ? `due ${issue.planned.slice(0, 10)}` : "",
    yours ? "yours" : "",
    // Logins as a card prints them.
    heldBy && heldBy.assignees.length > 0 ? `assigned to ${heldBy.assignees.join(", ")}` : "",
    heldBy && heldBy.requestsBy.length > 0 ? `Closing Request by ${heldBy.requestsBy.join(", ")}` : "",
  ].filter(Boolean);
  return `${issue.ref} ${named(issue.title)}${reasons.length > 0 ? ` — ${reasons.join(" · ")}` : ""}`;
}

/**
 * When the last of an Issue's blockers closed, from the Tracker's close dates
 * against when the Snapshot was read, so nothing is kept per viewer; and
 * any blocker that closed other than as completed, since it still unblocks.
 */
function unblockedBy(closed: ReadableEnd[], { readAt, project }: Snapshot): string[] {
  const last = closed[0];
  if (!last) return [];
  const when = last.closedAt ? `unblocked ${ago(last.closedAt, readAt)}` : `unblocked since ${short(last.ref, project.path)} closed`;
  const how = closed.flatMap((end) => {
    const how = howClosed(end.closedAs);
    return how ? [`${short(end.ref, project.path)} closed ${how}`] : [];
  });
  return [when, ...how];
}

function unlinkedPage(snapshot: Snapshot, unlinked: OpenIssue[], page: number, shows: Shows): string[] {
  const pages = Math.max(1, Math.ceil(unlinked.length / PAGE));
  const at = Math.min(Math.max(1, page), pages);
  const newestFirst = [...unlinked].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  const shown = newestFirst.slice((at - 1) * PAGE, at * PAGE);
  shown.forEach(shows);
  return [
    `**Unlinked: ${count(unlinked.length)}** — newest first, page ${count(at)} of ${count(pages)}`,
    ...shown.map((issue) => {
      // With no Link to an open Issue, nothing open Blocks it: a closed blocker left it Unblocked, where Blocks Links can be read.
      const unblocked = snapshot.unread.blocks === undefined ? unblockedBy(closedBlockers(issue), snapshot) : [];
      return `- ${issue.ref} ${title(issue.title)}${unblocked.length > 0 ? ` — ${unblocked.join(" · ")}` : ""}`;
    }),
    "",
    at < pages ? `_\`more\` for the next ${PAGE}_` : "_That's all of them. `map` for the Map._",
  ];
}

/** Group lines, numbered by their place, which `group <n>` opens them by. */
function groupsPage(groups: Group[], unblocked: Unblocked, page: number, shows: Shows): string {
  if (groups.length === 0) return "No Issue here has a Link, so there's no Group to list. `map` for the Map.";
  const pages = Math.ceil(groups.length / PAGE);
  const at = Math.min(Math.max(1, page), pages);
  const from = (at - 1) * PAGE;
  const shown = groups.slice(from, from + PAGE);
  for (const { head } of shown) if (head.kind === "issue") shows(head.issue);
  return [
    `**Groups: ${count(groups.length)}** — largest first, page ${count(at)} of ${count(pages)}`,
    ...shown.map((group, i) => `${from + i + 1}. ${groupLine(group, unblocked).slice(2)}`),
    "",
    at < pages ? `_\`more\` for the next ${PAGE} · a Group's number opens it · \`map\` for the Map_` : "_A Group's number opens it · `map` for the Map_",
  ].join("\n");
}

function outline(snapshot: Snapshot, opened: Opened, unblocked: Unblocked, page: number, shows: Shows): string {
  if (opened.kind === "no-group") {
    if (opened.groups === 0) return "No Issue here has a Link, so there's no Group to open. `map` for the Map.";
    return `There ${opened.groups === 1 ? "is" : "are"} only ${plural(opened.groups, "Group")} on the Map of ${snapshot.project.path}. \`map\` for the Map.`;
  }
  if (opened.kind === "not-on-map") {
    if (opened.unlinked) return `${opened.ref} is Unlinked: it has no Link to another open Issue, so it's in no Group.`;
    return `No Issue on the Map of ${snapshot.project.path} is ${opened.ref}. \`map\` for the Map.`;
  }
  const { place, groups, group, above, alone, entries } = opened;
  const lines = [`**Group ${count(place)} of ${count(groups)}** · ${headOf(group)} — ${groupSize(group, unblocked)}`, ""];
  if (above && entries.length === 0) {
    lines.push(`Nothing sits beneath ${label(above)} in this Group.`, "_`map` for the Map_");
    return lines.join("\n");
  }
  const pages = Math.max(1, Math.ceil(entries.length / OUTLINE_PAGE));
  const at = Math.min(Math.max(1, page), pages);
  const where = above ? `Under ${label(above)}${alone ? ", alone at the top" : ""}` : "At the top";
  // A level where nothing has anything beneath it, as in a Group joined only by Related Links, has no deeper level to open.
  const deeper = entries.some((e) => e.under > 0);
  lines.push(`**${where}: ${count(entries.length)}** — ${deeper ? "most under it first" : "oldest first"}${pages > 1 ? ` · page ${count(at)} of ${count(pages)}` : ""}`);
  const shown = entries.slice((at - 1) * OUTLINE_PAGE, at * OUTLINE_PAGE);
  for (const member of [above, ...shown.map((entry) => entry.member)]) if (member?.kind === "issue") shows(member.issue);
  lines.push(...shown.map((entry) => entryLine(entry, group, unblocked)));
  const hints = [
    at < pages ? `\`more\` for the next ${OUTLINE_PAGE}` : "",
    deeper ? "name one to open the level below it" : "",
    "`map` for the Map",
  ].filter(Boolean);
  const hint = hints.join(" · ");
  lines.push("", `_${hint[0]!.toUpperCase()}${hint.slice(1)}_`);
  return lines.join("\n");
}

/**
 * A Group's Picture, fenced so its rows print as drawn: the Group's line,
 * then its rows, then what the marks mean. A Group too large for one opens
 * as its outline, saying why.
 */
function pictured(snapshot: Snapshot, opened: Opened, unblocked: Unblocked, shows: Shows): string {
  if (opened.kind !== "level") return outline(snapshot, opened, unblocked, 1, shows);
  const { place, groups, group } = opened;
  const rows = picture(group);
  if (!rows) {
    const why = `Group ${count(place)} is too large to draw whole: a Picture holds about ${PICTURE_ISSUES} Issues in ${PICTURE_ROWS} rows. Here is its outline.`;
    return `${why}\n\n${outline(snapshot, opened, unblocked, 1, shows)}`;
  }
  for (const member of group.members.values()) if (member.kind === "issue") shows(member.issue);
  const marks = fence(rows);
  return [
    `**Picture of Group ${count(place)} of ${count(groups)}** · ${headOf(group)} — ${groupSize(group, unblocked)}`,
    "",
    marks,
    ...rows,
    marks,
    `_\`─\` its Parent above it · \`▶\` Blocked by the Issue above it · \`${OUTSIDE}\` an Outside Issue, not followed_`,
    `_\`group ${place}\` for its outline · \`map\` for the Map_`,
  ].join("\n");
}

function entryLine({ member, how, under, related }: Entry, group: Group, unblocked: Unblocked): string {
  const held = [...(member.kind === "issue" ? [member.issue] : []), ...ownBeneath(group, member.id)];
  const reasons = [how === "blocked" ? "Blocked by it" : "", under > 0 ? `${count(under)} under it` : "", unblocked(held), related > 0 ? `${count(related)} Related` : ""];
  const said = reasons.filter(Boolean);
  return `- ${name(member)}${said.length > 0 ? ` — ${said.join(" · ")}` : ""}`;
}

/** How an outline names the Issue whose level it is: by its reference alone. */
function label(member: Member): string {
  if (member.kind === "issue") return member.issue.ref;
  return member.end.readable ? `${OUTSIDE}${member.end.ref}` : `${OUTSIDE} an Outside Issue this login can't read`;
}

function headOf(group: Group): string {
  return `${name(group.head)}${group.head.kind === "outside" ? " (an Outside Issue)" : ""}`;
}

function groupLine(group: Group, unblocked: Unblocked): string {
  return `- ${name(group.head)} — ${groupSize(group, unblocked)}`;
}

function groupSize(group: Group, unblocked: Unblocked): string {
  const outside = group.outside.length > 0 ? `${group.outside.length}${OUTSIDE} Outside` : "";
  return [plural(group.issues.length, "Issue"), unblocked(group.issues), outside].filter(Boolean).join(", ");
}

function name(member: Member): string {
  if (member.kind === "issue") return `${member.issue.ref} ${title(member.issue.title)}`;
  if (!member.end.readable) return `${OUTSIDE} an Issue this login can't read`;
  return `${OUTSIDE}${member.end.ref} ${title(member.end.title)}`;
}
