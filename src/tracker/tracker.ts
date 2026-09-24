/**
 * The Tracker seam (ADR 0007). Everything above it speaks only the
 * glossary's terms; only the adapters behind it know GitHub from GitLab.
 * This file holds needs 1 to 7, 9 and 11 so far, and reading only what
 * changed for needs 3, 4 and 7.
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
  /**
   * `null` where the Map is tested on this Tracker's version (ADR 0003,
   * 0004); else why it isn't, such as a release older than the oldest tested.
   */
  readonly untested: string | null;
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
  /**
   * Needs 3, 4 and 7 again, for only what changed in a Project since `since`,
   * an ISO date, so a Snapshot is refreshed without a full read (ADR 0006):
   * every Issue updated, given or stripped of a Link, or given or stripped
   * of a Closing Request since then, as far as the Tracker records it. The
   * Issues `outside` names by identity are read again too, as far ends.
   */
  changes(project: Project, since: string, outside: string[]): Promise<ChangesAnswer>;
  /**
   * Needs 3, 4 and 7 for one Issue, open or closed, read live for its card
   * (ADR 0006), with the Mentions that Link Suggestions start from (need 8).
   * `locator` is its reference from anywhere, such as `owner/name#123`, or its
   * URL on this Tracker; an Issue in any Project here can be read.
   */
  issue(locator: string): Promise<IssueAnswer>;
  /**
   * Needs 5 and 9: per Link kind, whether the Project records it and the Map
   * can read it there, and whether this login can write a Link or assign.
   * Told from what the Tracker states, such as its version, its published
   * schema or a field saying so, never from a kind's name or an error's shape.
   */
  capabilities(project: Project): Promise<CapabilitiesAnswer>;
  /**
   * Need 11: assign the Issue `locator` names, as `issue` takes it, to the
   * viewer, the login `viewer` named, keeping whoever else it's assigned
   * to. The Tracker's refusal of the write is told apart from its refusal
   * of the login.
   */
  assign(locator: string, viewer: string): Promise<AssignAnswer>;
}

export type AssignAnswer =
  /** Written: whom the Issue is assigned to now, as the Tracker says after the write. */
  | { kind: "assigned"; assignees: string[] }
  /** The Tracker refused this write, or ignored it, though it still accepts the login. */
  | { kind: "not-allowed"; reason: string }
  /** No such Issue, or none this login can read. */
  | { kind: "not-found"; reason: string }
  | CantAnswer;

export type LinkKind = "blocks" | "parent" | "related";

/** Need 5 for one Link kind in one Project. */
export type KindAnswer =
  /** Recorded here and read: where none is read, none is recorded. */
  | { kind: "readable" }
  /** The Project can't record this kind, so none exists. */
  | { kind: "cant-record"; reason: string }
  /** The Project may record it, but the Map can't read it, or can't tell. */
  | { kind: "cant-read"; reason: string };

/** Need 9: whether this login can write a Link or assign. */
export type WriteAnswer = { kind: "can" } | { kind: "cant"; reason: string } | { kind: "cant-tell"; reason: string };

/** Need 5 for every Link kind in one Project. */
export type LinkKinds = Record<LinkKind, KindAnswer>;

/**
 * What a Project's band is decided from (ADR 0003): why the Map isn't
 * tested on the Tracker's version, `null` where it is, and which Link kinds
 * it reads in the Project.
 */
export interface Support {
  untested: string | null;
  links: LinkKinds;
}

export interface Capabilities {
  links: LinkKinds;
  write: WriteAnswer;
}

export type CapabilitiesAnswer = ({ kind: "capabilities" } & Capabilities) | { kind: "not-found"; reason: string } | CantAnswer;

/** What a Tracker says when it can't answer. */
export type CantAnswer =
  /** No login, or a login the Tracker doesn't accept for this. */
  | { kind: "refused"; reason: string }
  /** Nothing could be learned, for example because the Tracker couldn't be reached. */
  | { kind: "cant-tell"; reason: string };

export type ViewerAnswer =
  | { kind: "viewer"; login: string }
  /** `login` is the login the CLI holds for the host, as it says without the Tracker; absent when it holds none. */
  | (CantAnswer & { login?: string });

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

export type ChangesAnswer =
  | {
      kind: "changes";
      /** The Project's open Issues that changed, each read whole. */
      open: OpenIssue[];
      /**
       * The Issues that changed and aren't open in the Project any more —
       * closed, moved out, or hidden from this login — and the Issues
       * `outside` named, each as a Link's far end.
       */
      ends: FarEnd[];
      /** The Closing Requests updated since, by reference: one an Issue holds that isn't among the Issues it closes now no longer closes it. */
      requests: string[];
      /** `false` when the read couldn't reach back to `since`, so a change may have been missed. */
      caughtUp: boolean;
      /** What the read couldn't give. */
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

export type IssueAnswer =
  | { kind: "issue"; issue: IssueRead }
  /** No such Issue, or none this login can read. */
  | { kind: "not-found"; reason: string }
  | CantAnswer;

/** One Issue as its card shows it, read live. */
export interface IssueRead {
  id: string;
  /** The Project it is in. */
  project: string;
  /** The reference users type from anywhere, such as `owner/name#123`. */
  ref: string;
  title: string;
  url: string;
  open: boolean;
  /** Logins. */
  assignees: string[];
  /** How it closed, as the Tracker says, such as `completed`, `not planned` or `duplicate`; `null` while open, or when the Tracker doesn't say. */
  closedAs: string | null;
  links: NamedLink[];
  /** Its open Closing Requests, drafts included; empty when they couldn't be read. */
  closingRequests: ClosingRequest[];
  /** The identities of the Issues whose text names it, as the Tracker notes them. */
  mentionedBy: string[];
  /** What the read couldn't give. */
  unread: Unread;
}

/** A Link with the Tracker's own name for its kind, as seen from this Issue, such as `Blocked by`. */
export interface NamedLink extends Link {
  name: string;
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
      /** The reference users type from anywhere, such as `owner/name#123`, or `group#12` for a GitLab epic. */
      ref: string;
      title: string;
      url: string;
      /** When it closed, as an ISO date; absent while it is open, or where the read didn't say. */
      closedAt?: string;
      /** How it closed, as the Tracker says, such as `completed`, `not planned` or `duplicate`; absent while it is open, or where the Tracker doesn't say. */
      closedAs?: string;
    }
  /** The Tracker records the Link but won't show this login the Issue; the id is the adapter's own. */
  | { id: string; readable: false };

/** The far end of a Link that this login can read. */
export type ReadableEnd = Extract<FarEnd, { readable: true }>;

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
