/**
 * Installing the status line (#40). A plugin can't declare a status line,
 * and a user has just one (ADR 0001), so this writes it into the user's
 * Claude Code settings. A status line the user already has is wrapped, not
 * replaced: its rows come first, then the Map's, and should the plugin be
 * gone, as an update deletes the old one, the shell runs it alone (#56).
 * Drawing the Map points the status line at where the plugin is now.
 * Removing it (#50) puts back the one it wrapped.
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

/**
 * How often, in seconds, Claude Code re-runs a status line of the Map's
 * alone while the session is idle, when nothing else re-runs it: the
 * refresher saves a new row every 90 s, and the row's age goes on growing.
 * A status line it wraps keeps its own timing, whose cost is the user's.
 */
const REFRESH_S = 60;

/** The user's Claude Code settings file: in `CLAUDE_CONFIG_DIR`, or `~/.claude`. */
export function userSettings(env: Record<string, string | undefined> = process.env, home = homedir()): string {
  return join(env.CLAUDE_CONFIG_DIR ?? join(home, ".claude"), "settings.json");
}

/** Installs the status line whose process is at `entry` into the settings at `path`, and says what it did. */
export async function installStatusLine(path: string, entry: string): Promise<string> {
  const settings = await load(path);
  if (typeof settings === "string") return `Didn't install the status line: ${settings} Nothing changed.`;

  const { theirs, command } = statusLineIn(settings);
  if (command?.includes(OURS)) {
    if (!(await repoint(path, settings, entry))) return `The status line is already installed in ${path}; nothing changed.`;
    return `The status line in ${path} now runs from ${entry}.`;
  }
  settings.statusLine = command
    ? { ...theirs, command: wrapping(entry, quoted(command)) }
    : { type: "command", command: quoted(entry), refreshInterval: REFRESH_S };
  await save(path, settings);
  return command
    ? `The status line is installed in ${path}, wrapping yours: from the next message, your status line's rows come first, then the Home Project's Take next.`
    : `The status line is installed in ${path}: from the next message, it shows the Home Project's Take next, as the background refresher keeps it.`;
}

/** Points the Map's status line in the settings at `path`, when it is installed, at `entry`, as drawing the Map does once an update has moved the plugin; anything else is left alone. */
export async function repointStatusLine(path: string, entry: string): Promise<void> {
  const settings = await load(path);
  if (typeof settings !== "string" && statusLineIn(settings).command?.includes(OURS)) await repoint(path, settings, entry);
}

/** Points the Map's status line command in `settings` at `entry`, saving them to `path`; whether that changed anything. */
async function repoint(path: string, settings: Record<string, unknown>, entry: string): Promise<boolean> {
  const { theirs, command } = statusLineIn(settings);
  // The entry is its first word; one changed by hand past it keeps the rest as it is.
  const moved = QUOTED.exec(command!)?.[0];
  if (moved === undefined) return false;
  const rest = command!.slice(moved.length);
  const wrapped = WRAPPED.exec(rest)?.[1];
  const now = wrapped === undefined ? `${quoted(entry)}${rest}` : wrapping(entry, wrapped);
  if (now === command) return false;
  settings.statusLine = { ...theirs, command: now };
  await save(path, settings);
  return true;
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

/** The entry wrapping `theirs`, already quoted, and should the entry be gone, `theirs` alone, run through the shell as the entry runs it. */
function wrapping(entry: string, theirs: string): string {
  return `${quoted(entry)} --wrap ${theirs} 2>/dev/null || sh -c ${theirs}`;
}

/** Quoted for the shell, whatever it holds. */
function quoted(text: string): string {
  return `'${text.replaceAll("'", `'\\''`)}'`;
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
