/**
 * The Issue Map pane (ADR 0014), run by `claude plugin test` on the release
 * tree with this file copied in: the plugin's CLI is stood in for, printing
 * the README's small fixture Project as `issue-map pane` would, and every
 * screen is drawn on the terminal and on the desktop.
 */
import { expect, mock, test, type Engine } from "claude-code/testing";
import type { On, RenderPropsOf } from "claude-code";

/** What `issue-map pane` prints for the fixture: Groups headed by #4, #1 and an Outside Issue; #1, #7, #9 and #12 in Take next; #6 assigned. */
const PRINTED = String.raw`{"map":{"project":"fixture-org/tools","projectUrl":"https://github.com/fixture-org/tools","tracker":"github.com","readAt":"2026-09-23T00:00:00Z","open":12,"onMap":8,"band":"Promised","notes":[],"next":{"head":"Take next: 4","why":"most waited on first","picks":[{"issue":0,"line":"#1 Lay the foundation — ▶2 wait on it","why":"2 wait on it"},{"issue":6,"line":"#7 Proofread the release notes — via #5","why":"via #5"},{"issue":8,"line":"#9 Remove the compatibility shims — unblocked 2d ago","why":"unblocked 2d ago"},{"issue":10,"line":"#12 Drop the legacy flag — unblocked 2d ago","why":"unblocked 2d ago"}],"taken":[{"issue":5,"line":"#6 Tag the build — via #4 · assigned to someone","why":"via #4 · assigned to someone"}]},"groups":[{"head":3,"size":4,"unblocked":2,"outside":1,"top":[3],"below":[3,4,0,3,5,0,3,12,0,4,6,0]},{"head":0,"size":3,"unblocked":1,"outside":0,"top":[0],"below":[0,1,1,1,2,1]},{"head":13,"size":1,"unblocked":0,"outside":1,"top":[13],"below":[13,7,1]}],"unlinked":[11,10,9,8],"issues":[{"ref":"#1","title":"Lay the foundation","url":"https://github.com/fixture-org/tools/issues/1","unblocked":true,"next":1},{"ref":"#2","title":"Build the walls","url":"https://github.com/fixture-org/tools/issues/2"},{"ref":"#3","title":"Put on the roof","url":"https://github.com/fixture-org/tools/issues/3"},{"ref":"#4","title":"Plan the release","url":"https://github.com/fixture-org/tools/issues/4"},{"ref":"#5","title":"Write the release notes","url":"https://github.com/fixture-org/tools/issues/5"},{"ref":"#6","title":"Tag the build","url":"https://github.com/fixture-org/tools/issues/6","unblocked":true},{"ref":"#7","title":"Proofread the release notes","url":"https://github.com/fixture-org/tools/issues/7","unblocked":true,"next":2},{"ref":"#8","title":"Use the shared config","url":"https://github.com/fixture-org/tools/issues/8"},{"ref":"#9","title":"Remove the compatibility shims","url":"https://github.com/fixture-org/tools/issues/9","unblocked":true,"next":3},{"ref":"#11","title":"Keep the old parser working","url":"https://github.com/fixture-org/tools/issues/11"},{"ref":"#12","title":"Drop the legacy flag","url":"https://github.com/fixture-org/tools/issues/12","unblocked":true,"next":4},{"ref":"#13","title":"Document the new layout","url":"https://github.com/fixture-org/tools/issues/13"},{"ref":"↗issue-map-fixtures/site#1","title":"Update the website for the release","url":"https://github.com/issue-map-fixtures/site/issues/1"},{"ref":"↗issue-map-fixtures-b/elsewhere#1","title":"Publish the shared config","url":"https://github.com/issue-map-fixtures-b/elsewhere/issues/1"}],"because":["2 wait on it","A first step of #5","Its blocker closed 2d ago","Its blocker closed 2d ago"],"links":[[{"role":"blocked","to":1,"ref":"#2","title":"Issue 2","open":true}],[{"role":"blocker","to":0,"ref":"#1","title":"Issue 1","open":true},{"role":"blocked","to":2,"ref":"#3","title":"Issue 3","open":true}],[{"role":"blocker","to":1,"ref":"#2","title":"Issue 2","open":true}],[{"role":"child","to":4,"ref":"#5","title":"Issue 5","open":true},{"role":"child","to":5,"ref":"#6","title":"Issue 6","open":true},{"role":"child","to":12,"ref":"↗issue-map-fixtures/site#1","title":"Update the website for the release","open":true}],[{"role":"parent","to":3,"ref":"#4","title":"Issue 4","open":true},{"role":"child","to":6,"ref":"#7","title":"Issue 7","open":true}],[{"role":"parent","to":3,"ref":"#4","title":"Issue 4","open":true}],[{"role":"parent","to":4,"ref":"#5","title":"Issue 5","open":true}],[{"role":"blocker","to":13,"ref":"↗issue-map-fixtures-b/elsewhere#1","title":"Publish the shared config","open":true}],[{"role":"blocker","ref":"#20","title":"Issue 20","open":false}],[],[{"role":"blocker","ref":"#21","title":"Issue 21","open":false}],[]],"assigned":[5]}}`;

const SURFACES = ["terminal", "desktop"] as const;

/** The plugin's CLI, as it runs on any machine: its launcher, or Node on its source. */
const cliArgs = (argv: readonly string[]) => (argv[0]!.endsWith("/bin/issue-map") ? argv.slice(1) : argv[0] === "node" && argv[1]?.endsWith("/src/cli.ts") ? argv.slice(2) : null);

/** Answers each run of the CLI with `printed`, after the first with the next of `later` while there is one, and records what ran, what the pane opened, and what it handed Claude. */
function world(on: On, printed = PRINTED, later: string[] = []) {
  const ran: (readonly string[])[] = [];
  const opened: string[] = [];
  const submitted: string[] = [];
  const filled: string[] = [];
  on("session.cwd", () => ({ value: "/work/checkout" }));
  on("session.id", () => ({ value: "session-1" }));
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  on("command.register", (_$, e) => ({ value: { command: e.name } }));
  on("turn.complete", (_$, e) => ({ text: e.answer }));
  const clock = mock.clock(on);
  on("ui.status", () => ({ value: undefined }));
  on("ui.open", (_$, e) => (opened.push(e.focus ? `${e.id}, focused` : e.id), { value: { isPlaced: true as const } }));
  on("ui.panes", () => ({ value: [...new Set(opened.map((id) => id.split(",")[0]!))].map((id) => ({ id, title: "Issue Map", isShown: true, isFocused: false, isPlaced: true })) }));
  on("prompt.submit", (_$, e) => (submitted.push(e.text), { text: e.text }));
  on("prompt.fill", (_$, e) => (filled.push(e.text), { isFilled: true }));
  on("process.run", (_$, e) => {
    const args = cliArgs(e.argv);
    const done = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: "", isStdoutTruncated: false, isStderrTruncated: false } });
    if (!args) return done("");
    ran.push(args);
    return done(`${ran.length > 1 && later.length > 0 ? later.shift()! : printed}\n`);
  });
  return { ran, opened, submitted, filled, clock };
}

const start = ($: Engine) => $.session.start({ cwd: "/work/checkout", surface: "terminal", isInteractive: true });
/** Runs `/issue-map` with `args`, and lets what it set going, such as a read, finish. */
async function command($: Engine, clock: { settle: () => Promise<void> }, args: string) {
  const ran = await $.command.run({ command: "issue-map", args, origin: { kind: "composer" }, presentation: { isFullscreen: true, columns: 160 } });
  await clock.settle();
  return ran;
}
const turnEnds = ($: Engine) => $.turn.complete({ answer: "", durationMs: 1, isAborted: false, turnId: "t1", reason: "answer" });

/** A pane docked beside the transcript, 52 cells across and 30 down. */
const PANE: RenderPropsOf["Pane"] = { title: "Issue Map", isFocused: true, bodyColumns: 52, placement: "dock", scroll: { offset: 0, bodyRows: 30 }, view: {} };
const mount = ($: Engine, surface: (typeof SURFACES)[number]) =>
  $.ui.mount({ plugin: "issue-map", surface, component: "Pane", requestId: "map", props: PANE, viewport: { columns: 160, rows: 40, isFullscreen: true } });

type Found = { text: string; props: { props?: { text?: string; to?: unknown } } };
type Drawn = { findAll: (q: { type?: string }) => Promise<Found[]>; find: (q: { type?: string; key?: string }) => Promise<Found | undefined> };

/** Every text the drawing shows, in order, the desktop's links' included. */
async function shown(ui: Drawn): Promise<string> {
  const found = [...(await ui.findAll({ type: "Text" })), ...(await ui.findAll({ type: "Markdown" })), ...(await ui.findAll({ type: "Button" }))].map((t) => t.text);
  const links = (await ui.findAll({ type: "Client" })).map((c) => c.props.props?.text ?? "");
  return [...found, ...links].join(" | ");
}

/** Opens what a row or a Link shows: its Button on the terminal; on the desktop its link, which posts the screen it leads to. */
async function open(ui: Drawn & { press: (t: { key: string }) => Promise<unknown>; post: (data: unknown, at: { in: string }) => Promise<unknown> }, surface: (typeof SURFACES)[number], key: string) {
  if (surface === "terminal") return ui.press({ key });
  const link = await ui.find({ type: "Client", key });
  expect(link?.props.props?.to).toBeDefined();
  return ui.post({ go: link!.props.props!.to }, { in: key });
}

test("/issue-map pane opens the pane on the Map, asking for the keys, read from the plugin's own CLI where the session is", async ($, on) => {
  const { ran, opened, clock } = world(on);
  await start($);
  const { text } = await command($, clock, "pane");
  expect(text).toBe("Opened the Issue Map pane.");
  expect(opened).toEqual(["map, focused"]);
  expect(ran).toEqual([["pane"]]);
});

test("the Map screen leads with the Project, the share line, where to start, and the lists", async ($, on) => {
  const { clock } = world(on);
  await start($);
  await command($, clock, "pane");
  for (const surface of SURFACES) {
    const ui = await mount($, surface);
    const text = await shown(ui);
    expect(text).toContain("fixture-org/");
    expect(text).toContain("tools");
    expect(text).toContain("to take next,");
    expect(text).toContain("Start with");
    expect(text).toContain("2 wait on it");
    expect(text).toContain("Lay the foundation");
    expect((await ui.find({ key: "next" }))?.text).toBe("4 Take next");
    expect((await ui.find({ key: "groups" }))?.text).toBe("3 Groups");
    expect((await ui.find({ key: "unlinked" }))?.text).toBe("4 Unlinked");
    // The desktop draws the chart, and writes each island's label over it; the terminal lists the Groups in its place.
    if (surface === "desktop") {
      expect(await ui.find({ type: "Svg" })).toBeDefined();
      expect((await ui.find({ key: "isle-0" }))?.text).toBe("1");
    } else {
      expect((await ui.find({ key: "group-0" }))?.text).toContain("Plan the release");
    }
    await ui.unmount();
  }
});

test("a list opens an island, the island an Issue, and up goes back up the Map's own levels, naming where", async ($, on) => {
  const { clock } = world(on);
  await start($);
  await command($, clock, "pane");
  for (const surface of SURFACES) {
    const ui = await mount($, surface);
    await ui.press({ key: "groups" });
    expect((await ui.find({ key: "up" }))?.text).toBe("← Map");
    await open(ui, surface, "row-0");
    expect(await shown(ui)).toContain("Group 1");
    // An Issue in the island: its title in its box on the desktop, its row on the terminal.
    await ui.press({ key: "row-1" });
    expect(await shown(ui)).toContain("Write the release notes");
    expect((await ui.find({ key: "up" }))?.text).toBe("← Group 1");
    await ui.press({ key: "up" });
    expect(await shown(ui)).toContain("Group 1");
    await ui.press({ key: "up" });
    expect((await ui.find({ key: "next" }))?.text).toBe("4 Take next");
    await ui.unmount();
  }
});

test("on the desktop, an island's label opens it, and pointing at it shows its name card", async ($, on) => {
  const { clock } = world(on);
  await start($);
  await command($, clock, "pane");
  const ui = await mount($, "desktop");
  const svgs = (await ui.findAll({ type: "Svg" })) as unknown as { props: { alt: string; source: string } }[];
  // Group 2 is headed by #1, Lay the foundation.
  expect(svgs.find((svg) => svg.props.alt === "Lay the foundation")?.props.source).toContain("3 Issues, 1 Unblocked");
  await ui.press({ key: "isle-1" });
  expect(await shown(ui)).toContain("Group 2");
  await ui.unmount();
});

test("after a press draws the next screen, the pane asks for the keys back, which the desktop hands to the prompt", async ($, on) => {
  const { opened, clock } = world(on);
  await start($);
  await command($, clock, "pane");
  const ui = await mount($, "desktop");
  await ui.press({ key: "groups" });
  await open(ui, "desktop", "row-0");
  await clock.advance(1_000);
  expect(opened).toEqual(["map, focused", "map, focused", "map, focused"]);
  await ui.unmount();
});

test("an Issue's screen says its state, hands work to Claude, and lists its Links to go on to", async ($, on) => {
  const { submitted, filled, clock } = world(on);
  await start($);
  await command($, clock, "pane");
  for (const surface of SURFACES) {
    // Opened again, the pane starts on the Map.
    await command($, clock, "pane");
    const ui = await mount($, surface);
    await ui.press({ key: "next" });
    await open(ui, surface, "row-1");
    const text = await shown(ui);
    expect(text).toContain("Proofread the release notes");
    expect(text).toContain("2nd in Take next.");
    expect(text).toContain("Unassigned.");
    expect(text).toContain("Parent");
    await ui.press({ key: "brief" });
    await ui.press({ key: "assign" });
    // Its Parent, #5, opens from its Link.
    await open(ui, surface, "link-0");
    expect(await shown(ui)).toContain("Write the release notes");
    await ui.unmount();
  }
  expect(submitted).toEqual(["start work on #7", "start work on #7"]);
  expect(filled).toEqual(["assign #7 to me", "assign #7 to me"]);
});

test("an assigned Issue offers no assigning", async ($, on) => {
  const { clock } = world(on);
  await start($);
  await command($, clock, "pane");
  const ui = await mount($, "terminal");
  await ui.press({ key: "groups" });
  await ui.press({ key: "row-0" });
  // The island's rows: #4, then #5 under it, #7 under that, then #6.
  await ui.press({ key: "row-3" });
  expect(await shown(ui)).toContain("Tag the build");
  expect(await ui.find({ key: "assign" })).toBeUndefined();
  await ui.unmount();
});

test("an Issue in no Group goes up to the Unlinked list", async ($, on) => {
  const { clock } = world(on);
  await start($);
  await command($, clock, "pane");
  for (const surface of SURFACES) {
    await command($, clock, "pane");
    const ui = await mount($, surface);
    await ui.press({ key: "unlinked" });
    await open(ui, surface, "row-0");
    expect(await shown(ui)).toContain("Document the new layout");
    expect((await ui.find({ key: "up" }))?.text).toBe("← Unlinked");
    await ui.press({ key: "up" });
    expect(await shown(ui)).toContain("Unlinked");
    await ui.unmount();
  }
});

/** A Project with no Group: three Issues, none linked to another, #80 Unblocked as its blocker closed. */
const NO_GROUP = JSON.stringify({
  map: {
    project: "fixture-org/small",
    projectUrl: "https://github.com/fixture-org/small",
    tracker: "github.com",
    readAt: "2026-09-23T00:00:00Z",
    open: 3,
    onMap: 0,
    band: "Promised",
    notes: [],
    next: { head: "Take next: 1", why: "most waited on first", picks: [{ issue: 0, line: "#80 Apply for open source — unblocked 4d ago", why: "unblocked 4d ago" }], taken: [] },
    groups: [],
    unlinked: [2, 1, 0],
    issues: [
      { ref: "#80", title: "Apply for open source", url: "https://github.com/fixture-org/small/issues/80", unblocked: true, next: 1 },
      { ref: "#131", title: "Run the hooks tests", url: "https://github.com/fixture-org/small/issues/131" },
      { ref: "#137", title: "Fix the nightly reads", url: "https://github.com/fixture-org/small/issues/137" },
    ],
    because: ["Its blocker closed 4d ago"],
    links: [[{ role: "blocker", ref: "#47", title: "Go public", open: false }], [], []],
    assigned: [],
  },
});

test("with no Group to draw, the Map screen lists the Unlinked Issues in the chart's room, and offers to suggest Links", async ($, on) => {
  const { clock, submitted } = world(on, NO_GROUP);
  await start($);
  for (const surface of SURFACES) {
    await command($, clock, "pane");
    const ui = await mount($, surface);
    const text = await shown(ui);
    expect(text).toContain("#137 Fix the nightly reads");
    expect(text).toContain("#131 Run the hooks tests");
    expect(text.split("Apply for open source").length).toBe(2);
    expect(await ui.find({ key: "groups" })).toBeUndefined();
    await ui.press({ key: "suggest" });
    await open(ui, surface, "row-0");
    expect((await ui.find({ key: "up" }))?.text).toBe("← Unlinked");
    await ui.unmount();
  }
  expect(submitted).toEqual(["suggest Links", "suggest Links"]);
});

test("where there's no Map, the pane says why, and reads again when asked", async ($, on) => {
  const { ran, clock } = world(on, JSON.stringify({ said: "No Home Project: /work/checkout isn't inside a git checkout." }));
  await start($);
  await command($, clock, "pane");
  for (const surface of SURFACES) {
    const ui = await mount($, surface);
    expect(await shown(ui)).toContain("isn't inside a git checkout");
    await ui.press({ key: "again" });
    await clock.settle();
    await ui.unmount();
  }
  expect(ran.length).toBe(3);
});

test("while a first read runs, the pane says how far it's got, and reads again until the Map draws", async ($, on) => {
  const reading = (read: number) => JSON.stringify({ reading: { project: "fixture-org/tools", read, total: 12, elapsedMs: 3_000 } });
  const { ran, clock } = world(on, reading(3), [reading(12), PRINTED]);
  await start($);
  await command($, clock, "pane");
  const ui = await mount($, "terminal");
  expect(await shown(ui)).toContain("3 of 12 Issues read · about 9s left");
  expect(await ui.find({ key: "again" })).toBeUndefined();
  await clock.advance(1_000);
  expect(await shown(ui)).toContain("12 Issues read · finishing");
  await clock.advance(1_000);
  expect(ran.length).toBe(3);
  expect((await ui.find({ key: "next" }))?.text).toBe("4 Take next");
  await clock.advance(10_000);
  expect(ran.length).toBe(3);
  await ui.unmount();
});

test("a first read that stopped says why, and resumes when asked", async ($, on) => {
  const { ran, clock } = world(on, JSON.stringify({ reading: { project: "fixture-org/tools", read: 3, total: 12, elapsedMs: 3_000, stopped: "GitHub's rate limit" } }));
  await start($);
  await command($, clock, "pane");
  await clock.advance(5_000);
  expect(ran.length).toBe(1);
  const ui = await mount($, "terminal");
  expect(await shown(ui)).toContain("The read stopped: GitHub's rate limit.");
  await ui.press({ key: "again" });
  await clock.settle();
  expect(ran.length).toBe(2);
  await ui.unmount();
});

test("after a turn the open pane reads the Map again, and a screen whose Issue is gone falls back to the Map", async ($, on) => {
  const gone = JSON.parse(PRINTED);
  gone.map.issues[6].ref = "#70";
  const { ran, clock } = world(on, PRINTED, [JSON.stringify(gone)]);
  await start($);
  await command($, clock, "pane");
  const ui = await mount($, "terminal");
  await ui.press({ key: "next" });
  await ui.press({ key: "row-1" });
  expect(await shown(ui)).toContain("Proofread");
  await turnEnds($);
  await clock.settle();
  expect(ran.length).toBe(2);
  expect((await ui.find({ key: "next" }))?.text).toBe("4 Take next");
  await ui.unmount();
});
