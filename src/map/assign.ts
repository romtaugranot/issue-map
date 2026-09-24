/**
 * Assigning an Issue to the viewer from its card: the Map's first write.
 * The Issue is read again first, so the write never lands on one someone
 * took since (ADR 0006), and the write happens only on a Promised Project
 * (ADR 0003). Where the Tracker can't say whether this login may write, it
 * tries once and stops at the first refusal. Once written, the Snapshot
 * takes it in, so the card and Take next show it at once.
 */
import type { SnapshotStore } from "../snapshot/store.ts";
import type { IssueRead, Project, Tracker } from "../tracker/tracker.ts";
import { bandOf, wontWrite } from "./band.ts";
import { issueLocator, showCard, typedRef, why, type ShownCard } from "./show.ts";
import { short } from "./text.ts";

/**
 * Assigns the Issue `typed` names in the Project on screen to the viewer,
 * and shows its card as it is now; one it didn't assign says why first.
 */
export async function assignToViewer({ store }: { store: SnapshotStore }, tracker: Tracker, project: Project, typed: string): Promise<ShownCard> {
  const ref = typedRef(typed);
  const refusal = (reason: string): ShownCard => ({ text: `Not assigned: ${reason}.`, choices: [], opened: false });
  const viewer = await tracker.viewer();
  if (viewer.kind !== "viewer") return refusal(why(tracker, viewer));
  const said = await tracker.capabilities(project);
  if (said.kind !== "capabilities") return refusal(why(tracker, said));
  const wont = wontWrite(bandOf({ untested: tracker.untested, links: said.links }), said.write);
  if (wont !== null) return refusal(wont);

  // Read again last, just before the write, so it never lands on an Issue someone took since the Map read it.
  const answer = await tracker.issue(issueLocator(project, ref));
  if (answer.kind !== "issue") return refusal(why(tracker, answer));
  const read = answer.issue;
  const shortRef = short(read.ref, project.path);
  /** `line`, then the card of the Issue as it is now. */
  const withCard = async (line: string, issue: IssueRead = read) => {
    const card = await showCard(tracker, project, ref, 1, issue);
    return { ...card, text: `${line}\n\n${card.text}` };
  };
  if (read.project !== project.path) return withCard(`Not assigned: ${shortRef} is an Outside Issue, in ${read.project}; assign it from that Project's Map.`);
  if (!read.open) return withCard(`Not assigned: ${shortRef} is closed.`);
  if (read.assignees.includes(viewer.login)) return withCard(`${shortRef} is already assigned to you.`);
  if (read.assignees.length > 0) return withCard(`Not assigned: ${tracker.product} says ${shortRef} is assigned to ${read.assignees.join(", ")} now.`);

  const wrote = await tracker.assign(read.ref, viewer.login);
  if (wrote.kind === "not-allowed") return refusal(`${tracker.product} refused the write — ${wrote.reason}`);
  if (wrote.kind !== "assigned") return refusal(why(tracker, wrote));
  await store.assigned({ tracker: tracker.host, project: project.id, login: viewer.login }, read.id, wrote.assignees);
  return withCard(`Assigned ${shortRef} to you on ${tracker.product}.`, { ...read, assignees: wrote.assignees });
}
