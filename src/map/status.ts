/**
 * The status line's row (#40): the Project and the first Issue of its Take
 * next. Pure, and built from the overview's own Take next and wording, so
 * the two never disagree. It's worked out whenever a Snapshot is saved and
 * kept beside it, since the status line has no time to read a large one.
 */
import type { Snapshot } from "../snapshot/snapshot.ts";
import { bandOf } from "./band.ts";
import { NO_MAP, noMapToDraw, pickLine, takeNextSaid } from "./draw.ts";
import { layout } from "./links.ts";
import { takeNext } from "./take-next.ts";
import { ROW } from "./text.ts";

export function statusRow(snapshot: Snapshot): string {
  const head = `${ROW} ${snapshot.project.path}`;
  if (bandOf(snapshot.support).kind === "refused") return `${head} · Refused: the Map can read no Link kind here`;
  const laidOut = layout(snapshot);
  const next = takeNext(snapshot, laidOut);
  if (noMapToDraw(laidOut, next)) return `${head} · ${NO_MAP}`;
  const said = takeNextSaid(next);
  const first = next.kind === "list" ? next.picks[0] : undefined;
  return first ? `${head} · ${said.head} · ${pickLine(first, snapshot)}` : `${head} · ${said.head} — ${said.why}`;
}
