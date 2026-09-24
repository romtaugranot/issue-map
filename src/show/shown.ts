/**
 * Putting what the Map prints on screen exactly as printed (ADR 0009).
 * Claude doesn't reliably reprint a tool's output, so each output the user
 * should see is kept in the state directory under an id, and Claude writes
 * one line naming it, `⟦issue-map <id>⟧`. The plugin's MessageDisplay hook
 * shows the output in that line's place as the reply streams; what Claude
 * wrote, and the transcript, keep the line.
 */
import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

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
  await writeFile(join(shown, `${id}.md`), text, { mode: 0o600 });
  return `⟦issue-map ${id}⟧`;
}

/** `text` with each line standing for a kept output replaced by it, or `null` when it has none. */
export async function displayed(dir: string, text: string): Promise<string | null> {
  const ids = [...text.matchAll(LINE)].map((match) => match[1]!);
  if (ids.length === 0) return null;
  const kept = new Map<string, string>();
  for (const id of ids) {
    kept.set(id, await readFile(join(dir, "shown", `${id}.md`), "utf8").catch(() => "_This output of the Map's is no longer kept: ask for it again._"));
  }
  return text.replace(LINE, (_, id: string) => kept.get(id)!);
}

/** `text`, kept, then the line that shows it, with what Claude does with it. */
export async function withLine(dir: string, text: string): Promise<string> {
  return `${text}\n\nTo show the user all of the above, exactly as printed, write this line on its own in your reply:\n${await keepShown(dir, text)}`;
}
