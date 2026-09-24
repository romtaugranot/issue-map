/**
 * Draws the Map of a Project from its Snapshot, starting the first read when
 * there is none. A read gets a few seconds to finish; after that the draw
 * shows progress and the read carries on outside the conversation. A
 * Snapshot more than two minutes old is refreshed first, and drawn with its
 * age and why when it can't be; one due a full read again is drawn while
 * that read runs in the background. A Project where the Map can read no Link
 * kind is refused before a first read starts. An Issue card reads its Issue live instead,
 * so it opens even during a first read (ADR 0006).
 */
import type { SnapshotKey, SnapshotState, SnapshotStore } from "../snapshot/store.ts";
import type { CantAnswer, Project, Tracker } from "../tracker/tracker.ts";
import { bandOf, refusal } from "./band.ts";
import { drawCard, type Card } from "./card.ts";
import { draw, drawProgress, type Command } from "./draw.ts";
import { OUTSIDE } from "./text.ts";

export interface ShowDeps {
  store: SnapshotStore;
  /** Starts a full read in a process of its own, which outlives this one: the first, or one the Snapshot is due. */
  startRead(): void;
  /** Resolves after `ms`. */
  sleep(ms: number): Promise<void>;
  /** Starts the refresher that keeps this login's Snapshot warm, in a process of its own, unless one is running. */
  startRefresher(key: SnapshotKey): Promise<void>;
}

/** How long a draw waits for a read it started or found running. */
const WAIT_MS = 5000;
const POLL_MS = 250;

export async function showMap(deps: ShowDeps, tracker: Tracker, project: Project, command: Command): Promise<string> {
  // With no Tracker to say who the viewer is, the login the CLI holds reads its own Snapshot, and no other.
  const viewer = await tracker.viewer();
  const { login } = viewer;
  if (login === undefined) return `No Map of ${project.host}/${project.path}: ${cantAnswer(tracker, viewer as CantAnswer)}`;
  const key: SnapshotKey = { tracker: tracker.host, project: project.id, login };
  if (viewer.kind === "refused") {
    await deps.store.forget(key, viewer.reason);
    return `No Map of ${project.host}/${project.path}: ${cantAnswer(tracker, viewer)}. What was kept of it is deleted.`;
  }
  if (viewer.kind === "viewer") await deps.startRefresher(key);
  const drawable = await deps.store.forDraw(key, tracker, project);
  if (drawable.kind === "refused") return `No Map of ${project.host}/${project.path}: ${drawable.reason}. What was kept of it is deleted.`;
  if (drawable.kind === "ready") {
    const { snapshot, ageMs, stale, readAgain } = drawable;
    // Minutes on a large Project, so it never holds up the draw: this Snapshot is drawn meanwhile.
    if (readAgain) deps.startRead();
    return draw(snapshot, command, stale === undefined ? undefined : { ageMs, reason: stale }).text;
  }
  if (drawable.kind === "none") {
    // Minutes of reading would draw nothing on a Project that's Refused, so it's asked first; a Tracker that can't say is left to the read.
    const said = await tracker.capabilities(project);
    const band = said.kind === "capabilities" ? bandOf({ untested: tracker.untested, links: said.links }) : null;
    if (band?.kind === "refused") return refusal(`${project.host}/${project.path}`, band);
  }
  let state: SnapshotState = drawable;
  if (!(state.kind === "reading" && state.running)) deps.startRead();
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
