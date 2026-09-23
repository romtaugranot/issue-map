/**
 * The Tracker seam (ADR 0007). Everything above it speaks only the
 * glossary's terms; only the adapters behind it know GitHub from GitLab.
 * This file holds needs 1 and 2 so far.
 */

/** One kind of Tracker (GitHub, GitLab), able to say whether it runs at a host. */
export interface TrackerKind {
  readonly product: string;
  /** Need 1, without the network: a host this kind is known to run at, or `null` when that needs a probe. */
  recognise(host: string): Promise<Tracker | null>;
  /** Need 1, over the network: one anonymous probe of the host. */
  probe(host: string): Promise<Identification>;
}

export type Identification =
  | { kind: "identified"; tracker: Tracker }
  | { kind: "not-this-kind" }
  | { kind: "cant-tell"; reason: string };

/** One running Tracker at one host. */
export interface Tracker {
  readonly product: string;
  readonly host: string;
  /** The version it runs, where it has one; `null` for a Tracker that isn't versioned, such as github.com. */
  readonly version: string | null;
  /** Need 2: turn a Project's path on this Tracker into one stable Project identity. */
  resolveProject(path: string): Promise<ProjectResolution>;
}

export interface Project {
  /** Stable across renames and moves. */
  id: string;
  host: string;
  /** The Project's current path, as the Tracker states it. */
  path: string;
  url: string;
  /** `"off"` when the Project has Issues turned off. */
  issues: "off" | { open: number };
}

export type ProjectResolution =
  | { kind: "project"; project: Project; parent: Project | null }
  /** No such Project, or none this login can see. */
  | { kind: "not-found"; reason: string }
  /** The Tracker refused: no login, or a login it doesn't accept. */
  | { kind: "refused"; reason: string }
  /** Nothing could be learned, for example because the Tracker couldn't be reached. */
  | { kind: "cant-tell"; reason: string };

/** Asks every kind in turn which one runs at a host. */
export interface Trackers {
  at(host: string): Promise<Identification>;
}

export function trackers(kinds: TrackerKind[]): Trackers {
  const known = new Map<string, Promise<Identification>>();
  return {
    at(host) {
      let found = known.get(host);
      if (!found) {
        found = identify(host, kinds);
        known.set(host, found);
      }
      return found;
    },
  };
}

async function identify(host: string, kinds: TrackerKind[]): Promise<Identification> {
  for (const kind of kinds) {
    const tracker = await kind.recognise(host);
    if (tracker) return { kind: "identified", tracker };
  }
  const answers = await Promise.all(kinds.map((kind) => kind.probe(host)));
  const identified = answers.find((a) => a.kind === "identified");
  if (identified) return identified;
  const unsure = answers.find((a) => a.kind === "cant-tell");
  return unsure ?? { kind: "not-this-kind" };
}
