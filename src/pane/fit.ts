/**
 * Text fitted to its room in the pane's chart, which is drawn where there is
 * no canvas to measure with (the hooks module has none). Widths come from a
 * table of the widest of the system faces the desktop app draws with, Segoe
 * UI and Arial measured, then made a little wider again, for the faces not
 * measured: so a label fitted here never runs past its room, at the cost of
 * sometimes ending a little short of it. Pure, with no Node, since the hooks
 * module imports it.
 */

/** The printable ASCII characters, then a few the chart writes, in the tables' order. */
const CHARS = ` !"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_\`abcdefghijklmnopqrstuvwxyz{|}~…↗–—’“”·`;

/** Each character's advance at weight 400, in thousandths of the font size. */
const REGULAR = [
  278, 284, 392, 591, 556, 889, 800, 230, 333, 333, 417, 684, 278, 400, 278, 390, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 684, 684, 684, 556, 1015, 667, 667, 722, 722, 667,
  611, 778, 722, 278, 500, 667, 556, 898, 748, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 302, 379, 302, 684, 556, 333, 556, 588, 500, 589, 556, 313, 589, 566, 242, 242, 500, 242,
  861, 566, 586, 588, 589, 348, 500, 339, 566, 500, 723, 500, 500, 500, 334, 260, 334, 684, 1000, 732, 556, 1000, 229, 377, 377, 333,
];

/** The same at weight 600, which the chart's bold labels use. */
const BOLD = [
  278, 333, 474, 591, 556, 889, 722, 258, 333, 333, 434, 694, 278, 402, 278, 414, 556, 556, 556, 556, 576, 556, 558, 556, 556, 558, 333, 333, 694, 694, 694, 611, 975, 722, 722, 722, 722, 667, 611,
  778, 735, 292, 556, 722, 611, 924, 767, 778, 667, 778, 722, 667, 611, 722, 667, 966, 667, 667, 611, 333, 405, 333, 694, 556, 333, 556, 611, 556, 611, 556, 345, 611, 611, 278, 278, 556, 278, 889,
  611, 611, 611, 611, 389, 556, 361, 611, 556, 778, 556, 556, 500, 389, 280, 389, 694, 1000, 732, 556, 1000, 278, 500, 500, 333,
];

/** Room for the faces not measured, such as macOS's, a little wider than these. */
const MARGIN = 1.06;

const widths = (table: number[]) => new Map(Array.from(CHARS, (char, i) => [char, table[i]! / 1000]));
const REGULAR_EM = widths(REGULAR);
const BOLD_EM = widths(BOLD);

/** What a reader sees as characters, an emoji whole, where the environment can tell them; code points where it can't. */
const characters = (text: string): string[] => (typeof Intl !== "undefined" && "Segmenter" in Intl ? Array.from(new Intl.Segmenter().segment(text), (s) => s.segment) : Array.from(text));

/** One character the table doesn't hold: a Latin letter with a mark is about as wide as a capital, and the rest, such as CJK or an emoji, a full em. */
function unknown(char: string): number {
  return char.codePointAt(0)! < 0x2e80 ? 0.78 : 1;
}

/** How wide `text` is drawn, in pixels, at `size` pixels and `weight`. */
export function textWidth(text: string, size: number, weight = 400): number {
  const em = weight >= 600 ? BOLD_EM : REGULAR_EM;
  let width = 0;
  for (const char of characters(text)) width += em.get(char) ?? unknown(char);
  return width * size * MARGIN;
}

/** `text` on one line of `room` pixels, cut with `…` where it doesn't fit. */
export function fitLine(text: string, room: number, size: number, weight = 400): string {
  if (textWidth(text, size, weight) <= room) return text;
  const chars = characters(text);
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (textWidth(`${chars.slice(0, mid).join("").trimEnd()}…`, size, weight) <= room) lo = mid;
    else hi = mid - 1;
  }
  return `${chars.slice(0, lo).join("").trimEnd()}…`;
}

/** `text` wrapped at spaces onto at most `lines` lines of `room` pixels, the last cut with `…` where the rest doesn't fit. */
export function wrap(text: string, room: number, size: number, lines: number, weight = 400): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let line = "";
  for (let k = 0; k < words.length; k++) {
    const word = words[k]!;
    const longer = line ? `${line} ${word}` : word;
    if (textWidth(longer, size, weight) <= room) {
      line = longer;
      continue;
    }
    if (out.length === lines - 1) return [...out, fitLine([line, ...words.slice(k)].filter(Boolean).join(" "), room, size, weight)];
    if (line) out.push(line);
    line = word;
    if (textWidth(line, size, weight) > room) {
      if (out.length === lines - 1) return [...out, fitLine(words.slice(k).join(" "), room, size, weight)];
      out.push(fitLine(line, room, size, weight));
      line = "";
    }
  }
  if (line) out.push(line);
  return out;
}
