/**
 * Moving through Maps, and between Projects: where the user is, the one
 * trail `back` retraces across Projects, the Projects `go` offers, and the
 * targets a user can type — a Project's or an Issue's URL, an `owner/repo`
 * with or without `#n`, or a local path. A move lands where the user
 * pointed: an Issue on its card, a Project on its overview. A move that
 * can't open leaves the user where they are and says why. Moving never
 * changes the Home Project, and only the Home Project is kept warm.
 */
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { checkoutRoot, gitCheckout } from "../home/checkout.ts";
import { issueCount, likelyHome, resolveHome, type Choice as HomeChoice, type HomeAnswer, type HomeDeps } from "../home/home.ts";
import { remoteAddress, type Address } from "../home/remote-address.ts";
import type { Card, Choice as LinkChoice } from "../map/card.ts";
import type { Command } from "../map/draw.ts";
import { typedRef, type Shown, type ShownCard } from "../map/show.ts";
import { ago, plural, short } from "../map/text.ts";
import type { IssueRead, Project, Tracker, Trackers } from "../tracker/tracker.ts";

/** What is on screen: one of a Map's drawings, or an Issue card read live. */
export type View = Command | { kind: "card"; ref: string; page: number };

/** Where the user is: a view of one Project. */
export interface Position {
  project: Project;
  view: View;
}

/** This session's trail, oldest first; the last is where the user is. */
export interface Trail {
  get(): Promise<Position[]>;
  set(trail: Position[]): Promise<void>;
}

/** A Project whose Map opened, and when, in milliseconds since the epoch. Nothing else of it is kept. */
export interface Recent {
  host: string;
  path: string;
  openedAt: number;
}

export interface Recents {
  get(): Promise<Recent[]>;
  set(recents: Recent[]): Promise<void>;
}

/** Local checkouts other than this one, as a typed path or an added directory names them. */
export interface Checkouts {
  /** The directory `typed` names, made absolute; `null` when it names none. */
  dir(typed: string): Promise<string | null>;
  /** The Project the checkout at `dir` opens on, found as it finds its own Home Project, `pick` saved there; `null` when `dir` isn't in a checkout. */
  home(dir: string, pick?: string): Promise<HomeAnswer | null>;
  /** Where the checkout at `dir` likely opens, without reading any Tracker; `null` when it can't be told. */
  likely(dir: string): Promise<Address | null>;
}

export interface MoveDeps {
  trackers: Trackers;
  /** This checkout's Home Project, as resolved for this run. Moving never changes it. */
  home: HomeAnswer;
  trail: Trail;
  recents: Recents;
  checkouts: Checkouts;
  /** Milliseconds since the epoch. */
  now(): number;
  /** Draws a Project's Map. `home` is true only for the Home Project, the only one kept warm; `away` names the Home Project otherwise. */
  showMap(tracker: Tracker, project: Project, command: Command, at: { home: boolean; away?: string }): Promise<Shown>;
  /** `read` is the Issue when it was just read live. */
  showCard(tracker: Tracker, project: Project, ref: string, page: number, read?: IssueRead): Promise<ShownCard>;
  /** Assigns the Issue `ref` names to the viewer, and shows its card; one that can't be says why. */
  assign(tracker: Tracker, project: Project, ref: string): Promise<ShownCard>;
  /** The body and comments of the Issue `ref` names, to brief the user from; one that can't be read says why. */
  start(tracker: Tracker, project: Project, ref: string): Promise<string>;
}

export type Request =
  /** A view of the Project on screen: `map`, a Group, the Unlinked list or a card. */
  | { kind: "view"; view: View }
  /** `go`: a picker of nearby Projects, or a move to `target`. `dirs` are the directories added to the session; `pickThere` picks among the Projects a typed local path leads to. */
  | { kind: "go"; target?: string; dirs?: string[]; pickThere?: string }
  | { kind: "back" }
  /** Assigns the Issue `ref` names in the Project on screen to the viewer. */
  | { kind: "assign"; ref: string }
  /** Starts work on the Issue `ref` names in the Project on screen. */
  | { kind: "start"; ref: string }
  /** `picked` when the Home Project was just picked, so `home` goes there rather than re-pick. */
  | { kind: "home"; picked?: boolean };

/** A choice to ask about, and the command that takes it. */
export interface MoveChoice {
  label: string;
  description: string;
  run: string;
}

export interface Answer {
  text: string;
  /** A card's Links to follow, in its order; each opens with `issue <label>`. */
  links: LinkChoice[];
  /** Choices to ask about, best first. */
  choices: MoveChoice[];
}

/** Positions kept on the trail; the oldest drop off first. */
const TRAIL = 50;
/** Recent Projects kept. */
const RECENT = 10;
/** Projects `go` offers, as many as a picker holds. */
const NEARBY = 4;
/** Trackers a short name is looked up on after the one on screen and the Home Project's. */
const WELL_KNOWN = ["github.com", "gitlab.com"];

export async function move(deps: MoveDeps, request: Request): Promise<Answer> {
  const trail = await deps.trail.get();
  const home = deps.home.home;
  const here = trail.at(-1) ?? (home ? { project: home.project, view: { kind: "overview" } as const } : undefined);
  const isHome = (project: Project) => project.id === home?.project.id;

  /** Draws `at`; `opened` when it drew something to stand on, `drewMap` when that was a Map. */
  const show = async (at: Position): Promise<{ answer: Answer; opened: boolean; drewMap: boolean }> => {
    const found = await trackerAt(deps, at.project.host);
    if ("why" in found) return { answer: say(`No Map of ${at.project.host}/${at.project.path}: ${found.why}`), opened: false, drewMap: false };
    const { tracker } = found;
    if (at.view.kind === "card") {
      const card = await deps.showCard(tracker, at.project, at.view.ref, at.view.page);
      return { answer: cardAnswer(card), opened: card.opened, drewMap: false };
    }
    const shown = await deps.showMap(tracker, at.project, at.view, { home: isHome(at.project), ...(home && !isHome(at.project) ? { away: home.project.path } : {}) });
    return { answer: say(shown.text), opened: shown.drew !== "nothing", drewMap: shown.drew === "map" };
  };

  /** Puts `at` on the trail, and among the recent Projects once its Map has opened. */
  const land = async (at: Position, drewMap: boolean) => {
    // A session starts on the Home Project's overview, so its first move can be retraced to it.
    const before = trail.length === 0 && here ? [here] : trail;
    const top = before.at(-1);
    const same = top && top.project.id === at.project.id && JSON.stringify(top.view) === JSON.stringify(at.view);
    await deps.trail.set([...(same ? before.slice(0, -1) : before), at].slice(-TRAIL));
    if (drewMap && !isHome(at.project)) {
      const recents = (await deps.recents.get()).filter((r) => !sameProject(r, at.project));
      await deps.recents.set([{ host: at.project.host, path: at.project.path, openedAt: deps.now() }, ...recents].slice(0, RECENT));
    }
  };

  const stillHere = here ? `You're still on ${here.project.path}.` : "";

  switch (request.kind) {
    case "view": {
      if (!here) {
        const nearby = await picker(deps, here, {});
        return { ...nearby, text: `${deps.home.text}\n\n${nearby.text}` };
      }
      const at = { project: here.project, view: request.view };
      const shown = await show(at);
      if (shown.opened) await land(at, shown.drewMap);
      return shown.answer;
    }

    case "assign": {
      if (!here) return say(deps.home.text);
      const found = await trackerAt(deps, here.project.host);
      if ("why" in found) return say(`Not assigned: ${found.why}.`);
      const card = await deps.assign(found.tracker, here.project, request.ref);
      if (card.opened) await land({ project: here.project, view: { kind: "card", ref: request.ref.trim(), page: 1 } }, false);
      return cardAnswer(card);
    }

    case "start": {
      if (!here) return say(deps.home.text);
      const found = await trackerAt(deps, here.project.host);
      if ("why" in found) return say(`Can't start work on ${typedRef(request.ref)}: ${found.why}.`);
      // It hands the Issue over and moves nothing, so the user carries on from where they are.
      return say(await deps.start(found.tracker, here.project, request.ref));
    }

    case "back": {
      if (trail.length < 2) return say("Nothing to go back to: this is where this session's trail starts.");
      const back = trail.slice(0, -1);
      const shown = await show(back.at(-1)!);
      if (!shown.opened) return { ...shown.answer, text: `${shown.answer.text}\n${stillHere}` };
      await deps.trail.set(back);
      return shown.answer;
    }

    case "home": {
      if (!home) return say(deps.home.text);
      const atHome = trail.length > 0 && isHome(here!.project) && here!.view.kind === "overview";
      if (atHome && !request.picked && deps.home.others.length > 0) return pickHome(deps.home);
      const at: Position = { project: home.project, view: { kind: "overview" } };
      const shown = await show(at);
      if (shown.opened) await land(at, shown.drewMap);
      return request.picked ? { ...shown.answer, text: `${deps.home.text}\n\n${shown.answer.text}` } : shown.answer;
    }

    case "go": {
      if (request.target === undefined) return picker(deps, here, request);
      const target = request.target.trim();
      const found = await find(deps, target, here, request.pickThere);
      if (found.kind === "ask") return { text: found.text, links: [], choices: found.choices };
      if (found.kind === "cant") {
        if (found.gone) {
          const gone = found.gone;
          await deps.recents.set((await deps.recents.get()).filter((r) => !sameProject(r, gone)));
        }
        return say(`Can't move to ${target}: ${found.why}.${stillHere ? ` ${stillHere}` : ""}`);
      }
      if (found.kind === "issue") {
        const ref = short(found.issue.ref, found.project.path);
        await land({ project: found.project, view: { kind: "card", ref, page: 1 } }, false);
        return cardAnswer(await deps.showCard(found.tracker, found.project, ref, 1, found.issue));
      }
      const at: Position = { project: found.project, view: { kind: "overview" } };
      const shown = await show(at);
      if (!shown.opened) return { ...shown.answer, text: [shown.answer.text, stillHere].filter(Boolean).join("\n") };
      await land(at, shown.drewMap);
      return shown.answer;
    }
  }
}

function say(text: string): Answer {
  return { text, links: [], choices: [] };
}

function cardAnswer(card: Card): Answer {
  const choices: MoveChoice[] = [];
  if (card.assign) choices.push({ label: card.assign.label, description: card.assign.description, run: `issue-map assign ${quote(card.assign.ref)}` });
  if (card.start) choices.push({ label: card.start.label, description: card.start.description, run: `issue-map start ${quote(card.start.ref)}` });
  if (card.move) choices.push({ label: card.move.label, description: card.move.description, run: `issue-map go ${quote(card.move.target)}` });
  return { text: card.text, links: card.choices, choices };
}

/**
 * Asks which Project is the Home Project: in a tie, before any Map is drawn;
 * or, once there is one, again among the checkout's Projects, it first.
 */
export function pickHome({ text, choices, others, home }: HomeAnswer): Answer {
  const pick = (c: HomeChoice) => ({ label: c.label, description: c.description, run: `issue-map home --pick ${quote(c.url)}` });
  if (!home) return { text, links: [], choices: choices.map(pick) };
  const { project } = home;
  const now = { label: `${project.host}/${project.path}`, description: `${issueCount(project)} · the Home Project now`, url: project.url };
  return {
    text: `Home Project: ${project.host}/${project.path}. This checkout also leads to ${plural(others.length, "other Project")} with open Issues: ask which one is the Home Project.`,
    links: [],
    choices: [now, ...others].map(pick),
  };
}

/**
 * Up to four Projects near this one, found without reading any Tracker: the
 * checkout's other Projects and the added directories' first, then the
 * recent ones, newest first. The Project on screen and the Home Project are
 * left out, since `home` reaches it.
 */
async function picker(deps: MoveDeps, here: Position | undefined, request: { dirs?: string[] }): Promise<Answer> {
  const seen = new Set<string>();
  for (const project of [here?.project, deps.home.home?.project]) if (project) seen.add(key(project));
  const choices: MoveChoice[] = [];
  const offer = (address: Address, choice: MoveChoice) => {
    if (seen.has(key(address))) return;
    seen.add(key(address));
    choices.push(choice);
  };
  for (const other of deps.home.others) {
    const address = remoteAddress(other.url, (alias) => alias);
    if (address) offer(address, { label: other.label, description: other.description, run: `issue-map go ${quote(other.url)}` });
  }
  for (const typed of request.dirs ?? []) {
    const dir = await deps.checkouts.dir(typed);
    const address = dir ? await deps.checkouts.likely(dir) : null;
    if (address) offer(address, { label: `${address.host}/${address.path}`, description: `added directory ${dir}`, run: `issue-map go ${quote(dir!)}` });
  }
  const now = new Date(deps.now()).toISOString();
  const recents = [...(await deps.recents.get())].sort((a, b) => b.openedAt - a.openedAt);
  for (const recent of recents) {
    const name = `${recent.host}/${recent.path}`;
    offer(recent, { label: name, description: `opened ${ago(new Date(recent.openedAt).toISOString(), now)}`, run: `issue-map go ${quote(name)}` });
  }
  const takes = "a Project's or an Issue's URL, an `owner/repo`, or a local path";
  if (choices.length === 0) return say(`No Project near this one to offer. \`go\` takes ${takes}.`);
  return { text: `Projects near this one, to move to. Other takes ${takes}.`, links: [], choices: choices.slice(0, NEARBY) };
}

type Found =
  | { kind: "project"; tracker: Tracker; project: Project }
  | { kind: "issue"; tracker: Tracker; project: Project; issue: IssueRead }
  /** A typed local path leads to several Projects: the user picks. */
  | { kind: "ask"; text: string; choices: MoveChoice[] }
  /** `gone` is a Project found gone or unreadable, to drop from the recent ones; `refused` when the Tracker refused the login. */
  | { kind: "cant"; why: string; gone?: Address; refused?: boolean };

type Cant = Extract<Found, { kind: "cant" }>;

/** The Project or Issue `target` names; a local path, a URL, a reference in the Project on screen such as `#12`, or a short name. */
async function find(deps: MoveDeps, typed: string, here: Position | undefined, pickThere: string | undefined): Promise<Found> {
  const target = typedRef(typed);
  if (/^[/~.]/.test(target) || (!target.includes("://") && !target.includes("#") && (await deps.checkouts.dir(target)))) {
    return atPath(deps, target, pickThere);
  }
  if (target.startsWith("#")) {
    if (!here) return { kind: "cant", why: "a reference such as #12 names an Issue in the Project on screen, and there's none" };
    return lookUp(deps, here.project.host, `${here.project.path}${target}`, null);
  }
  const issueLike = /#\d+$/.test(target);
  if (target.includes("://")) {
    const address = remoteAddress(target, (alias) => alias);
    if (!address) return { kind: "cant", why: "that isn't a URL the Map can read" };
    const numbered = /\/\d+\/?(?:[?#].*)?$/.test(target);
    return lookUp(deps, address.host, numbered ? target : null, address.path);
  }
  // A name that starts with a host, such as `gitlab.com/group/project`, is read on that host alone.
  const [first, ...rest] = target.split("/");
  if (first?.includes(".") && rest.length >= 2 && (await deps.trackers.at(first)).kind === "identified") {
    const path = rest.join("/");
    return lookUp(deps, first, issueLike ? path : null, issueLike ? null : path);
  }
  const hosts = [...new Set([here?.project.host, deps.home.home?.project.host, ...WELL_KNOWN].filter((h): h is string => h !== undefined))];
  const found: { host: string; found: Extract<Found, { kind: "project" | "issue" }> }[] = [];
  const tried: Cant[] = [];
  for (const host of hosts) {
    const answer = await lookUp(deps, host, issueLike ? target : null, issueLike ? null : target);
    if (answer.kind === "cant") tried.push(answer);
    else if (answer.kind !== "ask") found.push({ host, found: answer });
  }
  if (found.length === 1) return found[0]!.found;
  if (found.length > 1) {
    return {
      kind: "ask",
      text: `More than one Tracker holds ${target}: ask which one to open.`,
      choices: found.map(({ host, found }) => ({
        label: `${host}/${target}`,
        description: `${found.tracker.product} · ${found.kind === "issue" ? found.issue.title : issueCount(found.project)}`,
        run: `issue-map go ${quote(`${host}/${target}`)}`,
      })),
    };
  }
  // A Tracker this user has no login for is worth naming only when none had anything else to say.
  const said = tried.filter((cant) => !cant.refused);
  return { kind: "cant", why: (said.length > 0 ? said : tried).map((cant) => cant.why).join("; ") };
}

/**
 * Reads `issue` as an Issue on the Tracker at `host`, then `path` as a
 * Project there, whichever is given, until one is found; says why of the
 * first to fail when neither is.
 */
async function lookUp(deps: MoveDeps, host: string, issue: string | null, path: string | null): Promise<Found> {
  const at = await trackerAt(deps, host);
  if ("why" in at) return { kind: "cant", why: at.why };
  const { tracker } = at;
  let why: string | undefined;
  if (issue !== null) {
    const answer = await tracker.issue(issue);
    if (answer.kind === "issue") {
      const resolved = await tracker.resolveProject(answer.issue.project);
      if (resolved.kind === "project") return { kind: "issue", tracker, project: resolved.project, issue: answer.issue };
      return { kind: "cant", why: `${answer.issue.project} isn't a Project the Map can open: ${reason(tracker, resolved)}` };
    }
    why = reason(tracker, answer);
    if (answer.kind !== "not-found" || path === null) return { kind: "cant", why, refused: answer.kind === "refused" };
  }
  const resolved = await tracker.resolveProject(path!);
  if (resolved.kind !== "project") {
    const gone = resolved.kind === "cant-tell" ? {} : { gone: { host, path: path! } };
    return { kind: "cant", why: why ?? reason(tracker, resolved), refused: resolved.kind === "refused", ...gone };
  }
  return openable(tracker, resolved.project);
}

/** A Project to move to, unless there's nothing on it to draw. */
function openable(tracker: Tracker, project: Project): Found {
  if (project.issues === "off") return { kind: "cant", why: `${project.path} has Issues turned off` };
  if (project.issues.open === 0) return { kind: "cant", why: `${project.path} has no open Issues` };
  return { kind: "project", tracker, project };
}

/** A local path moves to the Project its checkout opens on; when that is a tie, the user picks, and the pick is saved there. */
async function atPath(deps: MoveDeps, typed: string, pickThere: string | undefined): Promise<Found> {
  const dir = await deps.checkouts.dir(typed);
  if (!dir) return { kind: "cant", why: `there's no directory ${typed}` };
  const answer = await deps.checkouts.home(dir, pickThere);
  if (!answer) return { kind: "cant", why: `${dir} isn't inside a git checkout` };
  if (answer.home) return openable(answer.home.tracker, answer.home.project);
  if (answer.choices.length > 0) {
    return {
      kind: "ask",
      text: `${typed} leads to ${answer.choices.length} Projects with open Issues. Ask which one to open; the pick is saved in that checkout, as its Home Project.`,
      choices: answer.choices.map((c) => ({ label: c.label, description: c.description, run: `issue-map go ${quote(typed)} --pick-there ${quote(c.url)}` })),
    };
  }
  return { kind: "cant", why: answer.text.replace(/^No Home Project: /, "") };
}

/** The Tracker at `host`, the Home Project's without a second look; else why there is none. */
async function trackerAt(deps: MoveDeps, host: string): Promise<{ tracker: Tracker } | { why: string }> {
  if (deps.home.home?.tracker.host === host) return { tracker: deps.home.home.tracker };
  const identified = await deps.trackers.at(host);
  if (identified.kind === "identified") return { tracker: identified.tracker };
  return { why: identified.kind === "not-this-kind" ? `${host} runs no Tracker the Map can read` : `can't tell which Tracker runs at ${host}: ${identified.reason}` };
}

function reason(tracker: Tracker, answer: { kind: string; reason: string }): string {
  if (answer.kind === "refused") return `${tracker.product} refused: ${answer.reason}`;
  if (answer.kind === "cant-tell") return `${tracker.product} can't tell: ${answer.reason}`;
  return answer.reason;
}

function key({ host, path }: Address): string {
  return `${host}/${path}`.toLowerCase();
}

function sameProject(a: Address, b: Address): boolean {
  return key(a) === key(b);
}

/** Quotes for the shell, since `#` starts a comment there. */
function quote(arg: string): string {
  return `'${arg.replaceAll("'", `'\\''`)}'`;
}

/** Local checkouts as git and the Trackers find them; a relative path is read from `cwd`. */
export function localCheckouts(deps: Omit<HomeDeps, "checkout" | "lastHome">, cwd: string): Checkouts {
  return {
    async dir(typed) {
      const expanded = typed === "~" || typed.startsWith("~/") ? `${homedir()}${typed.slice(1)}` : typed;
      const dir = resolve(cwd, expanded);
      return existsSync(dir) && statSync(dir).isDirectory() ? dir : null;
    },
    async home(dir, pick) {
      const root = await checkoutRoot(dir);
      // No `lastHome`: what that checkout last opened on is its own business, and this move isn't it.
      return root ? resolveHome({ ...deps, checkout: gitCheckout(root) }, pick === undefined ? {} : { pick }) : null;
    },
    async likely(dir) {
      const root = await checkoutRoot(dir);
      return root ? likelyHome(gitCheckout(root), deps.sshHostname) : null;
    },
  };
}
