/**
 * What the plugin keeps on this machine besides Snapshots, and where: the
 * state directory, readable only by this OS user. Shared by the CLI and the
 * status line, so both find the same Home Project.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, openSync, renameSync, statSync } from "node:fs";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { LastHome } from "./home/home.ts";
import type { Declines } from "./map/suggest.ts";
import type { SnapshotKey } from "./snapshot/store.ts";
import type { Project } from "./tracker/tracker.ts";

/** How long what nobody has touched is kept: shown outputs, trails, and Snapshots no refresher keeps warm. */
export const KEPT_MS = 30 * 86_400_000;

/**
 * Where Snapshots are kept: `ISSUE_MAP_STATE_DIR`, or the XDG state directory.
 * Each counts only as an absolute path, so a relative one can't put private
 * titles in the working tree.
 */
export function stateDir(env: Record<string, string | undefined> = process.env): string {
  const absolute = (dir: string | undefined) => (dir && isAbsolute(dir) ? dir : undefined);
  return absolute(env.ISSUE_MAP_STATE_DIR) ?? join(absolute(env.XDG_STATE_HOME) ?? join(homedir(), ".local", "state"), "issue-map");
}

/** How large the background log grows before it's started afresh, the last one kept beside it as `background.log.1`. */
const LOG_CAP = 1_000_000;

/** Opens `dir`'s background log to append what a background process prints; past its cap, it's moved aside first. */
export function openBackgroundLog(dir: string): number {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, "background.log");
  try {
    if (statSync(path).size >= LOG_CAP) renameSync(path, `${path}.1`);
  } catch {
    // None yet, or another process moved it aside first.
  }
  return openSync(path, "a", 0o600);
}

/** The Home Project last resolved for the checkout at `root`, kept in `dir`. */
export function lastHomeOf(root: string, dir: string = stateDir()): LastHome {
  const homes = join(dir, "homes");
  const path = join(homes, `${createHash("sha256").update(root).digest("hex")}.json`);
  return {
    get: () => readJson<Project | undefined>(path, undefined),
    set: (project) => writeJson(homes, path, project),
  };
}

/**
 * The Link Suggestions each login declined, per Tracker and Project, kept in
 * `dir`: a line each, only ever appended, so two sessions declining at once
 * both keep theirs.
 */
export function declinesOf(dir: string = stateDir()): Declines {
  const declined = join(dir, "declined");
  const path = (key: SnapshotKey) => join(declined, `${createHash("sha256").update(JSON.stringify([key.tracker, key.project, key.login])).digest("hex")}.jsonl`);
  return {
    async get(key) {
      const lines = (await readFile(path(key), "utf8").catch(() => "")).split("\n");
      // A line cut short by a crash is skipped.
      return [...new Set(lines.flatMap((line) => readJsonLine<string>(line)))];
    },
    async add(key, more) {
      await mkdir(declined, { recursive: true, mode: 0o700 });
      await appendFile(path(key), more.map((decline) => `${JSON.stringify(decline)}\n`).join(""), { mode: 0o600 });
    },
  };
}

function readJsonLine<T>(line: string): T[] {
  try {
    return [JSON.parse(line) as T];
  } catch {
    return [];
  }
}

export async function readJson<T>(path: string, none: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return none;
  }
}

/** Written whole or not at all, and readable only by this OS user. */
export async function writeJson(dir: string, path: string, value: unknown): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeWhole(path, JSON.stringify(value));
}

/**
 * Written as the Snapshot store saves: to a temporary file of its own, then
 * renamed into place, so a reader finds the old text or the new, never part
 * of either. Readable only by this OS user.
 */
export async function writeWhole(path: string, text: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, text, { mode: 0o600 });
  await rename(temporary, path);
}
