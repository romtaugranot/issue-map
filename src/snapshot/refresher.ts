/**
 * The refresher (ADR 0006): a process of its own that keeps one Snapshot
 * warm, so the Map of the Home Project is usually drawn without waiting on
 * a refresh, whether or not anyone is drawing it.
 */
import type { SnapshotKey, SnapshotStore } from "./store.ts";
import type { Tracker } from "../tracker/tracker.ts";

export interface RefresherDeps {
  store: SnapshotStore;
  /** Starts a full read in a process of its own, as a draw does: the first, or one the Snapshot is due. */
  startRead(): void;
  /** Resolves after `ms`. */
  sleep(ms: number): Promise<void>;
}

/**
 * How long the refresher waits between rounds: inside the two minutes a draw
 * lets a Snapshot age before refreshing it itself. A round costs a few
 * requests, a few percent of GitHub's hourly allowance.
 */
const ROUND_MS = 90_000;

/** How long it keeps a Snapshot warm with nobody drawing the Map or glancing at it for the status line. */
const UNLOOKED_MS = 86_400_000;

/**
 * Keeps `key`'s Snapshot of the Project at `path` warm, round after round,
 * and starts a full read whenever one is due. Stops once the Tracker refuses
 * the login, deleting the Snapshot, once the CLI holds another login or the
 * path leads to another Project, or once nobody has looked at the Map for a
 * day; resolves with why it stopped.
 */
export async function keepWarm(deps: RefresherDeps, tracker: Tracker, path: string, key: SnapshotKey): Promise<string> {
  const claim = await deps.store.claimRefresher(key);
  if (!claim) return "another refresher keeps it warm";
  try {
    return await rounds(deps, tracker, path, key, claim);
  } finally {
    await claim.release();
  }
}

/** Refreshes the Snapshot and starts what full reads are due, a round at a time, until it has to stop; says why. */
async function rounds(deps: RefresherDeps, tracker: Tracker, path: string, key: SnapshotKey, claim: { renew(): Promise<void> }): Promise<string> {
  for (;;) {
    await claim.renew();
    // Nobody is looking: stop polling the Tracker until the next draw starts it again.
    if ((await deps.store.unlookedMs(key)) >= UNLOOKED_MS) return "nobody has drawn the Map or looked at its status line for a day";
    // Offline or rate-limited, a round does nothing, and the next tries again.
    const viewer = await tracker.viewer();
    // Another login's Snapshot is its own: a draw by that login starts its refresher.
    if (viewer.login !== undefined && viewer.login !== key.login) return `${tracker.host} now logs in as ${viewer.login}`;
    if (viewer.kind === "refused") {
      // With no login held at all there's no login to refuse, as when drawing: the Snapshot is kept.
      return viewer.login === undefined ? viewer.reason : (await deps.store.forget(key, viewer.reason)).reason;
    }
    const resolved = await tracker.resolveProject(path);
    if (resolved.kind === "refused" || resolved.kind === "not-found") return (await deps.store.forget(key, resolved.reason)).reason;
    if (resolved.kind === "project" && viewer.kind === "viewer") {
      if (resolved.project.id !== key.project) return `${tracker.host}/${path} is now another Project`;
      let state = await deps.store.state(key);
      if (state.kind === "ready" && state.ageMs >= ROUND_MS / 2) {
        const refreshed = await deps.store.refresh(key, tracker, resolved.project);
        if (refreshed.kind === "refused") return refreshed.reason;
        state = await deps.store.state(key);
      }
      // A full read takes minutes on a large Project, so it runs beside the rounds, which keep refreshing the Snapshot it replaces.
      if (state.kind === "ready" ? state.readAgain : !(state.kind === "reading" && state.running)) deps.startRead();
    }
    await deps.sleep(ROUND_MS);
  }
}
