/**
 * The plugin's hooks module, one file as the engine follows `$` into no
 * import: the status line (ADR 0011), `/issue-map` (ADR 0012), and the Issue
 * Map pane (ADR 0014).
 *
 * The status line is the Home Project's row, pinned under the prompt as this
 * plugin's own line, so nothing is written into the user's settings. The row
 * comes from the plugin's status line process, which reads only what the
 * background refresher keeps, so it never holds anything up.
 *
 * `/issue-map` shows the Map, or one of its views, as the command's output
 * with no model turn; Claude reads the same output. The plugin's
 * `bin/issue-map` draws it, told with `--shown` that this shows it.
 *
 * `/issue-map pane` opens the pane: the Map as a sea chart of Group islands,
 * drawn from what `issue-map pane` prints, the HTML Picture's own data. Its
 * screens lead one to another, each fitting the pane with no scroll bar, and
 * its way up follows the Map's own levels. Writes stay with Claude: the pane
 * only sends Claude a prompt, or fills the prompt box for the person to send.
 */
import type { EngineInterface, Register, RenderElement } from "claude-code";
import type { IssueMapProgress, IssueMapRead, IssueMapScreen } from "../types";
import type { PaneData, PaneLink } from "../src/map/pane.ts";
import { CELL, earlier, islandChart, islandPage, isleCaption, isleLabel, seaChart, shareBar, TEXT } from "../src/pane/chart.ts";
import { fitLine, textWidth } from "../src/pane/fit.ts";
import {
  count,
  firstPick,
  groupAt,
  groupOf,
  groupSaid,
  holdsNext,
  island,
  issueAt,
  isOutside,
  issueSaid,
  LISTS,
  nameOf,
  outline,
  plain,
  plural,
  readSaid,
  ROLES,
  shares,
  stateOf,
  upOf,
  type List,
  type Screen,
  type Tone,
} from "../src/pane/screens.ts";
import type { LinkPost, LinkProps } from "./link.tsx";

/** How often the row is worked out again while nothing else happens: the refresher keeps a new one every 90 s, and its age goes on growing. */
const EVERY_MS = 60_000;

/** What `/issue-map` serves: views only. Writes, and what's printed for Claude to work from, stay with Claude. */
const VIEWS = new Set(["map", "refresh", "unlinked", "groups", "next", "taken", "group", "picture", "issue", "go", "back", "home", "html"]);

const USAGE =
  "`/issue-map` draws the Map; followed by `refresh`, `next`, `taken`, `groups`, `unlinked`, `group <n | ref>`, `picture <n | ref>`, `issue <ref>`, `go [<target>]`, `back`, `home` or `html`, it shows that instead, and followed by `pane`, it opens the Issue Map pane. Ask Claude to assign an Issue, suggest Links or start work.";

/** The pane's id. */
const PANE = "map";
const SCREEN = { plugin: "issue-map", key: "screen" } as const;
const READ = { plugin: "issue-map", key: "read" } as const;
const READING = { plugin: "issue-map", key: "reading" } as const;

/** How often an open pane's data is read again while nothing else happens. */
const READ_EVERY_MS = 120_000;
/** How soon a first read is asked after again, while it runs: each ask also waits a few seconds on it. */
const FOLLOW_MS = 1_000;
/** How long an opened island grows into the chart: its screen draws the growing only this soon after. */
const GROWS_MS = 1_500;
/** The cells a Link's role takes on an Issue's screen: "Blocked by". */
const ROLE = 10;
/** How soon after a press the pane asks for the keys back, once the press has drawn the next screen. */
const REFOCUS_MS = 120;

/**
 * Rows each part of a screen takes: as the terminal draws it, and as the
 * desktop app was measured to, where a gap is half a row, a Button or the
 * share bar with its line a row and a third, and a panel's frame most of one.
 */
const ROWS = {
  terminal: { gap: 1, button: 1, bar: 1, frame: 2 },
  remote: { gap: 0.5, button: 1.3, bar: 1.3, frame: 0.8 },
} as const;

/** One of the plugin's launchers: itself, or on Windows, where a bash script can't be started without a shell, Node on its source. */
function launch($: EngineInterface, bin: string, source: string): string[] {
  const root = $.plugin.root;
  return /^[A-Za-z]:[\\/]/.test(root) ? ["node", `${root}/src/${source}`] : [`${root}/bin/${bin}`];
}

/** The plugin's CLI. */
const cli = ($: EngineInterface) => launch($, "issue-map", "cli.ts");

/** Pins the row for where the session is, or takes the line away when there is none. */
async function pin($: EngineInterface): Promise<void> {
  const ran = await $.process.run(launch($, "issue-map-status-line", "status-line.ts"), { cwd: await $.session.cwd(), timeoutMs: 10_000 }).catch(() => null);
  $.ui.status(ran?.stdout.trim() || undefined);
}

/** Runs the CLI with `args` where the session is, on its trail: what it printed, or why it couldn't run. */
async function run($: EngineInterface, args: string[], timeoutMs: number): Promise<{ ok: boolean; text: string }> {
  const ran = await $.process
    .run([...cli($), ...args], {
      cwd: await $.session.cwd(),
      // As the Bash tool has it, so this moves along the same trail as the Map Claude draws.
      env: { CLAUDE_CODE_SESSION_ID: await $.session.id() },
      timeoutMs,
    })
    .catch((error: unknown) => `Issue Map couldn't run: ${error instanceof Error ? error.message : String(error)}`);
  if (typeof ran === "string") return { ok: false, text: ran };
  return ran.exitCode === 0 ? { ok: true, text: ran.stdout } : { ok: false, text: (ran.stderr || ran.stdout).trimEnd() };
}

/** What `/issue-map` followed by `args` shows. */
async function answer($: EngineInterface, args: string): Promise<string> {
  // ponytail: split on spaces, so `go` can't take a local path with a space in it; quote-aware splitting if someone needs one.
  const argv = args.trim() ? args.trim().split(/\s+/) : ["map"];
  if (argv[0] === "pane" && argv.length === 1) return openPane($);
  if (!VIEWS.has(argv[0]!) || argv.includes("--artifact")) return USAGE;
  return (await run($, ["--shown", ...argv], 60_000)).text.trimEnd();
}

/** Opens the pane on the Map, holding the keys where the prompt gives them up, so its first click presses; and reads what it draws. */
async function openPane($: EngineInterface): Promise<string> {
  await $.state.set(SCREEN, { kind: "map" });
  const opened = await $.ui.open({ id: PANE, title: "Issue Map", focus: true });
  void readPane($);
  return opened.isPlaced ? "Opened the Issue Map pane." : `The Issue Map pane is open, but not shown: ${opened.reason}`;
}

/** Reads what the pane draws, once at a time; while a first read runs, again until it finishes, so the Map draws as soon as it can. */
async function readPane($: EngineInterface): Promise<void> {
  if ((await $.state.get(READING)).value) return;
  await $.state.set(READING, true);
  let following = false;
  try {
    const ran = await run($, ["pane"], 120_000);
    const read: IssueMapRead = { at: await $.clock.now() };
    const printed = ran.ok ? parse(ran.text) : null;
    if (printed && typeof printed.map === "object") read.map = ran.text.trim();
    else if (printed && typeof printed.reading === "object" && printed.reading) read.reading = printed.reading as IssueMapProgress;
    else read.said = printed && typeof printed.said === "string" ? printed.said : ran.text || "Issue Map printed nothing.";
    await $.state.set(READ, read);
    following = read.reading !== undefined && !read.reading.stopped;
  } finally {
    await $.state.set(READING, false);
  }
  if (following) $.clock.after(FOLLOW_MS, () => void isOpen($).then((open) => (open ? readPane($) : undefined)));
}

function parse(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * After a press draws the next screen, the desktop app hands the keys back to
 * the prompt, and takes the next click on the pane to give them back, so it
 * presses nothing: the pane asks for them again. Only granted while the
 * prompt holds the keys over an empty composer, so nothing typed is taken.
 */
const refocus = ($: EngineInterface) => $.clock.after(REFOCUS_MS, () => void $.ui.open({ id: PANE, title: "Issue Map", focus: true }));

/** Whether the pane is open; not, where nothing says. */
const isOpen = async ($: EngineInterface) => (await $.ui.panes().catch(() => [])).some((pane) => pane.id === PANE);

/** The last data read, parsed once. */
let parsed: { json: string; data: PaneData } | null = null;
function dataOf(read: IssueMapRead | undefined): PaneData | null {
  if (!read?.map) return null;
  if (parsed?.json !== read.map) parsed = { json: read.map, data: (JSON.parse(read.map) as { map: PaneData }).map };
  return parsed.data;
}

/** The theme's colors for what the chart draws in its own. */
const COLOR: Record<Tone, string> = { pick: "warning", go: "success", stop: "error", muted: "inactive" };

/** `text` cut to about `cells` cells of the pane, so a line never wraps. */
const fit = (text: string, cells: number) => fitLine(text, Math.max(1, cells) * 7, 14);

/** Markdown that prints `text` as typed. */
const md = (text: string) => text.replace(/[\\`*_~[\]<>|&#]/g, "\\$&");

/** An SVG drawn `w` pixels across, made wider than any pane, so the pane draws it exactly as wide as itself. */
const wide = (source: string, w: number) => source.replace(/ width="[\d.]+" height="[\d.]+"/, (sized) => sized.replace(/[\d.]+/g, (n) => String(Math.round(Number(n) * (4000 / w)))));

/** The tracker's name, for its button. */
const trackerName = (host: string) => (/github/i.test(host) ? "GitHub" : /gitlab/i.test(host) ? "GitLab" : host);

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    await $.command.register({ name: "issue-map", description: "Show the Map of this checkout's Home Project, or one of its views, or open the Issue Map pane", argumentHint: "[pane | group <n> | issue <ref> | back | …]" });
    void pin($);
    // A read the module was reloaded during never finished, so none is running now.
    await $.state.set(READING, false);
    $.clock.every(EVERY_MS, () => pin($));
    $.clock.every(READ_EVERY_MS, async () => {
      if (await isOpen($)) await readPane($);
    });
    return next(e);
  });
  // A turn may have drawn the Map, moved the session to another checkout, or written to the Tracker.
  on("turn.complete", async ($, e, next) => {
    void pin($);
    void isOpen($).then((open) => (open ? readPane($) : undefined));
    return next(e);
  });
  on("command.run", { command: "issue-map" }, async ($, e) => ({ text: await answer($, e.args) }));

  // What a link posts: the screen it leads to.
  on("ui.message", { requestId: PANE }, async ($, e) => {
    const post = e.data as LinkPost | null;
    if (post && typeof post === "object" && typeof post.go?.kind === "string") await $.state.set(SCREEN, post.go).then(() => refocus($));
    return {};
  });

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Markdown, Link } = $.ui.resolve(e);
    // A chart where a surface draws one, its labels Buttons laid over it; and on the desktop, regions drawing the links, whose presses its Markdown hands no plugin.
    const pictured = e.surface === "terminal" ? null : $.ui.resolve(e);
    const pressed = e.surface === "desktop" ? $.ui.resolve(e) : null;
    const surface = e.surface;
    const columns = Math.max(20, e.props.bodyColumns);
    const rows = Math.max(8, e.props.scroll.bodyRows);
    const { value: read } = await $.state.get(READ);
    const { value: reading = false } = await $.state.get(READING);
    const data = dataOf(read);
    const go = (to: Screen) => void $.state.set(SCREEN, to as IssueMapScreen).then(() => refocus($));
    const size = surface === "terminal" ? ROWS.terminal : ROWS.remote;

    if (!data && read?.reading) {
      const progress = read.reading;
      return (
        <Box flexDirection="column" gap={1}>
          <Text>
            <Text bold>{progress.project}</Text>
            {" · reading it for the first time"}
          </Text>
          <Text>{readSaid(progress)}</Text>
          {progress.stopped && <Text>{`The read stopped: ${progress.stopped}.`}</Text>}
          {progress.stopped && !reading && <Button key="again" label="Read it again" onPress={() => void readPane($)} />}
        </Box>
      );
    }
    if (!data) {
      const said = read?.said ?? (reading ? "Reading the Map…" : "No Map read yet.");
      // Each line its own, as printed: Markdown would run a paragraph's lines together.
      return (
        <Box flexDirection="column" gap={1}>
          {said
            .slice(0, 9_000)
            .split(/\n{2,}/)
            .map((paragraph, k) => (
              <Box key={`said-${k}`} flexDirection="column">
                {paragraph.split("\n").map((line, j) => (
                  <Markdown key={`line-${j}`} text={line} />
                ))}
              </Box>
            ))}
          {!reading && <Button key="again" label="Read it again" onPress={() => void readPane($)} />}
        </Box>
      );
    }

    const d = data;
    const stored = (await $.state.get(SCREEN)).value as Screen | undefined;
    // A screen naming what's gone since the data was read is the Map.
    const screen: Screen =
      stored?.kind === "island" && groupAt(d, stored.head) === undefined ? { kind: "map" } : stored?.kind === "issue" && issueAt(d, stored.ref) === undefined ? { kind: "map" } : (stored ?? { kind: "map" });
    const now = await $.clock.now();

    /** A link reading `text` that opens `to`: on the desktop a region drawing it, cut to its room; elsewhere a Button, its text cut to `cells`. */
    const linkTo = (key: string, text: string, cells: number, to: Screen, marked = false): RenderElement => {
      if (!pressed) return <Button key={key} plain label={fit(text, cells)} onPress={() => go(to)} />;
      const props: LinkProps = { text, bold: marked, to: to as IssueMapScreen };
      return <pressed.Client key={key} module="./link.tsx" props={props} width={cells} height={1} />;
    };
    /** A link to Issue `i` that opens its screen. */
    const issueLink = (key: string, i: number, cells: number, marked = false): RenderElement => {
      const issue = d.issues[i]!;
      if (surface === "terminal") return <Text bold={marked}>{`${issue.ref} ${fit(plain(issue.title), cells - issue.ref.length - 1)}`}</Text>;
      return linkTo(key, `${issue.ref} ${plain(issue.title)}`, cells, { kind: "issue", ref: issue.ref }, marked);
    };

    /** The way up, named for where it leads, and what this screen is. */
    const topRow = (what: string, said = ""): RenderElement => {
      const up = upOf(d, screen)!;
      return (
        <Box flexDirection="row" gap={1} alignItems="center">
          <Button key="up" label={`← ${up.label}`} hotkey="u" onPress={() => go(up.to)} />
          <Text bold wrap="truncate-end">
            {what}
            {said && <Text dimColor>{` ${said}`}</Text>}
          </Text>
        </Box>
      );
    };

    /** Earlier, where on the list it is, and More; nothing when one page holds it all. */
    const pager = (first: number, shown: number, all: number, to: (first: number, back: boolean) => void): RenderElement | null => {
      if (shown >= all) return null;
      return (
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          {first > 0 ? <Button key="earlier" label="Earlier" hotkey="e" onPress={() => to(first, true)} /> : <Text> </Text>}
          <Text dimColor>{`${count(first + 1)}–${count(Math.min(all, first + shown))} of ${count(all)}`}</Text>
          {first + shown < all ? <Button key="more" label="More" hotkey="m" onPress={() => to(first + shown, false)} /> : <Text> </Text>}
        </Box>
      );
    };

    /** A numbered row of a list: its number, a link, and a dim line under it. */
    const numbered = (key: string, n: number, link: RenderElement, under: string): RenderElement => (
      <Box key={key} flexDirection="row" gap={1}>
        <Box width={4} flexShrink={0} justifyContent="flex-end">
          <Text dimColor>{`${count(n)}.`}</Text>
        </Box>
        <Box flexDirection="column" flexGrow={1}>
          {link}
          {under && (
            <Text dimColor wrap="truncate-end">
              {under}
            </Text>
          )}
        </Box>
      </Box>
    );

    switch (screen.kind) {
      case "map": {
        const parts = shares(d);
        const first = firstPick(d);
        const slash = d.project.lastIndexOf("/");
        // A bar over the share line where a chart is drawn, and Start with in a panel round it.
        const barred = pictured !== null;
        const panel = first !== undefined ? 2 + size.frame : 1;
        // Title, the share line, Start with, the buttons, and a gap between each.
        const fixed = Math.ceil(1 + size.gap + size.bar + size.gap + panel + size.gap + size.gap + size.button);
        const room = rows - fixed;
        const sea = d.groups.length > 0 && room >= 5;
        let chart: RenderElement | null = null;
        if (sea && pictured) {
          const { Svg } = pictured;
          const w = columns * CELL.w;
          const high = room * CELL.h;
          const drawn = seaChart(d, w, high);
          // An image, which takes no press, so each island's label is a Button laid over it; and a hover scope, so pointing at it shows its name card over the chart's foot.
          chart = (
            <Box key="sea" height={room} overflow="hidden">
              <Svg source={wide(drawn.source, w)} alt={`${plural(d.groups.length, "Group")} as islands`} />
              {drawn.isles.map((c) => {
                const label = isleLabel(d, c);
                const tall = label.size ? 2 : 1;
                const span = Math.ceil(textWidth(label.size || label.n, TEXT, 600) / CELL.w) + 2;
                const top = Math.max(0, Math.round(c.y / CELL.h - tall / 2));
                const left = Math.max(0, Math.round(c.x / CELL.w - span / 2));
                const caption = isleCaption(d, c.k, w);
                const open = () => void $.clock.now().then((at) => go(island(d, c.k, { openedAt: at })));
                return (
                  <Box key={`isle${c.k}`} position="absolute" top={top} left={left} width={span} flexDirection="column" alignItems="center">
                    <Button key={`isle-${c.k}`} plain label={label.n} onPress={open} />
                    {label.size && <Button key={`isle-${c.k}-size`} plain dimColor label={label.size} onPress={open} />}
                    <Box position="absolute" top={room - caption.rows - top} left={-left} width={columns} display="none" hover={{ display: "flex" }}>
                      <Svg source={wide(caption.source, w)} alt={nameOf(d, d.groups[c.k]!.head)} />
                    </Box>
                  </Box>
                );
              })}
            </Box>
          );
        } else if (sea) {
          // No chart on the terminal: the numbered Groups stand in for it.
          const shown = d.groups.slice(0, Math.min(9, room));
          chart = (
            <Box key="sea" flexDirection="column" height={room}>
              {shown.map((g, k) => (
                <Box key={`g${k}`} flexDirection="row" gap={1}>
                  <Button key={`group-${k}`} plain hotkey={String(k + 1)} label={fit(nameOf(d, g.head), columns - 30)} onPress={() => go(island(d, k))} />
                  <Text dimColor wrap="truncate-end">{groupSaid(g)}</Text>
                  {holdsNext(d, g) && <Text color={COLOR.pick}>●</Text>}
                </Box>
              ))}
            </Box>
          );
        } else if (d.groups.length === 0 && room >= 1) {
          // No Group to draw: the Unlinked Issues, all the Project holds, stand in the chart's room.
          const rest = d.unlinked.filter((i) => i !== first).slice(0, Math.min(surface === "terminal" ? 9 : 99, room));
          chart = (
            <Box key="sea" flexDirection="column" height={room} overflow="hidden">
              {rest.map((i, j) =>
                surface === "terminal" ? (
                  <Button key={`row-${j}`} plain hotkey={String(j + 1)} label={`${d.issues[i]!.ref} ${fit(plain(d.issues[i]!.title), columns - d.issues[i]!.ref.length - 6)}`} onPress={() => go({ kind: "issue", ref: d.issues[i]!.ref })} />
                ) : (
                  <Box key={`u${j}`}>{issueLink(`row-${j}`, i, columns - 2)}</Box>
                ),
              )}
            </Box>
          );
        }
        return (
          <Box flexDirection="column" gap={1} height={rows}>
            <Text bold wrap="truncate-end">
              {slash >= 0 && <Text dimColor>{d.project.slice(0, slash + 1)}</Text>}
              {d.project.slice(slash + 1)}
            </Text>
            <Box flexDirection="column">
              {barred && pictured && <pictured.Svg source={wide(shareBar([parts.next, parts.waiting, parts.unlinked], columns * CELL.w), columns * CELL.w)} alt={`${count(parts.next)} to take next, ${count(parts.waiting)} waiting, ${count(parts.unlinked)} Unlinked`} />}
              <Text wrap="truncate-end">
                <Text bold color={COLOR.pick}>{count(parts.next)}</Text>
                <Text dimColor> to take next, </Text>
                <Text bold color={COLOR.stop}>{count(parts.waiting)}</Text>
                <Text dimColor> waiting, </Text>
                <Text bold>{count(parts.unlinked)}</Text>
                <Text dimColor>{parts.others ? " other Unlinked" : " Unlinked"}</Text>
              </Text>
            </Box>
            {first !== undefined ? (
              <Box flexDirection="column" borderStyle="round" borderColor={COLOR.pick} paddingX={1}>
                <Text wrap="truncate-end">
                  <Text color={COLOR.pick}>● </Text>
                  <Text bold color={COLOR.pick}>Start with</Text>
                  {d.because[0] && <Text dimColor>{`  ${d.because[0]}`}</Text>}
                </Text>
                {surface === "terminal" ? (
                  <Button key="start" plain hotkey="s" label={`${d.issues[first]!.ref} ${fit(plain(d.issues[first]!.title), columns - 16)}`} onPress={() => go({ kind: "issue", ref: d.issues[first]!.ref })} />
                ) : (
                  issueLink("start", first, columns - 6)
                )}
              </Box>
            ) : d.groups.length > 0 ? (
              <Text dimColor>Nothing to take next: everything on the Map waits on another open Issue.</Text>
            ) : (
              <Text dimColor>No Issue here links to another yet.</Text>
            )}
            {chart ?? <Box flexGrow={1} />}
            <Box flexDirection="row" gap={1} flexWrap="wrap">
              <Button key="next" hotkey="t" label={`${count(d.next.picks.length)} Take next`} onPress={() => go({ kind: "list", which: "next" })} />
              {d.groups.length > 0 && <Button key="groups" hotkey="g" label={`${count(d.groups.length)} Groups`} onPress={() => go({ kind: "list", which: "groups" })} />}
              <Button key="unlinked" hotkey="l" label={`${count(d.unlinked.length)} Unlinked`} onPress={() => go({ kind: "list", which: "unlinked" })} />
              {d.groups.length === 0 && <Button key="suggest" label="Suggest Links ↗" onPress={() => void $.prompt.submit({ text: "suggest Links" })} />}
            </Box>
          </Box>
        );
      }

      case "island": {
        const k = groupAt(d, screen.head)!;
        const g = d.groups[k]!;
        const room = rows - Math.ceil(size.button + size.gap + size.gap + size.button);
        // Where the chart is drawn, what the Group holds is said beside its name; on the terminal, on a line of its own.
        const head = topRow(`Group ${count(k + 1)}`, `of ${count(d.groups.length)}${pictured ? ` · ${groupSaid(g)}` : ""}`);
        const mark = screen.mark === undefined ? undefined : issueAt(d, screen.mark);
        if (pictured) {
          const { Svg } = pictured;
          const w = columns * CELL.w;
          const high = room * CELL.h;
          const page = islandPage(d, k, w, high, { ...(screen.from === undefined ? {} : { from: screen.from }), ...(mark === undefined ? {} : { mark }) });
          const grow = screen.openedAt !== undefined && now - screen.openedAt < GROWS_MS;
          const source = islandChart(d, k, w, high, page, { grow });
          // The chart draws the island and its lines; each Issue's box is the pane's, round its words, its title Buttons that open it.
          return (
            <Box flexDirection="column" gap={1} height={rows}>
              {head}
              <Box key="island" height={room} overflow="hidden">
                <Svg source={wide(source, w)} alt={`${nameOf(d, g.head)}: ${groupSaid(g)}`} />
                {page.boxes.map((b, j) => {
                  const issue = d.issues[b.i]!;
                  const state = stateOf(d, b.i);
                  const open = () => go({ kind: "issue", ref: issue.ref });
                  // The Issue just left in a bright frame, an Outside Issue's dim.
                  const frame = b.i === mark ? { borderColor: "text" } : { borderColor: COLOR.muted, borderDimColor: isOutside(d, b.i) };
                  return (
                    <Box key={`b${j}`} position="absolute" top={b.y / CELL.h} left={b.x / CELL.w} width={b.w / CELL.w} flexDirection="column" borderStyle="round" paddingX={1} {...frame}>
                      <Box flexDirection="row" justifyContent="space-between">
                        <Text wrap="truncate-end">
                          {state && <Text color={COLOR[state.tone]}>● </Text>}
                          <Text dimColor>{issue.ref}</Text>
                        </Text>
                        {state && <Text color={COLOR[state.tone]}>{state.word}</Text>}
                      </Box>
                      {b.lines.map((line, l) => (
                        <Button key={l === 0 ? `row-${j}` : `row-${j}-${l}`} plain label={line} onPress={open} />
                      ))}
                    </Box>
                  );
                })}
              </Box>
              {pager(page.first, page.boxes.length, page.rows, (first, back) => go({ kind: "island", head: screen.head, from: back ? earlier(d, k, w, high, first) : first }))}
            </Box>
          );
        }
        // On the terminal, which draws no chart, the outline is a list of its Issues, indented as the chart draws it.
        const all = outline(g);
        const per = Math.max(1, Math.min(9, room));
        const at = mark === undefined ? -1 : all.findIndex((r) => r.i === mark);
        const first = screen.from ?? (at >= 0 ? Math.floor(at / per) * per : 0);
        return (
          <Box flexDirection="column" gap={1} height={rows}>
            {head}
            <Text dimColor>{groupSaid(g)}</Text>
            <Box flexDirection="column" height={room - 2}>
              {all.slice(first, first + per).map((r, j) => {
                const state = stateOf(d, r.i);
                return (
                  <Box key={`r${j}`} flexDirection="row" gap={1}>
                    <Text color={r.from === null ? undefined : r.blocks ? COLOR.stop : COLOR.muted}>{`${"  ".repeat(r.depth)}${r.from === null ? "•" : r.blocks ? "▶" : "└"}`}</Text>
                    <Button key={`row-${j}`} plain hotkey={String(j + 1)} label={`${d.issues[r.i]!.ref} ${fit(nameOf(d, r.i), columns - 2 * r.depth - 26)}`} onPress={() => go({ kind: "issue", ref: d.issues[r.i]!.ref })} />
                    {state && <Text color={COLOR[state.tone]}>{state.word}</Text>}
                  </Box>
                );
              })}
            </Box>
            {pager(first, per, all.length, (from, back) => go({ kind: "island", head: screen.head, from: back ? Math.max(0, from - per) : from }))}
          </Box>
        );
      }

      case "issue": {
        const i = issueAt(d, screen.ref)!;
        const issue = d.issues[i]!;
        const said = issueSaid(d, i);
        const own = !issue.ref.startsWith("↗");
        const links: PaneLink[] = d.links[i] ?? [];
        // The title wraps to three lines at most.
        const titleRows = Math.min(3, Math.ceil(((issue.ref.length + issue.title.length + 1) * 1.3) / columns)) * (surface === "terminal" ? 1 : 2);
        const room = rows - Math.ceil(size.button + size.gap + titleRows + 1 + size.gap + size.button + size.gap + size.button);
        const per = Math.max(1, Math.min(surface === "terminal" ? 9 : 40, room));
        const first = Math.min(links.length - 1, Math.max(0, (screen.page ?? 0) * per));
        const linkRow = (l: PaneLink, j: number) => {
          const state = !l.open ? { word: "Closed", tone: "muted" as Tone } : l.to === undefined ? null : stateOf(d, l.to);
          // The role and the state word keep their room, and the link takes what's left, so a long title is cut and never pushes the word off.
          const word = !state ? 0 : surface === "terminal" ? state.word.length : Math.ceil(textWidth(state.word, TEXT) / CELL.w);
          const cells = columns - ROLE - 1 - (state ? word + 1 : 0) - 1;
          const label = `${l.ref} ${fit(plain(l.title), cells - l.ref.length - 1)}`;
          return (
            <Box key={`l${j}`} flexDirection="row" gap={1}>
              <Box width={ROLE} flexShrink={0}>
                <Text dimColor wrap="truncate-end">
                  {ROLES[l.role]}
                </Text>
              </Box>
              <Box width={cells} flexShrink={0} overflow="hidden">
                {l.to === undefined ? (
                  <Text dimColor={!l.open} wrap="truncate-end">{label}</Text>
                ) : surface === "terminal" ? (
                  <Button key={`link-${j}`} plain hotkey={String(j + 1)} label={label} onPress={() => go({ kind: "issue", ref: d.issues[l.to!]!.ref })} />
                ) : (
                  issueLink(`link-${j}`, l.to, cells)
                )}
              </Box>
              {state && (
                <Box flexShrink={0}>
                  <Text color={COLOR[state.tone]}>{state.word}</Text>
                </Box>
              )}
            </Box>
          );
        };
        return (
          <Box flexDirection="column" gap={1} height={rows}>
            {topRow("")}
            <Box flexDirection="column">
              <Markdown text={`### ${md(issue.ref)} ${md(plain(issue.title) || "an Issue this login can't read")}`} />
              <Text>
                {said.blocked && <Text bold color={COLOR.stop}>{`${said.blocked} `}</Text>}
                <Text dimColor>{said.state}</Text>
                {said.next && <Text bold color={COLOR.pick}>{` ${said.next}`}</Text>}
              </Text>
            </Box>
            <Box flexDirection="row" gap={1} flexWrap="wrap">
              <Button key="brief" variant="primary" hotkey="b" label="Brief me ↗" onPress={() => void $.prompt.submit({ text: `start work on ${issue.ref.replace(/^↗/, "")}` })} />
              {own && !d.assigned.includes(i) && <Button key="assign" hotkey="a" label="Assign to me ↗" onPress={() => void $.prompt.fill({ text: `assign ${issue.ref} to me` })} />}
              {issue.url && <Link href={issue.url} label={`Open on ${trackerName(d.tracker)}`} />}
            </Box>
            <Box flexDirection="column" flexGrow={1}>
              {links.length === 0 ? <Text dimColor>{own ? "No Links." : "The Map doesn't follow an Outside Issue's Links."}</Text> : links.slice(first, first + per).map((l, j) => linkRow(l, j))}
            </Box>
            {pager(first, per, links.length, (from, back) => go({ kind: "issue", ref: screen.ref, page: Math.floor(from / per) - (back ? 1 : 0) }))}
          </Box>
        );
      }

      case "list": {
        const which: List = screen.which;
        const total = which === "next" ? d.next.picks.length : which === "groups" ? d.groups.length : d.unlinked.length;
        const tall = which === "unlinked" ? 1 : 2;
        const room = rows - Math.ceil(size.button + size.gap + size.gap + size.button);
        const per = Math.max(1, Math.min(surface === "terminal" ? 9 : 99, Math.floor(room / tall)));
        const mark = screen.mark === undefined ? undefined : issueAt(d, screen.mark);
        const markAt = mark === undefined ? -1 : d.unlinked.indexOf(mark);
        const page = screen.page ?? (markAt >= 0 ? Math.floor(markAt / per) : 0);
        const first = Math.min(Math.max(0, total - 1), page * per);
        const rowOf = (n: number, j: number): RenderElement => {
          const hot = surface === "terminal" ? String(j + 1) : undefined;
          if (which === "groups") {
            const g = d.groups[n]!;
            const link =
              surface === "terminal" ? (
                <Button key={`row-${j}`} plain hotkey={hot!} label={fit(nameOf(d, g.head), columns - 8)} onPress={() => go(island(d, n))} />
              ) : (
                linkTo(`row-${j}`, nameOf(d, g.head), columns - 6, island(d, n))
              );
            return numbered(`n${j}`, n + 1, link, `${groupSaid(g)}${holdsNext(d, g) ? ", holds Take next" : ""}`);
          }
          const i = which === "next" ? d.next.picks[n]!.issue : d.unlinked[n]!;
          const issue = d.issues[i]!;
          const link =
            surface === "terminal" ? (
              <Button key={`row-${j}`} plain hotkey={hot!} label={`${issue.ref} ${fit(plain(issue.title), columns - issue.ref.length - 12)}`} onPress={() => go({ kind: "issue", ref: issue.ref })} />
            ) : (
              issueLink(`row-${j}`, i, which === "unlinked" ? columns - 1 : columns - 6, i === mark)
            );
          if (which === "next") return numbered(`n${j}`, n + 1, link, d.because[n] || "Nothing open blocks it");
          return <Box key={`n${j}`}>{link}</Box>;
        };
        const shown = Array.from({ length: Math.max(0, Math.min(per, total - first)) }, (_, j) => first + j);
        return (
          <Box flexDirection="column" gap={1} height={rows}>
            {topRow(LISTS[which], count(total))}
            <Box flexDirection="column" flexGrow={1}>
              {total === 0 ? <Text dimColor>{which === "next" ? `${d.next.head}: ${d.next.why}.` : "None."}</Text> : shown.map((n, j) => rowOf(n, j))}
            </Box>
            {pager(first, per, total, (from, back) => go({ kind: "list", which, page: Math.floor(from / per) - (back ? 1 : 0) }))}
          </Box>
        );
      }
    }
  });
};
