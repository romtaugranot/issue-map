/**
 * Installing the status line (#40): a setup command writes it into the
 * user's Claude Code settings, wrapping a status line they already have.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installStatusLine, userSettings } from "../src/status/install.ts";

const ENTRY = "/opt/plugins/issue map/bin/issue-map-status-line";

/** A settings file in a directory of its own, holding `settings` when given. */
function settingsFile(settings?: string): string {
  const path = join(mkdtempSync(join(tmpdir(), "issue-map-settings-")), "settings.json");
  if (settings !== undefined) writeFileSync(path, settings);
  return path;
}

const read = (path: string) => JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;

test("installs the status line where there was none, creating the settings file, re-run every minute while the session is idle", async () => {
  const path = settingsFile();
  const said = await installStatusLine(path, ENTRY);
  assert.deepEqual(read(path), { statusLine: { type: "command", command: "'/opt/plugins/issue map/bin/issue-map-status-line'", refreshInterval: 60 } });
  assert.match(said, /^The status line is installed in .*settings\.json/);
});

test("keeps every other setting", async () => {
  const path = settingsFile(JSON.stringify({ model: "opus", permissions: { allow: ["Bash(npm test)"] } }));
  await installStatusLine(path, ENTRY);
  const settings = read(path);
  assert.deepEqual([settings.model, settings.permissions], ["opus", { allow: ["Bash(npm test)"] }]);
});

test("wraps a status line the user already has rather than replacing it, keeping its other fields", async () => {
  const path = settingsFile(JSON.stringify({ statusLine: { type: "command", command: "~/.claude/statusline.sh --short", padding: 2 } }));
  const said = await installStatusLine(path, ENTRY);
  assert.deepEqual(read(path).statusLine, {
    type: "command",
    command: "'/opt/plugins/issue map/bin/issue-map-status-line' --wrap '~/.claude/statusline.sh --short'",
    padding: 2,
  });
  assert.match(said, /wrapping yours/);
});

test("the wrapped command runs as the user's own did, quotes and all, then the Map's row", async () => {
  const path = settingsFile(JSON.stringify({ statusLine: { type: "command", command: `echo "it's mine"` } }));
  const entry = new URL("../bin/issue-map-status-line", import.meta.url).pathname;
  await installStatusLine(path, entry);
  const { command } = read(path).statusLine as { command: string };
  const outside = mkdtempSync(join(tmpdir(), "issue-map-elsewhere-"));
  const printed = execFileSync("sh", ["-c", command], { input: JSON.stringify({ workspace: { current_dir: outside } }) }).toString();
  assert.equal(printed, "it's mine\n", "outside a checkout, the Map adds no row");
});

test("installing it again changes nothing, and doesn't wrap it twice", async () => {
  const path = settingsFile(JSON.stringify({ statusLine: { type: "command", command: "my-status" } }));
  await installStatusLine(path, ENTRY);
  const once = readFileSync(path, "utf8");
  const said = await installStatusLine(path, ENTRY);
  assert.equal(readFileSync(path, "utf8"), once);
  assert.match(said, /already installed/);
});

test("installing it again from where the plugin now lives points it there, still wrapping the user's own", async () => {
  const path = settingsFile(JSON.stringify({ statusLine: { type: "command", command: "my-status", padding: 1 } }));
  await installStatusLine(path, "/opt/plugins/issue-map/0.1.0/bin/issue-map-status-line");
  const said = await installStatusLine(path, "/opt/plugins/issue-map/0.2.0/bin/issue-map-status-line");
  assert.deepEqual(read(path).statusLine, {
    type: "command",
    command: "'/opt/plugins/issue-map/0.2.0/bin/issue-map-status-line' --wrap 'my-status'",
    padding: 1,
  });
  assert.match(said, /now runs from/);
});

test("leaves a settings file it can't read as JSON alone, and says why", async () => {
  const path = settingsFile("{ not json");
  const said = await installStatusLine(path, ENTRY);
  assert.equal(readFileSync(path, "utf8"), "{ not json");
  assert.match(said, /^Didn't install the status line: .*settings\.json isn't JSON/);
});

test("the user's settings are in CLAUDE_CONFIG_DIR, or in ~/.claude", () => {
  assert.equal(userSettings({ CLAUDE_CONFIG_DIR: "/config/claude" }, "/home/fixture"), "/config/claude/settings.json");
  assert.equal(userSettings({}, "/home/fixture"), "/home/fixture/.claude/settings.json");
});
