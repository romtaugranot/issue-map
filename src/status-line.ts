/**
 * The status line's process (ADR 0011), as the plugin's hooks module runs it
 * in the directory the session is in.
 *
 * `issue-map-status-line`: prints the Map's row for the checkout it runs in,
 * saying how to take out a status line 0.1.0 set up while one is still in the
 * user's settings. It always exits 0 and prints no error: a status line has
 * nowhere to show one.
 */
import { hasOldStatusLine, userSettings } from "./status/settings.ts";
import { homeRowHere } from "./status/line.ts";

async function main(): Promise<void> {
  const [row, old] = await Promise.all([homeRowHere(process.cwd()), hasOldStatusLine(userSettings())]);
  if (row) process.stdout.write(`${row}${old ? " · say “take the Map out of my status line” to remove the old one" : ""}\n`);
}

await main().catch(() => {});
process.exitCode = 0;
