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

/** How an Issue closed, where that's worth saying, such as `as duplicate`; an ordinary close, or one the Tracker didn't say how, is `null`. */
export function howClosed(closedAs: string | null | undefined): string | null {
  return closedAs && closedAs !== "completed" ? `as ${closedAs}` : null;
}

/** A reference inside the Project as users type it there, such as `#12`; one outside it marked as an Outside Issue. */
export function short(ref: string, project: string): string {
  return ref.startsWith(`${project}#`) ? ref.slice(project.length) : `${OUTSIDE}${ref}`;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** How long something has lasted, such as `3 min`, `3h` or `3d`. */
export function age(ms: number): string {
  if (ms < HOUR) return `${Math.floor(ms / 60_000)} min`;
  if (ms < 2 * DAY) return `${Math.floor(ms / HOUR)}h`;
  return `${Math.floor(ms / DAY)}d`;
}

/** How long before `now` something happened, both ISO dates, such as `2d ago`; the drawing module has no clock of its own. */
export function ago(then: string, now: string): string {
  const ms = Math.max(0, Date.parse(now) - Date.parse(then));
  if (ms < HOUR) return "under 1h ago";
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h ago`;
  if (ms < 60 * DAY) return `${Math.floor(ms / DAY)}d ago`;
  if (ms < 730 * DAY) return `${Math.floor(ms / (30 * DAY))}mo ago`;
  return `${Math.floor(ms / (365 * DAY))}y ago`;
}

/** `text` at most about `max` characters long: its start and its end, with how much was left out between. */
export function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const start = Math.floor((max * 2) / 3);
  const end = max - start;
  return `${text.slice(0, start)}\n[… ${count(text.length - start - end)} characters left out …]\n${text.slice(-end)}`;
}
