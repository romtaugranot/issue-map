/**
 * The status line (ADR 0011): the Home Project's row, pinned under the prompt
 * as this plugin's own line, so nothing is written into the user's settings.
 * The row comes from the plugin's status line process, which reads only what
 * the background refresher keeps, so it never holds anything up.
 */
import type { Engine, Register } from "claude-code";

/** How often the row is worked out again while nothing else happens: the refresher keeps a new one every 90 s, and its age goes on growing. */
const EVERY_MS = 60_000;

/** Pins the row for where the session is, or takes the line away when there is none. */
async function pin($: Engine): Promise<void> {
  const ran = await $.process.run([`${$.plugin.root}/bin/issue-map-status-line`], { cwd: await $.session.cwd(), timeoutMs: 10_000 }).catch(() => null);
  $.ui.status(ran?.stdout.trim() || undefined);
}

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    void pin($);
    $.clock.every(EVERY_MS, () => pin($));
    return next(e);
  });
  // A turn may have drawn the Map, or moved the session to another checkout.
  on("turn.complete", async ($, e, next) => {
    void pin($);
    return next(e);
  });
};
