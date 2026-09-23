/**
 * Draws the Map of a Project from its Snapshot, starting the first read when
 * there is none. A read gets a few seconds to finish; after that the draw
 * shows progress and the read carries on outside the conversation.
 */
import type { SnapshotKey, SnapshotState, SnapshotStore } from "../snapshot/store.ts";
import type { Project, Tracker } from "../tracker/tracker.ts";
import { draw, drawProgress, type Command } from "./draw.ts";

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
    return `No Map of ${project.host}/${project.path}: ${tracker.product} ${viewer.kind === "refused" ? "refused" : "can't tell"}: ${viewer.reason}`;
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
