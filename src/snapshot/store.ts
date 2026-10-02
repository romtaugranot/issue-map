/**
 * The Snapshot store (ADR 0006): what's kept between draws, one Snapshot per
 * Tracker, Project and login. A first read saves itself a page at a time, so
 * an interrupted read resumes, but only a finished read is ever handed over
 * as a Snapshot: until then the store hands over progress. A draw is
 * handed a Snapshot refreshed first when it's more than two minutes old,
 * or whatever its age when the user asks to refresh the Map.
 * A Snapshot is read in full again when a refresh couldn't prove it caught
 * up, and otherwise weekly; that read runs beside refreshes of the Snapshot
 * it replaces, which is drawn meanwhile. One refresher at a time may claim a
 * Snapshot to keep it warm; a claim of another version is taken over. Beside
 * each Snapshot it keeps a line summing it up, for the status line, which
 * has no time to read a large Snapshot, and when it was refreshed, so a
 * refresh that finds nothing changed doesn't rewrite a large Snapshot (#75).
 * What's kept of a Project nothing has touched for a month expires, unless a
 * refresher keeps it warm.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { link, mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { KEPT_MS, writeWhole } from "../state.ts";
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
  /** `snapshot` is the Snapshot refreshed, to hand back to `state` so it isn't read again. */
  | { kind: "done"; caughtUp: boolean; snapshot: Snapshot }
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

/**
 * What the status line glances at: the line kept beside the Snapshot of the
 * login whose refresher keeps the Project warm, with the Snapshot's age; or,
 * before there is one, how far that login's first read has got.
 */
export type Glance =
  | { kind: "none" }
  | { kind: "reading"; read: number; total: number }
  | { kind: "ready"; line: string; ageMs: number };

export interface StoreOptions {
  /** The line kept beside a Snapshot whenever it's saved; without it, none is kept. */
  summarise?(snapshot: Snapshot): string;
}

/**
 * `held` in `state` and `refresh` is a Snapshot the store handed over
 * earlier: unless it's been saved again since, it isn't read again, since
 * reading a large one takes a while (#75).
 */
export interface SnapshotStore {
  state(key: SnapshotKey, held?: Snapshot): Promise<SnapshotState>;
  /** Reads the Project in full, resuming an interrupted read; leaves it to another read already running. */
  read(key: SnapshotKey, tracker: Tracker, project: Project): Promise<ReadOutcome>;
  /** Brings a finished Snapshot up to date with only what changed since it was read. */
  refresh(key: SnapshotKey, tracker: Tracker, project: Project, held?: Snapshot): Promise<RefreshOutcome>;
  /** The Snapshot to draw: refreshed first when it's more than two minutes old, or with `now` whatever its age; when it can't be, as it is and why. */
  forDraw(key: SnapshotKey, tracker: Tracker, project: Project, now?: boolean): Promise<ForDraw>;
  /**
   * Takes in a write the Map made, so the next draw shows it without waiting
   * for a refresh: the Issue `issue` names is assigned to `assignees` now.
   * The Snapshot keeps its age, and the next refresh reads the Issue again
   * from where it would have. A first read running meanwhile shows the
   * write once a refresh has read it.
   */
  assigned(key: SnapshotKey, issue: string, assignees: string[]): Promise<void>;
  /**
   * Takes in a Link the Map wrote, as `assigned` does a write: each Issue
   * `ends` names by identity that the Snapshot holds gets its end of it,
   * unless it has that end already.
   */
  linked(key: SnapshotKey, ends: { issue: string; link: Link }[]): Promise<void>;
  /** Writes the HTML Picture beside the Snapshot, replacing the last, and says where; it's deleted with the Snapshot (ADR 0010). */
  page(key: SnapshotKey, html: string): Promise<string>;
  /** Deletes what's kept for a login the Tracker refused, keeping only why. */
  forget(key: SnapshotKey, reason: string): Promise<Refused>;
  /**
   * Takes the place of the one refresher that keeps it warm, or `null` while
   * another holds it. The claim lapses unless renewed every few minutes, so a
   * stuck refresher doesn't hold it forever. `renew` says `false` once another
   * refresher has taken the claim over, and `release` leaves that one's claim.
   */
  claimRefresher(key: SnapshotKey): Promise<{ renew(): Promise<boolean>; release(): Promise<void> } | null>;
  /** Whether a live process of this version of the plugin is keeping it warm; one of another version is taken over by the next claim (#55). */
  refresherRunning(key: SnapshotKey): Promise<boolean>;
  /** Whether a newer version of the plugin saved its Snapshot, or a read towards one, in a format this one can't read: then it's left to that version (#55). */
  savedByNewer(key: SnapshotKey): Promise<boolean>;
  /** How long since anyone drew its Project's Map or glanced at it for the status line, counted from the refresher's claim when nobody has yet. */
  unlookedMs(key: SnapshotKey): Promise<number>;
  /**
   * What the status line shows of the Project `project` names by identity on
   * the Tracker at `tracker`, without reading a Snapshot or the Tracker. The
   * login is the one whose refresher keeps it warm: a refresher stops once
   * the CLI holds another login, so no other login is shown it (ADR 0006).
   */
  glance(tracker: string, project: string): Promise<Glance>;
}

/** The line kept beside a Snapshot, as it was when the Snapshot was saved. */
interface Summary {
  format: typeof SNAPSHOT_FORMAT;
  readAt: string;
  line: string;
}

/** When a Snapshot was last refreshed and where the next refresh reads from, kept beside it and saved alone when a refresh changed nothing else (#75). */
type Refreshed = Pick<Snapshot, "format" | "fullReadAt" | "readAt" | "changesSince" | "caughtUp">;

/** The plugin's version, as its manifest says, stamped on a refresher's claim with the Snapshot format. */
export const PLUGIN_VERSION: string = JSON.parse(readFileSync(new URL("../../.claude-plugin/plugin.json", import.meta.url), "utf8")).version;

/** How long a Snapshot is fresh; a draw refreshes one older than this first (ADR 0006). */
export const FRESH_MS = 2 * 60_000;
/** How often a Snapshot is read in full again, even when every refresh caught up, so drift can't build up unseen (ADR 0006). */
const FULL_READ_EVERY_MS = 7 * 86_400_000;
/** How far before its last read a refresh reads changes from, since this machine's clock and the Tracker's can disagree. */
const MARGIN_MS = 60_000;
/** How often a look is written down at most: the status line glances every few seconds. */
const LOOK_EVERY_MS = 60_000;
/** Where the last look at a Project's Map is written down, beside its Snapshots. */
const LOOKED = ".looked.json";
/**
 * How long a lock lasts unrenewed, whoever's pid it names, since a pid can
 * pass to another process. The refresher renews its claim every round and a
 * full read its reading lock every page; a refresh holds the Snapshot lock
 * for a few requests.
 */
const LOCK_LAPSES_MS = 10 * 60_000;
/** How long a write waits for the Snapshot lock before it gives up and says so. */
const LOCK_WAIT_MS = 60_000;
/** How the refresher's claim on a login's Snapshot is named, after the login. */
const REFRESHER_LOCK = ".refresher.lock";
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

export function snapshotStore(dir: string, clock: Clock, { summarise }: StoreOptions = {}): SnapshotStore {
  const stamp: Stamp = { version: PLUGIN_VERSION, format: SNAPSHOT_FORMAT };
  const projectDir = (tracker: string, project: string) => join(dir, "snapshots", safe(tracker), safe(project));
  const paths = (key: SnapshotKey) => {
    const base = join(projectDir(key.tracker, key.project), safe(key.login));
    const reading = `${base}.reading`;
    return {
      dir: projectDir(key.tracker, key.project),
      snapshot: `${base}.json`,
      summary: `${base}.summary.json`,
      refreshed: `${base}.refreshed.json`,
      picture: `${base}.picture.html`,
      reading,
      progress: join(reading, "progress.json"),
      page: (n: number) => join(reading, `page-${n}.json`),
      /** Held by a refresh, and by a full read while it puts its Snapshot in place. */
      lock: `${base}.lock`,
      /** Held by a full read throughout, so it runs beside refreshes of the Snapshot it replaces. */
      readLock: `${reading}.lock`,
      /** Held by the refresher for as long as it runs. */
      refresherLock: `${base}${REFRESHER_LOCK}`,
    };
  };

  /** Which save of its file each Snapshot handed over was read from. */
  const saves = new WeakMap<Snapshot, string>();
  /** The save of the Snapshot's file there now, told by its identity, size and time, without reading it; `null` with none. */
  const saveAt = async (path: string) => {
    const found = await stat(path).catch(() => null);
    return found && `${found.ino}:${found.size}:${found.mtimeMs}`;
  };

  /**
   * The Snapshot at `at`, as last refreshed: `last` when it was read from
   * the save there now, otherwise read again. Told apart before it's read,
   * so a save made while it's read only reads it again next time.
   */
  const load = async (at: Paths, last?: Snapshot | null): Promise<Snapshot | null> => {
    const now = await saveAt(at.snapshot);
    if (now === null) return null;
    let snapshot = last && saves.get(last) === now ? last : null;
    if (!snapshot) {
      snapshot = current(await readJson<Snapshot>(at.snapshot));
      if (!snapshot) return null;
      saves.set(snapshot, now);
    }
    const refreshed = current(await readJson<Refreshed>(at.refreshed));
    // Kept for the Snapshot a full read replaced, or by a save that stopped before it was put beside the Snapshot.
    if (refreshed?.fullReadAt !== snapshot.fullReadAt || Date.parse(refreshed.readAt) <= Date.parse(snapshot.readAt)) return snapshot;
    const latest = { ...snapshot, ...refreshed };
    saves.set(latest, now);
    return latest;
  };

  /** Saves the Snapshot, then what's kept beside it. */
  const keep = async (at: Paths, snapshot: Snapshot) => {
    await save(at.snapshot, snapshot);
    const now = await saveAt(at.snapshot);
    if (now) saves.set(snapshot, now);
    await keepBeside(at, snapshot);
  };

  /** Saves what's kept beside the Snapshot, which is saved already: when it was refreshed, and the line summing it up; then deletes what's expired. */
  const keepBeside = async (at: Paths, snapshot: Snapshot) => {
    const { format, fullReadAt, readAt, changesSince, caughtUp } = snapshot;
    await save(at.refreshed, { format, fullReadAt, readAt, changesSince, caughtUp } satisfies Refreshed);
    if (!summarise) await rm(at.summary, { force: true });
    else await save(at.summary, { format: SNAPSHOT_FORMAT, readAt: snapshot.readAt, line: summarise(snapshot) } satisfies Summary);
    await expire();
  };

  /**
   * Deletes all that's kept of each Project nothing has touched for a month,
   * Snapshots and partial reads alike, unless a refresher keeps it warm; and,
   * of the rest, the temporary files a crash left behind.
   */
  const expire = async () => {
    const snapshots = join(dir, "snapshots");
    for (const tracker of await readdir(snapshots).catch(() => [])) {
      for (const project of await readdir(join(snapshots, tracker)).catch(() => [])) {
        const at = join(snapshots, tracker, project);
        const kept = await Promise.all(
          (await readdir(at).catch(() => [])).map(async (name) => ({ name, path: join(at, name), ageMs: clock.now() - ((await stat(join(at, name)).catch(() => null))?.mtimeMs ?? clock.now()) })),
        );
        const warm = await Promise.all(kept.filter(({ name }) => name.endsWith(REFRESHER_LOCK)).map(({ path }) => held(path, clock)));
        if (!warm.includes(true) && kept.every(({ ageMs }) => ageMs >= KEPT_MS)) await rm(at, { recursive: true, force: true });
        else for (const { name, path, ageMs } of kept) if (/\.(tmp|stale)$/.test(name) && ageMs >= LOCK_LAPSES_MS) await rm(path, { force: true });
      }
    }
  };

  /** Writes down that someone looked at the Map of `project`, which keeps its refresher going. */
  const look = async (tracker: string, project: string) => {
    const path = join(projectDir(tracker, project), LOOKED);
    const looked = await readJson<{ at: number }>(path);
    if (clock.now() - (looked?.at ?? 0) < LOOK_EVERY_MS) return;
    await mkdir(projectDir(tracker, project), { recursive: true, mode: 0o700 });
    await save(path, { at: clock.now() });
  };

  return {
    async state(key, last) {
      const at = paths(key);
      const snapshot = await load(at, last);
      const running = await held(at.readLock, clock);
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
      const reader = await lock(at.readLock, clock);
      if (!reader) return { kind: "busy" };
      try {
        // Saved over, it would be read again by that version in turn.
        if (await this.savedByNewer(key)) return { kind: "failed", reason: "a newer version of the plugin keeps this Snapshot" };
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
            return await locked(at.lock, clock, () => forget(at, total, said.reason));
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
            return await locked(at.lock, clock, () => forget(at, total, page.reason));
          }
          if (page.kind !== "page") {
            progress.stopped = page.reason;
            await save(at.progress, progress);
            return { kind: "failed", reason: page.reason };
          }
          // Saved under the Snapshot's lock, so a refused login's pages are never saved after they're deleted.
          const deleted = await locked(at.lock, clock, async () => {
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
            await renew(at.readLock, reader, clock);
            return null;
          });
          if (deleted) return deleted;
          if (page.next === null) break;
        }
        const switched = await otherLogin(tracker, key);
        if (switched) {
          await locked(at.lock, clock, () => rm(at.reading, { recursive: true, force: true }));
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
        const replaced = await locked(at.lock, clock, async () => {
          const deleted = await forgotten(at, attempt);
          if (!deleted) await keep(at, snapshot);
          return deleted;
        });
        if (replaced) return replaced;
        await rm(at.reading, { recursive: true, force: true });
        return { kind: "done" };
      } finally {
        await unlock(at.readLock, reader);
      }
    },

    async refresh(key, tracker, project, last) {
      const at = paths(key);
      const refresher = await lock(at.lock, clock);
      if (!refresher) return { kind: "busy" };
      try {
        const snapshot = await load(at, last);
        if (!snapshot) return { kind: "none" };
        const started = clock.now();
        const changes = await tracker.changes(project, snapshot.changesSince, outsideOf(snapshot));
        if (changes.kind === "refused" || changes.kind === "not-found") return await forget(at, 0, changes.reason);
        if (changes.kind !== "changes") return { kind: "failed", reason: changes.reason };
        const switched = await otherLogin(tracker, key);
        if (switched) return { kind: "failed", reason: switched };
        const issues = applied(snapshot, changes);
        const unread = { ...changes.unread, ...snapshot.unread };
        const refreshed: Snapshot = {
          ...snapshot,
          issues: issues ?? snapshot.issues,
          unread,
          readAt: new Date(clock.now()).toISOString(),
          changesSince: new Date(started - MARGIN_MS).toISOString(),
          caughtUp: snapshot.caughtUp && changes.caughtUp,
        };
        if (issues || Object.keys(unread).length > Object.keys(snapshot.unread).length) await keep(at, refreshed);
        else {
          // Nothing the Snapshot holds changed: only when it was refreshed is saved.
          const unchanged = saves.get(snapshot);
          if (unchanged) saves.set(refreshed, unchanged);
          await keepBeside(at, refreshed);
        }
        return { kind: "done", caughtUp: refreshed.caughtUp, snapshot: refreshed };
      } finally {
        await unlock(at.lock, refresher);
      }
    },

    async forDraw(key, tracker, project, now = false) {
      await look(key.tracker, key.project);
      const state = await this.state(key);
      if (state.kind !== "ready" || (!now && state.ageMs <= FRESH_MS)) return state;
      const outcome = await this.refresh(key, tracker, project, state.snapshot);
      if (outcome.kind === "refused") return outcome;
      const after = await this.state(key, outcome.kind === "done" ? outcome.snapshot : state.snapshot);
      if (outcome.kind === "done" || after.kind !== "ready") return after;
      return { ...after, stale: outcome.kind === "failed" ? outcome.reason : "another refresh of it is running" };
    },

    async assigned(key, issue, assignees) {
      const at = paths(key);
      const last = await load(at);
      if (!last) return;
      await locked(at.lock, clock, async () => {
        const snapshot = await load(at, last);
        if (!snapshot?.issues.some((held) => held.id === issue)) return;
        await keep(at, { ...snapshot, issues: snapshot.issues.map((held) => (held.id === issue ? { ...held, assignees } : held)) });
      });
    },

    async linked(key, ends) {
      const at = paths(key);
      const last = await load(at);
      if (!last) return;
      await locked(at.lock, clock, async () => {
        const snapshot = await load(at, last);
        if (!snapshot) return;
        const issues = snapshot.issues.map((held) => {
          const more = ends.filter((end) => end.issue === held.id && !held.links.some((l) => l.role === end.link.role && l.to.id === end.link.to.id));
          return more.length > 0 ? { ...held, links: [...held.links, ...more.map((end) => end.link)] } : held;
        });
        await keep(at, { ...snapshot, issues });
      });
    },

    async page(key, html) {
      const at = paths(key);
      await mkdir(at.dir, { recursive: true, mode: 0o700 });
      await writeWhole(at.picture, html);
      return at.picture;
    },

    async forget(key, reason) {
      const at = paths(key);
      await mkdir(at.dir, { recursive: true, mode: 0o700 });
      return locked(at.lock, clock, () => forget(at, 0, reason));
    },

    async claimRefresher(key) {
      const at = paths(key);
      await mkdir(at.dir, { recursive: true, mode: 0o700 });
      const claim = await lock(at.refresherLock, clock, stamp);
      if (!claim) return null;
      if (!(await readJson<{ at: number }>(join(at.dir, LOOKED)))) await look(key.tracker, key.project);
      return {
        renew: () => renew(at.refresherLock, claim, clock),
        release: () => unlock(at.refresherLock, claim),
      };
    },

    async refresherRunning(key) {
      return held(paths(key).refresherLock, clock, stamp);
    },

    async savedByNewer(key) {
      const at = paths(key);
      return (await formatOf(at.snapshot)) > SNAPSHOT_FORMAT || ((await readJson<Progress>(at.progress))?.format ?? 0) > SNAPSHOT_FORMAT;
    },

    async unlookedMs(key) {
      const looked = await readJson<{ at: number }>(join(projectDir(key.tracker, key.project), LOOKED));
      return clock.now() - (looked?.at ?? clock.now());
    },

    async glance(tracker, project) {
      const claimed = (await readdir(projectDir(tracker, project)).catch(() => [])).filter((name) => name.endsWith(REFRESHER_LOCK));
      let warm: { login: string; at: number } | null = null;
      for (const name of claimed) {
        const path = join(projectDir(tracker, project), name);
        const at = (await readJson<Holder>(path))?.at ?? 0;
        if ((!warm || at > warm.at) && (await held(path, clock))) warm = { login: decodeURIComponent(name.slice(0, -REFRESHER_LOCK.length)), at };
      }
      if (!warm) return { kind: "none" };
      await look(tracker, project);
      const at = paths({ tracker, project, login: warm.login });
      const summary = current(await readJson<Summary>(at.summary));
      if (summary) return { kind: "ready", line: summary.line, ageMs: clock.now() - Date.parse(summary.readAt) };
      const progress = current(await readJson<Progress>(at.progress));
      if (progress && (await held(at.readLock, clock))) return { kind: "reading", read: progress.read, total: progress.total };
      return { kind: "none" };
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
 * The Snapshot's open Issues with what changed applied, oldest first, or
 * `null` when that changes none of them. A Link
 * is recorded at both its ends, but a Tracker may note a change at only one,
 * so an Issue that didn't change takes its Links to one that did from the
 * changed one's side. A Link to an Issue that closed or left is kept, with
 * the far end as it is now. An Issue that didn't change no longer holds a
 * Closing Request that changed, since one that still closes it would have
 * marked it changed.
 */
function applied(snapshot: Snapshot, { open, ends, requests }: Extract<ChangesAnswer, { kind: "changes" }>): OpenIssue[] | null {
  const changedOpen = new Set(open.map((issue) => issue.id));
  const endsNow = new Map(ends.map((end) => [end.id, end]));
  const changedRequests = new Set(requests);
  const unchanged =
    open.length === 0 &&
    snapshot.issues.every(
      ({ id, links, closingRequests }) =>
        !endsNow.has(id) && !closingRequests.some((request) => changedRequests.has(request.ref)) && links.every(({ to }) => !endsNow.has(to.id) || JSON.stringify(endsNow.get(to.id)) === JSON.stringify(to)),
    );
  if (unchanged) return null;
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

type Paths = { snapshot: string; summary: string; picture: string; refreshed: string; reading: string; progress: string };

/**
 * Deletes the Snapshot and every page read towards one, keeping only why,
 * with none of the Project's Issues: the next read starts over.
 */
async function forget(at: Paths, total: number, reason: string): Promise<Refused> {
  await rm(at.snapshot, { force: true });
  await rm(at.summary, { force: true });
  await rm(at.picture, { force: true });
  await rm(at.refreshed, { force: true });
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

/**
 * The format the file at `path` was saved in, `0` with none: from its first
 * bytes, where every save puts it, so a large Snapshot isn't read whole for it.
 */
async function formatOf(path: string): Promise<number> {
  const file = await open(path).catch(() => null);
  if (!file) return 0;
  try {
    const { buffer, bytesRead } = await file.read(Buffer.alloc(32), 0, 32, 0);
    const said = /^\{"format":(\d+)[,}]/.exec(buffer.toString("utf8", 0, bytesRead));
    if (said) return Number(said[1]);
  } finally {
    await file.close();
  }
  return (await readJson<{ format?: number }>(path))?.format ?? 0;
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
async function locked<T>(path: string, clock: Clock, work: () => Promise<T>): Promise<T> {
  const until = clock.now() + LOCK_WAIT_MS;
  let id: string | null;
  while (!(id = await lock(path, clock))) {
    if (clock.now() >= until) {
      const holder = await readJson<Holder>(path);
      throw new Error(`Gave up after a minute waiting for the Snapshot lock ${path}, held by process ${holder?.pid ?? "unknown"}.`);
    }
    await sleep(LOCK_POLL_MS);
  }
  try {
    return await work();
  } finally {
    await unlock(path, id);
  }
}

/** The version of the plugin, and the Snapshot format, a refresher's claim was taken by. */
interface Stamp {
  version: string;
  format: number;
}

/** What a lock holds: who took it, which taking it was, when it was taken or last renewed, on which boot, and, for a refresher's claim, by which version. */
interface Holder extends Partial<Stamp> {
  pid: number;
  id: string;
  at: number;
  boot: string | null;
}

/** The ids of the locks this process holds now. */
const holding = new Set<string>();

/**
 * Takes the lock, returning its id, or `null` while another holds it. A lock
 * nobody holds any more is moved aside, and taken over only if what moved is
 * the one found not held, so two takers of one stale lock can't both win.
 */
async function lock(path: string, clock: Clock, stamp?: Stamp): Promise<string | null> {
  const id = randomUUID();
  // Linked into place whole, so nobody ever reads a lock without its holder.
  const mine = `${path}.${id}.tmp`;
  await writeFile(mine, JSON.stringify({ pid: process.pid, id, at: clock.now(), boot: bootId(), ...stamp } satisfies Holder), { mode: 0o600 });
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await link(mine, path);
        holding.add(id);
        return id;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      const found = await readJson<Holder>(path);
      if (found && alive(found, clock, stamp)) return null;
      const aside = `${path}.${randomUUID()}.stale`;
      try {
        await rename(path, aside);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      const moved = await readJson<Holder>(aside);
      if (moved?.id !== found?.id) {
        // Another taker got in first: its lock goes back.
        // ponytail: a third taker linking in this instant wins too; renameat2's RENAME_NOREPLACE would close it, were it in Node.
        await link(aside, path).catch(() => {});
        await rm(aside, { force: true });
        return null;
      }
      await rm(aside, { force: true });
    }
    return null;
  } finally {
    await rm(mine, { force: true });
  }
}

/** Marks the lock `id` renewed now; `false`, changing nothing, once another holds it. */
async function renew(path: string, id: string, clock: Clock): Promise<boolean> {
  const found = await readJson<Holder>(path);
  if (found?.id !== id) {
    holding.delete(id);
    return false;
  }
  await save(path, { ...found, at: clock.now() });
  return true;
}

/** Lets go of the lock `id`, leaving it be if another has taken it over since. */
async function unlock(path: string, id: string): Promise<void> {
  holding.delete(id);
  if ((await readJson<Holder>(path))?.id === id) await rm(path, { force: true });
}

async function held(path: string, clock: Clock, stamp?: Stamp): Promise<boolean> {
  const found = await readJson<Holder>(path);
  return found !== null && alive(found, clock, stamp);
}

/**
 * Whether the lock's holder can still be running, and, given a stamp, holds
 * it as that version: one stamped by another, or by none, counts as gone. Its
 * pid alone can't say, since another process may have that pid now.
 */
function alive({ pid, id, at, boot, version, format }: Holder, clock: Clock, stamp?: Stamp): boolean {
  if (stamp && (version !== stamp.version || format !== stamp.format)) return false;
  const thisBoot = bootId();
  if (boot && thisBoot && boot !== thisBoot) return false;
  if (!(clock.now() - at < LOCK_LAPSES_MS)) return false;
  // Our own pid holds only what this process took, not what one before it with that pid left.
  if (pid === process.pid) return holding.has(id);
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    // ESRCH: the process is gone. EPERM: it's another OS user's, so it can't hold this user's lock.
    return false;
  }
}

let boot: string | null | undefined;

/** What tells this boot from the last, where the OS says; `null` where it doesn't, which leaves a lock from before a reboot to lapse. */
function bootId(): string | null {
  if (boot !== undefined) return boot;
  try {
    const said = process.platform === "darwin" ? execFileSync("sysctl", ["-n", "kern.bootsessionuuid"], { encoding: "utf8" }) : readFileSync("/proc/sys/kernel/random/boot_id", "utf8");
    boot = said.trim() || null;
  } catch {
    boot = null;
  }
  return boot;
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
