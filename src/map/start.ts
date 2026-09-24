/**
 * Starting work on an Issue from its card: the Issue's body and comments,
 * read live (need 8), handed to the conversation for Claude to brief the
 * user from. Nothing else starts: no branch, no editor, no workflow. A long
 * thread is cut to a fixed budget, keeping the start and end of each long
 * text and the latest comments, and says what it left out.
 */
import type { IssueComment, Project, Thread, Tracker } from "../tracker/tracker.ts";
import { issueLocator, typedRef, why } from "./show.ts";
import { count, cut, plural, short } from "./text.ts";

/** The most characters a thread is handed over in, however long it is. */
export const THREAD_BUDGET = 12_000;
/** The most of the body kept, and of each comment. */
const BODY = 4_000;
const COMMENT = 1_500;
/** Kept for the comments' heading, which says how many were left out. */
const HEADING = 100;

/** The thread of the Issue `typed` names in the Project on screen; one that can't be read says why. */
export async function startWork(tracker: Tracker, project: Project, typed: string): Promise<string> {
  const ref = typedRef(typed);
  const answer = await tracker.thread(issueLocator(project, ref));
  if (answer.kind !== "thread") return `Can't start work on ${ref}: ${why(tracker, answer)}.`;
  return drawThread(answer.thread, project.path);
}

/** Pure. `project` is the path of the Project whose Map it's started from. */
export function drawThread(thread: Thread, project: string): string {
  const head = [
    `**${short(thread.ref, project)} ${thread.title}**`,
    thread.url,
    `${thread.open ? "Open" : "Closed"} · ${commentCount(thread)}`,
    "",
    "**Body**",
    cut(thread.body.trim(), BODY) || "(none)",
  ].join("\n");
  if (thread.comments.length === 0) return head;
  // The latest first, while they fit.
  let room = THREAD_BUDGET - head.length - HEADING;
  const kept: string[] = [];
  for (const comment of [...thread.comments].reverse()) {
    const text = `\n\n${commentBlock(comment)}`;
    if (text.length > room) break;
    kept.unshift(text);
    room -= text.length;
  }
  const left = thread.comments.length - kept.length;
  const heading = `**Comments**, oldest first${left > 0 ? ` — the ${count(left)} earlier ${left === 1 ? "one is" : "ones are"} left out, to keep this short` : ""}`;
  return `${head}\n\n${heading}${kept.join("")}`;
}

/** How many comments it has, or how many were read where there are earlier ones. */
function commentCount({ comments, earlier }: Thread): string {
  if (earlier) return `the latest ${plural(comments.length, "comment")} read; earlier ones weren't`;
  return comments.length === 0 ? "no comments" : plural(comments.length, "comment");
}

/** One comment: who wrote it and when, then what it says, cut to fit. */
export function commentBlock({ author, at, body }: IssueComment): string {
  return `${author ?? "a deleted account"} on ${at.slice(0, 10)}:\n${cut(body.trim(), COMMENT)}`;
}

