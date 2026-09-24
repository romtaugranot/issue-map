/**
 * Installing the status line (#40). A plugin can't declare a status line,
 * and a user has just one (ADR 0001), so this writes it into the user's
 * Claude Code settings. A status line the user already has is wrapped, not
 * replaced: its rows come first, then the Map's.
 */
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** What marks a status line command as already the Map's. */
const OURS = "issue-map-status-line";

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
  let settings: Record<string, unknown>;
  try {
    settings = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") settings = {};
    else return `Didn't install the status line: ${path} isn't JSON (${(error as Error).message}). Nothing changed.`;
  }
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return `Didn't install the status line: ${path} doesn't hold an object. Nothing changed.`;

  const theirs = settings.statusLine as { type?: unknown; command?: unknown } | undefined;
  const command = theirs?.type === "command" && typeof theirs.command === "string" && theirs.command.trim() ? theirs.command : null;
  if (command?.includes(OURS)) return `The status line is already installed in ${path}; nothing changed.`;
  settings.statusLine = command
    ? { ...theirs, command: `${quoted(entry)} --wrap ${quoted(command)}` }
    : { type: "command", command: quoted(entry), refreshInterval: REFRESH_S };
  await save(path, settings);
  return command
    ? `The status line is installed in ${path}, wrapping yours: from the next message, your status line's rows come first, then the Home Project's Take next.`
    : `The status line is installed in ${path}: from the next message, it shows the Home Project's Take next, as the background refresher keeps it.`;
}

/** Quoted for the shell, whatever it holds. */
function quoted(text: string): string {
  return `'${text.replaceAll("'", `'\\''`)}'`;
}

/** Written whole or not at all, keeping the file's permissions. */
async function save(path: string, settings: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const mode = (await stat(path).catch(() => null))?.mode ?? 0o600;
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, { mode });
  await rename(temporary, path);
}
