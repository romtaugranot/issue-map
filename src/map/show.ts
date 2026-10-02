/**
 * Draws the Map of a Project from its Snapshot, starting the first read when
 * there is none. A read gets a few seconds to finish; after that the draw
 * shows progress and the read carries on outside the conversation. A
 * Snapshot more than two minutes old, or any when the user asks to refresh
 * the Map, is refreshed first, and drawn with its
 * age and why when it can't be; one due a full read again is drawn while
 * that read runs in the background. A Project where the Map can read no Link
 * kind is refused before a first read starts. An Issue card reads its Issue live instead,
 * so it opens even during a first read (ADR 0006).
 */
import type { SnapshotKey, SnapshotState, SnapshotStore } from "../snapshot/store.ts";
import type { CantAnswer, IssueRead, Project, Tracker } from "../tracker/tracker.ts";
import { bandOf, refusal } from "./band.ts";
import { drawCard, type Card, type CardContext } from "./card.ts";
import { draw, drawProgress, type Command, type Drawing } from "./draw.ts";
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

/** What a draw showed: a Map, a first read's progress, or no Map and why. */
export interface Shown extends Drawing {
  drew: "map" | "progress" | "nothing";
}

/** `home` names the Home Project while the Project drawn isn't it; `refresh` refreshes its Snapshot first however fresh it is. */
export async function showMap(deps: ShowDeps, tracker: Tracker, project: Project, command: Command, { home, refresh }: { home?: string; refresh?: boolean } = {}): Promise<Shown> {
  const nothing = (text: string): Shown => ({ text, drew: "nothing" });
  const map = (text: string): Shown => ({ text, drew: "map" });
  // With no Tracker to say who the viewer is, the login the CLI holds reads its own Snapshot, and no other.
  const viewer = await tracker.viewer();
  const { login } = viewer;
  if (login === undefined) return nothing(`No Map of ${project.host}/${project.path}: ${cantAnswer(tracker, viewer as CantAnswer)}`);
  const key: SnapshotKey = { tracker: tracker.host, project: project.id, login };
  if (viewer.kind === "refused") {
    await deps.store.forget(key, viewer.reason);
    return nothing(`No Map of ${project.host}/${project.path}: ${cantAnswer(tracker, viewer)}. What was kept of it is deleted.`);
  }
  if (viewer.kind === "viewer") await deps.startRefresher(key);
  const drawable = await deps.store.forDraw(key, tracker, project, refresh);
  if (drawable.kind === "refused") return nothing(`No Map of ${project.host}/${project.path}: ${drawable.reason}. What was kept of it is deleted.`);
  if (drawable.kind === "ready") {
    const { snapshot, ageMs, stale, readAgain } = drawable;
    // Minutes on a large Project, so it never holds up the draw: this Snapshot is drawn meanwhile.
    if (readAgain) deps.startRead();
    const drawing = draw(snapshot, command, { ...(stale === undefined ? {} : { stale: { ageMs, reason: stale } }), ...(home === undefined ? {} : { home }) });
    return bandOf(snapshot.support).kind === "refused" ? nothing(drawing.text) : map(drawing.text);
  }
  if (drawable.kind === "none") {
    // Minutes of reading would draw nothing on a Project that's Refused, so it's asked first; a Tracker that can't say is left to the read.
    const said = await tracker.capabilities(project);
    const band = said.kind === "capabilities" ? bandOf({ untested: tracker.untested, links: said.links }) : null;
    if (band?.kind === "refused") return nothing(refusal(`${project.host}/${project.path}`, band));
  }
  let state: SnapshotState = drawable;
  if (!(state.kind === "reading" && state.running)) deps.startRead();
  for (let waited = 0; state.kind !== "ready" && waited < WAIT_MS; waited += POLL_MS) {
    await deps.sleep(POLL_MS);
    state = await deps.store.state(key);
  }
  if (state.kind === "ready") {
    const text = draw(state.snapshot, command, home === undefined ? {} : { home }).text;
    return bandOf(state.snapshot.support).kind === "refused" ? nothing(text) : map(text);
  }
  return { text: drawProgress(project.path, progress(state, project)).text, drew: "progress" };
}

function progress(state: Exclude<SnapshotState, { kind: "ready" }>, project: Project) {
  const open = project.issues === "off" ? 0 : project.issues.open;
  if (state.kind === "none") return { read: 0, total: open, elapsedMs: 0 };
  return { read: state.read, total: state.total || open, elapsedMs: state.elapsedMs, ...(state.stopped ? { stopped: state.stopped } : {}) };
}

/**
 * The card of the Issue `typed` names: a reference inside the Project such
 * as `#12`, one from anywhere such as `owner/name#12`, or its URL. A card
 * that can't open says why and offers nothing to follow. `read` is the
 * Issue when it was just read live, so it isn't read again.
 */
export async function showCard(tracker: Tracker, project: Project, typed: string, page = 1, read?: IssueRead): Promise<ShownCard> {
  const ref = typedRef(typed);
  const answer = read ? { kind: "issue" as const, issue: read } : await tracker.issue(issueLocator(project, ref));
  if (answer.kind === "issue") return { ...drawCard(answer.issue, project.path, page, await cardContext(tracker, project, answer.issue)), opened: true };
  const card: ShownCard = { text: `No card for ${ref}: ${why(tracker, answer)}.`, choices: [], opened: false };
  // The Issue may be hidden from this login while its Project isn't, as a confidential Issue is.
  const elsewhere = /^(.+)#\d+$/.exec(ref)?.[1];
  if (elsewhere && elsewhere !== project.path) {
    card.move = { label: `Open ${elsewhere}'s Map`, description: "its overview, since this Issue couldn't be read", target: `${tracker.host}/${elsewhere}` };
  }
  return card;
}

/** An Issue's reference as the user typed it, less the `↗` the Map marks an Outside Issue with. */
export function typedRef(typed: string): string {
  return typed.trim().replace(new RegExp(`^${OUTSIDE}\\s*`), "");
}

/** What `issue` takes for what the user typed: `#12` is in the Project on screen. */
export function issueLocator(project: Project, ref: string): string {
  return ref.startsWith("#") ? `${project.path}${ref}` : ref;
}

/**
 * Who the viewer is, for an open Issue of the Project; and, where it's
 * unassigned, whether the Map may assign it to them: the Project's band,
 * and whether this login can write, both asked live.
 */
export async function cardContext(tracker: Tracker, project: Project, issue: IssueRead): Promise<CardContext> {
  if (!issue.open || issue.project !== project.path) return {};
  const viewer = await tracker.viewer();
  if (viewer.kind !== "viewer") return {};
  if (issue.assignees.length > 0) return { viewer: viewer.login };
  const said = await tracker.capabilities(project);
  if (said.kind !== "capabilities") return { viewer: viewer.login };
  return { viewer: viewer.login, writes: { product: tracker.product, band: bandOf({ untested: tracker.untested, links: said.links }), write: said.write } };
}

/** A card, and whether it opened: one that couldn't says why instead. */
export type ShownCard = Card & { opened: boolean };

function cantAnswer(tracker: Tracker, answer: CantAnswer): string {
  return `${tracker.product} ${answer.kind === "refused" ? "refused" : "can't tell"}: ${answer.reason}`;
}

/** Why a Tracker gave no answer: what it said of a thing it can't find, or why it couldn't say. */
export function why(tracker: Tracker, answer: CantAnswer | { kind: "not-found"; reason: string }): string {
  return answer.kind === "not-found" ? answer.reason : cantAnswer(tracker, answer);
}
