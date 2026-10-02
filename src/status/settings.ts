/**
 * The status line 0.1.0 wrote into the user's Claude Code settings (#40),
 * wrapping any status line they had (#50, #56). The plugin now pins its own
 * line (ADR 0011), so this only tells whether that old one is still there and
 * takes it out on the user's word, putting back the one it wrapped.
 */
import { mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** What marks a status line command as already the Map's. */
const OURS = "issue-map-status-line";

/** A word `quoted` quoted, at the start of a command. */
const QUOTED = /^'(?:[^']|'\\'')*'/;

/** What follows the entry in a command the Map wrote wrapping one: as #50 wrote it, or, since #56, with the shell's fallback to the wrapped command alone. */
const WRAPPED = /^ --wrap ('(?:[^']|'\\'')*')(?: 2>\/dev\/null \|\| sh -c \1)?$/;

/** The user's Claude Code settings file: in `CLAUDE_CONFIG_DIR`, or `~/.claude`. */
export function userSettings(env: Record<string, string | undefined> = process.env, home = homedir()): string {
  return join(env.CLAUDE_CONFIG_DIR ?? join(home, ".claude"), "settings.json");
}

/** Whether the settings at `path` still run a status line of the Map's, as 0.1.0 set up. */
export async function hasOldStatusLine(path: string): Promise<boolean> {
  const settings = await load(path);
  return typeof settings !== "string" && !!statusLineIn(settings).command?.includes(OURS);
}

/** Takes the Map's row out of the status line in the settings at `path`, and says what it did: the status line it wrapped is put back as it was, or, when it wrapped none, the setting goes. */
export async function removeStatusLine(path: string): Promise<string> {
  const settings = await load(path);
  if (typeof settings === "string") return `Didn't remove the status line: ${settings} Nothing changed.`;

  const { theirs, command } = statusLineIn(settings);
  if (!command?.includes(OURS)) return `The Map's status line isn't installed in ${path}; nothing changed.`;
  const rest = command.slice(QUOTED.exec(command)?.[0].length ?? 0);
  const wrapped = WRAPPED.exec(rest)?.[1];
  if (rest && wrapped === undefined) return `Didn't remove the status line: the one in ${path} isn't as the Map wrote it, so what was yours can't be told apart. Nothing changed.`;
  if (wrapped === undefined) delete settings.statusLine;
  else settings.statusLine = { ...theirs, command: wrapped.slice(1, -1).replaceAll(`'\\''`, "'") };
  await save(path, settings);
  return wrapped === undefined
    ? `The status line is removed from ${path}.`
    : `The Map's row is removed from the status line in ${path}: yours is back as it was.`;
}

/** The settings at `path`, `{}` when there are none yet; why not, when they can't be had. */
async function load(path: string): Promise<Record<string, unknown> | string> {
  let settings: unknown;
  try {
    const text = await readFile(path, "utf8");
    settings = text.trim() ? JSON.parse(text) : {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return `${path} isn't JSON (${(error as Error).message}).`;
    settings = {};
  }
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return `${path} doesn't hold an object.`;
  return settings as Record<string, unknown>;
}

/** The status line in `settings`, and its command when it runs one. */
function statusLineIn(settings: Record<string, unknown>) {
  const theirs = settings.statusLine as { type?: unknown; command?: unknown } | undefined;
  const command = theirs?.type === "command" && typeof theirs.command === "string" && theirs.command.trim() ? theirs.command : null;
  return { theirs, command };
}

/** Written whole or not at all, keeping the file's permissions; a symlinked settings file is written through, keeping the link. */
async function save(link: string, settings: Record<string, unknown>): Promise<void> {
  const path = await realpath(link).catch(() => link);
  await mkdir(dirname(path), { recursive: true });
  const mode = (await stat(path).catch(() => null))?.mode ?? 0o600;
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, { mode });
  await rename(temporary, path);
}
