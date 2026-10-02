/**
 * Installing the status line (#40). A plugin can't declare a status line,
 * and a user has just one (ADR 0001), so this writes it into the user's
 * Claude Code settings. A status line the user already has is wrapped, not
 * replaced: its rows come first, then the Map's. Removing it (#50) puts
 * back the one it wrapped.
 */
import { mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** What marks a status line command as already the Map's. */
const OURS = "issue-map-status-line";

/** A word `quoted` quoted, at the start of a command. */
const QUOTED = /^'(?:[^']|'\\'')*'/;

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
    // A plugin update moves the entry, which would leave the status line blank: the entry, its first word, is pointed at where it is now.
    const moved = QUOTED.exec(command)?.[0];
    if (moved === undefined || moved === quoted(entry)) return `The status line is already installed in ${path}; nothing changed.`;
    settings.statusLine = { ...theirs, command: `${quoted(entry)}${command.slice(moved.length)}` };
    await save(path, settings);
    return `The status line in ${path} now runs from ${entry}.`;
  }
  settings.statusLine = command
    ? { ...theirs, command: `${quoted(entry)} --wrap ${quoted(command)}` }
    : { type: "command", command: quoted(entry), refreshInterval: REFRESH_S };
  await save(path, settings);
  return command
    ? `The status line is installed in ${path}, wrapping yours: from the next message, your status line's rows come first, then the Home Project's Take next.`
    : `The status line is installed in ${path}: from the next message, it shows the Home Project's Take next, as the background refresher keeps it.`;
}

/** Takes the Map's row out of the status line in the settings at `path`, and says what it did: the status line it wrapped is put back as it was, or, when it wrapped none, the setting goes. */
export async function removeStatusLine(path: string): Promise<string> {
  const settings = await load(path);
  if (typeof settings === "string") return `Didn't remove the status line: ${settings} Nothing changed.`;

  const { theirs, command } = statusLineIn(settings);
  if (!command?.includes(OURS)) return `The Map's status line isn't installed in ${path}; nothing changed.`;
  const rest = command.slice(QUOTED.exec(command)?.[0].length ?? 0);
  const wrapped = /^ --wrap ('(?:[^']|'\\'')*')$/.exec(rest)?.[1];
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
