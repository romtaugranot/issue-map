/**
 * Each command acts on the Project on screen, which is the Home Project
 * until the user moves; where the user is, and the trail `back` retraces,
 * are kept per Claude Code session. Every command takes `--pick <URL>`, the
 * Home Project picked in a tie that couldn't be saved.
 *
 * `issue-map map`: draws the Map of the Project on screen.
 * `issue-map unlinked [--page <n>]`: lists its Unlinked Issues, 15 a page, newest first.
 * `issue-map group <n | ref> [--page <n>]`: opens Group `n` of the overview, or the level beneath the Issue `ref` names.
 * `issue-map issue <ref> [--page <n>]`: the Issue card of the Issue `ref` names, read live, and the Links to follow from it.
 * `issue-map assign <ref>`: assigns the Issue `ref` names to the viewer, once the user has confirmed, and shows its card.
 * `issue-map go [<target>] [--dir <path>]... [--pick-there <URL>]`: moves to a Project's or an Issue's URL, an `owner/repo[#n]` or a local path; on its own, offers nearby Projects, the added directories `--dir` names among them.
 * `issue-map back`: back one step along this session's trail.
 * `issue-map home`: returns to the Home Project's overview, and on it offers to re-pick it.
 * `issue-map read --host <host> --path <path>`: a full read of a Project, run detached by `map` and the refresher.
 * `issue-map refresher --host <host> --path <path> --login <login>`: keeps the Home Project's Snapshot warm, run detached by `map`.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { mkdirSync, openSync } from "node:fs";
import { homedir } from "node:os";
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
import { resolveHome, type HomeAnswer, type LastHome } from "./home/home.ts";
import { snapshotStore, type SnapshotKey } from "./snapshot/store.ts";
import { keepWarm } from "./snapshot/refresher.ts";
import { showCard, showMap } from "./map/show.ts";
import { assignToViewer } from "./map/assign.ts";
import type { Command } from "./map/draw.ts";
import { localCheckouts, move, pickHome, type Answer, type MoveChoice, type Position, type Recent, type Recents, type Request, type Trail } from "./move/move.ts";

const USAGE =
  "usage: issue-map map | unlinked [--page <n>] | group <n | ref> [--page <n>] | issue <ref> [--page <n>] | assign <ref> | go [<target>] [--dir <path>]... [--pick-there <URL>] | back | home — each takes [--pick <URL>]";

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
    },
  });
  const [verb, ...rest] = positionals;
  const page = values.page === undefined ? 1 : Number(values.page);
  const opening = verb === "group" ? toOpen(rest.shift(), page) : undefined;
  const cardRef = verb === "issue" || verb === "assign" ? rest.shift() : undefined;
  const target = verb === "go" ? rest.shift() : undefined;
  if (rest.length > 0 || !Number.isInteger(page) || page < 1) return usage();
  const deps = { cli: processCli, http: anonymousHttp, env: process.env };
  const known = trackers([github(deps), gitlab(deps)]);

  switch (verb) {
    case "read":
      if (!values.host || !values.path) return usage();
      return fullRead(known, values.host, values.path);
    case "refresher":
      if (!values.host || !values.path || !values.login) return usage();
      return refresher(known, values.host, values.path, values.login);
    case "group":
      if (!opening) return usage();
      break;
    case "issue":
    case "assign":
      if (!cardRef?.trim()) return usage();
      break;
    case "go":
      if (target !== undefined && !target.trim()) return usage();
      break;
    case "home":
    case "map":
    case "unlinked":
    case "back":
      break;
    default:
      return usage();
  }

  const cwd = process.cwd();
  const root = await checkoutRoot(cwd);
  const home: HomeAnswer = root
    ? await resolveHome({ checkout: gitCheckout(root), trackers: known, env: process.env, sshHostname, lastHome: lastHomeOf(root) }, { pick: values.pick })
    : { text: `No Home Project: ${cwd} isn't inside a git checkout.`, choices: [], others: [] };
  // A tie is asked before any Map is drawn.
  if (home.choices.length > 0) {
    console.log(render(pickHome(home)));
    return 0;
  }

  const request: Request =
    verb === "go"
      ? { kind: "go", ...(target === undefined ? {} : { target }), dirs: values.dir ?? [], ...(values["pick-there"] === undefined ? {} : { pickThere: values["pick-there"] }) }
      : verb === "back"
        ? { kind: "back" }
        : verb === "home"
          ? { kind: "home", picked: values.pick !== undefined }
          : verb === "assign"
            ? { kind: "assign", ref: cardRef! }
            : { kind: "view", view: verb === "issue" ? { kind: "card", ref: cardRef!, page } : verb === "map" ? { kind: "overview" } : verb === "unlinked" ? { kind: "unlinked", page } : opening! };
  const store = openStore();
  const answer = await move(
    {
      trackers: known,
      home,
      trail: trailOf(process.env.CLAUDE_CODE_SESSION_ID),
      recents: recents(),
      checkouts: localCheckouts({ trackers: known, env: process.env, sshHostname }, cwd),
      now: Date.now,
      showMap(tracker, project, command: Command, at) {
        const startRead = () => detach(["read", "--host", tracker.host, "--path", project.path]);
        // Only the Home Project is kept warm.
        const startRefresher = async ({ login }: SnapshotKey) => {
          if (at.home && !(await store.refresherRunning({ tracker: tracker.host, project: project.id, login }))) {
            detach(["refresher", "--host", tracker.host, "--path", project.path, "--login", login]);
          }
        };
        return showMap({ store, startRead, sleep, startRefresher }, tracker, project, command, at.away === undefined ? {} : { home: at.away });
      },
      showCard,
      assign: (tracker, project, ref) => assignToViewer({ store }, tracker, project, ref),
    },
    request,
  );
  console.log(render(answer));
  return 0;
}

/** `group`'s argument: a bare number is a Group's place on the overview, from 1; anything else names an Issue. */
function toOpen(arg: string | undefined, page: number): Command | undefined {
  if (!arg) return undefined;
  if (!/^\d+$/.test(arg)) return { kind: "under", ref: arg, page };
  return Number(arg) >= 1 ? { kind: "group", group: Number(arg), page } : undefined;
}

/** Reads a Project in full into its Snapshot, resuming where an earlier read stopped. */
async function fullRead(known: Trackers, host: string, path: string): Promise<number> {
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

function openStore() {
  return snapshotStore(stateDir(), { now: Date.now });
}

/** Runs this CLI again in a process of its own that outlives this one; what it prints goes to a log beside the Snapshots. */
function detach(args: string[]): void {
  const dir = stateDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const log = openSync(join(dir, "background.log"), "a", 0o600);
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

/** The Projects recently moved to, shared across checkouts, beside the Snapshots. */
function recents(): Recents {
  const dir = stateDir();
  const path = join(dir, "recent.json");
  return { get: async () => readJson<Recent[]>(path, []), set: (recent) => writeJson(dir, path, recent) };
}

async function readJson<T>(path: string, none: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return none;
  }
}

/** Readable only by this OS user. */
async function writeJson(dir: string, path: string, value: unknown): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(value), { mode: 0o600 });
}

/** The Home Project last resolved for the checkout at `root`, kept beside the Snapshots, readable only by this OS user. */
function lastHomeOf(root: string): LastHome {
  const dir = join(stateDir(), "homes");
  const path = join(dir, `${createHash("sha256").update(root).digest("hex")}.json`);
  return {
    get: () => readJson<Project | undefined>(path, undefined),
    set: (project) => writeJson(dir, path, project),
  };
}

/** Where Snapshots are kept: `ISSUE_MAP_STATE_DIR`, or the XDG state directory. */
function stateDir(): string {
  const env = process.env;
  return env.ISSUE_MAP_STATE_DIR ?? join(env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "issue-map");
}

function usage(): number {
  console.error(USAGE);
  return 2;
}

/** The answer, then the Links to follow from a card, whose `label` is what `issue` takes; then any choices, each with the command that takes it. */
function render({ text, links, choices }: Answer): string {
  const lines = [text];
  if (links.length > 0) lines.push("", "Links to follow, in the card's order:", ...links.map((c) => `- ${c.label} — ${c.description}`));
  if (choices.length > 0) lines.push("", "Choices, best first:", ...choices.map((c: MoveChoice) => `- ${c.label} — ${c.description}\n  ${c.run}`));
  return lines.join("\n");
}

/** The real host behind an SSH alias, read from the user's SSH config without connecting. */
async function sshHostname(alias: string): Promise<string> {
  const answer = await processCli("ssh", ["-G", alias]);
  if (answer.kind !== "exited" || answer.code !== 0) return alias;
  return /^hostname (\S+)$/m.exec(answer.stdout)?.[1] ?? alias;
}

process.exitCode = await main(process.argv.slice(2));
