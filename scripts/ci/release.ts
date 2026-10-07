/**
 * The tree a release publishes, and what users install: only the plugin's
 * runtime parts, so it holds no package manifest or lockfile for Claude Code
 * to install npm dependencies from, and none of the tests (the hooks module's
 * included: CI copies it back in to run it), recorded
 * Snapshots, schemas or developer notes. The Release workflow commits it to
 * the `release` branch the marketplace entry names, and tags that commit
 * (docs/releasing.md).
 *
 * `node scripts/ci/release.ts <version> <dir>`: writes the tree of `version`
 * to `dir`, with the version in its plugin manifest, and prints the version's
 * release notes from CHANGELOG.md; with no section for it, fails.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** What the plugin runs from: launchers, hooks and the contract of what they keep, skill, source and manifest, and what a user reads. */
export const RUNTIME = ["bin", "hooks", "skills", "src", "types", ".claude-plugin/plugin.json", "LICENSE", "README.md", "SECURITY.md"];

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** Copies the committed runtime parts of the checkout at `root` to `dir`, the manifest saying `version`. */
export function releaseTree(root: string, version: string, dir: string): void {
  const files = execFileSync("git", ["ls-files", "-z", "--", ...RUNTIME], { cwd: root, encoding: "utf8" }).split("\0").filter((file) => file && !file.endsWith(".test.ts"));
  for (const file of files) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    copyFileSync(join(root, file), join(dir, file));
  }
  const manifest = join(dir, ".claude-plugin/plugin.json");
  writeFileSync(manifest, `${JSON.stringify({ ...JSON.parse(readFileSync(manifest, "utf8")), version }, null, 2)}\n`);
}

/** The section of `changelog` headed `## <version>`, without its heading. */
export function releaseNotes(changelog: string, version: string): string {
  const heading = new RegExp(`^## \\[?${version.replaceAll(".", "\\.")}\\]?(?![\\w.-])`);
  const lines = changelog.split("\n");
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) throw new Error(`CHANGELOG.md has no section headed "## ${version}"`);
  const end = lines.findIndex((line, i) => i > start && line.startsWith("## "));
  const notes = lines.slice(start + 1, end === -1 ? undefined : end).join("\n").trim();
  if (!notes) throw new Error(`CHANGELOG.md's section for ${version} is empty`);
  return `${notes}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [version, dir] = process.argv.slice(2);
  if (!version || !dir) throw new Error("usage: node scripts/ci/release.ts <version> <dir>");
  const notes = releaseNotes(readFileSync(join(ROOT, "CHANGELOG.md"), "utf8"), version);
  releaseTree(ROOT, version, dir);
  process.stdout.write(notes);
}
