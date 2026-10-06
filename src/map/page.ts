/**
 * The HTML Picture (ADR 0010): the whole Map of a Snapshot on one read-only
 * page outside Claude Code, by the drawing rules the in-session Map uses, so
 * the two never disagree on Take next or the Groups. Pure. The page is one
 * file, its style and script inline, and its policy forbids every request,
 * so nothing leaves the machine; it never writes to a Tracker, never asks
 * Claude anything and never refreshes itself. The way back is each Issue's
 * copy button, which copies its URL: pasted into the session, the URL opens
 * the Issue's card, read live.
 */
import type { Snapshot } from "../snapshot/snapshot.ts";
import type { FarEnd, OpenIssue } from "../tracker/tracker.ts";
import { bandName, bandOf, notes } from "./band.ts";
import { pickLine, takeNextSaid, type Stale } from "./draw.ts";
import { byRank, layout, type Member } from "./links.ts";
import { topOf } from "./outline.ts";
import { takeNext, type Pick } from "./take-next.ts";
import { OUTSIDE, oneLine, plainTitle } from "./text.ts";

/** An Issue as the page names it; `url` is `null` for one this login can't read. */
export interface PageIssue {
  ref: string;
  title: string;
  url: string | null;
  /** Unblocked, as Take next counts it. */
  unblocked?: true;
  /** Its place in Take next, from 1. */
  next?: number;
}

/** A line of Take next: the Issue, by its place in `issues`, and the line the overview prints for it. */
export interface PagePick {
  issue: number;
  line: string;
  /** Why it's there, as the line says it after the Issue's name, such as "4 wait on it, via #3414"; empty when nothing is said. */
  why: string;
}

export interface PageGroup {
  head: number;
  /** The Project's own Issues in it. */
  size: number;
  unblocked: number;
  outside: number;
  /** What sits at its top, in the order to draw it. */
  top: number[];
  /** Each Issue beneath another, as triples: the one above, the one beneath, and 1 when it's Blocked by it rather than its child. */
  below: number[];
}

export interface PageData {
  project: string;
  projectUrl: string;
  tracker: string;
  /** When the Snapshot was read, as an ISO date. */
  readAt: string;
  /** Why the Snapshot couldn't be refreshed, when it couldn't. */
  stale?: string;
  open: number;
  onMap: number;
  band: string;
  notes: string[];
  next: { head: string; why: string; picks: PagePick[]; taken: PagePick[] };
  /** Largest first, as the overview lists them. */
  groups: PageGroup[];
  /** Newest first, as the Unlinked list orders them. */
  unlinked: number[];
  /** Every Issue the page names, the Project's own first. */
  issues: PageIssue[];
}

/** What the page holds; a Project the Map refuses never gets this far. */
export function pageData(snapshot: Snapshot, { stale }: { stale?: Stale } = {}): PageData {
  const laidOut = layout(snapshot);
  const next = takeNext(snapshot, laidOut);
  const issues: PageIssue[] = [];
  const at = new Map<string, number>();
  const add = (id: string, issue: PageIssue) => at.get(id) ?? (at.set(id, issues.push(issue) - 1), issues.length - 1);
  const own = (issue: OpenIssue) => add(issue.id, { ref: issue.ref, title: oneLine(issue.title), url: issue.url });
  const outside = (end: FarEnd) => add(end.id, end.readable ? { ref: `${OUTSIDE}${end.ref}`, title: oneLine(end.title), url: end.url } : { ref: `${OUTSIDE} an Issue this login can't read`, title: "", url: null });
  const member = (m: Member) => (m.kind === "issue" ? own(m.issue) : outside(m.end));
  snapshot.issues.forEach(own);

  const picked = (pick: Pick): PagePick => {
    const line = pickLine(pick, snapshot, undefined, plainTitle);
    // Cut at the name's own length, since a title can hold " — " too.
    const why = line.slice(`${pick.issue.ref} ${plainTitle(pick.issue.title)}`.length).replace(/^ — /, "").replace(/▶/g, "");
    return { issue: own(pick.issue), line, why };
  };
  const { head, why } = takeNextSaid(next);
  const picks = next.kind === "list" ? next.picks.map(picked) : [];
  if (next.kind === "list") {
    for (const issue of next.unblocked) issues[own(issue)]!.unblocked = true;
    picks.forEach((pick, i) => (issues[pick.issue]!.next = i + 1));
  }

  const unblocked = (group: OpenIssue[]) => (next.kind === "list" ? group.filter((issue) => next.unblocked.has(issue)).length : 0);
  const groups = laidOut.groups.map((group): PageGroup => {
    const below: number[] = [];
    for (const [above, beneath] of group.beneath) {
      const ranked = [...beneath].map(([id, how]) => ({ m: group.members.get(id)!, how })).sort((a, b) => byRank(a.m, b.m));
      for (const { m, how } of ranked) below.push(member(group.members.get(above)!), member(m), how === "blocked" ? 1 : 0);
    }
    return { head: member(group.head), size: group.issues.length, unblocked: unblocked(group.issues), outside: group.outside.length, top: topOf(group).sort(byRank).map(member), below };
  });

  return {
    project: snapshot.project.path,
    projectUrl: snapshot.project.url,
    tracker: snapshot.tracker,
    readAt: snapshot.readAt,
    ...(stale ? { stale: stale.reason } : {}),
    open: snapshot.issues.length,
    onMap: laidOut.onMap.length,
    band: bandName(bandOf(snapshot.support)),
    notes: notes(snapshot.support),
    next: { head, why: next.kind === "blocks-unread" ? `${why} (${next.reason}), so it calls no Issue Unblocked` : why, picks, taken: next.kind === "list" ? next.takenByOthers.map(picked) : [] },
    groups,
    unlinked: [...laidOut.unlinked].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)).map(own),
    issues,
  };
}

/** The page: `pageData` kept as JSON, drawn by its own inline script. */
export function htmlPicture(snapshot: Snapshot, context: { stale?: Stale } = {}): string {
  // `<` escaped, so no title can end the script it's kept in.
  const data = JSON.stringify(pageData(snapshot, context)).replace(/</g, "\\u003c");
  const name = snapshot.project.path.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name} · Issue Map</title>
<style>${STYLE}</style>
</head>
<body>
<div id="page"></div>
<script type="application/json" id="data">${data}</script>
<script>${SCRIPT}</script>
</body>
</html>
`;
}

/**
 * What to say of the page written at `path`: where it is and how to open it
 * here; over SSH, that there's no browser here and how to fetch it; in a
 * cloud session, that it can't reach the user's device.
 */
export function pageSaid(path: string, env: Record<string, string | undefined> = process.env): string {
  const lead = "The HTML Picture of the whole Map, read-only and as old as its Snapshot";
  const back = "Each Issue on it has a copy button for its URL: paste the URL here to open its card.";
  if (env.CLAUDE_CODE_REMOTE) {
    return `${lead}, is written on the machine this session runs on, at ${path}. This is a cloud session, so the page can't reach your device and no command here can fetch it to you: the Map in this conversation shows everything it does.`;
  }
  const [, , server, port] = env.SSH_CONNECTION?.trim().split(/\s+/) ?? [];
  if (server) {
    const host = server.includes(":") ? `[${server}]` : server;
    const user = env.USER || env.LOGNAME;
    const scp = `scp ${port && port !== "22" ? `-P ${port} ` : ""}'${user ? `${user}@` : ""}${host}:${path}' .`;
    return `${lead}, is written on this machine, which you reach over SSH, so there's no browser here to open it in. It's at ${path}. To fetch it, run this on your own machine, then open the file there:\n\n${scp}\n\n${back}`;
  }
  return `${lead}, is at ${path}. ${back}`;
}

/** Set, and not switched off: Claude Code reads `1` or `true` as on. */
const on = (value: string | undefined) => !!value && !/^(0|false|no|off)$/i.test(value.trim());

/**
 * Why claude.ai Artifacts can't be had in this session, as far as its
 * environment says: a cloud provider, or an API key or a gateway's token in
 * place of a claude.ai account. `undefined` when nothing here rules them
 * out; `claude -p`, and Artifacts turned off, Claude tells for itself.
 */
export function noArtifacts(env: Record<string, string | undefined> = process.env): string | undefined {
  if (on(env.CLAUDE_CODE_USE_BEDROCK)) return "this session runs on Amazon Bedrock";
  if (on(env.CLAUDE_CODE_USE_VERTEX)) return "this session runs on Google Vertex AI";
  if (on(env.CLAUDE_CODE_USE_FOUNDRY)) return "this session runs on Microsoft Foundry";
  if (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN) return "this session signs in with an API key, not a claude.ai account";
  return undefined;
}

/**
 * What Claude asks before publishing the page at `path` as a private
 * claude.ai Artifact (ADR 0010): the Project, and what leaves the machine
 * under which account. For Claude to ask from, not to show; asked before
 * every publish and republish, since each sends the titles of that moment.
 */
export function artifactSaid(
  path: string,
  { project, open, tracker, login }: { project: string; open: number; tracker: string; login: string },
  env: Record<string, string | undefined> = process.env,
): string {
  const ruledOut = noArtifacts(env);
  if (ruledOut) return `Not offered: claude.ai Artifacts can't be had here, since ${ruledOut}.`;
  return [
    "Ask before every publish and republish, and never remember the answer: nothing is published without a yes to this publish.",
    "",
    `Question: Publish the HTML Picture of ${project} as a private claude.ai Artifact?`,
    `Publish it: sends the titles of its ${open} open Issues, and of the Outside Issues its Links reach, to claude.ai, kept under your claude.ai account, which isn't your ${tracker} login ${login}.`,
    "Keep it here: nothing leaves this machine.",
    "",
    `Page: ${path}`,
  ].join("\n");
}

/**
 * The page looks like a sea chart: each Group an island, sized by its Issues.
 * Every colour is a token, set for light and for dark, and again under
 * `data-theme`, which a claude.ai Artifact sets on the page it shows.
 */
const STYLE = String.raw`
:root {
  --bg: #f3f7f8; --ink: #10242f; --muted: #4c6573; --faint: #86a0ad; --line: #c9dbe2; --raise: #e6eff2;
  --go: #0e8a76; --stop: #cf4f3a; --pick: #a8720a; --pick-wash: #fbefd0;
  --shallow: #dcebf0; --land: #fbfcfb; --coast: #a9c6d1;
  --mono: ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace;
  --sans: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #0a1b29; --ink: #e4edf1; --muted: #8ea6b4; --faint: #577487; --line: #1d374b; --raise: #10263a;
  --go: #5fd0b9; --stop: #ff8a72; --pick: #f2c45c; --pick-wash: #2c2818;
  --shallow: #12304a; --land: #16334a; --coast: #2d5470;
  color-scheme: dark;
} }
:root[data-theme="dark"] {
  --bg: #0a1b29; --ink: #e4edf1; --muted: #8ea6b4; --faint: #577487; --line: #1d374b; --raise: #10263a;
  --go: #5fd0b9; --stop: #ff8a72; --pick: #f2c45c; --pick-wash: #2c2818;
  --shallow: #12304a; --land: #16334a; --coast: #2d5470;
  color-scheme: dark;
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.5 var(--sans); }
a { color: inherit; }
button { font: inherit; color: inherit; }
[hidden] { display: none !important; }
:focus-visible { outline: 2px solid var(--pick); outline-offset: 2px; }
code { font-family: var(--mono); font-size: .88em; background: var(--raise); border: 1px solid var(--line); border-radius: 4px; padding: 0 3px; }
.ref { font-family: var(--mono); font-size: .86em; color: var(--muted); font-variant-numeric: tabular-nums; }
.muted { color: var(--muted); }
.warn { color: var(--stop); margin: 0; font-size: 13px; }
.btn { display: inline-flex; align-items: center; min-height: 32px; padding: 0 12px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); cursor: pointer; text-decoration: none; font-size: 13px; white-space: nowrap; }
.btn:hover { border-color: var(--muted); }
#page { position: fixed; inset: 0; display: grid; grid-template-rows: auto 1fr; padding-top: env(safe-area-inset-top, 0px); }
.top { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px 24px; align-items: center; padding: 14px 20px 12px; border-bottom: 1px solid var(--line); background: var(--bg); z-index: 3; }
.top > * { grid-column: 1; min-width: 0; }
.top h1 { margin: 0; font-size: 15px; font-weight: 600; color: var(--muted); }
.top h1 a { text-decoration: none; }
.top .facts { font-size: 12.5px; color: var(--muted); }
.start { display: flex; flex-direction: column; gap: 2px; text-align: left; background: none; border: 0; padding: 0; cursor: pointer; }
.start .lead { font-size: 13px; color: var(--pick); font-weight: 600; }
.start .what { font-size: 19px; font-weight: 650; line-height: 1.25; text-wrap: balance; }
.start .why { font-size: 13px; color: var(--muted); }
.top .side { grid-column: 2; grid-row: 1 / span 3; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.sea { position: relative; overflow: hidden; background: radial-gradient(ellipse at 50% 45%, var(--shallow), var(--bg) 72%); }
.sea > svg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; transition: opacity .3s ease; }
.sea > svg.under { opacity: 0; pointer-events: none; transition-delay: .25s; }
.world { transition: transform .7s cubic-bezier(.2, .7, .1, 1); }
.isle { cursor: pointer; transition: opacity .45s ease; }
.isle.away { opacity: 0; pointer-events: none; }
.isle .shore { fill: none; stroke: var(--coast); stroke-width: 1; stroke-dasharray: 2 4; opacity: .7; }
.isle .body { fill: var(--land); stroke: var(--coast); stroke-width: 1; transition: fill .2s; }
.isle:hover .body, .isle:focus-visible .body { fill: color-mix(in srgb, var(--land) 80%, var(--go)); }
.isle .track { fill: none; stroke: color-mix(in srgb, var(--coast) 60%, transparent); }
.isle .ring { fill: none; stroke: var(--go); stroke-linecap: round; }
.isle .count { font: 650 calc(15px / var(--k, 1)) var(--sans); fill: var(--ink); text-anchor: middle; dominant-baseline: central; font-variant-numeric: tabular-nums; }
.isle .name { font: calc(11px / var(--k, 1)) var(--sans); fill: var(--muted); text-anchor: middle; }
.isle .flag { fill: var(--pick); }
.grow { transform-box: fill-box; transform-origin: center; animation: grow .6s cubic-bezier(.2, .8, .2, 1.15) both; }
@keyframes grow { from { transform: scale(0); opacity: 0; } }
.peek { position: absolute; left: 50%; top: 14px; transform: translateX(-50%); max-width: calc(100% - 32px); font-size: 13.5px; background: var(--bg); border: 1px solid var(--line); border-radius: 999px; padding: 6px 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; pointer-events: none; transition: opacity .2s; }
.peek:empty { opacity: 0; }
.hint { position: absolute; left: 20px; right: 20px; bottom: calc(16px + env(safe-area-inset-bottom, 0px)); margin: 0; font-size: 12.5px; color: var(--muted); pointer-events: none; }
.note { position: absolute; left: 50%; top: 40%; transform: translate(-50%, -50%); width: min(460px, 100%); text-align: center; padding: 0 16px; }
.note h2 { margin: 0 0 6px; font-size: 18px; }
.inside { position: absolute; inset: 0; overflow: auto; padding: 16px 16px calc(220px + env(safe-area-inset-bottom, 0px)); }
.inside .bar { display: flex; align-items: center; gap: 8px 12px; flex-wrap: wrap; margin-bottom: 6px; }
.inside h2 { margin: 0; font-size: 18px; font-weight: 650; text-wrap: balance; min-width: 0; }
.inside .bar .muted { font-size: 13px; }
.inside svg { display: block; margin: 10px auto 0; overflow: visible; }
.legend { display: flex; gap: 4px 16px; flex-wrap: wrap; font-size: 12.5px; color: var(--muted); }
.legend i { display: inline-block; width: 18px; height: 0; border-top: 2px solid; vertical-align: middle; margin-right: 6px; }
.issue { cursor: pointer; }
.issue rect { fill: var(--land); stroke: var(--coast); stroke-width: 1.2; }
.issue.outside rect { stroke-dasharray: 4 3; }
.issue.unblocked rect { stroke: var(--go); stroke-width: 2; }
.issue.next rect { fill: var(--pick-wash); stroke: var(--pick); stroke-width: 2; }
.issue.chosen rect { stroke: var(--ink); stroke-width: 2.5; }
.issue .r { font: 600 11.5px var(--mono); fill: var(--muted); }
.issue.next .r { fill: var(--pick); }
.issue .t { font: 13px var(--sans); fill: var(--ink); }
.issue.in { animation: rise .45s cubic-bezier(.2, .8, .2, 1) both; }
@keyframes rise { from { opacity: 0; transform: translateY(10px); } }
.line { fill: none; stroke: var(--faint); stroke-width: 1.5; }
.line.blocked { stroke: var(--stop); }
.line.in { stroke-dasharray: var(--len); stroke-dashoffset: var(--len); animation: draw .5s ease-out forwards; }
@keyframes draw { to { stroke-dashoffset: 0; } }
.more { cursor: pointer; }
.more text { font: 12.5px var(--sans); fill: var(--muted); text-decoration: underline; }
.card { position: absolute; left: 50%; bottom: calc(16px + env(safe-area-inset-bottom, 0px)); width: min(440px, calc(100% - 24px)); max-height: 70%; overflow: auto; background: var(--land); border: 1px solid var(--coast); border-radius: 14px; padding: 16px; box-shadow: 0 16px 40px #0004; z-index: 4; transform: translate(-50%, 0); transition: transform .35s cubic-bezier(.2, .8, .2, 1), opacity .25s; }
.card.off { transform: translate(-50%, 30px); opacity: 0; pointer-events: none; }
.card .close { float: right; margin-left: 8px; }
.card .title { font-weight: 650; margin: 2px 0 6px; }
.card .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
.card input { width: 100%; margin-top: 10px; font: 12px var(--mono); padding: 6px; background: var(--bg); color: var(--ink); border: 1px solid var(--line); border-radius: 6px; }
.card .status { font-size: 13px; color: var(--muted); margin-top: 8px; }
.list { position: absolute; right: 0; top: 0; bottom: 0; width: min(420px, 100%); background: var(--bg); border-left: 1px solid var(--line); overflow: auto; z-index: 5; transition: transform .4s cubic-bezier(.2, .8, .2, 1); padding: 16px 16px calc(40px + env(safe-area-inset-bottom, 0px)); }
.list.off { transform: translateX(102%); visibility: hidden; transition: transform .4s cubic-bezier(.2, .8, .2, 1), visibility 0s .4s; }
.list h2 { margin: 0 0 4px; font-size: 16px; display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.list h3 { margin: 18px 0 4px; font-size: 14px; }
.list p { margin: 0 0 8px; font-size: 13px; color: var(--muted); }
.list ol, .list ul { list-style: none; margin: 0; padding: 0; }
.list li > button { display: grid; grid-template-columns: 2.4em minmax(0, 1fr); gap: 0 8px; width: 100%; text-align: left; background: none; border: 0; border-top: 1px solid var(--line); padding: 10px 2px; cursor: pointer; }
.list ul li > button { grid-template-columns: minmax(0, 1fr); }
.list li > button:hover { background: var(--raise); }
.list .pos { color: var(--faint); font-variant-numeric: tabular-nums; text-align: right; }
.list ol li:first-child .pos { color: var(--pick); font-weight: 700; }
.list .why { grid-column: -2; font-size: 12.5px; color: var(--muted); }
.list .meter { grid-column: -2; height: 4px; border-radius: 2px; background: var(--line); overflow: hidden; margin-top: 4px; }
.list .meter i { display: block; height: 100%; background: var(--go); }
.list .btn.next-page { margin-top: 10px; }
@media (max-width: 700px) {
  .top { grid-template-columns: 1fr; padding: 12px 16px 10px; }
  .top .side { grid-column: 1; grid-row: auto; justify-content: flex-start; }
  .start .what { font-size: 17px; }
}
@media (prefers-reduced-motion: reduce) {
  *, .world { animation: none !important; transition: none !important; }
  .line.in { stroke-dashoffset: 0; }
}
`;

/** Draws the page from its data; builds every element with text, never markup, so no title is read as HTML. */
const SCRIPT = String.raw`
"use strict";
// Wrapped, so no name here meets one the window already has, such as top.
(() => {
const D = JSON.parse(document.getElementById("data").textContent);
const I = D.issues;
/** Islands drawn; every Group is still in the Groups list. */
const ISLES = 150;
/** Rows a list shows at a time, and an outline before "more". */
const PAGE = 50, ROWS = 60;
const NS = "http://www.w3.org/2000/svg";
const quiet = matchMedia("(prefers-reduced-motion: reduce)").matches;
const el = (tag, props, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(props || {})) { if (k === "class") e.className = v; else if (k === "role" || k.startsWith("aria-")) e.setAttribute(k, v); else e[k] = v; } for (const c of kids) if (c != null) e.append(c); return e; };
const sv = (tag, attrs, text) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v); if (text != null) e.textContent = text; return e; };
const n = (x) => x.toLocaleString("en-US");
const plural = (x, noun) => n(x) + " " + noun + (x === 1 ? "" : "s");
const clip = (text, max) => (text.length <= max ? text : text.slice(0, Math.max(1, max - 1)) + "…");
const web = (url) => (url && /^https?:\/\//.test(url) ? url : null);
const nameOf = (i) => I[i].title || I[i].ref;
/** A title with its backtick spans as code, as the Tracker shows them. */
const titled = (text) => { const s = el("span"); text.split(String.fromCharCode(96)).forEach((part, k) => s.append(k % 2 ? el("code", { textContent: part }) : part)); return s; };
const refTitle = (i) => el("span", {}, el("span", { class: "ref", textContent: I[i].ref }), " ", titled(I[i].title));
const groupLine = (g) => plural(g.size, "Issue") + ", " + n(g.unblocked) + " Unblocked" + (g.outside ? ", " + plural(g.outside, "Outside Issue") : "");
const holds = (g) => { if (I[g.head].next) return true; for (const i of g.top) if (I[i].next) return true; for (let k = 1; k < g.below.length; k += 3) if (I[g.below[k]].next) return true; return false; };
const has = (g, i) => { if (g.head === i || g.top.includes(i)) return true; for (let k = 0; k < g.below.length; k += 3) if (g.below[k] === i || g.below[k + 1] === i) return true; return false; };
const after = (ms, f) => setTimeout(f, quiet ? 0 : ms);

function ago(iso) {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 90) return "just now";
  if (s < 5400) return Math.round(s / 60) + " minutes ago";
  if (s < 129600) return Math.round(s / 3600) + " hours ago";
  return Math.round(s / 86400) + " days ago";
}

/** A list shown PAGE rows at a time, with a button for the next. */
function paged(items, row, tag) {
  const list = el(tag);
  const wrap = el("div", {}, list);
  let shown = 0;
  const more = el("button", { class: "btn next-page" });
  const step = () => {
    items.slice(shown, shown + PAGE).forEach((item, k) => list.append(el("li", {}, row(item, shown + k))));
    shown = Math.min(items.length, shown + PAGE);
    more.textContent = "Show " + n(Math.min(PAGE, items.length - shown)) + " more of " + n(items.length - shown);
    if (shown >= items.length) more.remove();
  };
  more.onclick = step;
  wrap.append(more);
  step();
  return wrap;
}

const page = document.getElementById("page");
const head = el("header", { class: "top" });
const sea = el("main", { class: "sea" });
page.append(head, sea);

// The head: the Project, how old the page is, and the one thing to start on.
head.append(el("h1", {}, web(D.projectUrl) ? el("a", { href: D.projectUrl, target: "_blank", rel: "noopener", textContent: D.project }) : D.project));
head.append(el("div", { class: "facts", textContent: plural(D.open, "open Issue") + ", " + n(D.onMap) + " on the Map, " + n(D.unlinked.length) + " Unlinked. " + D.band + ". Read from " + D.tracker + " " + ago(D.readAt) + "; this page never refreshes, so ask Claude Code for a new one." }));
if (D.stale) head.append(el("p", { class: "warn", textContent: "Its Snapshot couldn't be refreshed: " + D.stale }));
for (const note of D.notes) head.append(el("p", { class: "warn", textContent: note }));
const first = D.next.picks[0];
if (first) head.append(el("button", { class: "start", onclick: () => openFor(first.issue) }, el("span", { class: "lead", textContent: "Start with " + I[first.issue].ref }), el("span", { class: "what" }, titled(I[first.issue].title)), first.why ? el("span", { class: "why", textContent: first.why }) : null));
else if (D.open) head.append(el("div", { class: "start" }, el("span", { class: "what", textContent: D.next.head }), el("span", { class: "why", textContent: D.next.why })));
const side = el("div", { class: "side" });
head.append(side);

// One Issue, and the way back into Claude Code: its URL, copied.
const card = el("div", { class: "card off", role: "dialog", "aria-label": "Issue" });
sea.append(card);
let chosen = null;
const unchoose = () => { chosen?.classList.remove("chosen"); chosen = null; };
const closeCard = () => { card.classList.add("off"); unchoose(); };
function showCard(i) {
  const it = I[i];
  card.replaceChildren(el("button", { class: "btn close", textContent: "Close", onclick: closeCard }), el("div", { class: "ref", textContent: it.ref }));
  if (it.title) card.append(el("div", { class: "title" }, titled(it.title)));
  const said = [it.next ? "Number " + n(it.next) + " in Take next" : "", it.unblocked ? "Unblocked: no open Issue Blocks it" : ""].filter(Boolean).join(". ");
  if (said) card.append(el("div", { class: "muted", textContent: said + "." }));
  const url = web(it.url);
  if (url) {
    const status = el("div", { class: "status" });
    const field = el("input", { value: url, readOnly: true, hidden: true, "aria-label": "The Issue's URL" });
    // A page without the clipboard, or a frame that refuses it, still lets the URL be copied by hand.
    const byHand = () => { field.hidden = false; field.focus(); field.select(); status.textContent = "Selected: copy it with your keyboard, then paste it into Claude Code."; };
    const copy = el("button", { class: "btn", textContent: "Copy URL for Claude Code", onclick: () => {
      if (!navigator.clipboard) return byHand();
      navigator.clipboard.writeText(url).then(() => (status.textContent = "Copied. Paste it into Claude Code to open its Issue card."), byHand);
    } });
    card.append(el("div", { class: "actions" }, copy, el("a", { class: "btn", href: url, target: "_blank", rel: "noopener", textContent: "Open on " + D.tracker })), field, status);
  }
  requestAnimationFrame(() => card.classList.remove("off"));
}

// The lists beside the islands: Take next, every Group, and the Unlinked Issues.
const list = el("aside", { class: "list off" });
page.append(list);
const closeList = () => list.classList.add("off");
function openList(head, ...body) {
  // A part a list lacks is null, which the DOM would print as the word.
  list.replaceChildren(el("h2", {}, head, el("button", { class: "btn", textContent: "Close", onclick: closeList })), ...body.filter((part) => part != null));
  list.scrollTop = 0;
  list.classList.remove("off");
}
const pickRow = (p, k) => el("button", { onclick: () => { closeList(); openFor(p.issue); } }, el("span", { class: "pos", textContent: n(k + 1) }), refTitle(p.issue), p.why ? el("span", { class: "why", textContent: p.why }) : null);
const takenRow = (p) => el("button", { onclick: () => { closeList(); openFor(p.issue); } }, refTitle(p.issue), p.why ? el("span", { class: "why", textContent: p.why }) : null);
const takeNextList = () => openList("Take next", el("p", { textContent: D.next.head + ": " + D.next.why + "." }), D.next.picks.length ? paged(D.next.picks, pickRow, "ol") : null,
  D.next.taken.length ? el("h3", { textContent: "Taken by others: " + n(D.next.taken.length) }) : null, D.next.taken.length ? el("p", { textContent: "Unblocked, but assigned to someone else or under their Closing Request." }) : null, D.next.taken.length ? paged(D.next.taken, takenRow, "ul") : null);
const groupRow = (g, k) => el("button", { onclick: () => { closeList(); openGroup(k); } }, el("span", { class: "pos", textContent: n(k + 1) }), refTitle(g.head), el("span", { class: "why", textContent: groupLine(g) + (holds(g) ? ", holds an Issue in Take next" : "") }), el("span", { class: "meter" }, el("i", { style: "width:" + (g.size ? (100 * g.unblocked) / g.size : 0) + "%" })));
const groupsList = () => openList("Groups: " + n(D.groups.length), el("p", { textContent: "Largest first. Each joins Issues by their Parent and Blocks Links; the bar is the share Unblocked." }), paged(D.groups, groupRow, "ol"));
const unlinkedRow = (i) => el("button", { onclick: () => showCard(i) }, refTitle(i));
const unlinkedList = () => openList("Unlinked: " + n(D.unlinked.length), el("p", { textContent: "Open Issues with no Link to another open Issue, newest first." }), paged(D.unlinked, unlinkedRow, "ul"));
if (D.next.picks.length || D.next.taken.length) side.append(el("button", { class: "btn", textContent: "Take next: " + n(D.next.picks.length), onclick: takeNextList }));
if (D.groups.length) side.append(el("button", { class: "btn", textContent: "Groups: " + n(D.groups.length), onclick: groupsList }));
if (D.unlinked.length) side.append(el("button", { class: "btn", textContent: "Unlinked: " + n(D.unlinked.length), onclick: unlinkedList }));
addEventListener("keydown", (e) => { if (e.key !== "Escape") return; if (!list.classList.contains("off")) closeList(); else if (!card.classList.contains("off")) closeCard(); else if (inside) leaveGroup(); });

// The islands, packed on a spiral from the largest out.
const peek = el("div", { class: "peek", "aria-live": "polite" });
const placed = [];
let world = null, chart = null, hint = null, inside = null;
const isles = [];
if (!D.open) sea.append(el("div", { class: "note" }, el("h2", { textContent: "No open Issues" }), el("p", { class: "muted", textContent: "There's nothing to take in " + D.project + ". Open an Issue on " + D.tracker + ", then ask Claude Code for the Map again." })));
else if (!D.groups.length) sea.append(el("div", { class: "note" }, el("h2", { textContent: "No Groups" }), el("p", { class: "muted", textContent: "No open Issue here has a Parent or Blocks Link to another, so there's nothing to draw. Unlinked lists all " + plural(D.unlinked.length, "Issue") + "." })));
else drawSea();

function drawSea() {
  const radius = (g) => 16 + 10 * Math.sqrt(g.size + g.outside);
  for (const [k, g] of D.groups.slice(0, ISLES).entries()) {
    const r = radius(g);
    let x = 0, y = 0;
    if (placed.length) for (let t = 0; ; t += 0.12) { x = 9 * t * Math.cos(t); y = 7 * t * Math.sin(t); if (placed.every((p) => Math.hypot(p.x - x, p.y - y) > p.r + r + 14)) break; }
    placed.push({ g, k, r, x, y });
  }
  chart = sv("svg", { role: "group", "aria-label": "The Groups of " + D.project + " as islands, sized by their Issues" });
  world = sv("g", { class: "world" });
  chart.append(world);
  sea.append(chart, peek);
  placed.forEach((p, k) => {
    const g = p.g, share = g.size ? g.unblocked / g.size : 0;
    const isle = sv("g", { class: "isle", tabindex: 0, role: "button", "aria-label": nameOf(g.head) + ": " + groupLine(g), transform: "translate(" + p.x + "," + p.y + ")" });
    const land = sv("g", { class: "grow", style: "animation-delay:" + Math.min(k * 35, 900) + "ms" });
    land.append(sv("circle", { class: "shore", r: p.r + 6 }), sv("circle", { class: "body", r: p.r }), sv("circle", { class: "track", r: p.r - 4, "stroke-width": 3 }));
    if (share) land.append(sv("circle", { class: "ring", r: p.r - 4, "stroke-width": 3, pathLength: 100, "stroke-dasharray": (share * 100).toFixed(1) + " 100", transform: "rotate(-90)" }));
    if (holds(g)) land.append((p.flag = sv("circle", { class: "flag", cx: p.r * 0.72, cy: -p.r * 0.72, r: 5 })));
    // A name lies inside its own shore, so none lies on another; overview shows it only where the island is drawn large enough to read.
    p.count = sv("text", { class: "count" }, n(g.size));
    p.name = sv("text", { class: "name" });
    land.append(p.count, p.name);
    land.append(sv("title", {}, nameOf(g.head) + ": " + groupLine(g)));
    isle.append(land);
    const say = () => { peek.textContent = nameOf(g.head) + ": " + groupLine(g); };
    isle.addEventListener("pointerenter", say);
    isle.addEventListener("focus", say);
    isle.addEventListener("pointerleave", () => { peek.textContent = ""; });
    isle.addEventListener("click", () => openGroup(k));
    isle.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openGroup(k); } });
    world.append(isle);
    isles.push(isle);
  });
  const drawn = D.groups.length > ISLES ? "The " + n(ISLES) + " largest of " + n(D.groups.length) + " Groups are drawn; Groups lists every one. " : "";
  hint = el("p", { class: "hint", textContent: drawn + "Each island is a Group of linked Issues, sized by how many it holds. Its ring fills with the share Unblocked, and a dot marks one holding an Issue in Take next. Select an island to open it." });
  sea.append(hint);
  requestAnimationFrame(overview);
  addEventListener("resize", () => { if (!inside) overview(); });
}

/** Every island in view, as large as fits. */
function overview() {
  const box = sea.getBoundingClientRect();
  const minX = Math.min(...placed.map((p) => p.x - p.r)) - 30, maxX = Math.max(...placed.map((p) => p.x + p.r)) + 30;
  const minY = Math.min(...placed.map((p) => p.y - p.r)) - 30, maxY = Math.max(...placed.map((p) => p.y + p.r)) + 30;
  const room = box.height - 60;
  const k = Math.min(box.width / (maxX - minX), room / (maxY - minY), 2.2);
  world.style.transform = "translate(" + (box.width / 2 - ((minX + maxX) / 2) * k) + "px," + (room / 2 - ((minY + maxY) / 2) * k) + "px) scale(" + k + ")";
  // Text keeps its size on screen however far the islands are scaled down; what doesn't fit its island is left out.
  world.style.setProperty("--k", k);
  for (const p of placed) {
    const across = p.r * k, named = across >= 44;
    p.count.setAttribute("display", across >= 11 ? "inline" : "none");
    p.count.setAttribute("y", named ? -7 / k : 0);
    p.name.setAttribute("display", named ? "inline" : "none");
    p.name.setAttribute("y", 12 / k);
    p.flag?.setAttribute("r", Math.min(5 / k, p.r / 4));
    if (named) p.name.textContent = clip(nameOf(p.g.head), Math.floor((across * 1.3) / 6.5));
  }
}

/** The Group that holds Issue i, opened with i chosen; an Issue in no Group is shown on its own. */
function openFor(i) {
  const k = D.groups.findIndex((g) => has(g, i));
  if (k < 0) return showCard(i);
  openGroup(k, i);
}

/** Zooms into Group k's island, then draws its Issues over the sea. */
function openGroup(k, focusOn, all) {
  closeCard();
  closeList();
  const p = placed[k];
  if (p && !inside) {
    const box = sea.getBoundingClientRect();
    const zoom = Math.max(box.width, box.height) / p.r;
    world.style.transform = "translate(" + (box.width / 2 - p.x * zoom) + "px," + (box.height / 2 - p.y * zoom) + "px) scale(" + zoom + ")";
    isles.forEach((x, j) => x.classList.toggle("away", j !== k));
  }
  const zoomed = !!p && !inside;
  if (hint) hint.hidden = true;
  peek.textContent = "";
  chart?.classList.add("under");
  inside?.remove();
  const view = (inside = el("section", { class: "inside" }));
  after(zoomed ? 420 : 0, () => { if (inside !== view) return; sea.insertBefore(view, card); drawGroup(k, focusOn, all); });
}

function leaveGroup() {
  inside?.remove();
  inside = null;
  closeCard();
  if (!chart) return;
  isles.forEach((x) => x.classList.remove("away"));
  chart.classList.remove("under");
  hint.hidden = false;
  overview();
}

function drawGroup(k, focusOn, all) {
  const g = D.groups[k];
  inside.append(el("div", { class: "bar" }, el("button", { class: "btn", textContent: "All Groups", onclick: leaveGroup }), el("span", { class: "muted", textContent: "Group " + n(k + 1) + " of " + n(D.groups.length) })), el("h2", {}, titled(nameOf(g.head))),
    el("div", { class: "bar" }, el("span", { class: "muted", textContent: groupLine(g) + "." }), el("div", { class: "legend" }, el("span", {}, el("i", { style: "border-color:var(--stop)" }), "Blocks the Issue under it"), el("span", {}, el("i", { style: "border-color:var(--faint)" }), "Parent of the Issue under it"), el("span", { textContent: "↗ an Outside Issue" }))));
  const beneath = new Map();
  for (let j = 0; j < g.below.length; j += 3) { const a = g.below[j]; if (!beneath.has(a)) beneath.set(a, []); beneath.get(a).push([g.below[j + 1], g.below[j + 2]]); }
  const width = inside.clientWidth - 32;
  if (all || width < 560) outline(g, beneath, focusOn, width, ROWS);
  else layers(k, g, beneath, focusOn, width);
}

/** One Issue's box at (x, y), w wide; choosing it shows its card. */
function issueBox(i, x, y, w, delay) {
  const it = I[i];
  const box = sv("g", { class: "issue in" + (it.unblocked ? " unblocked" : "") + (it.next ? " next" : "") + (it.ref.startsWith("↗") ? " outside" : ""), tabindex: 0, role: "button", "aria-label": it.ref + " " + it.title, style: "animation-delay:" + delay + "ms" });
  const at = sv("g", { transform: "translate(" + x + "," + y + ")" });
  at.append(sv("rect", { width: w, height: 50, rx: 9 }), sv("text", { class: "r", x: 12, y: 19 }, clip((it.next ? "Take next " + n(it.next) + " · " : "") + it.ref, Math.floor((w - 20) / 7.2))), sv("text", { class: "t", x: 12, y: 37 }, clip(it.title, Math.floor((w - 20) / 7))), sv("title", {}, it.ref + " " + it.title));
  box.append(at);
  const choose = () => { unchoose(); chosen = box; box.classList.add("chosen"); };
  box.addEventListener("click", () => { choose(); showCard(i); });
  box.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(); showCard(i); } });
  return { box, choose };
}

/** A line from one Issue to the one under it, drawing itself in after delay. */
function link(d, blocked, delay) {
  const path = sv("path", { class: "line in" + (blocked ? " blocked" : ""), d });
  path.style.animationDelay = delay + "ms";
  return path;
}
const measure = (lines) => lines.forEach((path) => path.style.setProperty("--len", Math.ceil(path.getTotalLength())));

/** Wide screens: the Group in layers from its top, each Issue once, where it's first reached; a full layer folds the rest into "more". */
function layers(k, g, beneath, focusOn, width) {
  const W = 184, H = 50, GX = 14, GY = 54;
  const per = Math.max(2, Math.floor((width + GX) / (W + GX)));
  const seen = new Set(g.top), rows = [];
  let layer = g.top.slice();
  while (layer.length) {
    const drawn = layer.slice(0, layer.length > per ? per - 1 : per);
    rows.push({ drawn, folded: layer.length - drawn.length });
    const next = [];
    for (const i of drawn) for (const [j] of beneath.get(i) || []) if (!seen.has(j)) { seen.add(j); next.push(j); }
    layer = next;
  }
  const cols = Math.max(...rows.map((l) => l.drawn.length + (l.folded ? 1 : 0)));
  const SW = cols * (W + GX) - GX, SH = rows.length * (H + GY) - GY + 8;
  const at = new Map();
  rows.forEach((l, d) => { const c = l.drawn.length + (l.folded ? 1 : 0); l.x0 = (SW - (c * (W + GX) - GX)) / 2; l.drawn.forEach((i, j) => at.set(i, [l.x0 + j * (W + GX), d * (H + GY)])); });
  const picture = sv("svg", { width: SW, height: SH, viewBox: "0 0 " + SW + " " + SH, role: "group", "aria-label": "The Issues of this Group" });
  const lines = sv("g"), boxes = sv("g");
  picture.append(lines, boxes);
  let focus = null;
  rows.forEach((l, d) => {
    for (const i of l.drawn) {
      const [x, y] = at.get(i);
      const made = issueBox(i, x, y, W, d * 160);
      boxes.append(made.box);
      if (i === focusOn) focus = made;
    }
    if (l.folded) {
      // Every Issue can still be reached: "more" opens the Group as one outline.
      const more = sv("g", { class: "more", tabindex: 0, role: "button" });
      more.append(sv("text", { x: l.x0 + l.drawn.length * (W + GX) + 8, y: d * (H + GY) + H / 2 + 4 }, n(l.folded) + " more"));
      const open = () => openGroup(k, focusOn, true);
      more.addEventListener("click", open);
      more.addEventListener("keydown", (e) => { if (e.key === "Enter") open(); });
      boxes.append(more);
    }
  });
  const drawnLines = [];
  for (const [a, under] of beneath) {
    if (!at.has(a)) continue;
    const [x1, y1] = at.get(a), d = Math.round(y1 / (H + GY));
    for (const [b, blocked] of under) {
      if (!at.has(b)) continue;
      const [x2, y2] = at.get(b);
      const sx = x1 + W / 2, sy = y1 + H, ex = x2 + W / 2, my = (sy + y2) / 2;
      const path = link("M" + sx + "," + sy + " C" + sx + "," + my + " " + ex + "," + my + " " + ex + "," + y2, blocked, d * 160 + 120);
      lines.append(path);
      drawnLines.push(path);
    }
  }
  inside.append(picture);
  measure(drawnLines);
  if (focus) after(500, () => { focus.choose(); showCard(focusOn); });
}

/** Narrow screens, or a Group too wide for layers: one column, each Issue indented under the one it was first reached from. */
function outline(g, beneath, focusOn, width, cap) {
  const rows = [], seen = new Set();
  const walk = (i, d, from, blocked) => {
    if (seen.has(i) || rows.length >= cap) return;
    seen.add(i);
    rows.push({ i, d: Math.min(d, 4), from, blocked });
    for (const [j, b] of beneath.get(i) || []) walk(j, d + 1, i, b);
  };
  for (const t of g.top) walk(t, 0, null, 0);
  const every = new Set(g.top);
  for (let j = 0; j < g.below.length; j += 3) { every.add(g.below[j]); every.add(g.below[j + 1]); }
  const rest = every.size - rows.length;
  const H = 50, GY = 10, IN = 18;
  const SW = Math.max(240, Math.min(width, 720)), SH = rows.length * (H + GY) + (rest > 0 ? 28 : 0);
  const picture = sv("svg", { width: SW, height: SH, viewBox: "0 0 " + SW + " " + SH, role: "group", "aria-label": "The Issues of this Group" });
  const lines = sv("g"), boxes = sv("g");
  picture.append(lines, boxes);
  const where = new Map(), drawnLines = [];
  let focus = null;
  rows.forEach((r, k) => {
    const x = r.d * IN, y = k * (H + GY), delay = Math.min(k * 45, 900);
    where.set(r.i, { x, y });
    const made = issueBox(r.i, x, y, SW - x, delay);
    boxes.append(made.box);
    if (r.i === focusOn) focus = made;
    if (r.from == null || !where.has(r.from)) return;
    const above = where.get(r.from), sx = Math.max(above.x + 8, 4), ex = Math.max(x - 2, 0), ey = y + H / 2;
    const path = link("M" + sx + "," + (above.y + H) + " L" + sx + "," + (ey - 6) + " Q" + sx + "," + ey + " " + (sx + 6) + "," + ey + " L" + ex + "," + ey, r.blocked, delay + 100);
    lines.append(path);
    drawnLines.push(path);
  });
  if (rest > 0) {
    const more = sv("g", { class: "more", tabindex: 0, role: "button" });
    more.append(sv("text", { x: 4, y: SH - 8 }, "Show " + n(Math.min(rest, 200)) + " more of " + n(rest)));
    const grow = () => { const keep = inside.scrollTop; picture.remove(); outline(g, beneath, null, width, cap + 200); inside.scrollTop = keep; };
    more.addEventListener("click", grow);
    more.addEventListener("keydown", (e) => { if (e.key === "Enter") grow(); });
    boxes.append(more);
  }
  inside.append(picture);
  measure(drawnLines);
  // A phone's card would cover the outline: the Issue is marked and scrolled to, and its card waits for a tap.
  if (focus) after(500, () => { focus.choose(); focus.box.scrollIntoView({ block: "center", behavior: quiet ? "auto" : "smooth" }); if (width >= 560) showCard(focusOn); });
}
})();
`;
