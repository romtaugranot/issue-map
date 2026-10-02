/**
 * The band a Project is in (ADR 0003). Pure: it comes from what the Tracker
 * said of its version and of the Project, never from which Tracker it is.
 */
import type { LinkKind, Support, WriteAnswer } from "../tracker/tracker.ts";

export type Band =
  /** Tested here, and writes allowed. */
  | { kind: "promised" }
  /** Drawn from the Link kinds the Map can read, marked untested, and read-only. */
  | { kind: "best-effort"; untested: string }
  /** No Link kind the Map can read: no Map at all. */
  | { kind: "refused"; reason: string };

const LINK_KINDS: [LinkKind, string][] = [
  ["blocks", "Blocks"],
  ["parent", "Parent"],
  ["related", "Related"],
];

export function bandOf({ untested, links }: Support): Band {
  if (LINK_KINDS.every(([kind]) => links[kind].kind !== "readable")) {
    const reasons = LINK_KINDS.map(([kind]) => {
      const answer = links[kind];
      return answer.kind === "readable" ? "" : answer.reason;
    });
    // One reason for every kind, such as a version too old, is said once.
    const why = new Set(reasons).size === 1 ? [`${reasons[0]}.`] : LINK_KINDS.map(([, name], i) => `${name}: ${reasons[i]}.`);
    return { kind: "refused", reason: `Refused — the Map can read no Link kind here. ${why.join(" ")}` };
  }
  return untested === null ? { kind: "promised" } : { kind: "best-effort", untested };
}

/** The band as the Map's header states it. */
export function bandName(band: Band): string {
  return { promised: "Promised", "best-effort": "Best effort", refused: "Refused" }[band.kind];
}

/** What the Map says in place of a Refused Project's Map. */
export function refusal(where: string, band: Extract<Band, { kind: "refused" }>): string {
  return `No Map of ${where}: ${band.reason}`;
}

/**
 * What the Map can't promise here, each with why: an untested version, and
 * the Parent and Related Links it can't show. Blocks is said where Take
 * next would be. A kind a tested Tracker can't record is how that Tracker
 * works, such as GitHub's Related Links, so only Best effort names it.
 */
export function notes(support: Support): string[] {
  const band = bandOf(support);
  const untested = band.kind === "best-effort" ? [`Best effort: ${band.untested} — the Map is untested here, and read-only: it writes nothing`] : [];
  const kinds = LINK_KINDS.flatMap(([kind, name]) => {
    const answer = support.links[kind];
    if (kind === "blocks" || answer.kind === "readable") return [];
    if (answer.kind === "cant-read") return [`${name} Links can't be read here: ${answer.reason}`];
    return band.kind === "best-effort" ? [`${name} Links can't be recorded here: ${answer.reason}`] : [];
  });
  return [...untested, ...kinds];
}

/**
 * Why the Map won't write here, or `null` where it will: only on a Promised
 * Project, and not for a login the Tracker says can't. Where the Tracker
 * can't say, it writes, and stops at the first refusal (ADR 0003).
 */
export function wontWrite(band: Band, write: WriteAnswer): string | null {
  if (band.kind === "best-effort") return `Best effort: ${band.untested} — the Map writes nothing here`;
  if (band.kind === "refused") return band.reason;
  return write.kind === "cant" ? write.reason : null;
}
