/**
 * The Snapshot store (ADR 0006): what's kept between draws, one Snapshot per
 * Tracker, Project and login. A first read saves itself a page at a time, so
 * an interrupted read resumes, but only a finished read is ever handed over
 * as a Snapshot: until then the store hands over progress.
 */
import { link, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { OpenIssue, Project, Tracker } from "../tracker/tracker.ts";
import type { Snapshot } from "./snapshot.ts";

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
  | { kind: "ready"; snapshot: Snapshot; ageMs: number };

export type ReadOutcome = { kind: "done" } | { kind: "busy" } | { kind: "failed"; reason: string };

export interface SnapshotStore {
  state(key: SnapshotKey): Promise<SnapshotState>;
  /** Reads the Project in full, resuming an interrupted read; leaves it to another read already running. */
  read(key: SnapshotKey, tracker: Tracker, project: Project): Promise<ReadOutcome>;
}

/** A first read part-way through. Its pages are kept one file each, so saving one doesn't rewrite the rest. */
interface Progress {
  pages: number;
  /** Issues in the saved pages. */
  read: number;
  /** Where the next page starts; `null` before the first page. */
  after: string | null;
  total: number;
  spentMs: number;
  stopped?: string;
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
      lock: `${base}.lock`,
    };
  };

  return {
    async state(key) {
      const at = paths(key);
      const snapshot = await readJson<Snapshot>(at.snapshot);
      if (snapshot) return { kind: "ready", snapshot, ageMs: clock.now() - Date.parse(snapshot.readAt) };
      const progress = await readJson<Progress>(at.progress);
      const running = await held(at.lock);
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
      if (!(await lock(at.lock))) return { kind: "busy" };
      try {
        await mkdir(at.reading, { recursive: true, mode: 0o700 });
        const progress: Progress = (await readJson<Progress>(at.progress)) ?? {
          pages: 0,
          read: 0,
          after: null,
          total: project.issues === "off" ? 0 : project.issues.open,
          spentMs: 0,
        };
        delete progress.stopped;
        await save(at.progress, progress);
        for (;;) {
          const started = clock.now();
          const page = await tracker.openIssues(project, progress.after);
          if (page.kind !== "page") {
            progress.stopped = page.reason;
            await save(at.progress, progress);
            return { kind: "failed", reason: page.reason };
          }
          await save(at.page(progress.pages), page.issues);
          progress.pages++;
          progress.read += page.issues.length;
          progress.total = page.total;
          progress.spentMs += clock.now() - started;
          if (page.next === null) break;
          progress.after = page.next;
          await save(at.progress, progress);
        }
        const issues: OpenIssue[] = [];
        for (let n = 0; n < progress.pages; n++) issues.push(...((await readJson<OpenIssue[]>(at.page(n))) ?? []));
        const snapshot: Snapshot = {
          tracker: key.tracker,
          project: { id: project.id, path: project.path, url: project.url },
          login: key.login,
          readAt: new Date(clock.now()).toISOString(),
          issues: unique(issues),
        };
        await save(at.snapshot, snapshot);
        await rm(at.reading, { recursive: true, force: true });
        return { kind: "done" };
      } finally {
        await rm(at.lock, { force: true });
      }
    },
  };
}

/** An Issue created while the read runs can land on two pages; it is kept once. */
function unique(issues: OpenIssue[]): OpenIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => !seen.has(issue.id) && seen.add(issue.id));
}

/** Takes the lock, or says another live process holds it. A lock whose process is gone is taken over. */
async function lock(path: string): Promise<boolean> {
  // Linked into place whole, so nobody ever reads a lock without its holder.
  const mine = `${path}.${process.pid}.tmp`;
  await writeFile(mine, JSON.stringify({ pid: process.pid }), { mode: 0o600 });
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await link(mine, path);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (await held(path)) return false;
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
