/**
 * Seam A: the Issue card, `(Issue read live, the Map's Project) → (text,
 * choices)`, with no network and no clock.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { drawCard, type CardContext } from "../src/map/card.ts";
import type { FarEnd, IssueRead, NamedLink } from "../src/tracker/tracker.ts";

const PROJECT = "fixture-org/tools";

function read(n: number, more: Partial<IssueRead> = {}): IssueRead {
  return {
    id: `${PROJECT}#${n}`,
    project: PROJECT,
    ref: `${PROJECT}#${n}`,
    title: `Issue ${n}`,
    url: `https://github.com/${PROJECT}/issues/${n}`,
    open: true,
    assignees: [],
    closedAs: null,
    links: [],
    closingRequests: [],
    mentionedBy: [],
    unread: {},
    ...more,
  };
}

/** A Link to `#n` in the Project, or to `owner/name#n` elsewhere. */
function link(role: NamedLink["role"], name: string, at: number | string, more: { open?: boolean; title?: string; closedAs?: string } = {}): NamedLink {
  const [project, n] = typeof at === "number" ? [PROJECT, at] : (at.split("#") as [string, string]);
  const to: FarEnd = { id: `${project}#${n}`, readable: true, open: more.open ?? true, project, ref: `${project}#${n}`, title: more.title ?? `Issue ${n}`, url: `https://github.com/${project}/issues/${n}` };
  if (more.closedAs) to.closedAs = more.closedAs;
  return { role, name, to };
}

const card = (issue: IssueRead) => drawCard(issue, PROJECT);

describe("an Issue card", () => {
  test("shows the Issue's name and URL, whether it is Blocked, and its Links by kind under the Tracker's own names", () => {
    const issue = read(12, {
      title: "Import state from S3",
      links: [
        link("child", "Sub-issues", 14),
        link("parent", "Parent issue", 3, { title: "Plan the importer" }),
        link("blocker", "Blocked by", 5),
        link("child", "Sub-issues", 13),
      ],
    });
    assert.equal(
      card(issue).text,
      [
        "**#12 Import state from S3**",
        "https://github.com/fixture-org/tools/issues/12",
        "**Blocked** — 1 open Issue Blocks it · unassigned",
        "",
        "**Parent issue**",
        "- #3 Plan the importer",
        "**Blocked by**",
        "- #5 Issue 5",
        "**Sub-issues: 2**",
        "- #14 Issue 14",
        "- #13 Issue 13",
      ].join("\n"),
    );
  });

  test("offers every Link it shows as a choice, in the card's order, named by the reference that opens its card", () => {
    const issue = read(12, {
      links: [
        link("child", "Sub-issues", 14, { open: false }),
        link("parent", "Parent issue", "fixture-org/plans#7", { title: "Q3 importer epic" }),
        link("related", "Relates to", 20),
        link("blocked", "Blocking", 30),
      ],
    });
    const { text, choices } = card(issue);
    assert.deepEqual(choices, [
      { label: "fixture-org/plans#7", description: "Parent issue · ↗ Q3 importer epic" },
      { label: "#30", description: "Blocking · Issue 30" },
      { label: "#14", description: "Sub-issues · closed · Issue 14" },
      { label: "#20", description: "Relates to · Issue 20" },
    ]);
    assert.match(text, /^- ↗fixture-org\/plans#7 Q3 importer epic$/m);
    assert.match(text, /^- #14 Issue 14 — closed$/m);
  });

  test("shows a Link to an Issue this login can't read without a name, and offers no way to open it", () => {
    const hidden: NamedLink = { role: "parent", name: "Parent issue", to: { id: "hidden-1", readable: false } };
    const { text, choices } = card(read(12, { links: [hidden] }));
    assert.match(text, /^\*\*Parent issue\*\*\n- ↗ an Issue this login can't read$/m);
    assert.deepEqual(choices, []);
  });

  test("shows its open Closing Requests with their authors and URLs, and never offers one as a choice", () => {
    const issue = read(12, {
      closingRequests: [
        { ref: `${PROJECT}#40`, url: `https://github.com/${PROJECT}/pull/40`, draft: false, author: "fixture-bot" },
        { ref: `${PROJECT}#41`, url: `https://github.com/${PROJECT}/pull/41`, draft: true, author: "fixture-viewer" },
      ],
    });
    const { text, choices } = card(issue);
    assert.deepEqual(text.split("\n").slice(3), [
      "",
      "**Closing Requests: 2 open** — not Issues, so never followed",
      "- fixture-org/tools#40 by fixture-bot https://github.com/fixture-org/tools/pull/40",
      "- fixture-org/tools#41 by fixture-viewer, draft https://github.com/fixture-org/tools/pull/41",
    ]);
    assert.deepEqual(choices, []);
  });

  test("says when Closing Requests couldn't be read, rather than showing none", () => {
    const { text } = card(read(12, { unread: { closingRequests: "this login can't read pull requests" } }));
    assert.match(text, /^\*\*Closing Requests: unread\*\* — this login can't read pull requests$/m);
  });

  test("says when Mentions couldn't be read, rather than counting none", () => {
    const { text } = card(read(12, { unread: { mentions: "GitLab gave no answer for them" } }));
    assert.match(text, /^\*\*Mentions: unread\*\* — GitLab gave no answer for them$/m);
  });

  test("counts Mentions and points at Link Suggestions, never listing them as Links", () => {
    const issue = read(12, { links: [link("parent", "Parent issue", 3)], mentionedBy: [`${PROJECT}#3`, `${PROJECT}#8`, `fixture-org/plans#2`, `${PROJECT}#8`].map((id) => ({ id, ref: id })) });
    const { text, choices } = card(issue);
    assert.equal(text.split("\n").at(-1), "Mentioned by 2 other Issues — Mentions aren't Links. Ask for Link Suggestions to see whether any should be.");
    assert.deepEqual(choices.map((c) => c.label), ["#3"], "an Issue it's already Linked to isn't counted, and no Mention is a choice");
    assert.doesNotMatch(text, /#8|plans#2/);
  });

  test("shows 10 Links of a kind, open ones first, and `more` pages through the rest of every kind that has more", () => {
    const children = Array.from({ length: 25 }, (_, i) => link("child", "Sub-issues", 100 + i, { open: i >= 5 }));
    const blockers = Array.from({ length: 12 }, (_, i) => link("blocker", "Blocked by", 200 + i));
    const issue = read(12, { links: [link("parent", "Parent issue", 3), ...children, ...blockers] });
    const first = card(issue);
    const lines = first.text.split("\n");
    const ids = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);
    assert.deepEqual(lines.slice(6, 18), ["**Blocked by: 12**", ...ids(200, 210).map((n) => `- #${n} Issue ${n}`), "- … 2 more — `more` for the next 10"]);
    assert.deepEqual(lines.slice(18), ["**Sub-issues: 25**", ...ids(105, 115).map((n) => `- #${n} Issue ${n}`), "- … 15 more — `more` for the next 10"]);
    assert.equal(first.choices.length, 21, "every Link the card shows, and no more");

    const second = drawCard(issue, PROJECT, 2).text.split("\n");
    assert.deepEqual(second.slice(3), [
      "",
      "**Blocked by: 12** · 11–12",
      "- #210 Issue 210",
      "- #211 Issue 211",
      "**Sub-issues: 25** · 11–20",
      ...ids(115, 125).map((n) => `- #${n} Issue ${n}`),
      "- … 5 more — `more` for the next 10",
    ]);
    const third = drawCard(issue, PROJECT, 3);
    assert.deepEqual(third.text.split("\n").slice(4), ["**Sub-issues: 25** · 21–25", ...ids(100, 105).map((n) => `- #${n} Issue ${n} — closed`)]);
    assert.deepEqual(drawCard(issue, PROJECT, 4).text, third.text, "a page past the end shows the last page");
  });

  test("says it can't tell whether the Issue is Blocked when Blocks Links couldn't be read", () => {
    const { text } = card(read(12, { unread: { blocks: "this Tracker can't record Blocks" } }));
    assert.equal(text.split("\n")[2], "Blocked: can't tell — this Tracker can't record Blocks · unassigned");
  });

  test("a Link to an Issue that closed as a duplicate or as not planned says so, and one that closed as completed only that it closed", () => {
    const issue = read(12, {
      links: [
        link("blocker", "Blocked by", 5, { open: false, closedAs: "duplicate" }),
        link("blocker", "Blocked by", 6, { open: false, closedAs: "not planned" }),
        link("blocker", "Blocked by", 7, { open: false, closedAs: "completed" }),
      ],
    });
    const { text, choices } = card(issue);
    assert.deepEqual(text.split("\n").slice(4), ["**Blocked by: 3**", "- #5 Issue 5 — closed as duplicate", "- #6 Issue 6 — closed as not planned", "- #7 Issue 7 — closed"]);
    assert.deepEqual(choices.map((c) => c.description), ["Blocked by · closed as duplicate · Issue 5", "Blocked by · closed as not planned · Issue 6", "Blocked by · closed · Issue 7"]);
  });

  test("a Blocks Link from a closed Issue, or to an Issue it Blocks, leaves it not Blocked", () => {
    const { text } = card(read(12, { links: [link("blocker", "Blocked by", 5, { open: false }), link("blocked", "Blocking", 6)] }));
    assert.equal(text.split("\n")[2], "Not Blocked · unassigned");
  });

  test("says whom the Issue is assigned to, the viewer as you", () => {
    const line = (assignees: string[], viewer?: string) => drawCard(read(12, { assignees }), PROJECT, 1, viewer === undefined ? {} : { viewer }).text.split("\n")[2];
    assert.equal(line(["fixture-viewer"], "fixture-viewer"), "Not Blocked · assigned to you");
    assert.equal(line(["fixture-dev", "fixture-viewer"], "fixture-viewer"), "Not Blocked · assigned to you and fixture-dev");
    assert.equal(line(["fixture-dev", "fixture-bot"], "fixture-viewer"), "Not Blocked · assigned to fixture-dev and fixture-bot");
    assert.equal(line(["fixture-viewer"]), "Not Blocked · assigned to fixture-viewer", "with no viewer known, nobody is you");
  });
});

describe("assigning an Issue to yourself from its card", () => {
  const promised: CardContext = { viewer: "fixture-viewer", writes: { product: "GitHub", band: { kind: "promised" }, write: { kind: "can" } } };
  const offer = (issue: IssueRead, context: CardContext = promised) => drawCard(issue, PROJECT, 1, context).assign;

  test("an unassigned Issue's card offers to assign it to the viewer, naming the write", () => {
    assert.deepEqual(offer(read(12)), { label: "Assign #12 to me", description: "writes to GitHub: assigns #12 to fixture-viewer", ref: "#12" });
  });

  test("where the Tracker can't say whether this login may write, it's offered anyway, saying it stops at the first refusal", () => {
    const unsure: CardContext = { ...promised, writes: { ...promised.writes!, write: { kind: "cant-tell", reason: "this login's token doesn't list what it may write" } } };
    assert.deepEqual(offer(read(12), unsure), {
      label: "Assign #12 to me",
      description: "writes to GitHub: assigns #12 to fixture-viewer. GitHub doesn't say whether this login may (this login's token doesn't list what it may write), so it stops at the first refusal",
      ref: "#12",
    });
  });

  test("isn't offered on a Best effort or a Refused Project, which the Map never writes to", () => {
    const at = (band: NonNullable<CardContext["writes"]>["band"]) => offer(read(12), { ...promised, writes: { ...promised.writes!, band } });
    assert.equal(at({ kind: "best-effort", untested: "GHES 3.17.4 is older than 3.18" }), undefined);
    assert.equal(at({ kind: "refused", reason: "Refused — the Map can read no Link kind here." }), undefined);
  });

  test("isn't offered where this login can't write, where the Tracker wasn't asked, or with no viewer known", () => {
    assert.equal(offer(read(12), { ...promised, writes: { ...promised.writes!, write: { kind: "cant", reason: "this login can only read fixture-org/tools" } } }), undefined);
    assert.equal(offer(read(12), { viewer: "fixture-viewer" }), undefined);
    assert.equal(offer(read(12), { writes: promised.writes! }), undefined);
  });

  test("isn't offered for an Issue someone is assigned to, a closed Issue, or an Outside Issue", () => {
    assert.equal(offer(read(12, { assignees: ["fixture-dev"] })), undefined);
    assert.equal(offer(read(12, { assignees: ["fixture-viewer"] })), undefined);
    assert.equal(offer(read(12, { open: false, closedAs: "completed" })), undefined);
    assert.equal(offer({ ...read(7), project: "fixture-org/plans", ref: "fixture-org/plans#7" }), undefined);
  });
});

describe("starting work on an Issue from its card", () => {
  const offer = (issue: IssueRead, context: CardContext = {}) => drawCard(issue, PROJECT, 1, context).start;

  test("an open Issue's card offers to start work on it, saying what that does and doesn't do", () => {
    assert.deepEqual(offer(read(12)), { label: "Start work on #12", description: "reads its body and comments to brief you; makes no branch and opens no editor", ref: "#12" });
  });

  test("is offered whoever the Issue is assigned to, and on every band, since it writes nothing", () => {
    assert.equal(offer(read(12, { assignees: ["fixture-dev"] }))?.ref, "#12");
    assert.equal(offer(read(12), { viewer: "fixture-viewer", writes: { product: "GitHub", band: { kind: "best-effort", untested: "GHES 3.17.4 is older than 3.18" }, write: { kind: "cant", reason: "read-only" } } })?.ref, "#12");
  });

  test("is offered on every page of the card", () => {
    const links = Array.from({ length: 12 }, (_, i) => link("child", "Sub-issues", 20 + i));
    assert.equal(drawCard(read(12, { links }), PROJECT, 2).start?.ref, "#12");
  });

  test("an open Outside Issue's card offers it too, by its full reference, since it only reads", () => {
    assert.equal(offer({ ...read(7), project: "fixture-org/plans", ref: "fixture-org/plans#7" })?.ref, "fixture-org/plans#7");
  });

  test("isn't offered for a closed Issue", () => {
    assert.equal(offer(read(12, { open: false, closedAs: "completed" })), undefined);
    assert.equal(offer({ ...read(7), project: "fixture-org/plans", ref: "fixture-org/plans#7", open: false, closedAs: "completed" }), undefined);
  });
});

describe("a reduced card", () => {
  const busy = {
    links: [link("parent", "Parent issue", 3), link("blocker", "Blocked by", 5)],
    closingRequests: [{ ref: `${PROJECT}#40`, url: `https://github.com/${PROJECT}/pull/40`, draft: false, author: "fixture-bot" }],
    mentionedBy: [{ id: `${PROJECT}#8`, ref: `${PROJECT}#8` }],
  };

  test("an Outside Issue's card shows its name, URL and state, and no Links, since the Map hasn't read its Project", () => {
    const outside = { ...read(7, busy), project: "fixture-org/plans", ref: "fixture-org/plans#7", title: "Q3 importer epic", url: "https://github.com/fixture-org/plans/issues/7" };
    assert.deepEqual(card(outside), {
      text: [
        "**↗fixture-org/plans#7 Q3 importer epic**",
        "https://github.com/fixture-org/plans/issues/7",
        "Open · an Outside Issue, in fixture-org/plans. The Map hasn't read that Project, so this card shows none of its Links.",
      ].join("\n"),
      choices: [],
      start: { label: "Start work on ↗fixture-org/plans#7", description: "reads its body and comments to brief you; makes no branch and opens no editor", ref: "fixture-org/plans#7" },
      move: {
        label: "Open fixture-org/plans's Map",
        description: "on this Issue's card there, which shows its Links",
        target: "https://github.com/fixture-org/plans/issues/7",
      },
    });
  });

  test("a closed Issue's card shows its name, URL and how it closed, and no Links, since closed Issues aren't on the Map", () => {
    assert.deepEqual(card(read(10, { ...busy, open: false, closedAs: "not planned" })), {
      text: [
        "**#10 Issue 10**",
        "https://github.com/fixture-org/tools/issues/10",
        "Closed as not planned. A closed Issue isn't on the Map, so this card shows none of its Links.",
      ].join("\n"),
      choices: [],
    });
  });

  test("a closed Outside Issue's card says both", () => {
    const outside = { ...read(7), project: "fixture-org/plans", ref: "fixture-org/plans#7", open: false, closedAs: "completed" };
    assert.equal(card(outside).text.split("\n")[2], "Closed as completed · an Outside Issue, in fixture-org/plans. The Map hasn't read that Project, so this card shows none of its Links.");
  });
});
