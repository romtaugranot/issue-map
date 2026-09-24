/**
 * What the plugin keeps on this machine besides Snapshots, and where: the
 * state directory, readable only by this OS user. Shared by the CLI and the
 * status line, so both find the same Home Project.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { LastHome } from "./home/home.ts";
import type { Project } from "./tracker/tracker.ts";

/** Where Snapshots are kept: `ISSUE_MAP_STATE_DIR`, or the XDG state directory. */
export function stateDir(env: Record<string, string | undefined> = process.env): string {
  return env.ISSUE_MAP_STATE_DIR ?? join(env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "issue-map");
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

export async function readJson<T>(path: string, none: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return none;
  }
}

/** Readable only by this OS user. */
export async function writeJson(dir: string, path: string, value: unknown): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(value), { mode: 0o600 });
}
