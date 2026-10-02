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

  const picked = (pick: Pick): PagePick => ({ issue: own(pick.issue), line: pickLine(pick, snapshot, undefined, plainTitle) });
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
<header id="header"></header>
<main>
<section id="groups-view"></section>
<section id="group-view" hidden></section>
</main>
<aside id="issue" hidden></aside>
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

const STYLE = `
:root { --bg: #fff; --fg: #1f2328; --muted: #656d76; --line: #d0d7de; --tile: #eef1f4; --free: #1a7f37; --blocked: #cf222e; --pick: #bf8700; --panel: #f6f8fa; }
@media (prefers-color-scheme: dark) { :root { --bg: #0d1117; --fg: #e6edf3; --muted: #9198a1; --line: #3d444d; --tile: #1c2128; --free: #3fb950; --blocked: #f85149; --pick: #d29922; --panel: #161b22; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.45 system-ui, sans-serif; }
header, main { padding: 12px 16px; }
header h1 { font-size: 18px; margin: 0 0 4px; }
.muted { color: var(--muted); }
.warn { color: var(--blocked); }
h2 { font-size: 15px; margin: 16px 0 6px; }
ol, ul { margin: 0; padding-left: 22px; }
li { margin: 2px 0; }
button.link { background: none; border: 0; padding: 0; color: inherit; font: inherit; text-align: left; cursor: pointer; }
button.link:hover { text-decoration: underline; }
button.more { margin: 6px 0; }
.tiles { display: flex; flex-wrap: wrap; gap: 4px; align-items: flex-start; }
.tile { display: flex; flex-direction: column; justify-content: flex-start; align-items: flex-start; border: 1px solid var(--line); border-radius: 4px; padding: 4px; overflow: hidden; cursor: pointer; font-size: 11px; color: var(--fg); text-align: left;
  background: linear-gradient(to top, color-mix(in srgb, var(--free) 35%, var(--tile)) var(--share), var(--tile) var(--share)); }
.tile.next { outline: 2px solid var(--pick); }
.tile:hover { border-color: var(--fg); }
svg text { fill: var(--fg); font-size: 11px; }
svg .node rect { fill: var(--tile); stroke: var(--line); }
svg .node.unblocked rect { stroke: var(--free); stroke-width: 2; }
svg .node.next rect { stroke: var(--pick); stroke-width: 3; }
svg .node, svg .fold { cursor: pointer; }
svg .fold rect { fill: transparent; stroke: var(--line); stroke-dasharray: 3 3; }
svg line.child { stroke: var(--muted); }
svg line.blocked { stroke: var(--blocked); stroke-dasharray: 5 3; }
.legend span { margin-right: 12px; }
#group-view { overflow-x: auto; }
aside { position: fixed; right: 12px; bottom: 12px; width: min(420px, calc(100% - 24px)); background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 12px; box-shadow: 0 4px 16px #0003; }
aside input { width: 100%; margin: 6px 0; font: 12px ui-monospace, monospace; padding: 4px; background: var(--bg); color: var(--fg); border: 1px solid var(--line); }
aside .close { float: right; }
`;

/** Draws the page from its data; builds every element with text, never markup, so no title is read as HTML. */
const SCRIPT = `
"use strict";
const D = JSON.parse(document.getElementById("data").textContent);
const I = D.issues;
const LIST = 50, FOLD = 12, W = 170, H = 36, GAP_X = 14, GAP_Y = 46;
const el = (tag, props, ...kids) => { const e = document.createElement(tag); Object.assign(e, props || {}); for (const k of kids) e.append(k); return e; };
const svg = (tag, attrs) => { const e = document.createElementNS("http://www.w3.org/2000/svg", tag); for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v); return e; };
const n = (x) => x.toLocaleString("en-US");
const plural = (x, noun) => n(x) + " " + noun + (x === 1 ? "" : "s");
const clip = (text, max) => (text.length <= max ? text : text.slice(0, max - 1) + "…");
const web = (url) => (url && /^https?:\\/\\//.test(url) ? url : null);
const issueButton = (i, text) => el("button", { className: "link", textContent: text, onclick: () => showIssue(i) });

function ago(iso) {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 90) return "just now";
  if (s < 5400) return Math.round(s / 60) + " min ago";
  if (s < 129600) return Math.round(s / 3600) + " h ago";
  return Math.round(s / 86400) + " days ago";
}

/** A list shown LIST at a time, with a button for the next. */
function paged(items, row, tag) {
  const list = el(tag || "ul");
  const wrap = el("div", {}, list);
  let shown = 0;
  const more = el("button", { className: "more" });
  const step = () => {
    for (const item of items.slice(shown, shown + LIST)) list.append(el("li", {}, row(item)));
    shown = Math.min(items.length, shown + LIST);
    more.textContent = "Show " + n(Math.min(LIST, items.length - shown)) + " more of " + n(items.length - shown);
    if (shown >= items.length) more.remove();
  };
  more.onclick = step;
  wrap.append(more);
  step();
  return wrap;
}

function header() {
  const h = document.getElementById("header");
  const project = web(D.projectUrl) ? el("a", { href: D.projectUrl, target: "_blank", rel: "noopener", textContent: D.project }) : D.project;
  h.append(el("h1", {}, project));
  h.append(el("div", { textContent: [plural(D.open, "open Issue"), n(D.onMap) + " on the Map", n(D.unlinked.length) + " Unlinked", D.band].join(" · ") }));
  h.append(el("div", { className: "muted", textContent: "Read from " + D.tracker + " " + ago(D.readAt) + " (" + D.readAt + "). This page is read-only and never refreshes: ask for it again in Claude Code for a new one. Copy an Issue's URL and paste it into Claude Code to open its card." }));
  if (D.stale) h.append(el("div", { className: "warn", textContent: "⚠ Its Snapshot couldn't be refreshed: " + D.stale }));
  for (const note of D.notes) h.append(el("div", { className: "warn", textContent: "⚠ " + note }));
}

function overview() {
  const view = document.getElementById("groups-view");
  view.append(el("h2", { textContent: D.next.head + " — " + D.next.why }));
  if (D.next.picks.length) view.append(paged(D.next.picks, (p) => issueButton(p.issue, p.line), "ol"));
  if (D.next.taken.length) {
    view.append(el("h2", { textContent: "Taken by others: " + n(D.next.taken.length) + " — Unblocked, but someone else has them" }));
    view.append(paged(D.next.taken, (p) => issueButton(p.issue, p.line)));
  }
  view.append(el("h2", { textContent: "Groups: " + n(D.groups.length) + " — largest first; each tile is sized by its Issues and filled by the share Unblocked; one holding Take next is outlined" }));
  const tiles = el("div", { className: "tiles" });
  let shown = 0;
  const more = el("button", { className: "more" });
  const step = () => {
    for (const [g, group] of D.groups.slice(shown, shown + 500).entries()) {
      const place = shown + g;
      const side = Math.round(40 + 22 * Math.sqrt(group.size + group.outside));
      const head = I[group.head];
      const tile = el("button", { className: "tile", title: head.ref + " " + head.title });
      tile.style.width = tile.style.height = side + "px";
      tile.style.setProperty("--share", (group.size ? (100 * group.unblocked) / group.size : 0) + "%");
      if (holdsNext(group)) tile.classList.add("next");
      tile.append(el("span", {}, el("b", { textContent: n(place + 1) + ". " }), head.ref, el("br"), plural(group.size, "Issue") + (group.unblocked ? ", " + n(group.unblocked) + " Unblocked" : "")));
      tile.onclick = () => openGroup(place);
      tiles.append(tile);
    }
    shown = Math.min(D.groups.length, shown + 500);
    more.textContent = "Show more Groups: " + n(D.groups.length - shown) + " left";
    if (shown >= D.groups.length) more.remove();
  };
  more.onclick = step;
  view.append(tiles, more);
  step();
  view.append(el("h2", { textContent: "Unlinked: " + n(D.unlinked.length) + " — no Link to another open Issue; newest first" }));
  view.append(paged(D.unlinked, (i) => issueButton(i, I[i].ref + " " + I[i].title)));
}

function holdsNext(group) {
  if (I[group.head].next) return true;
  for (const i of group.top) if (I[i].next) return true;
  for (let k = 1; k < group.below.length; k += 3) if (I[group.below[k]].next) return true;
  return false;
}

let opened = null;
function openGroup(place) {
  opened = { place, limits: [] };
  document.getElementById("groups-view").hidden = true;
  drawGroup();
  window.scrollTo(0, 0);
}

function closeGroup() {
  opened = null;
  document.getElementById("group-view").hidden = true;
  document.getElementById("groups-view").hidden = false;
}

/** The Group in layers from its top, each Issue once, where it's first reached; a layer past FOLD folds the rest into "+N more", and only what's drawn is followed further. */
function drawGroup() {
  const { place, limits } = opened;
  const group = D.groups[place];
  const view = document.getElementById("group-view");
  view.replaceChildren();
  view.hidden = false;
  const head = I[group.head];
  view.append(el("button", { textContent: "← All Groups", onclick: closeGroup }));
  view.append(el("h2", { textContent: "Group " + n(place + 1) + " of " + n(D.groups.length) + " · " + head.ref + " " + head.title + " — " + plural(group.size, "Issue") + (group.unblocked ? ", " + n(group.unblocked) + " Unblocked" : "") + (group.outside ? ", " + n(group.outside) + "↗ Outside" : "") }));
  view.append(el("div", { className: "legend muted" }, el("span", { textContent: "── its Parent above it" }), el("span", { textContent: "╌╌ Blocked by the Issue above it (red)" }), el("span", { textContent: "green border: Unblocked" }), el("span", { textContent: "gold border: in Take next" }), el("span", { textContent: "↗ an Outside Issue, not followed" })));
  const beneath = new Map();
  for (let k = 0; k < group.below.length; k += 3) {
    const from = group.below[k];
    if (!beneath.has(from)) beneath.set(from, []);
    beneath.get(from).push([group.below[k + 1], group.below[k + 2]]);
  }
  const seen = new Set(group.top);
  const layers = [];
  let layer = group.top;
  while (layer.length) {
    const d = layers.length;
    const limit = limits[d] || FOLD;
    const drawn = layer.slice(0, limit);
    layers.push({ drawn, folded: layer.length - drawn.length });
    const nextLayer = [];
    for (const i of drawn) for (const [j] of beneath.get(i) || []) if (!seen.has(j)) { seen.add(j); nextLayer.push(j); }
    layer = nextLayer;
  }
  const at = new Map();
  const width = Math.max(...layers.map((l) => l.drawn.length + (l.folded ? 1 : 0))) * (W + GAP_X) + GAP_X;
  const height = layers.length * (H + GAP_Y) + GAP_Y;
  const picture = svg("svg", { width, height, viewBox: "0 0 " + width + " " + height, role: "img" });
  picture.append(el("title", { textContent: "Group " + n(place + 1) }));
  layers.forEach((l, d) => l.drawn.forEach((i, k) => at.set(i, [GAP_X + k * (W + GAP_X), GAP_Y / 2 + d * (H + GAP_Y)])));
  for (const [from, list] of beneath) {
    if (!at.has(from)) continue;
    const [x1, y1] = at.get(from);
    for (const [to, blocked] of list) {
      if (!at.has(to)) continue;
      const [x2, y2] = at.get(to);
      picture.append(svg("line", { x1: x1 + W / 2, y1: y1 + H, x2: x2 + W / 2, y2, class: blocked ? "blocked" : "child" }));
    }
  }
  layers.forEach((l, d) => {
    for (const i of l.drawn) {
      const [x, y] = at.get(i);
      const issue = I[i];
      const node = svg("g", { class: "node" + (issue.unblocked ? " unblocked" : "") + (issue.next ? " next" : ""), transform: "translate(" + x + "," + y + ")", tabindex: "0" });
      node.append(svg("rect", { width: W, height: H, rx: 4 }));
      const ref = svg("text", { x: 6, y: 14, "font-weight": "bold" });
      ref.textContent = clip(issue.ref, 26);
      const title = svg("text", { x: 6, y: 29 });
      title.textContent = clip(issue.title, 26);
      const tip = svg("title");
      tip.textContent = issue.ref + " " + issue.title;
      node.append(tip, ref, title);
      node.addEventListener("click", () => showIssue(i));
      node.addEventListener("keydown", (e) => { if (e.key === "Enter") showIssue(i); });
      picture.append(node);
    }
    if (l.folded) {
      const x = GAP_X + l.drawn.length * (W + GAP_X), y = GAP_Y / 2 + d * (H + GAP_Y);
      const fold = svg("g", { class: "fold", transform: "translate(" + x + "," + y + ")", tabindex: "0" });
      fold.append(svg("rect", { width: W, height: H, rx: 4 }));
      const text = svg("text", { x: 6, y: 22 });
      text.textContent = "+" + n(l.folded) + " more";
      fold.append(text);
      const unfold = () => { limits[d] = (limits[d] || FOLD) + 4 * FOLD; drawGroup(); };
      fold.addEventListener("click", unfold);
      fold.addEventListener("keydown", (e) => { if (e.key === "Enter") unfold(); });
      picture.append(fold);
    }
  });
  view.append(picture);
}

function showIssue(i) {
  const issue = I[i];
  const panel = document.getElementById("issue");
  panel.replaceChildren();
  panel.hidden = false;
  panel.append(el("button", { className: "close", textContent: "✕", title: "Close", onclick: () => (panel.hidden = true) }));
  panel.append(el("div", {}, el("b", { textContent: issue.ref })));
  if (issue.title) panel.append(el("div", { textContent: issue.title }));
  const said = [issue.next ? "Take next #" + n(issue.next) : "", issue.unblocked ? "Unblocked" : ""].filter(Boolean).join(" · ");
  if (said) panel.append(el("div", { className: "muted", textContent: said }));
  const url = web(issue.url);
  if (!url) return;
  const field = el("input", { value: url, readOnly: true });
  const status = el("span", { className: "muted" });
  const select = () => { field.focus(); field.select(); status.textContent = " Selected: copy it with your keyboard."; };
  const copy = el("button", { textContent: "Copy URL", onclick: () => {
    if (!navigator.clipboard) return select();
    navigator.clipboard.writeText(url).then(() => (status.textContent = " Copied: paste it into Claude Code to open its card."), select);
  } });
  panel.append(field, copy, status, el("div", {}, el("a", { href: url, target: "_blank", rel: "noopener", textContent: "Open on " + D.tracker })));
}

header();
overview();
`;
