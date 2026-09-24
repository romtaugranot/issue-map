/**
 * The Snapshot store (ADR 0006): what's kept between draws, one Snapshot per
 * Tracker, Project and login. A first read saves itself a page at a time, so
 * an interrupted read resumes, but only a finished read is ever handed over
 * as a Snapshot: until then the store hands over progress. A draw is
 * handed a Snapshot refreshed first when it's more than two minutes old.
 * A Snapshot is read in full again when a refresh couldn't prove it caught
 * up, and otherwise weekly; that read runs beside refreshes of the Snapshot
 * it replaces, which is drawn meanwhile. One refresher at a time may claim a
 * Snapshot to keep it warm.
 */
import { link, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { ChangesAnswer, FarEnd, Link, OpenIssue, Project, Support, Tracker, Unread } from "../tracker/tracker.ts";
import { SNAPSHOT_FORMAT, type Snapshot } from "./snapshot.ts";

export interface SnapshotKey {
  /** The Tracker's host. */
  tracker: string;
  /** The Project's stable identity. */
  project: string;
  login: string;
}

export interface Clock {
  /** Milliseconds since the epoch. */
  now(): number;
}

export type SnapshotState =
  | { kind: "none" }
  | {
      kind: "reading";
      /** Open Issues read so far, of `total`. */
      read: number;
      total: number;
      /** Time the read has spent reading so far, across interruptions. */
      elapsedMs: number;
      /** Whether a live process is reading it now. */
      running: boolean;
      /** Why the last attempt stopped, when it stopped rather than being killed. */
      stopped?: string;
    }
  | {
      kind: "ready";
      snapshot: Snapshot;
      ageMs: number;
      /** Whether it's due a full read that isn't running: a refresh couldn't prove it caught up, or the last full read started a week ago (ADR 0006). */
      readAgain: boolean;
    };

/** The Tracker refused the login, or shows it no such Project: what the store kept of it is deleted (ADR 0006). */
export type Refused = { kind: "refused"; reason: string };

export type ReadOutcome = { kind: "done" } | { kind: "busy" } | { kind: "failed"; reason: string } | Refused;

export type RefreshOutcome =
  | { kind: "done"; caughtUp: boolean }
  /** Another read or refresh of it is running. */
  | { kind: "busy" }
  /** There's no finished Snapshot to refresh. */
  | { kind: "none" }
  | { kind: "failed"; reason: string }
  | Refused;

/** What a draw is handed: a Snapshot with its age and, when it couldn't be refreshed, why; or no Snapshot yet. */
export type ForDraw =
  | Exclude<SnapshotState, { kind: "ready" }>
  | {
      kind: "ready";
      snapshot: Snapshot;
      ageMs: number;
      readAgain: boolean;
      /** Why it's older than two minutes: the refresh it was due couldn't happen. */
      stale?: string;
    }
  | Refused;

export interface SnapshotStore {
  state(key: SnapshotKey): Promise<SnapshotState>;
  /** Reads the Project in full, resuming an interrupted read; leaves it to another read already running. */
  read(key: SnapshotKey, tracker: Tracker, project: Project): Promise<ReadOutcome>;
  /** Brings a finished Snapshot up to date with only what changed since it was read. */
  refresh(key: SnapshotKey, tracker: Tracker, project: Project): Promise<RefreshOutcome>;
  /** The Snapshot to draw: refreshed first when it's more than two minutes old, or, when it can't be, as it is and why. */
  forDraw(key: SnapshotKey, tracker: Tracker, project: Project): Promise<ForDraw>;
  /** Deletes what's kept for a login the Tracker refused, keeping only why. */
  forget(key: SnapshotKey, reason: string): Promise<Refused>;
  /**
   * Takes the place of the one refresher that keeps it warm, or `null` while
   * another holds it. The claim lapses unless renewed every few minutes, so a
   * pid handed on to another process after a reboot doesn't hold it forever.
   */
  claimRefresher(key: SnapshotKey): Promise<{ renew(): Promise<void>; release(): Promise<void> } | null>;
  /** Whether a live process is keeping it warm. */
  refresherRunning(key: SnapshotKey): Promise<boolean>;
}

/** How long a Snapshot is fresh; a draw refreshes one older than this first (ADR 0006). */
const FRESH_MS = 2 * 60_000;
/** How often a Snapshot is read in full again, even when every refresh caught up, so drift can't build up unseen (ADR 0006). */
const FULL_READ_EVERY_MS = 7 * 86_400_000;
/** How far before its last read a refresh reads changes from, since this machine's clock and the Tracker's can disagree. */
const MARGIN_MS = 60_000;
/** How long a refresher's claim lasts unrenewed; it renews it every round. */
const CLAIM_LAPSES_MS = 10 * 60_000;
/** How often a full read that's done looks again for a refresh to finish before putting its Snapshot in place. */
const LOCK_POLL_MS = 50;

/** A first read part-way through. Its pages are kept one file each, so saving one doesn't rewrite the rest. */
interface Progress {
  format: typeof SNAPSHOT_FORMAT;
  pages: number;
  /** Issues in the saved pages. */
  read: number;
  /** Where the next page starts; `null` before the first page. */
  after: string | null;
  total: number;
  /** When the first attempt started, in milliseconds since the epoch. */
  startedAt: number;
  spentMs: number;
  /** What the saved pages couldn't hold. */
  unread: Unread;
  /** What the Tracker said, before the first page, of its version and of the Project's Link kinds. */
  support?: Support;
  stopped?: string;
  /** The attempt reading now; once it isn't this one's, what it read was deleted under it. */
  attempt?: string;
}

export function snapshotStore(dir: string, clock: Clock): SnapshotStore {
  const paths = (key: SnapshotKey) => {
    const base = join(dir, "snapshots", safe(key.tracker), safe(key.project), safe(key.login));
    const reading = `${base}.reading`;
    return {
      dir: join(dir, "snapshots", safe(key.tracker), safe(key.project)),
      snapshot: `${base}.json`,
      reading,
      progress: join(reading, "progress.json"),
      page: (n: number) => join(reading, `page-${n}.json`),
      /** Held by a refresh, and by a full read while it puts its Snapshot in place. */
      lock: `${base}.lock`,
      /** Held by a full read throughout, so it runs beside refreshes of the Snapshot it replaces. */
      readLock: `${reading}.lock`,
      /** Held by the refresher for as long as it runs. */
      refresherLock: `${base}.refresher.lock`,
    };
  };

  /** Whether a live refresher holds the claim at `path` and renewed it lately. */
  const renewed = async (path: string) => {
    const claim = await readJson<{ renewedAt?: number }>(path);
    return clock.now() - (claim?.renewedAt ?? 0) < CLAIM_LAPSES_MS && (await held(path));
  };

  return {
    async state(key) {
      const at = paths(key);
      const snapshot = current(await readJson<Snapshot>(at.snapshot));
      const running = await held(at.readLock);
      if (snapshot) {
        const due = !snapshot.caughtUp || clock.now() - Date.parse(snapshot.fullReadAt) >= FULL_READ_EVERY_MS;
        return { kind: "ready", snapshot, ageMs: clock.now() - Date.parse(snapshot.readAt), readAgain: due && !running };
      }
      const progress = current(await readJson<Progress>(at.progress));
      if (!progress && !running) return { kind: "none" };
      return {
        kind: "reading",
        read: progress?.read ?? 0,
        total: progress?.total ?? 0,
        elapsedMs: progress?.spentMs ?? 0,
        running,
        ...(progress?.stopped && !running ? { stopped: progress.stopped } : {}),
      };
    },

    async read(key, tracker, project) {
      const at = paths(key);
      await mkdir(at.dir, { recursive: true, mode: 0o700 });
      if (!(await lock(at.readLock))) return { kind: "busy" };
      try {
        const saved = current(await readJson<Progress>(at.progress));
        // Pages saved in another format are read again.
        if (!saved) await rm(at.reading, { recursive: true, force: true });
        await mkdir(at.reading, { recursive: true, mode: 0o700 });
        const progress: Progress = saved ?? {
          format: SNAPSHOT_FORMAT,
          pages: 0,
          read: 0,
          after: null,
          total: project.issues === "off" ? 0 : project.issues.open,
          startedAt: clock.now(),
          spentMs: 0,
          unread: {},
        };
        delete progress.stopped;
        const attempt = (progress.attempt = randomUUID());
        // A read with nothing saved yet starts now, whenever an earlier attempt did.
        if (progress.pages === 0) progress.startedAt = clock.now();
        await save(at.progress, progress);
        if (!progress.support) {
          const said = await tracker.capabilities(project);
          if (said.kind === "refused" || said.kind === "not-found") {
            const total = progress.total;
            return await locked(at.lock, () => forget(at, total, said.reason));
          }
          if (said.kind !== "capabilities") {
            progress.stopped = said.reason;
            await save(at.progress, progress);
            return { kind: "failed", reason: said.reason };
          }
          // Whether the login can write isn't drawn, so the Snapshot doesn't keep it (ADR 0006).
          progress.support = { untested: tracker.untested, links: said.links };
          await save(at.progress, progress);
        }
        const { support } = progress;
        for (;;) {
          const started = clock.now();
          const page = await tracker.openIssues(project, progress.after);
          if (page.kind === "refused" || page.kind === "not-found") {
            const total = progress.total;
            return await locked(at.lock, () => forget(at, total, page.reason));
          }
          if (page.kind !== "page") {
            progress.stopped = page.reason;
            await save(at.progress, progress);
            return { kind: "failed", reason: page.reason };
          }
          // Saved under the Snapshot's lock, so a refused login's pages are never saved after they're deleted.
          const deleted = await locked(at.lock, async () => {
            const deleted = await forgotten(at, attempt);
            if (deleted) return deleted;
            await save(at.page(progress.pages), page.issues);
            progress.pages++;
            progress.read += page.issues.length;
            progress.total = page.total;
            progress.unread = { ...page.unread, ...progress.unread };
            progress.spentMs += clock.now() - started;
            progress.after = page.next;
            await save(at.progress, progress);
            return null;
          });
          if (deleted) return deleted;
          if (page.next === null) break;
        }
        const switched = await otherLogin(tracker, key);
        if (switched) {
          await locked(at.lock, () => rm(at.reading, { recursive: true, force: true }));
          return { kind: "failed", reason: switched };
        }
        const issues: OpenIssue[] = [];
        for (let n = 0; n < progress.pages; n++) issues.push(...((await readJson<OpenIssue[]>(at.page(n))) ?? []));
        const snapshot: Snapshot = {
          format: SNAPSHOT_FORMAT,
          tracker: key.tracker,
          project: { id: project.id, path: project.path, url: project.url },
          login: key.login,
          readAt: new Date(progress.startedAt).toISOString(),
          fullReadAt: new Date(progress.startedAt).toISOString(),
          changesSince: new Date(progress.startedAt - MARGIN_MS).toISOString(),
          caughtUp: true,
          issues: unique(issues),
          unread: withBlocks(progress.unread, support),
          support,
        };
        // A refresh of the Snapshot this replaces may be running; its changes are read again from `changesSince`.
        const replaced = await locked(at.lock, async () => {
          const deleted = await forgotten(at, attempt);
          if (!deleted) await save(at.snapshot, snapshot);
          return deleted;
        });
        if (replaced) return replaced;
        await rm(at.reading, { recursive: true, force: true });
        return { kind: "done" };
      } finally {
        await rm(at.readLock, { force: true });
      }
    },

    async refresh(key, tracker, project) {
      const at = paths(key);
      if (!(await lock(at.lock))) return { kind: "busy" };
      try {
        const snapshot = current(await readJson<Snapshot>(at.snapshot));
        if (!snapshot) return { kind: "none" };
        const started = clock.now();
        const changes = await tracker.changes(project, snapshot.changesSince, outsideOf(snapshot));
        if (changes.kind === "refused" || changes.kind === "not-found") return await forget(at, 0, changes.reason);
        if (changes.kind !== "changes") return { kind: "failed", reason: changes.reason };
        const switched = await otherLogin(tracker, key);
        if (switched) return { kind: "failed", reason: switched };
        const refreshed: Snapshot = {
          ...snapshot,
          issues: applied(snapshot, changes),
          unread: { ...changes.unread, ...snapshot.unread },
          readAt: new Date(clock.now()).toISOString(),
          changesSince: new Date(started - MARGIN_MS).toISOString(),
          caughtUp: snapshot.caughtUp && changes.caughtUp,
        };
        await save(at.snapshot, refreshed);
        return { kind: "done", caughtUp: refreshed.caughtUp };
      } finally {
        await rm(at.lock, { force: true });
      }
    },

    async forDraw(key, tracker, project) {
      const state = await this.state(key);
      if (state.kind !== "ready" || state.ageMs <= FRESH_MS) return state;
      const outcome = await this.refresh(key, tracker, project);
      if (outcome.kind === "refused") return outcome;
      const after = await this.state(key);
      if (outcome.kind === "done" || after.kind !== "ready") return after;
      return { ...after, stale: outcome.kind === "failed" ? outcome.reason : "another refresh of it is running" };
    },

    async forget(key, reason) {
      const at = paths(key);
      await mkdir(at.dir, { recursive: true, mode: 0o700 });
      return locked(at.lock, () => forget(at, 0, reason));
    },

    async claimRefresher(key) {
      const at = paths(key);
      await mkdir(at.dir, { recursive: true, mode: 0o700 });
      if (!(await lock(at.refresherLock, { renewedAt: clock.now() }, renewed))) return null;
      return {
        renew: () => save(at.refresherLock, { pid: process.pid, renewedAt: clock.now() }),
        release: () => rm(at.refresherLock, { force: true }),
      };
    },

    async refresherRunning(key) {
      return renewed(paths(key).refresherLock);
    },
  };
}

/** What was left unread, and Blocks Links too where the Map can't read them: then no Issue is Unblocked. */
function withBlocks(unread: Unread, { links: { blocks } }: Support): Unread {
  return blocks.kind === "readable" || unread.blocks !== undefined ? unread : { ...unread, blocks: blocks.reason };
}

/** The Outside Issues the Snapshot's Links reach that this login could read when it last looked. */
function outsideOf({ issues, project }: Snapshot): string[] {
  const ids = issues.flatMap((issue) => issue.links.flatMap(({ to }) => (to.readable && to.project !== project.path ? [to.id] : [])));
  return [...new Set(ids)];
}

/** What a Link's far end is to this Issue, seen from the far end. */
const MIRROR: Record<Link["role"], Link["role"]> = { blocker: "blocked", blocked: "blocker", parent: "child", child: "parent", related: "related" };

/**
 * The Snapshot's open Issues with what changed applied, oldest first. A Link
 * is recorded at both its ends, but a Tracker may note a change at only one,
 * so an Issue that didn't change takes its Links to one that did from the
 * changed one's side. A Link to an Issue that closed or left is kept, with
 * the far end as it is now. An Issue that didn't change no longer holds a
 * Closing Request that changed, since one that still closes it would have
 * marked it changed.
 */
function applied(snapshot: Snapshot, { open, ends, requests }: Extract<ChangesAnswer, { kind: "changes" }>): OpenIssue[] {
  const changedOpen = new Set(open.map((issue) => issue.id));
  const endsNow = new Map(ends.map((end) => [end.id, end]));
  const changedRequests = new Set(requests);
  const kept = new Map(
    snapshot.issues
      .filter((issue) => !changedOpen.has(issue.id) && !endsNow.has(issue.id))
      .map((issue) => [
        issue.id,
        {
          ...issue,
          links: issue.links.flatMap(({ role, to }) => (changedOpen.has(to.id) ? [] : [{ role, to: endsNow.get(to.id) ?? to }])),
          closingRequests: issue.closingRequests.filter((request) => !changedRequests.has(request.ref)),
        },
      ]),
  );
  for (const issue of open) {
    const self: FarEnd = { id: issue.id, readable: true, open: true, project: snapshot.project.path, ref: `${snapshot.project.path}${issue.ref}`, title: issue.title, url: issue.url };
    for (const { role, to } of issue.links) kept.get(to.id)?.links.push({ role: MIRROR[role], to: self });
  }
  return [...kept.values(), ...open].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

type Paths = { snapshot: string; reading: string; progress: string };

/**
 * Deletes the Snapshot and every page read towards one, keeping only why,
 * with none of the Project's Issues: the next read starts over.
 */
async function forget(at: Paths, total: number, reason: string): Promise<Refused> {
  await rm(at.snapshot, { force: true });
  await rm(at.reading, { recursive: true, force: true });
  await mkdir(at.reading, { recursive: true, mode: 0o700 });
  const empty: Progress = { format: SNAPSHOT_FORMAT, pages: 0, read: 0, after: null, total, startedAt: 0, spentMs: 0, unread: {} };
  await save(at.progress, { ...empty, stopped: reason });
  return { kind: "refused", reason };
}

/**
 * Says so when the CLI now holds another login than the one it read for:
 * what it read is never saved as this login's (ADR 0006). A switch and back
 * during a full read goes unseen.
 */
async function otherLogin(tracker: Tracker, key: SnapshotKey): Promise<string | null> {
  const { login } = await tracker.viewer();
  return login !== undefined && login !== key.login ? `${tracker.host} now logs in as ${login}` : null;
}

/** Why what a full read had read was deleted under it, once the Tracker refused the login elsewhere; `null` while it's still there. */
async function forgotten(at: Paths, attempt: string): Promise<Refused | null> {
  const progress = await readJson<Progress>(at.progress);
  if (progress?.attempt === attempt) return null;
  return { kind: "refused", reason: progress?.stopped ?? "what was read of it was deleted" };
}

/** A Snapshot or read saved in another format counts as none, so it is read again. */
function current<T extends { format: number }>(saved: T | null): T | null {
  return saved?.format === SNAPSHOT_FORMAT ? saved : null;
}

/** An Issue created while the read runs can land on two pages; it is kept once. */
function unique(issues: OpenIssue[]): OpenIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => !seen.has(issue.id) && seen.add(issue.id));
}

/** Runs `work` holding the lock, waiting for whoever holds it now; only a refresh or a Snapshot being put in place holds it, and neither for long. */
async function locked<T>(path: string, work: () => Promise<T>): Promise<T> {
  while (!(await lock(path))) await sleep(LOCK_POLL_MS);
  try {
    return await work();
  } finally {
    await rm(path, { force: true });
  }
}

/**
 * Takes the lock, or says another live process holds it. A lock whose
 * process is gone is taken over, and so is one `holding` says isn't held.
 */
async function lock(path: string, stamp: object = {}, holding: (path: string) => Promise<boolean> = held): Promise<boolean> {
  // Linked into place whole, so nobody ever reads a lock without its holder; named per attempt, since one process can try twice at once.
  const mine = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(mine, JSON.stringify({ pid: process.pid, ...stamp }), { mode: 0o600 });
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await link(mine, path);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (await holding(path)) return false;
        await rm(path, { force: true });
      }
    }
    return false;
  } finally {
    await rm(mine, { force: true });
  }
}

async function held(path: string): Promise<boolean> {
  const holder = await readJson<{ pid: number }>(path);
  if (!holder) return false;
  try {
    process.kill(holder.pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process is alive but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Written whole or not at all, and readable only by this OS user. */
async function save(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
  await rename(temporary, path);
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function safe(part: string): string {
  return encodeURIComponent(part);
}
