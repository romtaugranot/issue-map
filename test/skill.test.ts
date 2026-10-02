/**
 * The Map skill's allowed-tools (#78): every read-only command the skill runs
 * is pre-allowed, and no write matches, so assigning, confirming Link
 * Suggestions and removing an old status line still prompt.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SKILL = readFileSync(new URL("../skills/map/SKILL.md", import.meta.url), "utf8");
const [, frontmatter = "", body = ""] = SKILL.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/) ?? [];

/** The `Bash(...)` rules under `allowed-tools:`, a YAML list. */
const rules = (frontmatter.match(/^allowed-tools:\n((?: {2}- .*\n?)+)/m)?.[1] ?? "")
  .split("\n")
  .filter(Boolean)
  .map((line) => line.replace(/^ {2}- /, "").match(/^Bash\((.*)\)$/)?.[1] ?? assert.fail(`not a Bash rule: ${line}`));

/** Claude Code's Bash rule matching: `*` stands for any text, and a trailing ` *`, the only wildcard, also matches the bare command. */
function allows(rule: string, command: string): boolean {
  const pattern = rule.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[\\s\\S]*");
  const bare = rule.endsWith(" *") && rule.indexOf("*") === rule.length - 1 && command === rule.slice(0, -2);
  return bare || new RegExp(`^${pattern}$`).test(command);
}
const allowed = (command: string) => rules.some((rule) => allows(rule, command));

/** Every command the skill tells Claude to run, its placeholders filled in as Claude would. */
const commands = [...body.matchAll(/`(issue-map [^`]*)`/g)].map(([, command]) =>
  command!.replace(/<n>/g, "2").replace(/'<[^>]*>'/g, "'#12'"),
);
const OFFER = "issue-map offer <<'EOF'\n[{\"from\": \"#12\", \"kind\": \"blocks\", \"to\": \"#5\", \"quote\": \"Blocked by #12\", \"source\": \"#5\"}]\nEOF";
const isWrite = (command: string) => /^issue-map (assign|confirm)\b|^issue-map statusline .*--remove\b/.test(command);

test("every read-only command the skill runs is pre-allowed, so moving from card to card raises no prompt", () => {
  const reads = [...commands.filter((command) => !isWrite(command)), OFFER, "issue-map groups", "issue-map groups --page 2", "issue-map next", "issue-map next --page 2", "issue-map taken", "issue-map taken --page 2", "issue-map issue '#12' --page 2", "issue-map map --pick 'https://github.com/o/r'"];
  assert.ok(reads.includes("issue-map issue '#12'"));
  for (const command of reads) assert.ok(allowed(command), `${command} would prompt`);
});

test("assigning, confirming Link Suggestions and removing an old status line still prompt", () => {
  const writes = [
    ...commands.filter(isWrite),
    "issue-map assign '#12' --pick 'https://github.com/o/r'",
    "issue-map statusline --pick 'https://github.com/o/r' --remove",
  ];
  for (const verb of ["assign '#12'", "confirm", "confirm 1 3", "statusline --remove"]) assert.ok(writes.includes(`issue-map ${verb}`), verb);
  for (const command of writes) assert.ok(!allowed(command), `${command} is pre-allowed`);
});
