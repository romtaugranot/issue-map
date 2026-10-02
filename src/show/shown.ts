/**
 * Putting what the Map prints on screen exactly as printed (ADR 0009).
 * Claude doesn't reliably reprint a tool's output, so each output the user
 * should see is kept in the state directory under an id, and Claude writes
 * one line naming it, `⟦issue-map <id>⟧`. The plugin's MessageDisplay hook
 * shows the output in that line's place as the reply streams; what Claude
 * wrote, and the transcript, keep the line.
 */
import { createHash, randomBytes } from "node:crypto";
import { access, mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readJson, writeJson, writeWhole } from "../state.ts";

/** A line standing for a kept output: only a whole line of its own, so a mention in a sentence is left as written. */
const LINE = /^⟦issue-map ([0-9a-f]{12})⟧$/gm;
const KEPT_MS = 30 * 86_400_000;

/** Keeps `text` in `dir`, readable only by this OS user, and returns the line that shows it; outputs untouched for a month are deleted. */
export async function keepShown(dir: string, text: string): Promise<string> {
  const shown = join(dir, "shown");
  await mkdir(shown, { recursive: true, mode: 0o700 });
  for (const name of await readdir(shown).catch(() => [])) {
    const old = join(shown, name);
    const { mtimeMs } = await stat(old).catch(() => ({ mtimeMs: Date.now() }));
    if (Date.now() - mtimeMs > KEPT_MS) await unlink(old).catch(() => {});
  }
  const id = randomBytes(6).toString("hex");
  await writeWhole(join(shown, `${id}.md`), text);
  return `⟦issue-map ${id}⟧`;
}

/** `text` with each line standing for a kept output replaced by it, or `null` when it has none. */
export async function displayed(dir: string, text: string): Promise<string | null> {
  const ids = [...text.matchAll(LINE)].map((match) => match[1]!);
  if (ids.length === 0) return null;
  const kept = new Map<string, string>();
  for (const id of ids) {
    const output = await readFile(join(dir, "shown", `${id}.md`), "utf8").catch(() => null);
    // Marked as shown, so the next command knows the hook runs.
    if (output !== null) await writeFile(join(dir, "shown", `${id}.seen`), "", { mode: 0o600 }).catch(() => {});
    kept.set(id, output ?? "_This output of the Map's is no longer kept: ask for it again._");
  }
  return text.replace(LINE, (_, id: string) => kept.get(id)!);
}

const REPRINT =
  "The Map's display hook isn't showing its outputs in this session, so a line can't show them: show the user all of the above by reprinting it exactly as printed, and every output of the Map's from now on, as under `claude -p`.";
const TELL =
  "Tell the user once, unless this is `claude -p`, that the Map's display hook isn't running, most likely because hooks are disabled (`disableAllHooks`), only managed hooks are allowed (`allowManagedHooksOnly`), or Node isn't on the hook's PATH.";

/** How long before a command its session's last output must have been kept to judge the hook by it: past one turn's model latency, short of a user reading and replying. */
const JUDGED_AFTER_MS = 30_000;

/** A Claude Code session's last output's id and when it was kept, whether the hook ever marked one of its outputs, and whether it fell back to reprinting. */
type Session = { last?: string; lastAt?: number; seen?: boolean; reprint?: boolean };

/**
 * `text`, kept, then the line that shows it, with what Claude does with it.
 * In a `session` whose previous output, kept well before this command
 * `started`, the hook didn't mark, nor any before it, the hook isn't
 * running: from then on `text` ends by telling Claude to reprint it
 * instead, and the first time also to tell the user why. One kept just
 * before is judged by nothing: Claude may run several commands in a turn
 * before writing their lines.
 */
export async function withLine(dir: string, text: string, session?: string, started = performance.timeOrigin): Promise<string> {
  const path = session && join(dir, "shown", `${createHash("sha256").update(session).digest("hex")}.json`);
  const was: Session = path ? await readJson<Session>(path, {}) : {};
  // ponytail: misread only when a session's first turn runs commands over 30 s apart with no text between; once the hook marks one output the session trusts it.
  const seen = !!was.seen || (was.last !== undefined && (await access(join(dir, "shown", `${was.last}.seen`)).then(() => true, () => false)));
  const unshown = was.last !== undefined && !seen && started - (was.lastAt ?? 0) > JUDGED_AFTER_MS;
  if (path && (was.reprint || unshown)) {
    await writeJson(join(dir, "shown"), path, { reprint: true });
    return `${text}\n\n${was.reprint ? REPRINT : `${REPRINT}\n${TELL}`}`;
  }
  const line = await keepShown(dir, text);
  if (path) await writeJson(join(dir, "shown"), path, { last: line.slice("⟦issue-map ".length, -1), lastAt: Date.now(), seen });
  return `${text}\n\nTo show the user all of the above, exactly as printed, write this line on its own in your reply:\n${line}`;
}
