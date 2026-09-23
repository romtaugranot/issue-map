/** How the drawing module writes names and numbers, the same on every screen. */

/** Titles are trimmed to a fixed length, since the client does the wrapping. */
const TITLE = 60;
/** Marks an Outside Issue. */
export const OUTSIDE = "↗";

export function trim(title: string): string {
  return title.length <= TITLE ? title : `${title.slice(0, TITLE - 1)}…`;
}

export function count(n: number): string {
  return n.toLocaleString("en-US");
}

export function plural(n: number, noun: string): string {
  return `${count(n)} ${noun}${n === 1 ? "" : "s"}`;
}
