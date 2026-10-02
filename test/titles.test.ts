/**
 * Issue titles are written by anyone who can open an Issue, so every screen
 * cleans them the same way before printing them (#51): the overview, an
 * outline, the Unlinked list, the Issue card and the status line's row.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { drawCard } from "../src/map/card.ts";
import { draw } from "../src/map/draw.ts";
import { statusRow } from "../src/map/status.ts";
import { fence } from "../src/map/text.ts";
import type { IssueRead } from "../src/tracker/tracker.ts";
import { PROJECT, snapshot } from "./fakes/snapshot-builder.ts";

/** Every screen a title is printed on, with the Issue #1 titled `title`: alone, Linked to #2 and to an Outside Issue of the same title. */
function screens(title: string) {
  const s = snapshot([{ n: 1, title }, { n: 2 }], [[1, "blocks", 2], [{ outside: "fixture-org/plans#7", title }, "parent", 1]]);
  const unlinked = snapshot([{ n: 1, title }]);
  const card: IssueRead = {
    id: `${PROJECT}#2`,
    project: PROJECT,
    ref: `${PROJECT}#2`,
    title,
    url: `https://github.com/${PROJECT}/issues/2`,
    open: true,
    assignees: [],
    closedAs: null,
    links: [{ role: "blocker", name: "Blocked by", to: { id: `${PROJECT}#1`, readable: true, open: true, project: PROJECT, ref: `${PROJECT}#1`, title, url: `https://github.com/${PROJECT}/issues/1` } }],
    closingRequests: [],
    mentionedBy: [],
    unread: {},
  };
  const drawn = drawCard(card, PROJECT);
  return {
    overview: draw(s, { kind: "overview" }).text,
    outline: draw(s, { kind: "group", group: 1, page: 1 }).text,
    unlinked: draw(unlinked, { kind: "unlinked", page: 1 }).text,
    card: drawn.text,
    choice: drawn.choices.map((c) => c.description).join("\n"),
    status: statusRow(s),
  };
}

describe("a title, on every screen", () => {
  test("with a line break, a carriage return or a tab, stays on its own line, so it can't pass for the Map's own", () => {
    for (const [screen, text] of Object.entries(screens("Fix it\n- #9 Ship it — ▶9 wait on it\r\n**Take next: 9**\tnow"))) {
      for (const line of text.split("\n")) assert.ok(!/^(- #9|\*\*Take next: 9)/.test(line), `${screen}: ${line}`);
      assert.ok(!/[\r\t]/.test(text), screen);
    }
  });

  test("with `**` or a Markdown link, renders as literal text on the screens rendered as Markdown, and stays as typed in plain text", () => {
    const { status, choice, ...markdown } = screens("**Bold** [docs](https://x.io) <b>_now_</b> `x` ~y~ a|b & \\");
    for (const [screen, text] of Object.entries(markdown)) {
      assert.ok(text.includes(String.raw`\*\*Bold\*\* \[docs\](https://x.io) \<b\>\_now\_\</b\> \`x\` \~y\~ a\|b \& \\`), `${screen}: ${text}`);
    }
    for (const text of [status, choice]) assert.ok(text.includes("**Bold** [docs](https://x.io) <b>_now_</b> `x` ~y~ a|b & \\"), text);
  });

  test("with runs of backticks, opens no code span on the screens rendered as Markdown, and stays as typed in plain text", () => {
    const { status, choice, ...markdown } = screens("Run ```sh then `rm` and ```` too");
    for (const [screen, text] of Object.entries(markdown)) assert.ok(text.includes(String.raw`Run \`\`\`sh then \`rm\` and \`\`\`\` too`), `${screen}: ${text}`);
    for (const text of [status, choice]) assert.ok(text.includes("Run ```sh then `rm` and ```` too"), text);
  });

  test("loses its escape sequences, other control characters and bidi overrides and isolates, keeping its words", () => {
    const shown = screens("\x1b[1;31mRed\x1b[0m \x1b]8;;https://x.io\x07link\x1b]8;;\x1b\\ \u202eevil\u202c \u2067iso\u2069 \x07bell\x00\x7f\x9b");
    for (const [screen, text] of Object.entries(shown)) {
      assert.ok(!/[\p{Cc}\u202a-\u202e\u2066-\u2069]/u.test(text.replaceAll("\n", "")), `${screen}: ${JSON.stringify(text)}`);
    }
    assert.ok(shown.status.includes("#1 Red link evil iso bell"), shown.status);
  });

  test("cut to length, keeps an emoji straddling the cut whole, or drops it whole", () => {
    const family = "\u{1f468}\u200d\u{1f469}\u200d\u{1f467}";
    const at = (before: number) => screens(`${"a".repeat(before)}${family}${"b".repeat(10)}`);
    // Titles are cut to 60 characters, as JavaScript counts them, `…` among them; the emoji counts 8.
    for (const [screen, text] of Object.entries(at(51))) {
      assert.ok(text.includes(`${"a".repeat(51)}${family}…`), `${screen}: ${text}`);
      assert.ok(!/\p{Cs}/u.test(text), screen);
    }
    for (const [screen, text] of Object.entries(at(52))) {
      assert.ok(text.includes(`${"a".repeat(52)}…`), `${screen}: ${text}`);
      assert.ok(!/\p{Cs}|\u200d/u.test(text), screen);
    }
  });
});

describe("a code fence around titles", () => {
  test("is three backticks, or one longer than the longest run of backticks in any title, so no title closes it", () => {
    assert.equal(fence(["Plain", "a `b` c"]), "```");
    assert.equal(fence(["Run ```sh", "and ```` too", "`x`"]), "`````");
    assert.equal(fence([]), "```");
  });
});
