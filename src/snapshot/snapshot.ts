/**
 * The Snapshot (ADR 0006): one Project's open Issues and their Links, as one
 * login last read them from one Tracker. It holds only what the Map draws.
 */
import type { OpenIssue } from "../tracker/tracker.ts";

export interface Snapshot {
  /** The Tracker's host. */
  tracker: string;
  project: { id: string; path: string; url: string };
  /** The login that read it; no other login is ever shown it. */
  login: string;
  /** When the read finished, as an ISO date. */
  readAt: string;
  /** Every open Issue of the Project, oldest first. */
  issues: OpenIssue[];
}
