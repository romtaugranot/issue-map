/**
 * The Tracker seam (ADR 0007). Everything above it speaks only the
 * glossary's terms; only the adapters behind it know GitHub from GitLab.
 * This file holds needs 1, 2, 3, 4, 6 and 7 so far.
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
  /** Need 6: who this login is. */
  viewer(): Promise<ViewerAnswer>;
  /**
   * Needs 3, 4 and 7: one page of a Project's open Issues with their Links and
   * open Closing Requests, oldest first. `after` is the previous page's `next`,
   * or `null` for the first page.
   */
  openIssues(project: Project, after: string | null): Promise<IssuePage>;
}

/** What a Tracker says when it can't answer. */
export type CantAnswer =
  /** No login, or a login the Tracker doesn't accept for this. */
  | { kind: "refused"; reason: string }
  /** Nothing could be learned, for example because the Tracker couldn't be reached. */
  | { kind: "cant-tell"; reason: string };

export type ViewerAnswer = { kind: "viewer"; login: string } | CantAnswer;

export type IssuePage =
  | {
      kind: "page";
      issues: OpenIssue[];
      /** How many open Issues the Project holds, as the Tracker counts them now. */
      total: number;
      /** Where the next page starts, or `null` after the last. */
      next: string | null;
      /** What the page couldn't hold. */
      unread: Unread;
    }
  | { kind: "not-found"; reason: string }
  | CantAnswer;

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

/**
 * What a read of a Project couldn't give, each with why. The Map says so
 * rather than read the gap as "none".
 */
export interface Unread {
  /** Blocks Links (need 4); without them no Issue is Unblocked. */
  blocks?: string;
  /** Closing Requests or their authors (need 7); without them no Issue is left out of Take next as taken. */
  closingRequests?: string;
}

/** Needs 3, 4 and 7: one open Issue of a Project, with its Links and open Closing Requests. */
export interface OpenIssue {
  /** Stable, and the same wherever a Link names this Issue. */
  id: string;
  /** The reference users type inside the Project, such as `#123`. */
  ref: string;
  title: string;
  url: string;
  /** ISO date. */
  createdAt: string;
  /** Logins. */
  assignees: string[];
  /** The Planned date as an ISO date, or `null`. */
  planned: string | null;
  /** Whether the Tracker puts it at its smallest level, under an ordinary Issue. */
  taskLevel: boolean;
  links: Link[];
  /** Its open Closing Requests, drafts included; empty when the page couldn't read them. */
  closingRequests: ClosingRequest[];
}

/** Need 7: an open pull or merge request that closes an Issue when merged. */
export interface ClosingRequest {
  /** The reference users type from anywhere, such as `owner/name#812`. */
  ref: string;
  url: string;
  draft: boolean;
  /** The login that opened it. */
  author: string;
}

/** One Link, read from one of its ends. `role` is what the far end is to this Issue. */
export interface Link {
  role: "blocker" | "blocked" | "parent" | "child" | "related";
  to: FarEnd;
}

/** The far end of a Link, which may be in another Project, closed, or hidden from this login. */
export type FarEnd =
  | {
      id: string;
      readable: true;
      open: boolean;
      /** The path of the Project it is in. */
      project: string;
      /** The reference users type from anywhere, such as `owner/name#123` or `group&12`. */
      ref: string;
      title: string;
      url: string;
    }
  /** The Tracker records the Link but won't show this login the Issue; the id is the adapter's own. */
  | { id: string; readable: false };

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
