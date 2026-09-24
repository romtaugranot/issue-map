/** Small hand-written Snapshots, for the edges the recorded ones don't cover. */
import { SNAPSHOT_FORMAT, type Snapshot } from "../../src/snapshot/snapshot.ts";
import type { FarEnd, Link, OpenIssue, Support, Unread } from "../../src/tracker/tracker.ts";
import { READS_EVERYTHING } from "./fake-trackers.ts";

export const PROJECT = "fixture-org/tools";
/** The login that read every built Snapshot, so the viewer of every drawing. */
export const VIEWER = "fixture-viewer";
/** When every built Snapshot was read. */
export const READ_AT = "2026-09-23T00:00:00Z";
/** When a closed Issue closed, unless it says otherwise: two days before the read. */
const CLOSED_AT = "2026-09-21T00:00:00Z";

export interface IssueSpec {
  n: number;
  title?: string;
  /** Defaults to day `n` of 2026, so a higher number is newer. */
  createdAt?: string;
  assignees?: string[];
  /** The Planned date, as an ISO date. */
  planned?: string;
  taskLevel?: boolean;
  /** The authors of its open Closing Requests, one each. */
  closingRequests?: string[];
}

/** An Issue outside the Project, a closed one, or one this login can't read. */
export type Elsewhere =
  | { outside: string; title?: string; open?: boolean }
  /** Closed two days before the Snapshot was read, and as completed, unless it says otherwise. */
  | { closed: number; closedAt?: string; closedAs?: string }
  | { hidden: string };

export type End = number | Elsewhere;

/** `[a, "blocks", b]` reads "a Blocks b"; `[a, "parent", b]` reads "a is the Parent of b". */
export type LinkSpec = [End, "blocks" | "parent" | "related", End];

/** `support` is what the last full read found of the Tracker and Project; by default, tested there with everything read. */
export function snapshot(issues: IssueSpec[], links: LinkSpec[] = [], unread: Unread = {}, support: Partial<Support> = {}): Snapshot {
  const built = new Map<number, OpenIssue>(issues.map((spec) => [spec.n, issue(spec)]));
  const record = (at: End, role: Link["role"], far: End) => {
    if (typeof at !== "number") return; // The Map never reads an Issue outside its Project.
    built.get(at)!.links.push({ role, to: farEnd(far) });
  };
  for (const [a, kind, b] of links) {
    const [towardA, towardB]: [Link["role"], Link["role"]] =
      kind === "blocks" ? ["blocker", "blocked"] : kind === "parent" ? ["parent", "child"] : ["related", "related"];
    record(b, towardA, a);
    record(a, towardB, b);
  }
  return {
    format: SNAPSHOT_FORMAT,
    tracker: "github.com",
    project: { id: "github.com#1", path: PROJECT, url: `https://github.com/${PROJECT}` },
    login: VIEWER,
    readAt: READ_AT,
    fullReadAt: READ_AT,
    changesSince: READ_AT,
    caughtUp: true,
    issues: [...built.values()],
    unread,
    support: { untested: null, links: READS_EVERYTHING.links, ...support },
  };
}

function issue({ n, title, createdAt, assignees, planned, taskLevel, closingRequests }: IssueSpec): OpenIssue {
  return {
    id: `${PROJECT}#${n}`,
    ref: `#${n}`,
    title: title ?? `Issue ${n}`,
    url: `https://github.com/${PROJECT}/issues/${n}`,
    createdAt: createdAt ?? new Date(Date.UTC(2026, 0, n)).toISOString(),
    assignees: assignees ?? [],
    planned: planned ?? null,
    taskLevel: taskLevel ?? false,
    links: [],
    closingRequests: (closingRequests ?? []).map((author, i) => ({
      ref: `${PROJECT}#${900 + n * 10 + i}`,
      url: `https://github.com/${PROJECT}/pull/${900 + n * 10 + i}`,
      draft: false,
      author,
    })),
  };
}

function farEnd(end: End): FarEnd {
  if (typeof end === "number") {
    return { id: `${PROJECT}#${end}`, readable: true, open: true, project: PROJECT, ref: `${PROJECT}#${end}`, title: `Issue ${end}`, url: `https://github.com/${PROJECT}/issues/${end}` };
  }
  if ("hidden" in end) return { id: end.hidden, readable: false };
  if ("closed" in end) {
    const { closed, closedAt, closedAs } = end;
    return {
      id: `${PROJECT}#${closed}`,
      readable: true,
      open: false,
      project: PROJECT,
      ref: `${PROJECT}#${closed}`,
      title: `Issue ${closed}`,
      url: `https://github.com/${PROJECT}/issues/${closed}`,
      closedAt: closedAt ?? CLOSED_AT,
      closedAs: closedAs ?? "completed",
    };
  }
  const [project, number] = end.outside.split("#") as [string, string];
  return { id: end.outside, readable: true, open: end.open ?? true, project, ref: end.outside, title: end.title ?? `Outside ${end.outside}`, url: `https://github.com/${project}/issues/${number}` };
}
