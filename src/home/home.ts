/**
 * Which Project the Map opens on for this checkout: the Home Project.
 * Remotes are read the way `gh` and `glab` read them, every candidate
 * without open Issues is dropped, and a real tie is left for the user to pick.
 * While the Tracker can't be read, the Home Project last resolved opens, so
 * the Map can still be drawn from its Snapshot (ADR 0006).
 */
import type { Project, Tracker, Trackers } from "../tracker/tracker.ts";
import type { Checkout, Remote } from "./checkout.ts";
import { hostNamed } from "../tracker/boundary.ts";
import { remoteAddress, sshHosts, type Address } from "./remote-address.ts";

export interface HomeDeps {
  checkout: Checkout;
  trackers: Trackers;
  env: Record<string, string | undefined>;
  sshHostname(alias: string): Promise<string>;
  /** Where the Home Project last resolved for this checkout is kept; nothing is kept without it. */
  lastHome?: LastHome;
}

/** The Home Project last resolved for one checkout. */
export interface LastHome {
  get(): Promise<Project | undefined>;
  set(project: Project): Promise<void>;
}

export interface Choice {
  label: string;
  description: string;
  url: string;
}

export interface HomeAnswer {
  text: string;
  /** Non-empty when the user has to pick; the best guess comes first. */
  choices: Choice[];
  /** Once there is a Home Project, the checkout's other Projects with open Issues, best guess first: where `go` looks first, and what re-picking offers. */
  others: Choice[];
  /** The Home Project and the Tracker it is on, when there is one to draw. */
  home?: { tracker: Tracker; project: Project };
}

export async function resolveHome(deps: HomeDeps, request: { pick?: string } = {}): Promise<HomeAnswer> {
  const answer = await resolve(deps, request);
  if (answer.home) await deps.lastHome?.set(answer.home.project);
  return answer;
}

async function resolve(deps: HomeDeps, request: { pick?: string }): Promise<HomeAnswer> {
  const remotes = rankRemotes(await deps.checkout.remotes());
  const aliases = new Map<string, string>();
  for (const alias of new Set(remotes.flatMap((r) => sshHosts(r.url)))) aliases.set(alias, await deps.sshHostname(alias));
  const addressOf = (remote: Remote) => remoteAddress(remote.url, (alias) => aliases.get(alias) ?? alias);
  const read = projectReader(deps.trackers);

  const candidates: Candidate[] = [];
  const unreadable: { remote: Remote; address: Address; why: string; lasting: boolean; refused: boolean }[] = [];
  let leadsToHosts = false;
  for (const remote of remotes) {
    const address = addressOf(remote);
    if (!address) continue;
    leadsToHosts = true;
    const resolved = await read(address);
    if (resolved.kind === "unreadable") {
      if (!unreadable.some((u) => sameAddress(u.address, address))) unreadable.push({ remote, address, ...resolved });
      continue;
    }
    // A fork's Issues usually live in its parent, so the parent is the better guess.
    const { tracker } = resolved;
    if (resolved.parent) candidates.push({ tracker, project: resolved.parent, via: `parent of ${remote.name}` });
    candidates.push({ tracker, project: resolved.project, via: `remote ${remote.name}` });
  }
  const distinct = unique(candidates);
  if (distinct.length === 0) {
    if (!leadsToHosts) return { text: "No Home Project: this checkout has no remote that leads to a Tracker.", choices: [], others: [] };
    const last = await lastHome(deps, unreadable);
    if (last) return last;
    const lines = unreadable.map(({ remote, address, why }) => `  ${remote.name} → ${address.host}/${address.path}: ${why}`);
    return { text: ["No Home Project: no remote of this checkout leads to a Project the Map can read.", ...lines].join("\n"), choices: [], others: [] };
  }
  const withOpenIssues = distinct.filter(hasOpenIssues);
  const alsoHere = unreadable.map(({ address, why }) => `Also here: ${address.host}/${address.path} — ${why}`);
  const found = ({ tracker, project }: Candidate): HomeAnswer => ({
    text: [`Home Project: ${name(project)} — ${issueCount(project)}`, ...alsoHere].join("\n"),
    choices: [],
    others: choices(withOpenIssues.filter((c) => c.project.id !== project.id)),
    home: { tracker, project },
  });
  const ask = (tied: Candidate[], before = ""): HomeAnswer => ({
    text: [before + askText(tied), ...alsoHere].join("\n"),
    choices: choices(tied),
    others: [],
  });
  const tied = withOpenIssues.length > 1 ? withOpenIssues : [];

  if (request.pick !== undefined) {
    const pickable = withOpenIssues.length > 0 ? withOpenIssues : distinct;
    const picked = pickable.find((c) => sameUrl(c.project.url, request.pick!));
    if (!picked) {
      const notHere = `${request.pick} isn't one of this checkout's Projects.`;
      if (tied.length > 0) return ask(tied, `${notHere} `);
      const answer = found(pickable[0]!);
      return { ...answer, text: `${notHere}\n${answer.text}` };
    }
    const saved = await deps.checkout.set(HOME_KEY, picked.project.url);
    const answer = found(picked);
    if (!saved.saved) answer.text += `\nThe pick couldn't be saved to git config (${saved.reason}), so it holds for this session only.`;
    return answer;
  }

  const saved = await deps.checkout.get(HOME_KEY);
  if (saved !== undefined) {
    const byUrl = distinct.find((c) => sameUrl(c.project.url, saved));
    if (byUrl) return found(byUrl);
    // Compared by the Project the Tracker returns, so a renamed or moved Project still matches.
    const address = remoteAddress(saved, (alias) => alias);
    const resolved = address ? await read(address) : undefined;
    const byId = resolved?.kind === "project" ? distinct.find((c) => c.project.id === resolved.project.id) : undefined;
    if (byId) {
      await deps.checkout.set(HOME_KEY, byId.project.url);
      return found(byId);
    }
    if (address && resolved?.kind === "unreadable" && !resolved.lasting) {
      return { text: [`Home Project: ${address.host}/${address.path} — ${resolved.why}`, ...alsoHere].join("\n"), choices: [], others: [] };
    }
    await deps.checkout.unset(HOME_KEY);
  }

  // gh's and glab's own defaults, read fresh each time and never written: first the environment, then git config.
  for (const tier of [envDefaults(deps.env), await configDefaults(deps.checkout, remotes, addressOf)]) {
    const defaults: Candidate[] = [];
    for (const address of tier) {
      const resolved = await read(address);
      // Only a pick among this checkout's own Projects stands, so a default naming another is passed over.
      const candidate = resolved.kind === "project" ? distinct.find((c) => c.project.id === resolved.project.id) : undefined;
      if (candidate) defaults.push(candidate);
    }
    const usable = unique(defaults).filter(hasOpenIssues);
    if (usable.length === 1) return found(usable[0]!);
    if (usable.length > 1) return ask(usable);
  }

  if (tied.length > 0) return ask(tied);
  return found((withOpenIssues[0] ?? distinct[0])!);
}

/**
 * Where a checkout likely opens, without reading any Tracker: its saved
 * pick, or else where its top-ranked remote leads. `null` when no remote
 * leads to a host.
 */
export async function likelyHome(checkout: Checkout, sshHostname: (alias: string) => Promise<string>): Promise<Address | null> {
  const saved = await checkout.get(HOME_KEY);
  const pick = saved === undefined ? null : remoteAddress(saved, (alias) => alias);
  if (pick) return pick;
  for (const remote of rankRemotes(await checkout.remotes())) {
    const aliases = new Map<string, string>();
    for (const alias of sshHosts(remote.url)) aliases.set(alias, await sshHostname(alias));
    const address = remoteAddress(remote.url, (alias) => aliases.get(alias) ?? alias);
    if (address) return address;
  }
  return null;
}

function envDefaults(env: Record<string, string | undefined>): Address[] {
  const defaults: Address[] = [];
  // GH_REPO is a URL, or [HOST/]OWNER/REPO.
  const ghRepo = env.GH_REPO?.trim();
  if (ghRepo && (ghRepo.includes("://") || ghRepo.startsWith("git@"))) {
    const address = remoteAddress(ghRepo, (alias) => alias);
    if (address) defaults.push(address);
  } else if (ghRepo) {
    const parts = ghRepo.split("/");
    const host = parts.length === 3 ? hostNamed(parts[0]) : (hostNamed(env.GH_HOST) ?? "github.com");
    if (host && (parts.length === 2 || parts.length === 3)) defaults.push({ host, path: parts.slice(-2).join("/") });
  }
  // GITLAB_REPO is a URL, or a path whose first segment is a host only when it looks like one.
  const glRepo = env.GITLAB_REPO;
  if (glRepo) {
    const address = glRepo.includes("://") ? remoteAddress(glRepo, (alias) => alias) : null;
    const [first, ...rest] = glRepo.split("/");
    const guess = address ?? (first?.includes(".") && rest.length >= 2
      ? { host: first, path: rest.join("/") }
      : { host: env.GITLAB_HOST ?? "gitlab.com", path: glRepo });
    defaults.push(guess);
  }
  return defaults;
}

async function configDefaults(checkout: Checkout, remotes: Remote[], addressOf: (remote: Remote) => Address | null): Promise<Address[]> {
  const defaults: Address[] = [];
  for (const remote of remotes) {
    const address = addressOf(remote);
    if (!address) continue;
    const gh = await checkout.get(`remote.${remote.name}.gh-resolved`);
    if (gh) defaults.push(gh === "base" ? address : { host: address.host, path: gh });
    const glab = (await checkout.get(`remote.${remote.name}.glab-resolved-base`)) ?? (await checkout.get(`remote.${remote.name}.glab-resolved`));
    if (glab) {
      const path = glab.startsWith("base:") ? glab.slice("base:".length) : address.path;
      defaults.push({ host: address.host, path });
    }
  }
  return defaults;
}

/**
 * The Home Project last resolved, when no remote could be read only because
 * its Tracker couldn't answer or refused the login, and one of them leads to
 * that Tracker. A refused login still opens it, so what's kept of it for
 * that login can be deleted.
 */
async function lastHome(deps: HomeDeps, unreadable: { address: Address; why: string; lasting: boolean; refused: boolean }[]): Promise<HomeAnswer | undefined> {
  if (!unreadable.every((u) => !u.lasting || u.refused)) return undefined;
  const project = await deps.lastHome?.get();
  const why = unreadable.find((u) => u.address.host === project?.host)?.why;
  if (!project || why === undefined) return undefined;
  const identified = await deps.trackers.at(project.host);
  if (identified.kind !== "identified") return undefined;
  return { text: `Home Project: ${name(project)}, as last resolved — ${why}`, choices: [], others: [], home: { tracker: identified.tracker, project } };
}

type Read =
  | { kind: "project"; tracker: Tracker; project: Project; parent: Project | null }
  /** `lasting` is false when nothing could be learned, as when a Tracker couldn't be reached; `refused` when it refused the login. */
  | { kind: "unreadable"; why: string; lasting: boolean; refused: boolean };

/** Reads each Project once, however many remotes and defaults lead to it. */
function projectReader(trackers: Trackers): (address: Address) => Promise<Read> {
  const reads = new Map<string, Promise<Read>>();
  return (address) => {
    const key = `${address.host}/${address.path}`;
    let read = reads.get(key);
    if (!read) {
      read = readProject(trackers, address);
      reads.set(key, read);
    }
    return read;
  };
}

async function readProject(trackers: Trackers, { host, path }: Address): Promise<Read> {
  const identified = await trackers.at(host);
  if (identified.kind === "not-this-kind") return { kind: "unreadable", why: `${host} runs no Tracker the Map can read`, lasting: true, refused: false };
  if (identified.kind === "cant-tell") return { kind: "unreadable", why: `can't tell which Tracker runs at ${host}: ${identified.reason}`, lasting: false, refused: false };
  const { product } = identified.tracker;
  const answer = await identified.tracker.resolveProject(path);
  switch (answer.kind) {
    case "project":
      return { ...answer, tracker: identified.tracker };
    case "refused":
      return { kind: "unreadable", why: `${product} refused: ${answer.reason}`, lasting: true, refused: true };
    case "not-found":
      return { kind: "unreadable", why: `${product}: ${answer.reason}`, lasting: true, refused: false };
    case "cant-tell":
      return { kind: "unreadable", why: `${product} can't tell: ${answer.reason}`, lasting: false, refused: false };
  }
}

function unique(candidates: Candidate[]): Candidate[] {
  return candidates.filter((c, i) => candidates.findIndex((d) => d.project.id === c.project.id) === i);
}

function hasOpenIssues({ project }: Candidate): boolean {
  return project.issues !== "off" && project.issues.open > 0;
}

/** The plugin's own key in the checkout's local git config, holding the picked Project's URL. */
const HOME_KEY = "issue-map.home";

function askText(tied: Candidate[]): string {
  return `This checkout leads to ${tied.length} Projects with open Issues. Ask which one is the Home Project, then run \`issue-map home --pick <URL>\`.`;
}

function choices(tied: Candidate[]): Choice[] {
  return tied.slice(0, 4).map(({ project, via }) => ({
    label: name(project),
    description: `${issueCount(project)} · ${via}`,
    url: project.url,
  }));
}

function sameAddress(a: Address, b: Address): boolean {
  return a.host === b.host && a.path.toLowerCase() === b.path.toLowerCase();
}

function sameUrl(a: string, b: string): boolean {
  const normal = (url: string) => url.trim().replace(/\/+$/, "").replace(/\.git$/, "").toLowerCase();
  return normal(a) === normal(b);
}

interface Candidate {
  tracker: Tracker;
  project: Project;
  /** How the checkout leads to the Project, such as `remote origin` or `parent of origin`. */
  via: string;
}

/** `upstream`, then `github` or `gitlab`, then `origin`, then the rest, as `gh` and `glab` rank them; git's order breaks ties. */
function rankRemotes(remotes: Remote[]): Remote[] {
  const rank = (remote: Remote) => REMOTE_RANK[remote.name] ?? 3;
  // Array.prototype.sort is stable, so git's order stands among equal ranks.
  return [...remotes].sort((a, b) => rank(a) - rank(b));
}

const REMOTE_RANK: Record<string, number> = { upstream: 0, github: 1, gitlab: 1, origin: 2 };

function name(project: Project): string {
  return `${project.host}/${project.path}`;
}

/** A Project's open Issues, such as `1,028 open Issues`, or that it has them turned off. */
export function issueCount(project: Project): string {
  if (project.issues === "off") return "Issues are turned off";
  const { open } = project.issues;
  return `${open.toLocaleString("en-US")} open Issue${open === 1 ? "" : "s"}`;
}
