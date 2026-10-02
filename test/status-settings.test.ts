/**
 * The status line 0.1.0 wrote into the user's Claude Code settings (#40),
 * wrapping a status line they already had (#50, #56). The plugin now pins its
 * own line (ADR 0011), so nothing installs one any more: an old one is told
 * apart, and removing it puts back the one it wrapped.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdtempSync, readFileSync, readlinkSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hasOldStatusLine, removeStatusLine, userSettings } from "../src/status/settings.ts";

const ENTRY = "'/opt/plugins/issue map/0.1.0/bin/issue-map-status-line'";

/** The status line as 0.1.0 installed it: its row alone, or wrapping `theirs`. */
function installed(theirs?: string): { type: string; command: string; refreshInterval?: number } {
  if (theirs === undefined) return { type: "command", command: ENTRY, refreshInterval: 60 };
  const quoted = `'${theirs.replaceAll("'", `'\\''`)}'`;
  return { type: "command", command: `${ENTRY} --wrap ${quoted} 2>/dev/null || sh -c ${quoted}` };
}

/** A settings file in a directory of its own, holding `settings` when given. */
function settingsFile(settings?: string): string {
  const path = join(mkdtempSync(join(tmpdir(), "issue-map-settings-")), "settings.json");
  if (settings !== undefined) writeFileSync(path, settings);
  return path;
}

const read = (path: string) => JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;

test("tells a status line 0.1.0 set up, wrapping one or not, from the user's own or none", async () => {
  assert.equal(await hasOldStatusLine(settingsFile(JSON.stringify({ statusLine: installed() }))), true);
  assert.equal(await hasOldStatusLine(settingsFile(JSON.stringify({ statusLine: installed("my-status") }))), true);
  for (const settings of [undefined, "", "{ not json", JSON.stringify({ statusLine: { type: "command", command: "my-status" } })]) {
    assert.equal(await hasOldStatusLine(settingsFile(settings)), false, String(settings));
  }
});

test("removing it puts back the status line it wrapped, byte for byte, keeping its other fields and every other setting", async () => {
  const theirs = `~/bin/status --sep ' | ' "it's \\"mine\\""`;
  const path = settingsFile(JSON.stringify({ model: "opus", statusLine: { ...installed(theirs), padding: 2 } }));
  const said = await removeStatusLine(path);
  assert.deepEqual(read(path), { model: "opus", statusLine: { type: "command", command: theirs, padding: 2 } });
  assert.match(said, /yours is back as it was/);
});

test("removing one in the form #50 wrote still puts back the status line it wrapped", async () => {
  const path = settingsFile(JSON.stringify({ statusLine: { type: "command", command: `${ENTRY} --wrap 'my-status'` } }));
  await removeStatusLine(path);
  assert.deepEqual(read(path), { statusLine: { type: "command", command: "my-status" } });
});

test("removing it deletes the status line setting when the Map's row was all there was", async () => {
  const path = settingsFile(JSON.stringify({ model: "opus", statusLine: installed() }));
  const said = await removeStatusLine(path);
  assert.deepEqual(read(path), { model: "opus" });
  assert.match(said, /^The status line is removed from .*settings\.json/);
});

test("removing it when it isn't installed changes nothing, and says so", async () => {
  for (const settings of [undefined, `{"statusLine": {"type": "command", "command": "my-status"}}`]) {
    const path = settingsFile(settings);
    const said = await removeStatusLine(path);
    assert.equal(existsSync(path) ? readFileSync(path, "utf8") : undefined, settings);
    assert.match(said, /isn't installed in .*; nothing changed/);
  }
});

test("removing a status line of the Map's that was changed by hand leaves it alone, and says why", async () => {
  const path = settingsFile(JSON.stringify({ statusLine: { type: "command", command: `${ENTRY} --wrap 'my-status' --extra` } }));
  const before = readFileSync(path, "utf8");
  const said = await removeStatusLine(path);
  assert.equal(readFileSync(path, "utf8"), before);
  assert.match(said, /^Didn't remove the status line: .*Nothing changed\.$/);
});

test("leaves a settings file it can't read as JSON alone, and says why", async () => {
  const path = settingsFile("{ not json");
  const said = await removeStatusLine(path);
  assert.equal(readFileSync(path, "utf8"), "{ not json");
  assert.match(said, /^Didn't remove the status line: .*settings\.json isn't JSON/);
});

test("a symlinked settings file is written through, keeping the link", async () => {
  const target = settingsFile(JSON.stringify({ model: "opus", statusLine: installed() }));
  const link = join(mkdtempSync(join(tmpdir(), "issue-map-dotfiles-")), "settings.json");
  symlinkSync(target, link);
  await removeStatusLine(link);
  assert.equal(readlinkSync(link), target);
  assert.ok(lstatSync(link).isSymbolicLink());
  assert.deepEqual(read(target), { model: "opus" });
});

test("an empty settings file counts as empty settings", async () => {
  for (const empty of ["", "\n  \n"]) {
    const path = settingsFile(empty);
    assert.match(await removeStatusLine(path), /isn't installed/);
    assert.equal(readFileSync(path, "utf8"), empty);
  }
});

test("the user's settings are in CLAUDE_CONFIG_DIR, or in ~/.claude", () => {
  assert.equal(userSettings({ CLAUDE_CONFIG_DIR: "/config/claude" }, "/home/fixture"), "/config/claude/settings.json");
  assert.equal(userSettings({}, "/home/fixture"), "/home/fixture/.claude/settings.json");
});
