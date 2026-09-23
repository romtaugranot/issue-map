/**
 * The Snapshot (ADR 0006): one Project's open Issues and their Links, as one
 * login last read them from one Tracker. It holds only what the Map draws.
 */
import type { OpenIssue, Unread } from "../tracker/tracker.ts";

/** The shape Snapshots are saved in; one saved in any other is read again. */
export const SNAPSHOT_FORMAT = 2;

export interface Snapshot {
  format: typeof SNAPSHOT_FORMAT;
  /** The Tracker's host. */
  tracker: string;
  project: { id: string; path: string; url: string };
  /** The login that read it; no other login is ever shown it. */
  login: string;
  /** When the read finished, as an ISO date. */
  readAt: string;
  /** Every open Issue of the Project, oldest first. */
  issues: OpenIssue[];
  /** What the read couldn't give for this Project. */
  unread: Unread;
}
