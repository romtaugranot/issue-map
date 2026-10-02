/**
 * Each command acts on the Project on screen, which is the Home Project
 * until the user moves; where the user is, and the trail `back` retraces,
 * are kept per Claude Code session. Every command takes `--pick <URL>`, the
 * Home Project picked in a tie that couldn't be saved.
 *
 * `issue-map map`: draws the Map of the Project on screen.
 * `issue-map refresh`: refreshes the Snapshot of the Project on screen now, however fresh it is, then draws its Map; there is no full read on demand.
 * `issue-map unlinked [--page <n>]`: lists its Unlinked Issues, 15 a page, newest first.
 * `issue-map groups [--page <n>]`: lists every Group, 15 a page, largest first, numbered by the place `group` opens it by.
 * `issue-map group <n | ref> [--page <n>]`: opens Group `n` of the overview, or the level beneath the Issue `ref` names.
 * `issue-map issue <ref> [--page <n>]`: the Issue card of the Issue `ref` names, read live, and the Links to follow from it.
 * `issue-map assign <ref>`: assigns the Issue `ref` names to the viewer, once the user has confirmed, and shows its card.
 * `issue-map start <ref>`: the body and comments of the Issue `ref` names, cut to a fixed budget, for Claude to brief the user from; where the user is doesn't change.
 * `issue-map suggest`: the text of the Issues on screen, for Claude to propose Link Suggestions from; where the user is doesn't change.
 * `issue-map offer`: checks the Link Suggestions Claude proposes, a JSON array of `{from, kind, to, quote, source}` on standard input, and offers those that hold up to confirm.
 * `issue-map confirm [<n>]...`: writes the offered Link Suggestions numbered `n`, once the user has ticked them, and declines the rest.
 * `issue-map go [<target>] [--dir <path>]... [--pick-there <URL>]`: moves to a Project's or an Issue's URL, an `owner/repo[#n]` or a local path; on its own, offers nearby Projects, the added directories `--dir` names among them.
 * `issue-map back`: back one step along this session's trail.
 * `issue-map home`: returns to the Home Project's overview, and on it offers to re-pick it.
 * `issue-map statusline [--setup | --remove]`: the status line's row for this checkout; with `--setup`, installs the status line in the user's Claude Code settings, wrapping theirs; with `--remove`, takes the Map's row out of it again, putting theirs back.
 * `issue-map read --host <host> --path <path>`: a full read of a Project, run detached by `map` and the refresher.
 * `issue-map refresher --host <host> --path <path> --login <login>`: keeps the Home Project's Snapshot warm, run detached by `map`.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { anonymousHttp, processCli } from "./tracker/boundary.ts";
import { github } from "./tracker/github.ts";
import { gitlab } from "./tracker/gitlab.ts";
import { trackers, type Project, type Tracker, type Trackers } from "./tracker/tracker.ts";
import { checkoutRoot, gitCheckout } from "./home/checkout.ts";
import { readdir, stat, unlink } from "node:fs/promises";
import { resolveHome, type HomeAnswer } from "./home/home.ts";
import { declinesOf, lastHomeOf, openBackgroundLog, readJson, stateDir, writeJson } from "./state.ts";
import { snapshotStore, type SnapshotKey } from "./snapshot/store.ts";
import { keepWarm } from "./snapshot/refresher.ts";
import { statusRow } from "./map/status.ts";
import { homeRowHere } from "./status/line.ts";
import { installStatusLine, removeStatusLine, repointStatusLine, userSettings } from "./status/install.ts";
import { showCard, showMap } from "./map/show.ts";
import { withLine } from "./show/shown.ts";
import { assignToViewer } from "./map/assign.ts";
import { startWork } from "./map/start.ts";
import { confirm, offer, suggest, type Pending, type PendingSuggestions, type Proposal } from "./map/suggest.ts";
import type { Command } from "./map/draw.ts";
import { localCheckouts, move, pickHome, type Answer, type MoveChoice, type Position, type Recent, type Recents, type Request, type Trail } from "./move/move.ts";

const USAGE =
  "usage: issue-map map | refresh | unlinked [--page <n>] | groups [--page <n>] | group <n | ref> [--page <n>] | issue <ref> [--page <n>] | assign <ref> | start <ref> | suggest | offer < proposals.json | confirm [<n>]... | go [<target>] [--dir <path>]... [--pick-there <URL>] | back | home | statusline [--setup | --remove] — each takes [--pick <URL>]";

/** The status line's process, where this plugin is now. */
const STATUS_LINE = fileURLToPath(new URL("../bin/issue-map-status-line", import.meta.url));

async function main(argv: string[]): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      pick: { type: "string" },
      page: { type: "string" },
      host: { type: "string" },
      path: { type: "string" },
      login: { type: "string" },
      dir: { type: "string", multiple: true },
      "pick-there": { type: "string" },
      setup: { type: "boolean" },
      remove: { type: "boolean" },
    },
  });
  const [verb, ...rest] = positionals;
  const page = values.page === undefined ? 1 : Number(values.page);
  const opening = verb === "group" ? toOpen(rest.shift(), page) : undefined;
  const cardRef = verb === "issue" || verb === "assign" || verb === "start" ? rest.shift() : undefined;
  const target = verb === "go" ? rest.shift() : undefined;
  const picked = verb === "confirm" ? rest.splice(0).map(Number) : [];
  if (rest.length > 0 || !Number.isInteger(page) || page < 1 || picked.some((n) => !Number.isInteger(n) || n < 1)) return usage();
  const deps = { cli: processCli, http: anonymousHttp, env: process.env };
  const known = trackers([github(deps), gitlab(deps)]);

  switch (verb) {
    case "read":
      if (!values.host || !values.path) return usage();
      return fullRead(known, values.host, values.path);
    case "refresher":
      if (!values.host || !values.path || !values.login) return usage();
      return refresher(known, values.host, values.path, values.login);
    case "statusline":
      if (values.setup && values.remove) return usage();
      if (values.remove) {
        console.log(await withLine(stateDir(), await removeStatusLine(userSettings()), process.env.CLAUDE_CODE_SESSION_ID));
      } else if (values.setup) {
        console.log(await withLine(stateDir(), await installStatusLine(userSettings(), STATUS_LINE), process.env.CLAUDE_CODE_SESSION_ID));
      } else {
        const row = await homeRowHere(process.cwd());
        console.log(row || "No status line row: this isn't inside a git checkout, or no remote of it leads to a Tracker.");
      }
      return 0;
    case "group":
      if (!opening) return usage();
      break;
    case "issue":
    case "assign":
    case "start":
      if (!cardRef?.trim()) return usage();
      break;
    case "go":
      if (target !== undefined && !target.trim()) return usage();
      break;
    case "home":
    case "map":
    case "refresh":
    case "unlinked":
    case "groups":
    case "back":
    case "suggest":
    case "offer":
    case "confirm":
      break;
    default:
      return usage();
  }

  const proposals = verb === "offer" ? proposalsIn(await stdin()) : undefined;
  if (proposals === null) {
    console.error("issue-map offer takes a JSON array of {from, kind, to, quote, source} on standard input, each a string; kind is blocks, parent or related");
    return 2;
  }

  const cwd = process.cwd();
  const root = await checkoutRoot(cwd);
  const home: HomeAnswer = root
    ? await resolveHome({ checkout: gitCheckout(root), trackers: known, env: process.env, sshHostname, lastHome: lastHomeOf(root) }, { pick: values.pick })
    : { text: `No Home Project: ${cwd} isn't inside a git checkout.`, choices: [], others: [] };
  // A tie is asked before any Map is drawn.
  if (home.choices.length > 0) {
    console.log(render(await shown(pickHome(home))));
    return 0;
  }

  const request: Request =
    verb === "go"
      ? { kind: "go", ...(target === undefined ? {} : { target }), dirs: values.dir ?? [], ...(values["pick-there"] === undefined ? {} : { pickThere: values["pick-there"] }) }
      : verb === "back"
        ? { kind: "back" }
        : verb === "home"
          ? { kind: "home", picked: values.pick !== undefined }
          : verb === "assign" || verb === "start"
            ? { kind: verb, ref: cardRef! }
            : verb === "suggest"
              ? { kind: "suggest" }
              : verb === "offer"
                ? { kind: "offer", proposals: proposals! }
                : verb === "confirm"
                  ? { kind: "confirm", picked }
            : { kind: "view", view: verb === "issue" ? { kind: "card", ref: cardRef!, page } : verb === "map" || verb === "refresh" ? { kind: "overview" } : verb === "unlinked" || verb === "groups" ? { kind: verb, page } : opening! };
  const store = openStore();
  const suggesting = { store, pending: pendingOf(process.env.CLAUDE_CODE_SESSION_ID), declines: declinesOf() };
  const answer = await move(
    {
      trackers: known,
      home,
      trail: trailOf(process.env.CLAUDE_CODE_SESSION_ID),
      recents: recents(),
      checkouts: localCheckouts({ trackers: known, env: process.env, sshHostname }, cwd),
      now: Date.now,
      async showMap(tracker, project, command: Command, at) {
        // An update moves the plugin, so the status line follows it here.
        await repointStatusLine(userSettings(), STATUS_LINE).catch(() => {});
        const startRead = () => detach(["read", "--host", tracker.host, "--path", project.path]);
        // Only the Home Project is kept warm.
        const startRefresher = async ({ login }: SnapshotKey) => {
          if (at.home && !(await store.refresherRunning({ tracker: tracker.host, project: project.id, login }))) {
            detach(["refresher", "--host", tracker.host, "--path", project.path, "--login", login]);
          }
        };
        return showMap({ store, startRead, sleep, startRefresher }, tracker, project, command, { ...(at.away === undefined ? {} : { home: at.away }), refresh: verb === "refresh" });
      },
      showCard,
      start: startWork,
      assign: (tracker, project, ref) => assignToViewer({ store }, tracker, project, ref),
      suggest: (tracker, project, view) => suggest(suggesting, tracker, project, view),
      offer: (tracker, project, proposed) => offer(suggesting, tracker, project, proposed),
      confirm: (tracker, project, numbers) => confirm(suggesting, tracker, project, numbers),
    },
    request,
  );
  // What `start` and `suggest` print is for Claude to work from, not to show.
  console.log(render(verb === "start" || verb === "suggest" ? answer : await shown(answer)));
  return 0;
}

/** The answer, its text kept to be shown exactly as printed (ADR 0009). */
async function shown(answer: Answer): Promise<Answer> {
  return { ...answer, text: await withLine(stateDir(), answer.text, process.env.CLAUDE_CODE_SESSION_ID) };
}

/** `group`'s argument: a bare number is a Group's place on the overview, from 1; anything else names an Issue. */
function toOpen(arg: string | undefined, page: number): Command | undefined {
  if (!arg) return undefined;
  if (!/^\d+$/.test(arg)) return { kind: "under", ref: arg, page };
  return Number(arg) >= 1 ? { kind: "group", group: Number(arg), page } : undefined;
}

/** How long a full read may run in all: well past the 37 minutes `gitlab-org/gitlab` takes. */
const FULL_READ_HOURS = 3;

/** Reads a Project in full into its Snapshot, resuming where an earlier read stopped. */
async function fullRead(known: Trackers, host: string, path: string): Promise<number> {
  // One stopped here resumes from its last page when the next draw or refresher round starts it.
  setTimeout(() => {
    console.log(`${new Date().toISOString()} stopped reading ${host}/${path}: it ran past ${FULL_READ_HOURS} hours`);
    process.exit(1);
  }, FULL_READ_HOURS * 3_600_000).unref();
  const connected = await connect(known, host, path);
  if (!connected) return 1;
  const { tracker, project } = connected;
  const viewer = await tracker.viewer();
  if (viewer.kind !== "viewer") return 1;
  const outcome = await openStore().read({ tracker: host, project: project.id, login: viewer.login }, tracker, project);
  return outcome.kind === "failed" ? 1 : 0;
}

/** Keeps `login`'s Snapshot of the Project at `path` warm until it has to stop, then says why in the log. */
async function refresher(known: Trackers, host: string, path: string, login: string): Promise<number> {
  const connected = await connect(known, host, path);
  if (!connected) return 1;
  const { tracker, project } = connected;
  const startRead = () => detach(["read", "--host", host, "--path", path]);
  const stopped = await keepWarm({ store: openStore(), startRead, sleep }, tracker, path, { tracker: host, project: project.id, login });
  console.log(`${new Date().toISOString()} stopped keeping ${host}/${path} warm for ${login}: ${stopped}`);
  return 0;
}

/** The Tracker at `host` and the Project at `path` on it, as a process run detached finds them; `null` when either can't be had. */
async function connect(known: Trackers, host: string, path: string): Promise<{ tracker: Tracker; project: Project } | null> {
  const identified = await known.at(host);
  if (identified.kind !== "identified") return null;
  const resolved = await identified.tracker.resolveProject(path);
  return resolved.kind === "project" ? { tracker: identified.tracker, project: resolved.project } : null;
}

/** Every Snapshot saved keeps the status line's row beside it. */
function openStore() {
  return snapshotStore(stateDir(), { now: Date.now }, { summarise: statusRow });
}

/** Runs this CLI again in a process of its own that outlives this one; what it prints goes to a log beside the Snapshots. */
function detach(args: string[]): void {
  const log = openBackgroundLog(stateDir());
  spawn(process.execPath, [fileURLToPath(import.meta.url), ...args], { detached: true, stdio: ["ignore", log, log] }).unref();
}

/**
 * This Claude Code session's trail, beside the Snapshots. Outside a session
 * nothing is kept, so every command starts from the Home Project. Trails of
 * sessions untouched for a month are deleted.
 */
function trailOf(session: string | undefined): Trail {
  if (!session) return { get: async () => [], set: async () => {} };
  const dir = join(stateDir(), "trails");
  const path = join(dir, `${createHash("sha256").update(session).digest("hex")}.json`);
  return {
    get: async () => readJson<Position[]>(path, []),
    async set(trail) {
      await writeJson(dir, path, trail);
      for (const name of await readdir(dir).catch(() => [])) {
        const old = join(dir, name);
        const { mtimeMs } = await stat(old).catch(() => ({ mtimeMs: Date.now() }));
        if (Date.now() - mtimeMs > 30 * 86_400_000) await unlink(old).catch(() => {});
      }
    },
  };
}

/** This session's Link Suggestions, beside the Snapshots: only identities and references, never an Issue's text. */
function pendingOf(session: string | undefined): Pending {
  const dir = join(stateDir(), "suggestions");
  const path = join(dir, `${createHash("sha256").update(session ?? "no session").digest("hex")}.json`);
  return {
    get: () => readJson<PendingSuggestions | null>(path, null),
    set: async (pending) => (pending ? writeJson(dir, path, pending) : unlink(path).catch(() => {})),
  };
}

/** All that is piped in, as text. */
async function stdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** The proposals `offer` reads, or `null` when the text isn't a list of them. */
function proposalsIn(text: string): Proposal[] | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const fields = ["from", "kind", "to", "quote", "source"] as const;
  const isProposal = (item: unknown): item is Proposal => !!item && typeof item === "object" && fields.every((f) => typeof (item as Record<string, unknown>)[f] === "string");
  return Array.isArray(value) && value.every(isProposal) ? value : null;
}

/** The Projects recently moved to, shared across checkouts, beside the Snapshots. */
function recents(): Recents {
  const dir = stateDir();
  const path = join(dir, "recent.json");
  return { get: async () => readJson<Recent[]>(path, []), set: (recent) => writeJson(dir, path, recent) };
}

function usage(): number {
  console.error(USAGE);
  return 2;
}

/**
 * The answer, then the Links to follow from a card, whose `label` is what
 * `issue` takes; then any Link Suggestions to confirm, numbered; then any
 * choices, each with the command that takes it.
 */
function render({ text, links, choices, confirm }: Answer): string {
  const lines = [text];
  if (confirm) {
    lines.push("", `To confirm in one multi-select, in this order; then run \`${confirm.run}\` with the numbers ticked:`, ...confirm.choices.map((c, i) => `${i + 1}. ${c.label} — ${c.description}`));
  }
  if (links.length > 0) lines.push("", "Links to follow, in the card's order:", ...links.map((c) => `- ${c.label} — ${c.description}`));
  if (choices.length > 0) lines.push("", "Choices, best first:", ...choices.map((c: MoveChoice) => `- ${c.label} — ${c.description}\n  ${c.run}`));
  return lines.join("\n");
}

/** The real host behind an SSH alias, read from the user's SSH config without connecting. */
async function sshHostname(alias: string): Promise<string> {
  const answer = await processCli("ssh", ["-G", "--", alias]);
  if (answer.kind !== "exited" || answer.code !== 0) return alias;
  return /^hostname (\S+)$/m.exec(answer.stdout)?.[1] ?? alias;
}

// An unexpected failure, most often the state directory, in one line rather than a stack trace.
process.exitCode = await main(process.argv.slice(2)).catch((error: unknown) => {
  const reason = (error instanceof Error ? error.message : String(error)).split("\n")[0];
  console.error(`Issue Map failed: ${reason}. Its state directory is ${stateDir()}; set ISSUE_MAP_STATE_DIR to use another.`);
  return 1;
});
