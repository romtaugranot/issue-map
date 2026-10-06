/**
 * PROTOTYPE — throwaway, never for main. Three looks for the HTML Picture
 * (src/map/page.ts), drawn from real recorded Snapshots, switchable by
 * ?variant=A|B|C and ?data=opentofu|rust|playwright|empty, or the bar at the
 * bottom (Shift+←/→ cycles the variant).
 *
 *   node src/map/page.prototype.ts <out-dir>
 *
 * writes <out-dir>/map-prototype.html.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { pageData, type PageData } from "./page.ts";

const root = join(import.meta.dirname, "..", "..");
const load = (name: string): PageData => pageData(JSON.parse(gunzipSync(readFileSync(join(root, "test", "fixtures", "snapshots", `${name}.json.gz`))).toString()));
const opentofu = load("opentofu__opentofu");
const sets: Record<string, PageData> = {
  opentofu,
  rust: load("rust-lang__rust"),
  playwright: load("microsoft__playwright"),
  empty: { ...opentofu, project: "romtaugranot/agent-cockpit", projectUrl: "https://github.com/romtaugranot/agent-cockpit", open: 0, onMap: 0, next: { head: "Take next: 0", why: "every Issue on the Map is Blocked, or a Parent of Blocked Issues", picks: [], taken: [] }, groups: [], unlinked: [], issues: [] },
};
const data = JSON.stringify(sets).replace(/</g, "\\u003c");

const STYLE = String.raw`
:root {
  --bg: #f3f7f8; --ink: #10242f; --muted: #4c6573; --faint: #86a0ad; --line: #c9dbe2; --raise: #e6eff2;
  --go: #0e8a76; --stop: #cf4f3a; --pick: #a8720a; --pick-wash: #fbefd0;
  --shallow: #dcebf0; --land: #fbfcfb; --coast: #a9c6d1;
  --mono: ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace;
  --sans: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
@media (prefers-color-scheme: dark) { :root {
  --bg: #0a1b29; --ink: #e4edf1; --muted: #8ea6b4; --faint: #577487; --line: #1d374b; --raise: #10263a;
  --go: #5fd0b9; --stop: #ff8a72; --pick: #f2c45c; --pick-wash: #2c2818;
  --shallow: #12304a; --land: #16334a; --coast: #2d5470;
} }
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.5 var(--sans); }
a { color: inherit; }
button { font: inherit; color: inherit; }
:focus-visible { outline: 2px solid var(--pick); outline-offset: 2px; }
code { font-family: var(--mono); font-size: .88em; background: var(--raise); border: 1px solid var(--line); border-radius: 4px; padding: 0 3px; }
.ref { font-family: var(--mono); font-size: .86em; color: var(--muted); font-variant-numeric: tabular-nums; }
.muted { color: var(--muted); }
.warn { color: var(--stop); }
.btn { display: inline-flex; align-items: center; height: 32px; padding: 0 12px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); cursor: pointer; text-decoration: none; font-size: 13px; }
.btn:hover { border-color: var(--muted); }
.meter { height: 4px; border-radius: 2px; background: var(--line); overflow: hidden; }
.meter i { display: block; height: 100%; background: var(--go); }
.outline ul { list-style: none; margin: 0; padding-left: 18px; border-left: 1px solid var(--line); }
.outline > ul { padding-left: 0; border: 0; }
.outline li { margin: 2px 0; }
.outline li.blocked > .node { box-shadow: inset 2px 0 var(--stop); padding-left: 8px; }
.outline .node { display: block; width: 100%; text-align: left; background: none; border: 0; padding: 4px 6px; border-radius: 4px; cursor: pointer; }
.outline .node:hover { background: var(--raise); }
.outline .node.unblocked .ref { color: var(--go); }
.outline .node.next .ref { color: var(--pick); font-weight: 700; }
.outline .rel { font-size: 12px; color: var(--faint); margin-left: 6px; }
.detail .title { font-weight: 600; margin: 2px 0 6px; }
.detail .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
.detail .status { font-size: 13px; color: var(--muted); margin-top: 6px; min-height: 1.2em; }
.empty { padding: 32px 0; }
.empty h2 { margin: 0 0 6px; font-size: 20px; }

/* ── A · Queue ─────────────────────────────────────────── */
.A { max-width: 760px; margin: 0 auto; padding: 28px 16px 96px; }
.A header h1 { font-size: 26px; line-height: 1.15; letter-spacing: -.01em; margin: 0; font-weight: 680; }
.A header h1 a { text-decoration: none; }
.A .facts { display: flex; gap: 20px; flex-wrap: wrap; margin: 14px 0 6px; padding: 0; }
.A .facts div { display: flex; flex-direction: column; }
.A .facts b { font-size: 22px; font-variant-numeric: tabular-nums; font-weight: 650; line-height: 1.1; }
.A .facts span { font-size: 13px; color: var(--muted); }
.A .fresh { font-size: 13px; color: var(--muted); margin: 0; }
.A section { margin-top: 36px; }
.A h2 { font-size: 17px; margin: 0; font-weight: 650; }
.A h2 + .cap { font-size: 13px; color: var(--muted); margin: 2px 0 12px; }
.A ol.queue { list-style: none; margin: 0; padding: 0; counter-reset: q; border-top: 1px solid var(--line); }
.A ol.queue > li { border-bottom: 1px solid var(--line); }
.A .row { display: grid; grid-template-columns: 2.2em 1fr; gap: 0 10px; width: 100%; text-align: left; background: none; border: 0; padding: 12px 4px; cursor: pointer; }
.A .row:hover { background: var(--raise); }
.A .row .pos { font-variant-numeric: tabular-nums; color: var(--faint); font-size: 13px; padding-top: 2px; text-align: right; }
.A li:first-child .row .pos { color: var(--pick); font-weight: 700; }
.A .row .why { grid-column: 2; font-size: 13px; color: var(--muted); }
.A .open .detail { padding: 0 4px 14px calc(2.2em + 14px); }
.A .groups { display: grid; gap: 2px; }
.A .group { display: grid; grid-template-columns: 1fr auto; gap: 4px 16px; align-items: center; text-align: left; background: none; border: 0; border-bottom: 1px solid var(--line); padding: 10px 4px; cursor: pointer; }
.A .group:hover { background: var(--raise); }
.A .group .meter { grid-column: 1 / -1; }
.A .group .n { font-size: 13px; color: var(--muted); white-space: nowrap; }
.A .group.holds .name::before { content: ""; display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--pick); margin-right: 8px; vertical-align: 2px; }
.A details { margin-top: 36px; border-top: 1px solid var(--line); padding-top: 14px; }
.A summary { cursor: pointer; font-weight: 650; font-size: 17px; }
.A summary .cap { font-weight: 400; font-size: 13px; color: var(--muted); margin-left: 8px; }
.plain { list-style: none; padding: 0; margin: 10px 0; }
.A .plain li button { background: none; border: 0; padding: 6px 0; text-align: left; cursor: pointer; }
.A .back { margin-bottom: 16px; }

/* ── B · Panes ─────────────────────────────────────────── */
.B { display: grid; grid-template-rows: auto auto 1fr; height: 100dvh; }
.B header { padding: 14px 20px; border-bottom: 1px solid var(--line); display: flex; align-items: baseline; gap: 16px; flex-wrap: wrap; }
.B header h1 { font-size: 17px; margin: 0; font-weight: 650; }
.B header h1 a { text-decoration: none; }
.B header .fresh { font-size: 13px; color: var(--muted); }
.B .tabs { display: none; }
.B .panes { display: grid; grid-template-columns: 1.15fr 1fr 1fr; min-height: 0; }
.B .pane { overflow: auto; border-right: 1px solid var(--line); padding: 16px 20px 80px; }
.B .pane:last-child { border-right: 0; }
.B .pane h2 { font-size: 13px; font-weight: 600; color: var(--muted); margin: 0 0 10px; display: flex; justify-content: space-between; }
.B .pane h2 b { color: var(--ink); font-variant-numeric: tabular-nums; }
.B .card { display: block; width: 100%; text-align: left; background: var(--raise); border: 1px solid transparent; border-radius: 8px; padding: 10px 12px; margin-bottom: 8px; cursor: pointer; }
.B .card:hover, .B .card.sel { border-color: var(--line); }
.B .card.first { background: var(--pick-wash); border-color: var(--pick); }
.B .card .why { display: block; font-size: 12.5px; color: var(--muted); margin-top: 3px; }
.B .card .meter { margin-top: 8px; }
.B .drawer { position: fixed; right: 0; top: 0; bottom: 0; width: min(420px, 100%); background: var(--bg); border-left: 1px solid var(--line); padding: 20px; overflow: auto; box-shadow: -12px 0 32px #0002; }
.B .drawer .close { float: right; }
.B .more { margin: 6px 0; }
@media (max-width: 760px) {
  .B { height: auto; display: block; }
  .B .tabs { display: flex; position: sticky; top: 0; background: var(--bg); border-bottom: 1px solid var(--line); z-index: 2; }
  .B .tabs button { flex: 1; background: none; border: 0; padding: 12px 4px; font-size: 14px; color: var(--muted); border-bottom: 2px solid transparent; }
  .B .tabs button[aria-selected="true"] { color: var(--ink); border-bottom-color: var(--pick); font-weight: 600; }
  .B .panes { display: block; }
  .B .pane { border: 0; overflow: visible; padding: 14px 16px 96px; }
  .B .pane:not(.on) { display: none; }
  .B .pane h2 { display: none; }
  .B .drawer { top: auto; left: 0; width: 100%; max-height: 70dvh; border-left: 0; border-top: 1px solid var(--line); border-radius: 14px 14px 0 0; }
}

/* ── C · Map first ─────────────────────────────────────── */
.C { padding: 20px 20px 96px; display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 28px; max-width: 1280px; margin: 0 auto; }
.C header { grid-column: 1 / -1; display: flex; justify-content: space-between; align-items: end; gap: 16px; flex-wrap: wrap; }
.C header h1 { font-size: 22px; margin: 0; font-weight: 680; letter-spacing: -.01em; }
.C header h1 a { text-decoration: none; }
.C header .fresh { font-size: 13px; color: var(--muted); }
.C h2 { font-size: 15px; margin: 0 0 10px; font-weight: 650; }
.C h2 span { font-weight: 400; color: var(--muted); font-size: 13px; margin-left: 6px; }
.C .terrain { display: grid; grid-template-columns: repeat(auto-fill, minmax(84px, 1fr)); grid-auto-rows: 84px; grid-auto-flow: dense; gap: 6px; }
.C .plot { position: relative; border-radius: 6px; border: 1px solid var(--line); background: var(--raise); padding: 8px; text-align: left; cursor: pointer; overflow: hidden; display: flex; flex-direction: column; justify-content: space-between; }
.C .plot::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: var(--share); background: color-mix(in srgb, var(--go) 22%, transparent); pointer-events: none; }
.C .plot:hover { border-color: var(--muted); }
.C .plot.holds { border-color: var(--pick); box-shadow: inset 0 0 0 1px var(--pick); }
.C .plot .t { font-size: 12.5px; line-height: 1.3; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; position: relative; z-index: 1; }
.C .plot .n { font-size: 12px; color: var(--muted); position: relative; z-index: 1; font-variant-numeric: tabular-nums; }
.C .s2 { grid-column: span 2; } .C .s3 { grid-column: span 2; grid-row: span 2; } .C .s4 { grid-column: span 3; grid-row: span 2; }
.C .key { display: flex; gap: 16px; font-size: 12.5px; color: var(--muted); margin-top: 10px; flex-wrap: wrap; }
.C .key i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 6px; vertical-align: -1px; }
.C aside.queue ol { margin: 0; padding: 0; list-style: none; }
.C aside.queue li button { display: block; width: 100%; text-align: left; background: none; border: 0; border-bottom: 1px solid var(--line); padding: 9px 0; cursor: pointer; }
.C aside.queue li:first-child button { color: var(--ink); }
.C aside.queue li:first-child .ref { color: var(--pick); font-weight: 700; }
.C aside.queue .why { display: block; font-size: 12.5px; color: var(--muted); }
.C .sheet { margin-top: 20px; border: 1px solid var(--line); border-radius: 8px; padding: 14px; background: var(--raise); }
.C .lonely { margin-top: 28px; }
@media (max-width: 860px) {
  .C { grid-template-columns: 1fr; padding: 16px 16px 96px; gap: 22px; }
  .C .terrain { grid-template-columns: repeat(auto-fill, minmax(72px, 1fr)); grid-auto-rows: 72px; }
  .C header { order: -2; }
  .C aside.queue { order: -1; }
}



/* ── D · Islands ───────────────────────────────────────── */
.D { position: fixed; inset: 0; display: grid; grid-template-rows: auto 1fr; padding-top: env(safe-area-inset-top, 0px); }
.D .top { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px 24px; align-items: center; padding: 16px 20px 14px; border-bottom: 1px solid var(--line); background: var(--bg); z-index: 3; }
.D .top h1 { margin: 0; font-size: 15px; font-weight: 600; color: var(--muted); }
.D .top h1 a { text-decoration: none; }
.D .start { grid-column: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; text-align: left; background: none; border: 0; padding: 0; cursor: pointer; }
.D .start .lead { font-size: 13px; color: var(--pick); font-weight: 600; }
.D .start .what { font-size: 19px; font-weight: 650; line-height: 1.25; text-wrap: balance; }
.D .start .why { font-size: 13px; color: var(--muted); }
.D .top .side { grid-column: 2; grid-row: 1 / span 2; display: flex; gap: 8px; align-items: center; }
.D .sea { position: relative; overflow: hidden; touch-action: none; background: radial-gradient(ellipse at 50% 45%, var(--shallow), var(--bg) 72%); }
.D svg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.D .world { transition: transform .7s cubic-bezier(.2, .7, .1, 1); }
.D .isle { cursor: pointer; transition: opacity .45s ease; }
.D .isle .body { fill: var(--land); stroke: var(--coast); stroke-width: 1; transition: fill .2s; }
.D .isle .shore { fill: none; stroke: var(--coast); stroke-width: 1; stroke-dasharray: 2 4; opacity: .7; }
.D .isle:hover .body, .D .isle:focus-visible .body { fill: color-mix(in srgb, var(--land) 80%, var(--go)); }
.D .isle .ring { fill: none; stroke: var(--go); stroke-linecap: round; }
.D .isle .track { fill: none; stroke: color-mix(in srgb, var(--coast) 60%, transparent); }
.D .isle .count { font: 650 15px var(--sans); fill: var(--ink); text-anchor: middle; dominant-baseline: central; font-variant-numeric: tabular-nums; }
.D .isle .name { font: 11px var(--sans); fill: var(--muted); text-anchor: middle; }
.D svg.under { opacity: 0; transition: opacity .3s ease .25s; }
.D .peek { position: absolute; left: 50%; top: 14px; transform: translateX(-50%); max-width: calc(100% - 32px); font-size: 13.5px; background: var(--bg); border: 1px solid var(--line); border-radius: 999px; padding: 6px 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; pointer-events: none; transition: opacity .2s; }
.D .peek:empty { opacity: 0; }
.D .isle .flag { fill: var(--pick); }
.D .isle.away { opacity: 0; pointer-events: none; }
.D .grow { transform-box: fill-box; transform-origin: center; animation: grow .6s cubic-bezier(.2, .8, .2, 1.15) both; }
@keyframes grow { from { transform: scale(0); opacity: 0; } }
.D .tree { position: absolute; inset: 0; overflow: auto; padding: 18px 16px 120px; }
.D .tree .bar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; }
.D .tree h2 { margin: 0; font-size: 18px; font-weight: 650; text-wrap: balance; }
.D .tree .bar .muted { font-size: 13px; }
.D .tree svg { position: static; width: auto; height: auto; display: block; margin: 8px auto 0; overflow: visible; }
.D .node { cursor: pointer; }
.D .node rect { fill: var(--land); stroke: var(--coast); stroke-width: 1.2; }
.D .node.unblocked rect { stroke: var(--go); stroke-width: 2; }
.D .node.next rect { fill: var(--pick-wash); stroke: var(--pick); stroke-width: 2; }
.D .node.sel rect { stroke: var(--ink); stroke-width: 2.5; }
.D .node .r { font: 600 11.5px var(--mono); fill: var(--muted); }
.D .node.next .r { fill: var(--pick); }
.D .node .t { font: 13px var(--sans); fill: var(--ink); }
.D .node.in { animation: rise .45s cubic-bezier(.2, .8, .2, 1) both; }
@keyframes rise { from { opacity: 0; transform: translateY(10px); } }
.D .edge { fill: none; stroke: var(--faint); stroke-width: 1.5; }
.D .edge.blocked { stroke: var(--stop); }
.D .edge.in { stroke-dasharray: var(--len); stroke-dashoffset: var(--len); animation: draw .5s ease-out forwards; }
@keyframes draw { to { stroke-dashoffset: 0; } }
.D .more { font: 12.5px var(--sans); fill: var(--muted); }
.D .legend { display: flex; gap: 16px; flex-wrap: wrap; font-size: 12.5px; color: var(--muted); }
.D .legend i { display: inline-block; width: 18px; height: 0; border-top: 2px solid; vertical-align: middle; margin-right: 6px; }
.D .card { position: absolute; left: 50%; bottom: calc(70px + env(safe-area-inset-bottom, 0px)); width: min(440px, calc(100% - 24px)); background: var(--land); border: 1px solid var(--coast); border-radius: 14px; padding: 16px; box-shadow: 0 16px 40px #0004; z-index: 4; transform: translate(-50%, 0); transition: transform .35s cubic-bezier(.2, .8, .2, 1), opacity .25s; }
.D .card.off { transform: translate(-50%, 30px); opacity: 0; pointer-events: none; }
.D .card .close { float: right; }
.D .list { position: absolute; right: 0; top: 0; bottom: 0; width: min(400px, 100%); background: var(--bg); border-left: 1px solid var(--line); overflow: auto; z-index: 5; transition: transform .4s cubic-bezier(.2, .8, .2, 1); padding: 16px 16px 100px; }
.D .list.off { transform: translateX(102%); }
.D .list h2 { margin: 0 0 8px; font-size: 16px; display: flex; justify-content: space-between; align-items: center; }
.D .list ol { list-style: none; margin: 0; padding: 0; }
.D .list li button { display: grid; grid-template-columns: 1.8em 1fr; gap: 0 8px; width: 100%; text-align: left; background: none; border: 0; border-top: 1px solid var(--line); padding: 10px 2px; cursor: pointer; }
.D .list .pos { color: var(--faint); font-variant-numeric: tabular-nums; text-align: right; }
.D .list li:first-child .pos { color: var(--pick); font-weight: 700; }
.D .list .why { grid-column: 2; font-size: 12.5px; color: var(--muted); }
.D .hint { position: absolute; left: 20px; bottom: calc(72px + env(safe-area-inset-bottom, 0px)); font-size: 12.5px; color: var(--muted); pointer-events: none; }
.D .note { position: absolute; left: 50%; top: 40%; transform: translate(-50%, -50%); text-align: center; max-width: 420px; padding: 0 16px; }
@media (max-width: 700px) { .D .top { grid-template-columns: 1fr; } .D .top .side { grid-column: 1; grid-row: auto; } .D .start .what { font-size: 17px; } }
@media (prefers-reduced-motion: reduce) { .D *, .D .world { animation: none !important; transition: none !important; } .D .edge.in { stroke-dashoffset: 0; } }

/* ── the prototype's own bar ───────────────────────────── */
#proto { position: fixed; left: 50%; bottom: 12px; transform: translateX(-50%); z-index: 99; display: flex; gap: 6px; align-items: center; background: #fff; color: #000; border-radius: 999px; padding: 6px 10px; font: 12px system-ui; box-shadow: 0 4px 18px rgba(0,0,0,.45); white-space: nowrap; }
#proto button, #proto select { font: inherit; color: #000; background: #eee; border: 0; border-radius: 999px; padding: 4px 9px; }
`;

const SCRIPT = String.raw`
"use strict";
const SETS = JSON.parse(document.getElementById("data").textContent);
const VARIANTS = { A: "Queue", B: "Panes", C: "Map first", D: "Islands" };
const q = new URLSearchParams(location.search);
let V = VARIANTS[q.get("variant")] ? q.get("variant") : "A";
let SET = SETS[q.get("data")] ? q.get("data") : "opentofu";
let D, I;
const el = (tag, props, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(props || {})) { if (k === "class") e.className = v; else if (k === "style") e.style.cssText = v; else if (k.startsWith("data-") || k.startsWith("aria-")) e.setAttribute(k, v); else e[k] = v; } for (const c of kids) if (c != null) e.append(c); return e; };
const n = (x) => x.toLocaleString("en-US");
const plural = (x, one, many) => n(x) + " " + (x === 1 ? one : many || one + "s");
const web = (u) => (u && /^https?:\/\//.test(u) ? u : null);
function ago(iso) { const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000); if (s < 90) return "just now"; if (s < 5400) return Math.round(s / 60) + " minutes ago"; if (s < 129600) return Math.round(s / 3600) + " hours ago"; return Math.round(s / 86400) + " days ago"; }
const why = (p) => { const k = p.line.lastIndexOf(" — "); return k < 0 ? "" : p.line.slice(k + 3).replace(/▶/g, ""); };
const fresh = () => "Read from " + D.tracker + " " + ago(D.readAt) + ". Read-only: ask Claude Code for a fresh one.";
const projectName = () => (web(D.projectUrl) ? el("a", { href: D.projectUrl, target: "_blank", rel: "noopener", textContent: D.project }) : D.project);
const titled = (t) => { const s = el("span"); t.split(String.fromCharCode(96)).forEach((part, k) => s.append(k % 2 ? el("code", { textContent: part }) : part)); return s; };
const refTitle = (i) => [el("span", { class: "ref", textContent: I[i].ref }), " ", titled(I[i].title)];
function holds(g) { if (I[g.head].next) return true; for (const i of g.top) if (I[i].next) return true; for (let k = 1; k < g.below.length; k += 3) if (I[g.below[k]].next) return true; return false; }
const warnings = () => [D.stale ? el("p", { class: "warn", textContent: "This Snapshot couldn't be refreshed: " + D.stale }) : null, ...D.notes.map((t) => el("p", { class: "warn", textContent: t }))];

/** An Issue, and the way back into Claude Code: its URL, copied. */
function detail(i) {
  const it = I[i];
  const box = el("div", { class: "detail" });
  box.append(el("div", { class: "ref", textContent: it.ref }));
  if (it.title) box.append(el("div", { class: "title", textContent: it.title }));
  const state = [it.next ? "Number " + n(it.next) + " in Take next" : "", it.unblocked ? "Unblocked: nothing open blocks it" : ""].filter(Boolean).join(". ");
  if (state) box.append(el("div", { class: "muted", textContent: state + "." }));
  const url = web(it.url);
  if (!url) return box;
  const status = el("div", { class: "status" });
  const copy = el("button", { class: "btn", textContent: "Copy link for Claude Code", onclick: () => {
    const done = () => (status.textContent = "Copied. Paste it into Claude Code to open this Issue there.");
    const fail = () => (status.textContent = url);
    navigator.clipboard ? navigator.clipboard.writeText(url).then(done, fail) : fail();
  } });
  box.append(el("div", { class: "actions" }, copy, el("a", { class: "btn", href: url, target: "_blank", rel: "noopener", textContent: "Open on " + D.tracker })), status);
  return box;
}

/** A Group as an indented outline: each Issue once, where it's first reached; a red rule marks one Blocked by the Issue above it. */
function outline(g) {
  const beneath = new Map();
  for (let k = 0; k < g.below.length; k += 3) { const a = g.below[k]; if (!beneath.has(a)) beneath.set(a, []); beneath.get(a).push([g.below[k + 1], g.below[k + 2]]); }
  const seen = new Set();
  const list = (items) => {
    const ul = el("ul");
    for (const [i, blocked] of items.slice(0, 60)) {
      if (seen.has(i)) continue; seen.add(i);
      const it = I[i];
      const node = el("button", { class: "node" + (it.unblocked ? " unblocked" : "") + (it.next ? " next" : ""), onclick: () => show(i) }, ...refTitle(i), blocked === 1 ? el("span", { class: "rel", textContent: "blocked by the one above" }) : null);
      const li = el("li", { class: blocked === 1 ? "blocked" : "" }, node);
      const kids = beneath.get(i);
      if (kids) li.append(list(kids));
      ul.append(li);
    }
    if (items.length > 60) ul.append(el("li", { class: "muted", textContent: "and " + n(items.length - 60) + " more" }));
    return ul;
  };
  return el("div", { class: "outline" }, list(g.top.map((i) => [i, 0])));
}
const groupLine = (g) => plural(g.size, "Issue") + ", " + n(g.unblocked) + " unblocked" + (g.outside ? ", " + n(g.outside) + " in other projects" : "");
const meter = (g) => el("div", { class: "meter" }, el("i", { style: "width:" + (g.size ? (100 * g.unblocked) / g.size : 0) + "%" }));
function paged(items, row, step) { const ul = el("ul", { class: "plain" }); const wrap = el("div", {}, ul); let at = 0; const more = el("button", { class: "btn more" }); const go = () => { for (const x of items.slice(at, at + step)) ul.append(el("li", {}, row(x))); at = Math.min(items.length, at + step); more.textContent = "Show " + n(Math.min(step, items.length - at)) + " more"; if (at >= items.length) more.remove(); }; more.onclick = go; wrap.append(more); go(); return wrap; }
function emptyState() {
  if (D.open === 0) return el("div", { class: "empty" }, el("h2", { textContent: "No open Issues" }), el("p", { class: "muted", textContent: "There is nothing to take in " + D.project + ". Open an Issue on " + D.tracker + " and ask Claude Code for the Map again." }));
  return null;
}
let show = () => {};

// ── A · Queue ──────────────────────────────────────────────
function A(root) {
  root.className = "A";
  const page = el("div");
  root.append(page);
  let openRow = null;
  const home = () => {
    page.replaceChildren();
    page.append(el("header", {}, el("h1", {}, projectName()),
      el("div", { class: "facts" }, ...[[D.open, "open Issues"], [D.next.picks.length, "to take next"], [D.groups.length, "Groups"], [D.unlinked.length, "unlinked"]].map(([v, t]) => el("div", {}, el("b", { textContent: n(v) }), el("span", { textContent: t })))),
      el("p", { class: "fresh", textContent: fresh() }), ...warnings()));
    const e = emptyState(); if (e) return page.append(e);
    const s1 = el("section", {}, el("h2", { textContent: "Take next" }), el("p", { class: "cap", textContent: D.next.picks.length ? "Nothing open blocks these. The ones most others wait on come first." : "Nothing can be taken: " + D.next.why + "." }));
    const ol = el("ol", { class: "queue" });
    D.next.picks.slice(0, 50).forEach((p, k) => {
      const li = el("li");
      const row = el("button", { class: "row", "aria-expanded": "false" }, el("span", { class: "pos", textContent: n(k + 1) }), el("span", {}, ...refTitle(p.issue)), el("span", { class: "why", textContent: why(p) }));
      row.onclick = () => { if (openRow && openRow !== li) { openRow.classList.remove("open"); openRow.querySelector(".detail")?.remove(); } const on = !li.classList.contains("open"); li.classList.toggle("open", on); row.setAttribute("aria-expanded", String(on)); li.querySelector(".detail")?.remove(); if (on) li.append(detail(p.issue)); openRow = on ? li : null; };
      li.append(row); ol.append(li);
    });
    s1.append(ol);
    if (D.next.picks.length > 50) s1.append(el("p", { class: "muted", textContent: "and " + n(D.next.picks.length - 50) + " more" }));
    page.append(s1);
    if (D.next.taken.length) page.append(el("details", {}, el("summary", {}, "Taken by others", el("span", { class: "cap", textContent: plural(D.next.taken.length, "Issue") + " nothing blocks, assigned to someone else" })), paged(D.next.taken, (p) => el("button", { onclick: () => show(p.issue) }, ...refTitle(p.issue)), 50)));
    if (D.groups.length) {
      const s2 = el("section", {}, el("h2", { textContent: "Groups" }), el("p", { class: "cap", textContent: "Issues joined by their links, largest first. The bar is the share nothing blocks; a gold dot holds something in Take next." }));
      const gl = el("div", { class: "groups" });
      D.groups.slice(0, 200).forEach((g, k) => gl.append(el("button", { class: "group" + (holds(g) ? " holds" : ""), onclick: () => group(k) }, el("span", { class: "name" }, ...refTitle(g.head)), el("span", { class: "n", textContent: groupLine(g) }), meter(g))));
      s2.append(gl); page.append(s2);
    }
    if (D.unlinked.length) page.append(el("details", {}, el("summary", {}, "Unlinked", el("span", { class: "cap", textContent: plural(D.unlinked.length, "Issue") + " with no link to another open Issue, newest first" })), paged(D.unlinked, (i) => el("button", { onclick: () => show(i) }, ...refTitle(i)), 50)));
  };
  const group = (k) => {
    const g = D.groups[k];
    page.replaceChildren(el("button", { class: "btn back", textContent: "Back to the Map", onclick: home }), el("h2", {}, ...refTitle(g.head)), el("p", { class: "cap muted", textContent: "Group " + n(k + 1) + " of " + n(D.groups.length) + ": " + groupLine(g) }), outline(g));
    window.scrollTo(0, 0);
  };
  show = (i) => { const d = el("dialog", { style: "max-width:520px;width:calc(100% - 32px);border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--ink);padding:18px" }, detail(i), el("form", { method: "dialog", style: "margin-top:12px" }, el("button", { class: "btn", textContent: "Close" }))); document.body.append(d); d.addEventListener("close", () => d.remove()); d.showModal(); };
  home();
}

// ── B · Panes ──────────────────────────────────────────────
function B(root) {
  root.className = "B";
  root.append(el("header", {}, el("h1", {}, projectName()), el("span", { class: "fresh", textContent: plural(D.open, "open Issue") + ". " + fresh() }), ...warnings()));
  const e = emptyState(); if (e) return root.append(el("div", { style: "padding:0 20px" }, e));
  const tabs = el("div", { class: "tabs", role: "tablist" });
  const panes = el("div", { class: "panes" });
  root.append(tabs, panes);
  let drawer = null, sel = null;
  show = (i, card) => { drawer?.remove(); sel?.classList.remove("sel"); sel = card || null; sel?.classList.add("sel"); drawer = el("div", { class: "drawer", role: "dialog" }, el("button", { class: "btn close", textContent: "Close", onclick: () => { drawer.remove(); drawer = null; sel?.classList.remove("sel"); } }), detail(i)); document.body.append(drawer); };
  const pane = (name, count, build) => { const p = el("section", { class: "pane" }, el("h2", {}, name, el("b", { textContent: n(count) }))); build(p); panes.append(p); const t = el("button", { role: "tab", textContent: name + " " + n(count), "aria-selected": "false", onclick: () => pick(p, t) }); tabs.append(t); return [p, t]; };
  const pick = (p, t) => { for (const x of panes.children) x.classList.toggle("on", x === p); for (const x of tabs.children) x.setAttribute("aria-selected", String(x === t)); window.scrollTo(0, 0); };
  const card = (i, extra, cls) => { const c = el("button", { class: "card" + (cls ? " " + cls : "") }, ...refTitle(i), extra); c.onclick = () => show(i, c); return c; };
  const first = pane("Take next", D.next.picks.length, (p) => {
    if (!D.next.picks.length) p.append(el("p", { class: "muted", textContent: "Nothing can be taken: " + D.next.why + "." }));
    D.next.picks.slice(0, 60).forEach((x, k) => p.append(card(x.issue, el("span", { class: "why", textContent: why(x) }), k === 0 ? "first" : "")));
    if (D.next.taken.length) { p.append(el("h2", { style: "margin-top:20px;display:flex" }, "Taken by others", el("b", { textContent: n(D.next.taken.length) }))); D.next.taken.slice(0, 30).forEach((x) => p.append(card(x.issue, null))); }
  });
  pane("Groups", D.groups.length, (p) => {
    if (!D.groups.length) p.append(el("p", { class: "muted", textContent: "No Issue here links to another." }));
    const list = el("div"); p.append(list);
    const all = () => { list.replaceChildren(); D.groups.slice(0, 150).forEach((g, k) => { const c = el("button", { class: "card" }, ...refTitle(g.head), el("span", { class: "why", textContent: groupLine(g) }), meter(g)); c.onclick = () => { list.replaceChildren(el("button", { class: "btn", textContent: "All Groups", onclick: all, style: "margin-bottom:12px" }), el("p", { class: "muted", textContent: "Group " + n(k + 1) + ": " + groupLine(g) }), outline(g)); }; list.append(c); }); };
    all();
  });
  pane("Unlinked", D.unlinked.length, (p) => { const ul = paged(D.unlinked, (i) => card(i, null), 40); p.append(ul); });
  pick(first[0], first[1]);
}

// ── C · Map first ──────────────────────────────────────────
function C(root) {
  root.className = "C";
  root.append(el("header", {}, el("div", {}, el("h1", {}, projectName()), el("div", { class: "fresh", textContent: fresh() })), el("div", { class: "fresh", textContent: plural(D.open, "open Issue") + ", " + n(D.onMap) + " linked into " + plural(D.groups.length, "Group") + ", " + n(D.unlinked.length) + " unlinked" })));
  const e = emptyState(); if (e) return root.append(el("div", { style: "grid-column:1/-1" }, e));
  const main = el("div");
  const side = el("aside", { class: "queue" });
  root.append(main, side);
  let sheet = el("div");
  show = (i) => { sheet.replaceChildren(el("div", { class: "sheet" }, detail(i))); sheet.scrollIntoView({ block: "nearest", behavior: "smooth" }); };
  side.append(el("h2", {}, "Take next", el("span", { textContent: n(D.next.picks.length) })));
  if (!D.next.picks.length) side.append(el("p", { class: "muted", textContent: "Nothing can be taken: " + D.next.why + "." }));
  const ol = el("ol");
  D.next.picks.slice(0, 25).forEach((p) => ol.append(el("li", {}, el("button", { onclick: () => show(p.issue) }, ...refTitle(p.issue), el("span", { class: "why", textContent: why(p) })))));
  side.append(ol, sheet);
  const map = () => {
    main.replaceChildren();
    if (D.groups.length) {
      main.append(el("h2", {}, "Groups", el("span", { textContent: "sized by Issues, filled by the share unblocked" })));
      const t = el("div", { class: "terrain" });
      const max = D.groups[0].size;
      D.groups.slice(0, 400).forEach((g, k) => {
        const r = g.size / max, s = g.size >= 12 && r > .5 ? "s4" : g.size >= 8 ? "s3" : g.size >= 4 ? "s2" : "";
        const plot = el("button", { class: "plot " + s + (holds(g) ? " holds" : ""), title: I[g.head].ref + " " + I[g.head].title, style: "--share:" + (g.size ? (100 * g.unblocked) / g.size : 0) + "%" }, el("span", { class: "t", textContent: I[g.head].title || I[g.head].ref }), el("span", { class: "n", textContent: n(g.size) + (g.unblocked ? " · " + n(g.unblocked) + " free" : "") }));
        plot.onclick = () => { main.replaceChildren(el("button", { class: "btn", textContent: "Back to the Groups", onclick: map, style: "margin-bottom:12px" }), el("h2", {}, ...refTitle(g.head)), el("p", { class: "muted", textContent: groupLine(g) }), outline(g)); };
        t.append(plot);
      });
      main.append(t, el("div", { class: "key" }, el("span", {}, el("i", { style: "background:color-mix(in srgb, var(--go) 35%, var(--raise))" }), "unblocked share"), el("span", {}, el("i", { style: "border:2px solid var(--pick)" }), "holds an Issue to take next")));
    } else main.append(el("p", { class: "muted", textContent: "No Issue here links to another, so there are no Groups to draw." }));
    if (D.unlinked.length) main.append(el("details", { class: "lonely" }, el("summary", {}, el("b", { textContent: "Unlinked " }), el("span", { class: "muted", textContent: plural(D.unlinked.length, "Issue") + " with no link, newest first" })), paged(D.unlinked, (i) => el("button", { style: "background:none;border:0;padding:5px 0;text-align:left;cursor:pointer", onclick: () => show(i) }, ...refTitle(i)), 50)));
  };
  map();
}




// ── D · Islands ────────────────────────────────────────────
function Dmap(root) {
  root.className = "D";
  const NS = "http://www.w3.org/2000/svg";
  const sv = (tag, attrs, text) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v); if (text != null) e.textContent = text; return e; };
  const clip = (t, m) => (t.length <= m ? t : t.slice(0, m - 1) + "…");
  const top = el("div", { class: "top" });
  root.append(top);
  top.append(el("h1", {}, projectName(), " · ", plural(D.open, "open Issue")));
  const sea = el("div", { class: "sea" });
  root.append(sea);
  const e = emptyState();
  if (e) { top.append(el("div", { class: "muted", textContent: fresh() })); sea.append(el("div", { class: "note" }, e)); return; }
  // The one thing the page is for: what to start on.
  const first = D.next.picks[0];
  const card = el("div", { class: "card off" });
  sea.append(card);
  let selNode = null;
  const showCard = (i) => { card.replaceChildren(el("button", { class: "btn close", textContent: "Close", onclick: () => { card.classList.add("off"); selNode?.classList.remove("sel"); } }), detail(i)); requestAnimationFrame(() => card.classList.remove("off")); };
  show = showCard;
  const list = el("aside", { class: "list off" });
  root.append(list);
  if (first) top.append(el("button", { class: "start", onclick: () => openFor(first.issue) }, el("span", { class: "lead", textContent: "Start with " + I[first.issue].ref }), el("span", { class: "what" }, titled(I[first.issue].title)), el("span", { class: "why", textContent: why(first) })));
  else top.append(el("div", { class: "start" }, el("span", { class: "what", textContent: "Nothing to take yet" }), el("span", { class: "why", textContent: "Every Issue on the Map is " + D.next.why.replace(/^every Issue on the Map is /, "") + "." })));
  top.append(el("div", { class: "side" }, D.next.picks.length > 1 ? el("button", { class: "btn", textContent: "Take next: " + n(D.next.picks.length), onclick: () => list.classList.toggle("off") }) : null));
  list.append(el("h2", {}, "Take next", el("button", { class: "btn", textContent: "Close", onclick: () => list.classList.add("off") })));
  const ol = el("ol");
  D.next.picks.slice(0, 60).forEach((p, k) => ol.append(el("li", {}, el("button", { onclick: () => { list.classList.add("off"); openFor(p.issue); } }, el("span", { class: "pos", textContent: n(k + 1) }), el("span", {}, ...refTitle(p.issue)), el("span", { class: "why", textContent: why(p) })))));
  list.append(ol);
  if (!D.groups.length) { sea.append(el("div", { class: "note" }, el("p", { class: "muted", textContent: "No Issue here links to another, so there is no map to draw. All " + n(D.open) + " open Issues stand alone." }))); return; }

  // Islands, packed on a spiral from the largest out.
  const groups = D.groups.slice(0, 120);
  const radius = (g) => 16 + 10 * Math.sqrt(g.size + g.outside);
  const placed = [];
  for (const [k, g] of groups.entries()) {
    const r = radius(g);
    let x = 0, y = 0;
    if (placed.length) for (let t = 0; ; t += 0.12) { x = 9 * t * Math.cos(t); y = 7 * t * Math.sin(t); if (placed.every((p) => Math.hypot(p.x - x, p.y - y) > p.r + r + 14)) break; }
    placed.push({ g, k, r, x, y });
  }
  const minX = Math.min(...placed.map((p) => p.x - p.r)) - 30, maxX = Math.max(...placed.map((p) => p.x + p.r)) + 30;
  const minY = Math.min(...placed.map((p) => p.y - p.r)) - 30, maxY = Math.max(...placed.map((p) => p.y + p.r)) + 44;
  const svg = sv("svg", { role: "img", "aria-label": "Each Group of " + D.project + " as an island, sized by its Issues" });
  const world = sv("g", { class: "world" });
  svg.append(world);
  sea.append(svg);
  const peek = el("div", { class: "peek", "aria-live": "polite" });
  sea.append(peek);
  const isles = placed.map((p, idx) => {
    const g = p.g, share = g.size ? g.unblocked / g.size : 0;
    const isle = sv("g", { class: "isle", tabindex: 0, transform: "translate(" + p.x + "," + p.y + ")" });
    const inner = sv("g", { class: "grow", style: "animation-delay:" + Math.min(idx * 35, 900) + "ms" });
    inner.append(sv("circle", { class: "shore", r: p.r + 6 }), sv("circle", { class: "body", r: p.r }), sv("circle", { class: "track", r: p.r - 4, "stroke-width": 3 }));
    if (share) inner.append(sv("circle", { class: "ring", r: p.r - 4, "stroke-width": 3, pathLength: 100, "stroke-dasharray": (share * 100).toFixed(1) + " 100", transform: "rotate(-90)" }));
    if (holds(g)) inner.append(sv("circle", { class: "flag", cx: p.r * 0.72, cy: -p.r * 0.72, r: 5 }));
    inner.append(sv("text", { class: "count" }, n(g.size)));
    if (p.r >= 44) { inner.lastChild.setAttribute("y", -7); inner.append(sv("text", { class: "name", y: 12 }, clip(I[g.head].title || I[g.head].ref, Math.floor((p.r * 1.5) / 6)))); }
    const say = () => { peek.textContent = (I[g.head].title || I[g.head].ref) + " · " + groupLine(g); };
    isle.addEventListener("pointerenter", say); isle.addEventListener("focus", say);
    isle.addEventListener("pointerleave", () => { peek.textContent = ""; });
    inner.append(sv("title", {}, (I[g.head].title || I[g.head].ref) + ": " + groupLine(g)));
    isle.append(inner);
    isle.addEventListener("click", () => openGroup(p));
    isle.addEventListener("keydown", (ev) => { if (ev.key === "Enter") openGroup(p); });
    world.append(isle);
    return isle;
  });
  const hint = el("div", { class: "hint", textContent: "Each island is a Group of linked Issues. The teal ring is the share nothing blocks; a yellow dot holds something to take next. Tap one to open it." });
  sea.append(hint);
  const overview = () => {
    const r = sea.getBoundingClientRect();
    const k = Math.min(r.width / (maxX - minX), (r.height - 60) / (maxY - minY), 2.2);
    world.style.transform = "translate(" + (r.width / 2 - ((minX + maxX) / 2) * k) + "px," + ((r.height - 60) / 2 - ((minY + maxY) / 2) * k) + "px) scale(" + k + ")";
  };
  requestAnimationFrame(overview);
  addEventListener("resize", () => { if (!tree) overview(); });

  // Inside a Group: its Issues as a tree, cascading in by layer.
  let tree = null;
  const openFor = (i) => { const p = placed.find((p) => p.g.head === i || p.g.top.includes(i) || p.g.below.includes(i)); if (p) openGroup(p, i); else showCard(i); };
  function openGroup(p, focusOn) {
    card.classList.add("off");
    const r = sea.getBoundingClientRect();
    const k = Math.max(r.width, r.height) / p.r;
    world.style.transform = "translate(" + (r.width / 2 - p.x * k) + "px," + (r.height / 2 - p.y * k) + "px) scale(" + k + ")";
    isles.forEach((x, j) => x.classList.toggle("away", placed[j] !== p));
    hint.hidden = true; peek.textContent = "";
    svg.classList.add("under");
    tree?.remove();
    tree = el("div", { class: "tree" });
    setTimeout(() => { sea.append(tree); drawTree(p.g, focusOn); }, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 420);
  }
  function close() {
    tree?.remove(); tree = null; card.classList.add("off");
    isles.forEach((x) => x.classList.remove("away"));
    svg.classList.remove("under");
    hint.hidden = false; overview();
  }
  function drawTree(g, focusOn) {
    const width = tree.clientWidth - 32;
    if (width < 560) return drawOutline(g, focusOn, width);
    const W = 184, H = 50, GX = 14, GY = 54;
    const per = Math.max(2, Math.floor((width + GX) / (W + GX)));
    tree.append(el("div", { class: "bar" }, el("button", { class: "btn", textContent: "All Groups", onclick: close }), el("h2", {}, titled(I[g.head].title || I[g.head].ref))), el("div", { class: "bar" }, el("span", { class: "muted", textContent: groupLine(g) + "." }), el("div", { class: "legend" }, el("span", {}, el("i", { style: "border-color:var(--stop)" }), "blocks the one below"), el("span", {}, el("i", { style: "border-color:var(--faint)" }), "parent of the one below"))));
    const beneath = new Map();
    for (let j = 0; j < g.below.length; j += 3) { const a = g.below[j]; if (!beneath.has(a)) beneath.set(a, []); beneath.get(a).push([g.below[j + 1], g.below[j + 2]]); }
    const seen = new Set(g.top), layers = [];
    let layer = g.top.slice();
    while (layer.length) { const drawn = layer.slice(0, per - (layer.length > per ? 1 : 0)); layers.push({ drawn, folded: layer.length - drawn.length }); const nx = []; for (const i of drawn) for (const [j] of beneath.get(i) || []) if (!seen.has(j)) { seen.add(j); nx.push(j); } layer = nx; }
    const cols = Math.max(...layers.map((l) => l.drawn.length + (l.folded ? 1 : 0)));
    const SW = cols * (W + GX) - GX, SH = layers.length * (H + GY) - GY + 8;
    const at = new Map();
    layers.forEach((l, d) => { const c = l.drawn.length + (l.folded ? 1 : 0); const x0 = (SW - (c * (W + GX) - GX)) / 2; l.drawn.forEach((i, j) => at.set(i, [x0 + j * (W + GX), d * (H + GY)])); l.x0 = x0; });
    const s = sv("svg", { width: SW, height: SH, viewBox: "0 0 " + SW + " " + SH });
    const edges = sv("g"), nodes = sv("g");
    s.append(edges, nodes);
    const chars = Math.floor((W - 20) / 7);
    layers.forEach((l, d) => {
      for (const i of l.drawn) {
        const [x, y] = at.get(i), it = I[i];
        const node = sv("g", { class: "node in" + (it.unblocked ? " unblocked" : "") + (it.next ? " next" : ""), tabindex: 0, style: "animation-delay:" + d * 160 + "ms" });
        const inner = sv("g", { transform: "translate(" + x + "," + y + ")" });
        inner.append(sv("rect", { width: W, height: H, rx: 9 }), sv("text", { class: "r", x: 12, y: 19 }, (it.next ? "Take next " + n(it.next) + " · " : "") + it.ref), sv("text", { class: "t", x: 12, y: 37 }, clip(it.title, chars)), sv("title", {}, it.ref + " " + it.title));
        node.append(inner);
        const pickIt = () => { selNode?.classList.remove("sel"); selNode = node; node.classList.add("sel"); showCard(i); };
        node.addEventListener("click", pickIt);
        node.addEventListener("keydown", (ev) => { if (ev.key === "Enter") pickIt(); });
        nodes.append(node);
        if (i === focusOn) setTimeout(pickIt, 500);
      }
      if (l.folded) nodes.append(sv("text", { class: "more", x: l.x0 + l.drawn.length * (W + GX) + 8, y: d * (H + GY) + H / 2 + 4 }, "+" + n(l.folded) + " more"));
    });
    for (const [a, list] of beneath) {
      if (!at.has(a)) continue;
      const [x1, y1] = at.get(a), d = Math.round(y1 / (H + GY));
      for (const [b, blocked] of list) {
        if (!at.has(b)) continue;
        const [x2, y2] = at.get(b);
        const sx = x1 + W / 2, sy = y1 + H, ex = x2 + W / 2, ey = y2, my = (sy + ey) / 2;
        const path = sv("path", { class: "edge in" + (blocked ? " blocked" : ""), d: "M" + sx + "," + sy + " C" + sx + "," + my + " " + ex + "," + my + " " + ex + "," + ey });
        edges.append(path);
        const len = Math.ceil(path.getTotalLength ? path.getTotalLength() : 200);
        path.style.setProperty("--len", len);
        path.style.animationDelay = d * 160 + 120 + "ms";
      }
    }
    tree.append(s);
  }
  function head(g) {
    tree.append(el("div", { class: "bar" }, el("button", { class: "btn", textContent: "All Groups", onclick: close })), el("h2", {}, titled(I[g.head].title || I[g.head].ref)), el("div", { class: "bar" }, el("span", { class: "muted", textContent: groupLine(g) + "." }), el("div", { class: "legend" }, el("span", {}, el("i", { style: "border-color:var(--stop)" }), "blocks the one under it"), el("span", {}, el("i", { style: "border-color:var(--faint)" }), "parent of the one under it"))));
  }
  // Phone: one column, each Issue indented under the one above it.
  function drawOutline(g, focusOn, width) {
    head(g);
    const beneath = new Map();
    for (let j = 0; j < g.below.length; j += 3) { const a = g.below[j]; if (!beneath.has(a)) beneath.set(a, []); beneath.get(a).push([g.below[j + 1], g.below[j + 2]]); }
    const rows = [], seen = new Set(), CAP = 40;
    const walk = (i, d, from, blocked) => { if (seen.has(i) || rows.length >= CAP) return; seen.add(i); rows.push({ i, d: Math.min(d, 4), from, blocked }); for (const [j, b] of beneath.get(i) || []) walk(j, d + 1, i, b); };
    for (const t of g.top) walk(t, 0, null, 0);
    const H = 50, GY = 10, IN = 18, rest = g.size - rows.length;
    const SW = width, SH = rows.length * (H + GY) + (rest > 0 ? 24 : 0);
    const s = sv("svg", { width: SW, height: SH, viewBox: "0 0 " + SW + " " + SH });
    const edges = sv("g"), nodes = sv("g");
    s.append(edges, nodes);
    const y = new Map();
    rows.forEach((r, k) => {
      const it = I[r.i], x = r.d * IN, W = SW - x, top = k * (H + GY);
      y.set(r.i, { x, top });
      const node = sv("g", { class: "node in" + (it.unblocked ? " unblocked" : "") + (it.next ? " next" : ""), tabindex: 0, style: "animation-delay:" + Math.min(k * 45, 900) + "ms" });
      const inner = sv("g", { transform: "translate(" + x + "," + top + ")" });
      inner.append(sv("rect", { width: W, height: H, rx: 9 }), sv("text", { class: "r", x: 12, y: 19 }, (it.next ? "Take next " + n(it.next) + " · " : "") + it.ref), sv("text", { class: "t", x: 12, y: 37 }, clip(it.title, Math.floor((W - 20) / 7))));
      node.append(inner);
      const pickIt = () => { selNode?.classList.remove("sel"); selNode = node; node.classList.add("sel"); showCard(r.i); };
      node.addEventListener("click", pickIt);
      node.addEventListener("keydown", (ev) => { if (ev.key === "Enter") pickIt(); });
      nodes.append(node);
      // A phone's card would cover the outline: mark the Issue, leave the card to a tap.
      if (r.i === focusOn) setTimeout(() => { selNode = node; node.classList.add("sel"); node.scrollIntoView({ block: "center", behavior: "smooth" }); }, 500);
      if (r.from != null && y.has(r.from)) {
        const p = y.get(r.from), ex = Math.max(x - 2, 0), sx = Math.max(p.x + 8, 4), ey = top + H / 2;
        const path = sv("path", { class: "edge in" + (r.blocked ? " blocked" : ""), d: "M" + sx + "," + (p.top + H) + " L" + sx + "," + (ey - 6) + " Q" + sx + "," + ey + " " + (sx + 6) + "," + ey + " L" + ex + "," + ey });
        edges.append(path);
        path.style.setProperty("--len", Math.ceil(path.getTotalLength ? path.getTotalLength() : 120));
        path.style.animationDelay = Math.min(k * 45, 900) + 100 + "ms";
      }
    });
    if (rest > 0) nodes.append(sv("text", { class: "more", x: 4, y: SH - 6 }, "+" + n(rest) + " more in this Group"));
    tree.append(s);
  }
}

function render() {
  D = SETS[SET]; I = D.issues;
  document.title = D.project + " · Issue Map (prototype " + V + ")";
  const root = document.getElementById("root");
  root.replaceChildren(); root.className = "";
  document.querySelectorAll(".drawer, dialog").forEach((x) => x.remove());
  ({ A, B, C, D: Dmap })[V](root);
  bar();
}
function bar() {
  const b = document.getElementById("proto");
  const keys = Object.keys(VARIANTS);
  const step = (d) => { V = keys[(keys.indexOf(V) + d + keys.length) % keys.length]; sync(); };
  const sel = el("select", { onchange: () => { SET = sel.value; sync(); } }, ...Object.keys(SETS).map((k) => el("option", { value: k, textContent: k, selected: k === SET })));
  b.replaceChildren(el("button", { textContent: "←", onclick: () => step(-1) }), el("b", { textContent: "PROTOTYPE " + V + " — " + VARIANTS[V] }), el("button", { textContent: "→", onclick: () => step(1) }), sel);
}
function sync() { const u = new URLSearchParams(location.search); u.set("variant", V); u.set("data", SET); history.replaceState(null, "", "?" + u); render(); }
addEventListener("keydown", (e) => { if (!e.shiftKey || e.target.closest("input,select,textarea")) return; const keys = Object.keys(VARIANTS); if (e.key === "ArrowRight" || e.key === "ArrowLeft") { V = keys[(keys.indexOf(V) + (e.key === "ArrowRight" ? 1 : -1) + keys.length) % keys.length]; sync(); } });
render();
`;

const out = process.argv[2] ?? ".";
writeFileSync(
  join(out, "map-prototype.html"),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Issue Map prototype</title><style>${STYLE}</style></head><body><div id="root"></div><div id="proto"></div><script type="application/json" id="data">${data}</script><script>${SCRIPT}</script></body></html>`,
);
console.log(join(out, "map-prototype.html"));
