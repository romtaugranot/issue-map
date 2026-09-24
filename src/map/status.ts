/**
 * The status line's row (#40): the Project and the first Issue of its Take
 * next. Pure, and built from the overview's own Take next and wording, so
 * the two never disagree. It's worked out whenever a Snapshot is saved and
 * kept beside it, since the status line has no time to read a large one.
 */
import type { Snapshot } from "../snapshot/snapshot.ts";
import { bandOf } from "./band.ts";
import { pickLine } from "./draw.ts";
import { layout } from "./links.ts";
import { takeNext } from "./take-next.ts";
import { count, plural, ROW } from "./text.ts";

export function statusRow(snapshot: Snapshot): string {
  const head = `${ROW} ${snapshot.project.path}`;
  if (bandOf(snapshot.support).kind === "refused") return `${head} · Refused: the Map can read no Link kind here`;
  const laidOut = layout(snapshot);
  const next = takeNext(snapshot, laidOut);
  if (laidOut.onMap.length === 0 && (next.kind === "blocks-unread" || (next.picks.length === 0 && next.takenByOthers === 0))) {
    return `${head} · No Issue here has a Link, so there's no Map to draw`;
  }
  if (next.kind === "blocks-unread") return `${head} · Take next: none — the Map can't read this Project's Blocks Links`;
  const { picks, takenByOthers } = next;
  const first = picks[0];
  if (first) return `${head} · Take next: ${count(picks.length)} · ${pickLine(first, snapshot)}`;
  if (takenByOthers > 0) return `${head} · Take next: 0 — all ${plural(takenByOthers, "Unblocked Issue")} ${takenByOthers === 1 ? "is" : "are"} taken by others`;
  return `${head} · Take next: 0 — every Issue on the Map is Blocked, or a Parent of Blocked Issues`;
}
