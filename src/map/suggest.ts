/**
 * Link Suggestions (ADR 0002): the Links nobody recorded. `suggest` reads
 * the Issues on screen live, and no others — each one's body and latest
 * comments, its Links, and what the Issues that mention it say of it — for
 * Claude to propose Links from, and finds by itself the Link a blocker
 * closed as a duplicate points at. `offer` checks each proposal against the
 * Tracker as it is now and offers the ones that hold up, each quoting where
 * it came from, for one multi-select; `confirm` writes the ticked ones,
 * each read again first, and remembers the rest as declined. Nothing is
 * drawn until it's written, and nothing is written on a Project where the
 * Map doesn't write (ADR 0003).
 */
import type { SnapshotKey, SnapshotStore } from "../snapshot/store.ts";
import type { FarEnd, IssueRead, LinkKind, LinkKinds, Project, Thread, Tracker } from "../tracker/tracker.ts";
import { bandOf, wontWrite } from "./band.ts";
import type { Choice } from "./card.ts";
import { draw, type Command } from "./draw.ts";
import { issueLocator, typedRef, why } from "./show.ts";
import { commentBlock } from "./start.ts";
import { count, cut, plural, short } from "./text.ts";

/** A Link Claude proposes, as it pipes it to `offer`: `from` Blocks `to`, is its Parent, or is Related to it, as `source`'s text says in `quote`. */
export interface Proposal {
  from: string;
  kind: LinkKind;
  to: string;
  quote: string;
  source: string;
}

/** One end of a Link Suggestion: its identity, and its reference from anywhere, such as `owner/name#12`. */
interface End {
  id: string;
  ref: string;
}

/** A Link Suggestion: what it would write, and what it came from. */
export interface Suggestion {
  from: End;
  kind: LinkKind;
  to: End;
  /** The words quoted from an Issue's text; or, for one the Map found by itself, what it found. */
  quote: string;
  /** Where the quote is, such as `#12's body`; `null` for one the Map found by itself. */
  where: string | null;
}

/** What a Link Suggestion would write, without what it came from. */
export type Planned = Pick<Suggestion, "from" | "kind" | "to">;

/**
 * This session's Link Suggestions: the page `suggest` read, what it found
 * there, and what `offer` last offered. It holds identities and references,
 * never an Issue's text.
 */
export interface PendingSuggestions {
  tracker: string;
  /** The Project's identity. */
  project: string;
  /** The Issues on screen, by their references from anywhere. */
  onScreen: string[];
  /** The Issues whose text `suggest` read: those on screen and those that mention them. */
  read: string[];
  /** What the Map found by itself, from the Tracker's record. */
  found: Suggestion[];
  offered: Planned[];
}

/** Where this session's Link Suggestions are kept between `suggest`, `offer` and `confirm`. */
export interface Pending {
  get(): Promise<PendingSuggestions | null>;
  set(pending: PendingSuggestions | null): Promise<void>;
}

/** The suggestions declined, by `declineKey`, kept per Tracker, Project and login. */
export interface Declines {
  get(key: SnapshotKey): Promise<string[]>;
  add(key: SnapshotKey, declined: string[]): Promise<void>;
}

/** What `suggest`, `offer` and `confirm` keep: the Snapshots, this session's suggestions, and the declines. */
export interface SuggestDeps {
  store: SnapshotStore;
  pending: Pending;
  declines: Declines;
}

/** What is on screen: one of a Map's drawings, or an Issue card. */
export type OnScreen = Command | { kind: "card"; ref: string; page: number };

/** What `offer` says, and the suggestions to confirm in one multi-select, numbered from 1, where the Map writes. */
export interface Offer {
  text: string;
  confirm?: { choices: Choice[] };
}

/** Requests `suggest` keeps in flight. */
const AT_ONCE = 4;
/** Of each Issue's text: its body, all its comments, and each comment. */
const BODY = 1_200;
const COMMENTS = 1_200;
const COMMENT = 500;
/** Issues that mention those on screen whose text is read, and how much of what each says of one is kept. */
const MENTIONS = 10;
const MENTION = 300;
/** Suggestions one multi-select holds: four questions of four options. */
const OFFERED = 16;
/** How much of a quote a choice shows. */
const QUOTE = 160;

const KINDS: [LinkKind, string][] = [
  ["blocks", "Blocks"],
  ["parent", "Parent"],
  ["related", "Related"],
];
const VERB: Record<LinkKind, string> = { blocks: "Blocks", parent: "Parent of", related: "Related to" };
/** The role the far end has, seen from the Issue a Link starts at. */
const FAR_ROLE = { blocks: "blocked", parent: "child", related: "related" } as const;
const NEAR_ROLE = { blocks: "blocker", parent: "parent", related: "related" } as const;

/** The text of the Issues on screen, for Claude to propose Links from; one that can't be read says why. */
export async function suggest(deps: SuggestDeps, tracker: Tracker, project: Project, view: OnScreen): Promise<string> {
  const none = (reason: string) => `No Link Suggestions: ${reason}.`;
  const said = await tracker.capabilities(project);
  if (said.kind !== "capabilities") return none(why(tracker, said));
  const viewer = await tracker.viewer();
  if (viewer.kind !== "viewer") return none(why(tracker, viewer));
  const key: SnapshotKey = { tracker: tracker.host, project: project.id, login: viewer.login };
  const shown = await onScreen(deps.store, key, project, view);
  if (typeof shown === "string") return none(shown);

  const reads = await inTurn(shown, async (locator) => ({ locator, answer: await tracker.issue(locator) }));
  const skipped: string[] = [];
  const issues: IssueRead[] = [];
  for (const { locator, answer } of reads) {
    if (answer.kind !== "issue") skipped.push(`${short(locator, project.path)}: ${why(tracker, answer)}`);
    else if (answer.issue.project !== project.path) skipped.push(`${short(answer.issue.ref, project.path)} is an Outside Issue: suggest from its own Project's Map`);
    else if (!answer.issue.open) skipped.push(`${short(answer.issue.ref, project.path)} is closed`);
    else issues.push(answer.issue);
  }
  if (issues.length === 0) return none(skipped.length > 0 ? skipped.join("; ") : `no Issue of ${project.path} is on screen`);
  const refs = new Set(issues.map((issue) => issue.ref));
  const threads = await inTurn(issues, (issue) => tracker.thread(issue.ref));

  // What the Issues that mention these, and aren't on screen or Linked, say of them.
  const mentioning = new Map<string, IssueRead[]>();
  for (const issue of issues) {
    const linked = new Set(issue.links.map((link) => link.to.id));
    for (const { id, ref } of issue.mentionedBy) {
      if (id === issue.id || linked.has(id) || refs.has(ref)) continue;
      if (!mentioning.has(ref) && mentioning.size === MENTIONS) continue;
      mentioning.set(ref, [...(mentioning.get(ref) ?? []), issue]);
    }
  }
  const mentionThreads = new Map((await inTurn([...mentioning.keys()], async (ref) => [ref, await tracker.thread(ref)] as const)).filter(([, answer]) => answer.kind === "thread"));

  const declined = new Set(await deps.declines.get(key));
  const found = said.links.blocks.kind === "readable" ? (await duplicates(tracker, issues)).filter((s) => !declined.has(declineKey(s))) : [];
  await deps.pending.set({ tracker: tracker.host, project: project.id, onScreen: [...refs], read: [...refs, ...mentionThreads.keys()], found, offered: [] });

  const wont = wontWrite(bandOf({ untested: tracker.untested, links: said.links }), said.write);
  const lines = [
    `**Link Suggestions from ${plural(issues.length, "Issue")} on screen** · ${project.path}`,
    kindsLine(said.links),
    ...(wont === null ? [] : [`Not offered to write: ${wont}. The suggestions can still be listed.`]),
    ...(skipped.length > 0 ? [`Not read: ${skipped.join("; ")}.`] : []),
  ];
  if (found.length > 0) lines.push("", `**Found by the Map: ${count(found.length)}**`, ...found.map((s) => `- ${label(s, project.path)} — ${s.quote}`));
  issues.forEach((issue, i) => {
    const thread = threads[i]!;
    const mentions = [...mentioning].flatMap(([ref, named]) => {
      const answer = mentionThreads.get(ref);
      if (!named.includes(issue) || answer?.kind !== "thread") return [];
      const quoted = naming(answer.thread, issue, project.path);
      return quoted ? [`${short(ref, project.path)} mentions it: "${quoted}"`] : [];
    });
    lines.push("", ...issueSection(issue, thread.kind === "thread" ? thread.thread : why(tracker, thread), mentions, project.path));
  });
  lines.push("", "Propose Links from what these say, and pipe them to `issue-map offer`.");
  return lines.join("\n");
}

/** Checks each proposal, and what `suggest` found, against the Tracker as it is now, and offers those that hold up. */
export async function offer(deps: SuggestDeps, tracker: Tracker, project: Project, proposals: Proposal[]): Promise<Offer> {
  const pending = await pendingFor(deps, tracker, project);
  if (!pending) return { text: "No Link Suggestions to offer: run `issue-map suggest` first, on the page to suggest from." };
  const said = await tracker.capabilities(project);
  if (said.kind !== "capabilities") return { text: `No Link Suggestions to offer: ${why(tracker, said)}.` };
  const viewer = await tracker.viewer();
  if (viewer.kind !== "viewer") return { text: `No Link Suggestions to offer: ${why(tracker, viewer)}.` };
  const declined = new Set(await deps.declines.get({ tracker: tracker.host, project: project.id, login: viewer.login }));
  const reads = cached((locator: string) => tracker.issue(locator));
  const threads = cached((locator: string) => tracker.thread(locator));

  const offered: Suggestion[] = [];
  const rejected: string[] = [];
  let declinedBefore = 0;
  const check = async (proposal: Proposal): Promise<void> => {
    // Named as typed until both ends are read.
    const typed = (ref: string) => short(issueLocator(project, typedRef(ref ?? "")), project.path);
    const asTyped = `${typed(proposal.from)} ${VERB[proposal.kind] ?? proposal.kind} ${typed(proposal.to)}`;
    const reject = (reason: string) => void rejected.push(`- ${asTyped} — ${reason}`);
    if (!(proposal.kind in VERB)) return reject("that isn't a kind of Link: blocks, parent or related");
    const recordable = said.links[proposal.kind];
    if (recordable.kind !== "readable") return reject(`${kindName(proposal.kind)} Links can't be ${recordable.kind === "cant-record" ? "recorded" : "read"} here: ${recordable.reason}`);
    const ends: IssueRead[] = [];
    for (const ref of [proposal.from, proposal.to]) {
      const answer = await reads(issueLocator(project, typedRef(ref ?? "")));
      if (answer.kind !== "issue") return reject(why(tracker, answer));
      ends.push(answer.issue);
    }
    const [from, to] = ends as [IssueRead, IssueRead];
    const suggestion: Suggestion = { from: { id: from.id, ref: from.ref }, kind: proposal.kind, to: { id: to.id, ref: to.ref }, quote: "", where: null };
    const named = label(suggestion, project.path);
    const rejectAs = (reason: string) => void rejected.push(`- ${named} — ${reason}`);
    if (from.id === to.id) return rejectAs("an Issue isn't Linked to itself");
    if (!pending.onScreen.includes(from.ref) && !pending.onScreen.includes(to.ref)) return rejectAs("neither Issue is on screen");
    const stands = standsIn(from, proposal.kind, to, project.path);
    if (stands) return rejectAs(stands);
    if (declined.has(declineKey(suggestion))) return void declinedBefore++;
    const quote = flat(proposal.quote?.replace(/^["“”'‘’\s]+|["“”'‘’\s]+$/g, "") ?? "");
    if (!quote) return rejectAs("it quotes nothing");
    const sourceAt = issueLocator(project, typedRef(proposal.source ?? ""));
    if (!pending.read.includes(sourceAt)) return rejectAs(`it quotes ${typed(proposal.source)}, whose text \`suggest\` didn't read`);
    const source = await threads(sourceAt);
    if (source.kind !== "thread") return rejectAs(`its source can't be read: ${why(tracker, source)}`);
    const where = whereIn(quote, source.thread, project.path);
    if (!where) return rejectAs(`the quote isn't in ${short(source.thread.ref, project.path)}'s text`);
    suggestion.quote = quote;
    suggestion.where = where;
    offered.push(suggestion);
  };
  for (const proposal of proposals) await check(proposal);
  // What the Map found itself stands on the Tracker's record rather than on a quote.
  for (const found of pending.found) {
    const [from, to] = [await reads(found.from.ref), await reads(found.to.ref)];
    if (from.kind !== "issue" || to.kind !== "issue") continue;
    const stands = standsIn(from.issue, found.kind, to.issue, project.path);
    if (stands) rejected.push(`- ${label(found, project.path)} — ${stands}`);
    else if (declined.has(declineKey(found))) declinedBefore++;
    else offered.push(found);
  }
  const unique = offered.filter((s, i) => offered.findIndex((other) => declineKey(other) === declineKey(s)) === i);
  const kept = unique.slice(0, OFFERED);
  await deps.pending.set({ ...pending, offered: kept.map(({ from, kind, to }) => ({ from, kind, to })) });

  const wont = wontWrite(bandOf({ untested: tracker.untested, links: said.links }), said.write);
  const lines = [
    kept.length === 0 ? "No Link Suggestions to offer." : `**Link Suggestions: ${count(kept.length)}** — none is drawn until it's written to ${tracker.product}`,
    ...kept.map((s, i) => `${i + 1}. ${label(s, project.path)} — ${s.where ? `"${s.quote}" (${s.where})` : `${s.quote} (found by the Map)`}`),
  ];
  if (unique.length > kept.length) lines.push(`… ${count(unique.length - kept.length)} more, held back: one multi-select holds ${OFFERED}. Offer them again once these are confirmed.`);
  if (rejected.length > 0) lines.push("", `Not offered: ${count(rejected.length)}`, ...rejected);
  if (declinedBefore > 0) lines.push("", `${count(declinedBefore)} declined before, not offered again.`);
  if (wont !== null && kept.length > 0) {
    lines.push("", `Not offered to write: ${wont}.`);
    return { text: lines.join("\n") };
  }
  if (kept.length === 0) return { text: lines.join("\n") };
  return { text: lines.join("\n"), confirm: { choices: kept.map((s) => ({ label: label(s, project.path), description: describe(s) })) } };
}

/**
 * Writes the offered suggestions `picked` names, by their numbers, each read
 * again first; the rest of those offered are declined. A refusal of a write
 * stops the rest.
 */
export async function confirm(deps: SuggestDeps, tracker: Tracker, project: Project, picked: number[]): Promise<string> {
  const pending = await pendingFor(deps, tracker, project);
  if (!pending || pending.offered.length === 0) return "Nothing to confirm: no Link Suggestions are offered. Run `issue-map suggest`, then `issue-map offer`.";
  const { offered } = pending;
  const wrong = picked.find((n) => !Number.isInteger(n) || n < 1 || n > offered.length);
  if (wrong !== undefined) return `Nothing written: there's no suggestion ${wrong}; they're numbered 1 to ${offered.length}.`;
  const said = await tracker.capabilities(project);
  if (said.kind !== "capabilities") return `Nothing written: ${why(tracker, said)}.`;
  const wont = wontWrite(bandOf({ untested: tracker.untested, links: said.links }), said.write);
  if (wont !== null) return `Nothing written: ${wont}.`;
  const viewer = await tracker.viewer();
  if (viewer.kind !== "viewer") return `Nothing written: ${why(tracker, viewer)}.`;
  const key: SnapshotKey = { tracker: tracker.host, project: project.id, login: viewer.login };

  const lines: string[] = [];
  let stopped = false;
  for (const n of [...new Set(picked)]) {
    const suggestion = offered[n - 1]!;
    const named = label(suggestion, project.path);
    if (stopped) {
      lines.push(`Not tried: ${named}.`);
      continue;
    }
    // Read again last, just before the write, so it never lands on what changed since it was offered.
    const [from, to] = [await tracker.issue(suggestion.from.ref), await tracker.issue(suggestion.to.ref)];
    if (from.kind !== "issue" || to.kind !== "issue") {
      lines.push(`Not written: ${named} — ${why(tracker, from.kind !== "issue" ? from : (to as Exclude<typeof to, { kind: "issue" }>))}.`);
      continue;
    }
    const stands = standsIn(from.issue, suggestion.kind, to.issue, project.path);
    if (stands === "already recorded") {
      lines.push(`${named} is already recorded.`);
      continue;
    }
    if (stands) {
      lines.push(`Not written: ${named} — ${stands}.`);
      continue;
    }
    const wrote = await tracker.link(from.issue.ref, suggestion.kind, to.issue.ref);
    if (wrote.kind === "linked") {
      lines.push(`Wrote ${named} to ${tracker.product}.`);
      await deps.store.linked(key, [
        { issue: from.issue.id, link: { role: FAR_ROLE[suggestion.kind], to: farEnd(to.issue) } },
        { issue: to.issue.id, link: { role: NEAR_ROLE[suggestion.kind], to: farEnd(from.issue) } },
      ]);
    } else if (wrote.kind === "cant-record" || wrote.kind === "not-found") {
      lines.push(`Not written: ${named} — ${wrote.reason}.`);
    } else {
      stopped = true;
      lines.push(`Not written: ${named} — ${wrote.kind === "not-allowed" ? `${tracker.product} refused the write — ${wrote.reason}` : why(tracker, wrote)}.`);
    }
  }
  const unpicked = offered.filter((_, i) => !picked.includes(i + 1));
  if (unpicked.length > 0) {
    await deps.declines.add(key, unpicked.map(declineKey));
    lines.push(`Declined ${count(unpicked.length)}: ${unpicked.map((s) => label(s, project.path)).join(", ")} won't be suggested again.`);
  }
  // The page stays read, so what was held back can be offered next.
  await deps.pending.set({ ...pending, offered: [] });
  return lines.join("\n");
}

/** The Issues on screen, as `issue` takes them; else why there are none to read. */
async function onScreen(store: SnapshotStore, key: SnapshotKey, project: Project, view: OnScreen): Promise<string[] | string> {
  if (view.kind === "card") return [issueLocator(project, typedRef(view.ref))];
  const state = await store.state(key);
  if (state.kind !== "ready") return `the Map of ${project.path} isn't drawn yet`;
  const shown = draw(state.snapshot, view).issues ?? [];
  return shown.length > 0 ? shown.map((ref) => issueLocator(project, ref)) : `no Issue of ${project.path} is on screen`;
}

/** This session's Link Suggestions, where they're for this Tracker's Project. */
async function pendingFor(deps: SuggestDeps, tracker: Tracker, project: Project): Promise<PendingSuggestions | null> {
  const pending = await deps.pending.get();
  return pending && pending.tracker === tracker.host && pending.project === project.id ? pending : null;
}

/**
 * The Links a blocker closed as a duplicate points at: the open Issue it
 * duplicates Blocks the Issue it Blocked, unless that's recorded already.
 */
async function duplicates(tracker: Tracker, issues: IssueRead[]): Promise<Suggestion[]> {
  const found: Suggestion[] = [];
  const reads = cached((locator: string) => tracker.issue(locator));
  for (const issue of issues) {
    for (const { role, to } of issue.links) {
      if (role !== "blocker" || !to.readable || to.open || !to.duplicateOf) continue;
      const answer = await reads(to.duplicateOf);
      if (answer.kind !== "issue") continue;
      const duplicate = answer.issue;
      if (!duplicate.open || duplicate.id === issue.id || standsIn(duplicate, "blocks", issue, issue.project)) continue;
      const at = (ref: string) => short(ref, issue.project);
      found.push({
        from: { id: duplicate.id, ref: duplicate.ref },
        kind: "blocks",
        to: { id: issue.id, ref: issue.ref },
        quote: `${at(to.ref)}, which Blocks ${at(issue.ref)}, closed as a duplicate of ${at(duplicate.ref)}`,
        where: null,
      });
    }
  }
  return found;
}

/**
 * Why a Link from `from` of `kind` to `to` can't be suggested as they are
 * now, or `null` where it can: an end closed, the Link or its reverse
 * recorded, or a Parent it would move `to` from.
 */
function standsIn(from: IssueRead, kind: LinkKind, to: IssueRead, project: string): string | null {
  for (const end of [from, to]) if (!end.open) return `${short(end.ref, project)} is closed`;
  const has = (issue: IssueRead, role: string, other: IssueRead) => issue.links.some((link) => link.role === role && link.to.id === other.id);
  if (has(from, FAR_ROLE[kind], to)) return "already recorded";
  if (kind !== "related" && has(to, FAR_ROLE[kind], from)) return `${short(to.ref, project)} is already ${VERB[kind]} ${short(from.ref, project)}`;
  const parent = kind === "parent" ? to.links.find((link) => link.role === "parent") : undefined;
  if (parent) {
    const named = parent.to.readable ? short(parent.to.ref, project) : "an Issue this login can't read";
    return `${short(to.ref, project)} already has a Parent, ${named}, and a Link Suggestion never moves an Issue from its Parent`;
  }
  return null;
}

/** One Issue's part of what `suggest` hands over: its name, Links and text, and what mentions of it say; `thread` is why it couldn't be read, where it couldn't. */
function issueSection(issue: IssueRead, thread: Thread | string, mentions: string[], project: string): string[] {
  const links = issue.links.map(({ role, to }) => `${ROLE_NAMES[role]} ${to.readable ? short(to.ref, project) : "an Issue this login can't read"}${to.readable && !to.open ? " (closed)" : ""}`);
  const lines = [`**${short(issue.ref, project)} ${issue.title}**`, links.length > 0 ? `Recorded: ${links.join(" · ")}` : "Recorded: no Links"];
  if (typeof thread === "string") return [...lines, `Its text couldn't be read: ${thread}.`, ...mentions];
  lines.push("Body:", cut(thread.body.trim(), BODY) || "(none)");
  let room = COMMENTS;
  const kept: string[] = [];
  for (const comment of [...thread.comments].reverse()) {
    const block = commentBlock({ ...comment, body: cut(comment.body.trim(), COMMENT) });
    if (block.length > room) break;
    kept.unshift(block);
    room -= block.length;
  }
  if (kept.length > 0) lines.push(`Comments, oldest first${kept.length < thread.comments.length ? `, the latest ${count(kept.length)} of ${count(thread.comments.length)}` : ""}:`, ...kept);
  return [...lines, ...mentions];
}

/** A Link as `suggest` names it from the Issue it's recorded on. */
const ROLE_NAMES = { blocker: "Blocked by", blocked: "Blocks", parent: "Parent", child: "Child", related: "Related to" } as const;

/** The lines of `thread` that name `issue`, at most about `MENTION` characters; `null` when none does. */
function naming(thread: Thread, issue: IssueRead, project: string): string | null {
  const number = /#(\d+)$/.exec(issue.ref)?.[1];
  const names = [issue.ref, issue.url, ...(thread.ref.startsWith(`${project}#`) && number ? [`#${number}`] : [])];
  const text = [thread.body, ...thread.comments.map((c) => c.body)].join("\n");
  const lines = text.split("\n").filter((line) => names.some((name) => new RegExp(`(?<![\\w/#])${escape(name)}(?!\\d)`).test(line)));
  if (lines.length === 0) return null;
  const said = lines.map((line) => line.trim()).join(" … ");
  return said.length <= MENTION ? said : `${said.slice(0, MENTION - 1)}…`;
}

/** Where `quote` is word for word in the Issue's text, such as `#12's body`, whatever its line breaks; `null` where it isn't. */
function whereIn(quote: string, thread: Thread, project: string): string | null {
  const wanted = flat(quote);
  const ref = short(thread.ref, project);
  if (flat(thread.title).includes(wanted)) return `${ref}'s title`;
  if (flat(thread.body).includes(wanted)) return `${ref}'s body`;
  const comment = thread.comments.find((c) => flat(c.body).includes(wanted));
  return comment ? `${comment.author ?? "a deleted account"}'s comment on ${ref}, ${comment.at.slice(0, 10)}` : null;
}

/** `text` with each run of whitespace one space, as a quote spanning lines reads. */
function flat(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Which kinds may be suggested here, and why the others may not. */
function kindsLine(links: LinkKinds): string {
  const able = KINDS.filter(([kind]) => links[kind].kind === "readable").map(([, name]) => name);
  const others = KINDS.flatMap(([kind, name]) => {
    const answer = links[kind];
    return answer.kind === "readable" ? [] : [` ${name}: ${answer.reason}.`];
  });
  if (able.length === 0) return `No kind of Link can be suggested here.${others.join("")}`;
  return `Kinds to suggest: ${able.join(", ")} — the only ones this Project records.${others.join("")}`;
}

/** A kind of Link by its name in the glossary, such as `Blocks`. */
function kindName(kind: LinkKind): string {
  return KINDS.find(([k]) => k === kind)![1];
}

/** A suggestion as the list and its choice name it, such as `#6 Blocks #1`. */
function label({ from, kind, to }: Planned, project: string): string {
  return `${short(from.ref, project)} ${VERB[kind]} ${short(to.ref, project)}`;
}

/** A suggestion's choice in the multi-select: its quote and where it is, or what the Map found. */
function describe({ quote, where }: Suggestion): string {
  if (!where) return `${quote} — found by the Map`;
  return `"${quote.length <= QUOTE ? quote : `${quote.slice(0, QUOTE - 1)}…`}" — ${where}`;
}

/** What a declined suggestion is remembered by: its ends' identities and its kind; a Related Link has no direction. */
function declineKey({ from, kind, to }: Planned): string {
  const ends = kind === "related" ? [from.id, to.id].sort() : [from.id, to.id];
  return `${ends[0]} ${kind} ${ends[1]}`;
}

/** `issue` as the far end of a Link that the Snapshot holds. */
function farEnd(issue: IssueRead): FarEnd {
  return { id: issue.id, readable: true, open: issue.open, project: issue.project, ref: issue.ref, title: issue.title, url: issue.url };
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `read`, each argument read once. */
function cached<T>(read: (locator: string) => Promise<T>): (locator: string) => Promise<T> {
  const known = new Map<string, Promise<T>>();
  return (locator) => {
    let found = known.get(locator);
    if (!found) known.set(locator, (found = read(locator)));
    return found;
  };
}

/** `each` of `items`, `AT_ONCE` at a time, the answers in `items`' order. */
async function inTurn<T, U>(items: T[], each: (item: T) => Promise<U>): Promise<U[]> {
  const answers: U[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const at = next++;
      answers[at] = await each(items[at]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, items.length) }, worker));
  return answers;
}
