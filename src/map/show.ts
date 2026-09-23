/**
 * Draws the Map of a Project from its Snapshot, starting the first read when
 * there is none. A read gets a few seconds to finish; after that the draw
 * shows progress and the read carries on outside the conversation. An Issue
 * card reads its Issue live instead, so it opens even during a first read
 * (ADR 0006).
 */
import type { SnapshotKey, SnapshotState, SnapshotStore } from "../snapshot/store.ts";
import type { CantAnswer, Project, Tracker } from "../tracker/tracker.ts";
import { drawCard, type Card } from "./card.ts";
import { draw, drawProgress, type Command } from "./draw.ts";
import { OUTSIDE } from "./text.ts";

export interface ShowDeps {
  store: SnapshotStore;
  /** Starts the first read in a process of its own, which outlives this one. */
  startRead(): void;
  /** Resolves after `ms`. */
  sleep(ms: number): Promise<void>;
}

/** How long a draw waits for a read it started or found running. */
const WAIT_MS = 5000;
const POLL_MS = 250;

export async function showMap(deps: ShowDeps, tracker: Tracker, project: Project, command: Command): Promise<string> {
  const viewer = await tracker.viewer();
  if (viewer.kind !== "viewer") {
    return `No Map of ${project.host}/${project.path}: ${cantAnswer(tracker, viewer)}`;
  }
  const key: SnapshotKey = { tracker: tracker.host, project: project.id, login: viewer.login };
  let state = await deps.store.state(key);
  if (state.kind !== "ready" && !(state.kind === "reading" && state.running)) deps.startRead();
  for (let waited = 0; state.kind !== "ready" && waited < WAIT_MS; waited += POLL_MS) {
    await deps.sleep(POLL_MS);
    state = await deps.store.state(key);
  }
  if (state.kind === "ready") return draw(state.snapshot, command).text;
  return drawProgress(project.path, progress(state, project)).text;
}

function progress(state: Exclude<SnapshotState, { kind: "ready" }>, project: Project) {
  const open = project.issues === "off" ? 0 : project.issues.open;
  if (state.kind === "none") return { read: 0, total: open, elapsedMs: 0 };
  return { read: state.read, total: state.total || open, elapsedMs: state.elapsedMs, ...(state.stopped ? { stopped: state.stopped } : {}) };
}

/**
 * The card of the Issue `typed` names: a reference inside the Project such
 * as `#12`, one from anywhere such as `owner/name#12`, or its URL. A card
 * that can't open says why and offers nothing to follow.
 */
export async function showCard(tracker: Tracker, project: Project, typed: string, page = 1): Promise<Card> {
  const ref = typed.trim().replace(new RegExp(`^${OUTSIDE}\\s*`), "");
  const answer = await tracker.issue(ref.startsWith("#") ? `${project.path}${ref}` : ref);
  if (answer.kind === "issue") return drawCard(answer.issue, project.path, page);
  const why = answer.kind === "not-found" ? answer.reason : cantAnswer(tracker, answer);
  return { text: `No card for ${ref}: ${why}.`, choices: [] };
}

function cantAnswer(tracker: Tracker, answer: CantAnswer): string {
  return `${tracker.product} ${answer.kind === "refused" ? "refused" : "can't tell"}: ${answer.reason}`;
}
