/**
 * The Issue Map pane's sea chart (ADR 0014), drawn as the HTML Picture draws
 * its sea (ADR 0013): each Group an island, packed into the room it has from
 * the largest out, and a Group opened as one island grown into the chart
 * with its Issues as an outline. Each drawing is one SVG document, drawn on
 * the pane's grid of cells, and comes with where its islands or Issue boxes
 * lie: the pane writes their labels over them, where the chart leaves room,
 * as Buttons that open them. Every label is fitted to its measured room.
 * Pure, with no Node, since the hooks module imports it.
 */
import type { PaneData } from "../map/pane.ts";
import { fitLine, textWidth, wrap } from "./fit.ts";
import { count, firstPick, groupSaid, holdsNext, membersOf, nameOf, outline, plain, plural, type OutlineRow } from "./screens.ts";

/** Islands drawn at most; the Groups list holds every Group. */
const ISLANDS = 24;

/**
 * A cell of the pane in CSS pixels, as the desktop app was measured to set
 * it, a pane 41 cells across by 37 down being 414 by 900 pixels; and the
 * size of the pane's text, measured the same way. A chart is drawn this many
 * pixels to a cell, then scaled to the pane's width, so a label the pane
 * writes at a cell lands where the chart left room for it.
 */
export const CELL = { w: 10, h: 24 } as const;
export const TEXT = 15;

/** The chart's colors, for light and for dark: the HTML Picture's sea. */
const STYLE = `
svg { --water: #e7f0f4; --shallow: #d7e7ee; --land: #fbfcfb; --coast: #a9c6d1; --box: #ffffff; --go: #0e8a76; --stop: #cf4f3a; --pick: #a8720a; --pick-wash: #fbf1d8; --ink: #10242f; --muted: #4c6573; --faint: #86a0ad; }
@media (prefers-color-scheme: dark) { svg { --water: #0f2536; --shallow: #14304a; --land: #16334a; --coast: #2d5470; --box: #1f1e1d; --go: #5fd0b9; --stop: #ff8a72; --pick: #f2c45c; --pick-wash: #2e2a1a; --ink: #e4edf1; --muted: #9fb3bf; --faint: #627d8e; } }
text { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; font-variant-numeric: tabular-nums; }
.grow { animation: grow .45s cubic-bezier(.2, .7, .2, 1) backwards; }
.sink { opacity: 0; animation: sink .32s ease backwards; transform-box: fill-box; transform-origin: center; }
.rise { animation: rise .36s ease backwards; transform-box: fill-box; }
.draw { stroke-dasharray: 1; animation: draw .4s ease backwards; }
.fade { animation: fade .4s ease backwards; }
@keyframes grow { from { x: var(--x0); y: var(--y0); width: var(--d0); height: var(--d0); rx: var(--r0); } }
@keyframes sink { from { opacity: 1; transform: none; } to { opacity: 0; transform: scale(.85); } }
@keyframes rise { from { opacity: 0; transform: translateY(-8px); } }
@keyframes draw { from { stroke-dashoffset: 1; opacity: 0; } 30% { opacity: 1; } }
@keyframes fade { from { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .grow, .sink, .rise, .draw, .fade { animation: none; } }
`;

const esc = (text: string) => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const px = (n: number) => Math.round(n * 10) / 10;

/** An island: Group `k`, at (`x`, `y`), `r` across from its middle. */
export interface Isle {
  k: number;
  x: number;
  y: number;
  r: number;
}

/** The largest Groups as islands packed into `w` by `h`, from the largest out, shrunk until all fit; none where they can't. */
export function packIslands(d: PaneData, w: number, h: number): Isle[] {
  const groups = d.groups.slice(0, ISLANDS);
  const big = Math.max(1, ...groups.map((g) => g.size + g.outside));
  for (let scale = 1; scale > 0.3; scale *= 0.92) {
    const radius = (size: number) => Math.max(13, scale * Math.min(w / 4, h / 3, 13 + (Math.min(w, h * 1.4) / 4.6 - 13) * Math.sqrt(size / big)));
    const cx = w / 2;
    const cy = h / 2;
    const placed: Isle[] = [];
    const fits = (x: number, y: number, r: number) => x - r >= 4 && x + r <= w - 4 && y - r >= 4 && y + r <= h - 4 && placed.every((c) => Math.hypot(c.x - x, c.y - y) >= c.r + r + 6);
    let ok = true;
    for (const [k, g] of groups.entries()) {
      const r = radius(g.size + g.outside);
      let best: { x: number; y: number; score: number } | null = placed.length === 0 && fits(cx, cy, r) ? { x: cx, y: cy, score: 0 } : null;
      for (const c of placed) {
        for (let a = 0; a < 360; a += 8) {
          const x = c.x + (c.r + r + 6) * Math.cos((a * Math.PI) / 180);
          const y = c.y + (c.r + r + 6) * Math.sin((a * Math.PI) / 180);
          if (!fits(x, y, r)) continue;
          const score = Math.hypot((x - cx) / w, (y - cy) / h);
          if (!best || score < best.score) best = { x, y, score };
        }
      }
      if (!best) {
        ok = false;
        break;
      }
      placed.push({ k, x: best.x, y: best.y, r });
    }
    if (ok) return placed;
  }
  return [];
}

/** One island, its label left to the pane. */
function islandSvg(d: PaneData, c: Isle, { sink }: { sink?: boolean } = {}): string {
  const g = d.groups[c.k]!;
  const share = g.size ? g.unblocked / g.size : 0;
  const around = 2 * Math.PI * (c.r - 2);
  const first = firstPick(d);
  const starts = first !== undefined && membersOf(g).includes(first);
  const lantern = holdsNext(d, g)
    ? `<circle cx="${px(c.x + (c.r - 2) * Math.SQRT1_2)}" cy="${px(c.y - (c.r - 2) * Math.SQRT1_2)}" r="${starts ? 6 : 4.5}" fill="var(--pick)"${starts ? ' stroke="var(--pick-wash)" stroke-width="3" paint-order="stroke"' : ""}/>`
    : "";
  return `<g${sink ? ' class="sink"' : ""}><circle cx="${px(c.x)}" cy="${px(c.y)}" r="${px(c.r + 4)}" fill="var(--shallow)"/><circle cx="${px(c.x)}" cy="${px(c.y)}" r="${px(c.r)}" fill="var(--land)" stroke="var(--coast)" stroke-dasharray="2 3"/><circle cx="${px(c.x)}" cy="${px(c.y)}" r="${px(c.r - 2)}" fill="none" stroke="var(--go)" stroke-width="3" stroke-dasharray="${px(share * around)} ${px(around)}" transform="rotate(-90 ${px(c.x)} ${px(c.y)})"/>${lantern}</g>`;
}

/** What the pane writes on island `c`: its number, and its size where the island holds it. */
export function isleLabel(d: PaneData, c: Isle): { n: string; size: string } {
  const size = plural(d.groups[c.k]!.size, "Issue");
  return { n: count(c.k + 1), size: textWidth(size, TEXT, 600) <= 2 * c.r - 10 ? size : "" };
}

/** Group `k`'s name card, `w` across and whole rows tall, the card at its foot: what the pane shows over the chart's foot while the pointer is on the island. */
export function isleCaption(d: PaneData, k: number, w: number): { source: string; rows: number } {
  const g = d.groups[k]!;
  const name = wrap(nameOf(d, g.head), w - 28, 13, 2, 600);
  const tall = 18 + name.length * 17 + 16;
  const rows = Math.ceil((tall + 6) / CELL.h);
  const h = rows * CELL.h;
  const top = h - tall - 6;
  const label = `${plain(nameOf(d, g.head))}: ${groupSaid(g)}`;
  return {
    source: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${px(w)} ${h}" width="${px(w)}" height="${h}" role="img" aria-label="${esc(label)}"><style>${STYLE}</style><rect x="6" y="${px(top)}" width="${px(w - 12)}" height="${px(tall)}" rx="8" fill="var(--box)" stroke="var(--coast)"/>${name
      .map((line, j) => `<text x="16" y="${px(top + 20 + j * 17)}" font-size="13" font-weight="600" fill="var(--ink)">${esc(line)}</text>`)
      .join("")}<text x="16" y="${px(top + 20 + name.length * 17)}" font-size="12" fill="var(--muted)">${esc(fitLine(groupSaid(g), w - 32, 12))}</text></svg>`,
    rows,
  };
}

const svg = (w: number, h: number, label: string, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${px(w)} ${px(h)}" width="${px(w)}" height="${px(h)}" role="img" aria-label="${esc(label)}"><style>${STYLE}</style><rect width="${px(w)}" height="${px(h)}" rx="10" fill="var(--water)"/>${body}</svg>`;

/** The Map screen's share bar, `w` across: to take next, waiting and Unlinked, each as long as its share, in the chart's colors. */
export function shareBar([next, waiting, unlinked]: readonly [number, number, number], w: number): string {
  const tall = 7;
  const gap = 2;
  const parts = [
    { n: next, fill: "var(--pick)" },
    { n: waiting, fill: "var(--stop)" },
    { n: unlinked, fill: "var(--faint)" },
  ].filter((p) => p.n > 0);
  const total = parts.reduce((sum, p) => sum + p.n, 0);
  const room = w - gap * Math.max(0, parts.length - 1);
  let x = 0;
  const bars = parts
    .map((p) => {
      const long = (room * p.n) / total;
      const bar = `<rect x="${px(x)}" width="${px(long)}" height="${tall}" fill="${p.fill}"/>`;
      x += long + gap;
      return bar;
    })
    .join("");
  const label = `${count(next)} to take next, ${count(waiting)} waiting, ${count(unlinked)} Unlinked`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${px(w)} ${tall}" width="${px(w)}" height="${tall}" role="img" aria-label="${esc(label)}"><style>${STYLE}</style><clipPath id="round"><rect width="${px(w)}" height="${tall}" rx="${tall / 2}"/></clipPath><g clip-path="url(#round)">${bars}</g></svg>`;
}

/** The Map screen's chart: every island drawn in `w` by `h`. */
export function seaChart(d: PaneData, w: number, h: number): { source: string; isles: Isle[] } {
  const isles = packIslands(d, w, h);
  const label = `${plural(d.groups.length, "Group")} as islands, largest first`;
  return { source: svg(w, h, label, isles.map((c) => islandSvg(d, c)).join("")), isles };
}

/** An Issue box of an opened island, in whole cells: a row for its reference, its title on `lines`, and a row for the frame the pane draws round them. */
export interface Box extends OutlineRow {
  x: number;
  y: number;
  w: number;
  h: number;
  lines: string[];
  /** Its row in the whole outline. */
  row: number;
}

/** In cells: the room above the boxes, the boxes' margin, how far in each step of the outline goes, and the row a box's frame takes beside its words. */
const HEAD = 1;
const PAD = 1;
const INDENT = 2;
const FRAME = 1;
/** In pixels: the room kept below the boxes; and how far down a box its first row of words lies, its frame above them, as the desktop app was measured to draw it. */
const FOOT = 12;
const INSIDE = 9;

/** The boxes of outline rows from `first` that fit `h`: titles on two lines where that fits as many, on one where that fits more. */
function boxesFrom(d: PaneData, rows: OutlineRow[], w: number, h: number, first: number): Box[] {
  const across = Math.floor((w - FOOT) / CELL.w);
  const down = Math.floor((h - FOOT) / CELL.h);
  const fit = (lines: number) => {
    const out: Box[] = [];
    let y = HEAD;
    for (let row = first; row < rows.length; row++) {
      const r = rows[row]!;
      const x = PAD + r.depth * INDENT;
      const bw = across - x;
      // Room to spare for the frame, its padding and the Buttons' own; a Button's label is drawn semi-bold.
      const title = wrap(nameOf(d, r.i) || "an Issue this login can't read", (bw - 4) * CELL.w, TEXT, lines, 600);
      const bh = 1 + title.length + FRAME;
      if (y + bh > down && out.length > 0) break;
      out.push({ ...r, x: x * CELL.w, y: y * CELL.h, w: bw * CELL.w, h: bh * CELL.h, lines: title, row });
      y += bh;
    }
    return out;
  };
  const two = fit(2);
  const one = fit(1);
  return one.length > two.length ? one : two;
}

/** The page of Group `k`'s outline to show in `w` by `h`: from row `from`, moved back so Issue `mark` is on it where it wouldn't be. */
export function islandPage(d: PaneData, k: number, w: number, h: number, { from = 0, mark }: { from?: number; mark?: number }): { first: number; boxes: Box[]; rows: number } {
  const rows = outline(d.groups[k]!);
  let first = Math.min(Math.max(0, from), Math.max(0, rows.length - 1));
  const at = mark === undefined ? -1 : rows.findIndex((r) => r.i === mark);
  if (at >= 0 && !(at >= first && at < first + boxesFrom(d, rows, w, h, first).length)) first = Math.max(0, at - 1);
  return { first, boxes: boxesFrom(d, rows, w, h, first), rows: rows.length };
}

/** Where a page of the outline before `first` starts, so Earlier shows the rows just before it. */
export function earlier(d: PaneData, k: number, w: number, h: number, first: number): number {
  const rows = outline(d.groups[k]!);
  let start = first;
  while (start > 0 && boxesFrom(d, rows, w, h, start - 1).length >= first - start + 1) start--;
  return start;
}

/**
 * Group `k` opened: one island as tall as what it holds, its Issues as an
 * outline with a line running down the left into each from the one above
 * it, a red arrow for Blocks and a dotted line for Parent, so no line
 * crosses a box. The boxes are the pane's, drawn round their words, so the
 * words always fit them. `grow`, just opened from the Map, grows it from its
 * island while the others sink.
 */
export function islandChart(d: PaneData, k: number, w: number, h: number, page: { first: number; boxes: Box[]; rows: number }, { grow }: { grow?: boolean } = {}): string {
  const g = d.groups[k]!;
  const { boxes } = page;
  const at = new Map(boxes.map((b) => [b.i, b]));
  const isles = grow ? packIslands(d, w, h) : [];
  const from = isles.find((c) => c.k === k);
  const animate = !!from;
  let body = isles.filter((c) => c.k !== k).map((c) => islandSvg(d, c, { sink: true })).join("");
  const last = boxes[boxes.length - 1];
  const top = (HEAD * CELL.h) / 2;
  const tall = Math.min(h - 2 - top, (last ? last.y + last.h : 40) - top + FOOT - 6);
  const start = from ? ` class="grow" style="--x0:${px(from.x - from.r)}px;--y0:${px(from.y - from.r)}px;--d0:${px(2 * from.r)}px;--r0:${px(from.r)}px"` : "";
  body += `<rect${start} x="2" y="${top}" width="${px(w - 4)}" height="${px(tall)}" rx="14" fill="var(--land)" stroke="var(--ink)" stroke-width="1.5"/>`;
  body += `<defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M1 1L9 5L1 9" fill="none" stroke="var(--stop)" stroke-width="1.6"/></marker></defs>`;
  for (const b of boxes) {
    const above = b.from === null ? undefined : at.get(b.from);
    if (!above) continue;
    const sx = above.x + 10;
    const ey = b.y + INSIDE + CELL.h / 2;
    // A Blocks line draws itself in; a Parent's dots fade in, since drawing in would take their dashes.
    const motion = animate ? ` class="${b.blocks ? "draw" : "fade"}" style="animation-delay:${480 + Math.min(b.row * 45, 900)}ms"` : "";
    body += `<path${motion} d="M${px(sx)} ${px(above.y + above.h - 4)} L${px(sx)} ${px(ey - 6)} Q${px(sx)} ${px(ey)} ${px(sx + 6)} ${px(ey)} L${px(b.x - 1)} ${px(ey)}" fill="none" stroke="${b.blocks ? "var(--stop)" : "var(--faint)"}" stroke-width="1.6"${
      b.blocks ? ' pathLength="1" marker-end="url(#arrow)"' : ' stroke-dasharray="2 3"'
    }/>`;
  }
  return svg(w, h, `${plain(nameOf(d, g.head))}: ${groupSaid(g)}`, body);
}
