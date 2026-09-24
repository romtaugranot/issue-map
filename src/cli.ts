/**
 * `issue-map home [--pick <URL>]`: says which Project the Map opens on for this checkout.
 * `issue-map map [--pick <URL>]`: draws the Home Project's Map.
 * `issue-map unlinked [--page <n>] [--pick <URL>]`: lists its Unlinked Issues, 15 a page, newest first.
 * `issue-map group <n | ref> [--page <n>] [--pick <URL>]`: opens Group `n` of the overview, or the level beneath the Issue `ref` names.
 * `issue-map issue <ref> [--page <n>] [--pick <URL>]`: the Issue card of the Issue `ref` names, read live, and the Links to follow from it.
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
import { resolveHome, type HomeAnswer, type LastHome } from "./home/home.ts";
import { snapshotStore, type SnapshotKey } from "./snapshot/store.ts";
import { keepWarm } from "./snapshot/refresher.ts";
import { showCard, showMap } from "./map/show.ts";
import type { Card } from "./map/card.ts";
import type { Command } from "./map/draw.ts";

const USAGE =
  "usage: issue-map home [--pick <URL>] | map [--pick <URL>] | unlinked [--page <n>] [--pick <URL>] | group <n | ref> [--page <n>] [--pick <URL>] | issue <ref> [--page <n>] [--pick <URL>]";

async function main(argv: string[]): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { pick: { type: "string" }, page: { type: "string" }, host: { type: "string" }, path: { type: "string" }, login: { type: "string" } },
  });
  const [verb, ...rest] = positionals;
  const page = values.page === undefined ? 1 : Number(values.page);
  const opening = verb === "group" ? toOpen(rest.shift(), page) : undefined;
  const cardRef = verb === "issue" ? rest.shift() : undefined;
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
      if (!cardRef?.trim()) return usage();
      break;
    case "home":
    case "map":
    case "unlinked":
      break;
    default:
      return usage();
  }

  const root = await checkoutRoot(process.cwd());
  if (!root) {
    console.log(`No Home Project: ${process.cwd()} isn't inside a git checkout.`);
    return 0;
  }
  const answer = await resolveHome(
    { checkout: gitCheckout(root), trackers: known, env: process.env, sshHostname, lastHome: lastHomeOf(root) },
    { pick: values.pick },
  );
  if (verb === "home" || !answer.home) {
    console.log(render(answer));
    return 0;
  }
  const { tracker, project } = answer.home;
  if (cardRef !== undefined) {
    console.log(renderCard(await showCard(tracker, project, cardRef, page)));
    return 0;
  }
  const command: Command = verb === "map" ? { kind: "overview" } : verb === "unlinked" ? { kind: "unlinked", page } : opening!;
  const store = openStore();
  const startRead = () => detach(["read", "--host", tracker.host, "--path", project.path]);
  // Only the Home Project is kept warm.
  const startRefresher = async ({ login }: SnapshotKey) => {
    if (!(await store.refresherRunning({ tracker: tracker.host, project: project.id, login }))) {
      detach(["refresher", "--host", tracker.host, "--path", project.path, "--login", login]);
    }
  };
  console.log(await showMap({ store, startRead, sleep, startRefresher }, tracker, project, command));
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

/** The Home Project last resolved for the checkout at `root`, kept beside the Snapshots, readable only by this OS user. */
function lastHomeOf(root: string): LastHome {
  const dir = join(stateDir(), "homes");
  const path = join(dir, `${createHash("sha256").update(root).digest("hex")}.json`);
  return {
    async get() {
      try {
        return JSON.parse(await readFile(path, "utf8")) as Project;
      } catch {
        return undefined;
      }
    },
    async set(project) {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await writeFile(path, JSON.stringify(project), { mode: 0o600 });
    },
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

function render({ text, choices }: HomeAnswer): string {
  if (choices.length === 0) return text;
  const lines = choices.map((c) => `- ${c.label} — ${c.description}\n  ${c.url}`);
  return [text, "", "Choices, best guess first:", ...lines].join("\n");
}

/** The card, then the Links to follow from it, for the picker; `label` is what `issue` takes to open each. */
function renderCard({ text, choices }: Card): string {
  if (choices.length === 0) return text;
  return [text, "", "Links to follow, in the card's order:", ...choices.map((c) => `- ${c.label} — ${c.description}`)].join("\n");
}

/** The real host behind an SSH alias, read from the user's SSH config without connecting. */
async function sshHostname(alias: string): Promise<string> {
  const answer = await processCli("ssh", ["-G", alias]);
  if (answer.kind !== "exited" || answer.code !== 0) return alias;
  return /^hostname (\S+)$/m.exec(answer.stdout)?.[1] ?? alias;
}

process.exitCode = await main(process.argv.slice(2));
