/**
 * The Issue Map pane's sea chart (ADR 0014), drawn as the HTML Picture draws
 * its sea (ADR 0013): each Group an island, packed into the room it has from
 * the largest out, and a Group opened as one island grown into the chart
 * with its Issues as an outline. Each drawing is one SVG document, and comes
 * with where its islands or Issue boxes lie, since the pane hit-tests
 * presses against them. Every label is fitted to its measured room. Pure,
 * with no Node, since the hooks module imports it.
 */
import type { PaneData } from "../map/pane.ts";
import { fitLine, textWidth, wrap } from "./fit.ts";
import { count, firstPick, groupSaid, holdsNext, isOutside, membersOf, nameOf, outline, plain, plural, stateOf, type OutlineRow, type Tone } from "./screens.ts";

/** Islands drawn at most; the Groups list holds every Group. */
const ISLANDS = 24;

/** The chart's colors, for light and for dark: the HTML Picture's sea. */
const STYLE = `
svg { --water: #e7f0f4; --shallow: #d7e7ee; --land: #fbfcfb; --coast: #a9c6d1; --box: #ffffff; --go: #0e8a76; --stop: #cf4f3a; --pick: #a8720a; --pick-wash: #fbf1d8; --ink: #10242f; --muted: #4c6573; --faint: #86a0ad; }
@media (prefers-color-scheme: dark) { svg { --water: #0f2536; --shallow: #14304a; --land: #16334a; --coast: #2d5470; --box: #1f1e1d; --go: #5fd0b9; --stop: #ff8a72; --pick: #f2c45c; --pick-wash: #2e2a1a; --ink: #e4edf1; --muted: #9fb3bf; --faint: #627d8e; } }
text { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; font-variant-numeric: tabular-nums; }
.cap { opacity: 0; transition: opacity .12s; }
.isle:hover .cap { opacity: 1; }
.isle:hover .shore { stroke: var(--ink); stroke-dasharray: none; stroke-width: 1.5; }
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

const TONE: Record<Tone, string> = { pick: "var(--pick)", go: "var(--go)", stop: "var(--stop)", muted: "var(--muted)" };

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

/** One island; `cap` names it over the chart's foot while the pointer is on it, where nothing else does. */
function islandSvg(d: PaneData, c: Isle, w: number, h: number, { cap, sink }: { cap: boolean; sink?: boolean }): string {
  const g = d.groups[c.k]!;
  const share = g.size ? g.unblocked / g.size : 0;
  const around = 2 * Math.PI * (c.r - 2);
  const big = c.r > 23;
  const counted = big ? fitLine(plural(g.size, "Issue"), 2 * c.r - 14, 10) : "";
  const first = firstPick(d);
  const starts = first !== undefined && membersOf(g).includes(first);
  const lantern = holdsNext(d, g)
    ? `<circle cx="${px(c.x + (c.r - 2) * Math.SQRT1_2)}" cy="${px(c.y - (c.r - 2) * Math.SQRT1_2)}" r="${starts ? 6 : 4.5}" fill="var(--pick)"${starts ? ' stroke="var(--pick-wash)" stroke-width="3" paint-order="stroke"' : ""}/>`
    : "";
  let caption = "";
  if (cap) {
    const name = wrap(nameOf(d, g.head), w - 28, 13, 2, 600);
    const tall = 18 + name.length * 17 + 16;
    const top = h - tall - 6;
    caption = `<g class="cap"><rect x="6" y="${px(top)}" width="${px(w - 12)}" height="${px(tall)}" rx="8" fill="var(--box)" stroke="var(--coast)"/>${name
      .map((line, j) => `<text x="16" y="${px(top + 20 + j * 17)}" font-size="13" font-weight="600" fill="var(--ink)">${esc(line)}</text>`)
      .join("")}<text x="16" y="${px(top + 20 + name.length * 17)}" font-size="12" fill="var(--muted)">${esc(fitLine(groupSaid(g), w - 32, 12))}</text></g>`;
  }
  return `<g class="isle${sink ? " sink" : ""}"><circle cx="${px(c.x)}" cy="${px(c.y)}" r="${px(c.r + 4)}" fill="var(--shallow)"/><circle class="shore" cx="${px(c.x)}" cy="${px(c.y)}" r="${px(c.r)}" fill="var(--land)" stroke="var(--coast)" stroke-dasharray="2 3"/><circle cx="${px(c.x)}" cy="${px(c.y)}" r="${px(c.r - 2)}" fill="none" stroke="var(--go)" stroke-width="3" stroke-dasharray="${px(share * around)} ${px(around)}" transform="rotate(-90 ${px(c.x)} ${px(c.y)})"/>${lantern}<text x="${px(c.x)}" y="${px(c.y + (counted ? 0 : 4.5))}" text-anchor="middle" font-size="${big ? 15 : 12}" font-weight="650" fill="var(--ink)">${count(c.k + 1)}</text>${counted ? `<text x="${px(c.x)}" y="${px(c.y + 14)}" text-anchor="middle" font-size="10" fill="var(--muted)">${esc(counted)}</text>` : ""}${caption}</g>`;
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

/** The Map screen's chart: every island drawn in `w` by `h`; `caps` names an island under the pointer, where nothing laid over the chart does. */
export function seaChart(d: PaneData, w: number, h: number, { caps }: { caps: boolean }): { source: string; isles: Isle[] } {
  const isles = packIslands(d, w, h);
  const label = `${plural(d.groups.length, "Group")} as islands, largest first`;
  return { source: svg(w, h, label, isles.map((c) => islandSvg(d, c, w, h, { cap: caps })).join("")), isles };
}

/** An Issue box of an opened island, with its title on `lines`. */
export interface Box extends OutlineRow {
  x: number;
  y: number;
  w: number;
  h: number;
  lines: string[];
  /** Its row in the whole outline. */
  row: number;
}

const PAD = 12;
const HEAD = 38;
const INDENT = 16;
const GAP = 7;

/** The boxes of outline rows from `first` that fit `h`: titles on two lines where that fits as many, on one where that fits more. */
function boxesFrom(d: PaneData, rows: OutlineRow[], w: number, h: number, first: number): Box[] {
  const fit = (lines: number) => {
    const out: Box[] = [];
    let y = HEAD;
    for (let row = first; row < rows.length; row++) {
      const r = rows[row]!;
      const x = PAD + r.depth * INDENT;
      const bw = w - PAD - x;
      const title = wrap(nameOf(d, r.i) || "an Issue this login can't read", bw - 18, 12, lines);
      const bh = 24 + 15 * title.length;
      if (y + bh > h - PAD && out.length > 0) break;
      out.push({ ...r, x, y, w: bw, h: bh, lines: title, row });
      y += bh + GAP;
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

function boxSvg(d: PaneData, b: Box, { mark, rise }: { mark?: number; rise: boolean }): string {
  const issue = d.issues[b.i]!;
  const state = stateOf(d, b.i);
  const word = state ? textWidth(state.word, 11, 600) : 0;
  const delay = `style="animation-delay:${380 + Math.min(b.row * 45, 900)}ms"`;
  const marked = b.i === mark;
  return `<g${rise ? ` class="rise" ${delay}` : ""}><rect x="${px(b.x)}" y="${px(b.y)}" width="${px(b.w)}" height="${px(b.h)}" rx="7" fill="var(--box)" stroke="${marked ? "var(--ink)" : "var(--coast)"}" stroke-width="${marked ? 2.5 : 1}"${isOutside(d, b.i) ? ' stroke-dasharray="3 3"' : ""}/>${
    state ? `<circle cx="${px(b.x + 12)}" cy="${px(b.y + 11)}" r="3.5" fill="${TONE[state.tone]}"/>` : ""
  }<text x="${px(b.x + (state ? 21 : 9))}" y="${px(b.y + 15)}" font-size="11" font-weight="600" fill="var(--muted)">${esc(fitLine(issue.ref, b.w - (state ? 38 : 26) - word, 11, 600))}</text>${
    state ? `<text x="${px(b.x + b.w - 9)}" y="${px(b.y + 15)}" text-anchor="end" font-size="11" font-weight="600" fill="${TONE[state.tone]}">${esc(state.word)}</text>` : ""
  }${b.lines.map((line, j) => `<text x="${px(b.x + 9)}" y="${px(b.y + 30 + j * 15)}" font-size="12" fill="var(--ink)">${esc(line)}</text>`).join("")}</g>`;
}

/**
 * Group `k` opened: one island as tall as what it holds, its Issues as an
 * outline with a line running down the left into each from the one above
 * it, a red arrow for Blocks and a dotted line for Parent, so no line
 * crosses a box. `grow`, just opened from the Map, grows it from its island
 * while the others sink.
 */
export function islandChart(d: PaneData, k: number, w: number, h: number, page: { first: number; boxes: Box[]; rows: number }, { mark, grow }: { mark?: number; grow?: boolean } = {}): string {
  const g = d.groups[k]!;
  const { boxes } = page;
  const at = new Map(boxes.map((b) => [b.i, b]));
  const isles = grow ? packIslands(d, w, h) : [];
  const from = isles.find((c) => c.k === k);
  const animate = !!from;
  let body = isles.filter((c) => c.k !== k).map((c) => islandSvg(d, c, w, h, { cap: false, sink: true })).join("");
  const last = boxes[boxes.length - 1];
  const tall = Math.min(h - 8, (last ? last.y + last.h : 40) + 12 - 4);
  const start = from ? ` class="grow" style="--x0:${px(from.x - from.r)}px;--y0:${px(from.y - from.r)}px;--d0:${px(2 * from.r)}px;--r0:${px(from.r)}px"` : "";
  body += `<rect${start} x="4" y="4" width="${px(w - 8)}" height="${px(tall)}" rx="16" fill="var(--land)" stroke="var(--ink)" stroke-width="1.5"/>`;
  const said = groupSaid(g);
  body += `<text${animate ? ' class="rise" style="animation-delay:300ms"' : ""} x="16" y="25" font-size="12" font-weight="650" fill="var(--muted)">${esc(fitLine(said, w - 32, 12, 650))}</text>`;
  body += `<defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M1 1L9 5L1 9" fill="none" stroke="var(--stop)" stroke-width="1.6"/></marker></defs>`;
  for (const b of boxes) {
    const above = b.from === null ? undefined : at.get(b.from);
    if (!above) continue;
    const sx = above.x + 10;
    const ey = b.y + 15;
    // A Blocks line draws itself in; a Parent's dots fade in, since drawing in would take their dashes.
    const motion = animate ? ` class="${b.blocks ? "draw" : "fade"}" style="animation-delay:${480 + Math.min(b.row * 45, 900)}ms"` : "";
    body += `<path${motion} d="M${px(sx)} ${px(above.y + above.h)} L${px(sx)} ${px(ey - 6)} Q${px(sx)} ${px(ey)} ${px(sx + 6)} ${px(ey)} L${px(b.x - 1)} ${px(ey)}" fill="none" stroke="${b.blocks ? "var(--stop)" : "var(--faint)"}" stroke-width="1.6"${
      b.blocks ? ' pathLength="1" marker-end="url(#arrow)"' : ' stroke-dasharray="2 3"'
    }/>`;
  }
  body += boxes.map((b) => boxSvg(d, b, { ...(mark === undefined ? {} : { mark }), rise: animate })).join("");
  return svg(w, h, `${plain(nameOf(d, g.head))}: ${said}`, body);
}
