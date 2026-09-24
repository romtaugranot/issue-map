/**
 * The status line's process (#40), as Claude Code runs it after each
 * message, with the session's JSON on standard input.
 *
 * `issue-map-status-line [--wrap <command>]`: prints the Map's row for the
 * checkout the session is in. `--wrap` runs the user's own status line
 * command through the shell with the same standard input, beside working
 * out the row, and prints its rows first. It always exits 0 and prints no
 * error: a status line has nowhere to show one.
 */
import { spawn } from "node:child_process";
import { checkoutRoot } from "./home/checkout.ts";
import { snapshotStore } from "./snapshot/store.ts";
import { lastHomeOf, stateDir } from "./state.ts";
import { statusLine } from "./status/line.ts";

async function main(argv: string[]): Promise<void> {
  const wrap = argv[0] === "--wrap" ? argv[1] : undefined;
  const input = await stdin();
  const [theirs, ours] = await Promise.all([
    wrap === undefined ? "" : shell(wrap, input),
    statusLine({ checkoutRoot, lastHome: (root) => lastHomeOf(root).get(), store: snapshotStore(stateDir(), { now: Date.now }) }, directoryIn(input)).catch(() => ""),
  ]);
  const rows = [theirs.replace(/\n+$/, ""), ours].filter(Boolean);
  if (rows.length > 0) process.stdout.write(`${rows.join("\n")}\n`);
}

/** The directory the session is in, as Claude Code gives it; where this runs when it gives none. */
function directoryIn(input: string): string {
  try {
    const session = JSON.parse(input) as { workspace?: { current_dir?: unknown }; cwd?: unknown };
    const dir = session.workspace?.current_dir ?? session.cwd;
    if (typeof dir === "string" && dir) return dir;
  } catch {
    // Not JSON: fall back to where this runs.
  }
  return process.cwd();
}

/** What `command` prints, run through the shell with `input` on its standard input; whatever it printed when it fails. */
function shell(command: string, input: string): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(command, { shell: true, stdio: ["pipe", "pipe", "ignore"] });
    let stdout = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.on("error", () => resolve(stdout));
    child.on("close", () => resolve(stdout));
    // A command that doesn't read its input closes it early.
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

async function stdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

await main(process.argv.slice(2)).catch(() => {});
process.exitCode = 0;
