import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { accessSync, constants, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { releaseNotes, releaseTree } from "../scripts/ci/release.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

/** A release tree of the checkout, under a directory whose package.json says CommonJS, as a user's home might. */
function built(): string {
  const parent = mkdtempSync(join(tmpdir(), "issue-map-release-"));
  writeFileSync(join(parent, "package.json"), '{ "type": "commonjs" }\n');
  releaseTree(ROOT, "1.2.3", join(parent, "tree"));
  return join(parent, "tree");
}

test("the release tree holds only the plugin's runtime parts: no package manifest, lockfile, tests, Snapshots, schemas or developer notes", () => {
  const tree = built();
  assert.deepEqual(readdirSync(tree).sort(), [".claude-plugin", "LICENSE", "README.md", "SECURITY.md", "bin", "hooks", "skills", "src", "types"]);
  assert.deepEqual(readdirSync(join(tree, ".claude-plugin")), ["plugin.json"]);
  const everything = readdirSync(tree, { recursive: true, encoding: "utf8" });
  assert.deepEqual(everything.filter((path) => /(^|\/)(package-lock\.json|node_modules|test|CLAUDE\.md|.*\.test\.ts)$/.test(path)), []);
});

test("the release tree's manifest carries the version released", () => {
  const manifest = JSON.parse(readFileSync(join(built(), ".claude-plugin/plugin.json"), "utf8"));
  assert.equal(manifest.version, "1.2.3");
  assert.equal(manifest.name, "issue-map");
});

test("the release tree runs as it is, with nothing installed, whatever package.json lies above it", () => {
  const tree = built();
  for (const launcher of readdirSync(join(tree, "bin"))) accessSync(join(tree, "bin", launcher), constants.X_OK);
  const run = spawnSync(join(tree, "bin/issue-map"), [], { encoding: "utf8" });
  assert.match(run.stdout + run.stderr, /^usage: issue-map map/m);
  assert.doesNotMatch(run.stderr, /Warning|SyntaxError/);
});

test("a release's notes are its section of the changelog", () => {
  const changelog = "# Changelog\n\nIntro.\n\n## 1.2.3 — 2026-10-02\n\n- Fixed a thing.\n\n## 1.2.30\n\n- Not this.\n\n## 1.2.2\n\n- Nor this.\n";
  assert.equal(releaseNotes(changelog, "1.2.3"), "- Fixed a thing.\n");
  assert.equal(releaseNotes(changelog, "1.2.30"), "- Not this.\n");
  assert.throws(() => releaseNotes(changelog, "1.2.4"), /no section headed "## 1.2.4"/);
  assert.throws(() => releaseNotes("## 1.2.3\n\n## 1.2.2\n- x\n", "1.2.3"), /empty/);
});

test("the marketplace installs the plugin from the release branch over HTTPS, so a commit on main reaches nobody until it's released, and installing needs no GitHub SSH key", () => {
  const marketplace = JSON.parse(readFileSync(join(ROOT, ".claude-plugin/marketplace.json"), "utf8"));
  const manifest = JSON.parse(readFileSync(join(ROOT, ".claude-plugin/plugin.json"), "utf8"));
  assert.deepEqual(marketplace.plugins.map((p: { source: unknown }) => p.source), [
    { source: "url", url: `${manifest.repository}.git`, ref: "release" },
  ]);
});
