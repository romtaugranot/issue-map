/**
 * Live reads of the fixture Projects (ADR 0004's nightly tier, and each job
 * of the GitLab version matrix): the real adapters, through the login `gh`
 * or `glab` holds, must read exactly what `fixtures.ts` declares. What they
 * read differently is a Tracker's behaviour drifting, and fails.
 *
 * Kept out of `npm test`; `npm run test:live` runs it. It reads nothing
 * unless told which Fixtures to read:
 *
 * - `ISSUE_MAP_LIVE`: the Fixtures, comma-separated: `github`, `gitlab-free`, `gitlab-oss`.
 * - `ISSUE_MAP_LIVE_GITLAB_HOST`: where the GitLab Fixtures are read, `gitlab.com` by default; the version matrix points it at its own GitLab.
 *
 * The login comes from `gh` and `glab` as always, such as `GH_TOKEN`, or `GITLAB_TOKEN` with `GITLAB_HOST`.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { anonymousHttp, atLeast, processCli } from "../../src/tracker/boundary.ts";
import { github } from "../../src/tracker/github.ts";
import { gitlab, SINCE } from "../../src/tracker/gitlab.ts";
import { trackers, type IssueRead, type Link, type OpenIssue, type Project, type Tracker } from "../../src/tracker/tracker.ts";
import { bandOf } from "../../src/map/band.ts";
import { githubSeeding, gitlabSeeding } from "../../scripts/fixtures/seed.ts";
import { FIXTURES, title, type Fixture, type FixtureIssue } from "./fixtures.ts";

const asked = (process.env.ISSUE_MAP_LIVE ?? "").split(",").map((name) => name.trim()).filter(Boolean);
const unknown = asked.filter((name) => !(name in FIXTURES));
if (unknown.length > 0) throw new Error(`ISSUE_MAP_LIVE names no Fixture ${unknown.join(", ")}; there are ${Object.keys(FIXTURES).join(", ")}`);

for (const fixture of Object.values(FIXTURES)) {
  const skip = asked.includes(fixture.name) ? undefined : `ISSUE_MAP_LIVE doesn't name ${fixture.name}`;
  const host = fixture.name === "github" ? fixture.host : (process.env.ISSUE_MAP_LIVE_GITLAB_HOST ?? fixture.host);
  describe(`${fixture.name} read live at ${host}`, { skip }, () => liveReads(fixture, host));
}

function liveReads(fixture: Fixture, host: string): void {
  const deps = { cli: processCli, http: anonymousHttp, env: process.env };
  let tracker: Tracker;
  const declared = fixture.projects.flatMap((project) => project.issues);
  const byTitle = new Map(declared.map((issue) => [title(issue), issue]));

  test("the Tracker is one the Map promises everything on", async () => {
    const found = await trackers([github(deps), gitlab(deps)]).at(host);
    assert.equal(found.kind, "identified", JSON.stringify(found));
    tracker = (found as Extract<typeof found, { kind: "identified" }>).tracker;
    assert.equal(tracker.untested, null, `${host} runs ${tracker.product} ${tracker.version}`);
    const viewer = await tracker.viewer();
    assert.equal(viewer.kind, "viewer", JSON.stringify(viewer));
  });

  for (const spec of fixture.projects.filter((p) => !p.namespace)) {
    describe(spec.path, () => {
      let project: Project;
      const open: OpenIssue[] = [];
      /** Before 17.1 GitLab doesn't list merge requests with the Issues they close, and the Map says so rather than read them. */
      const closingUnread = () => tracker.product === "GitLab" && tracker.version !== null && !atLeast(tracker.version, SINCE.closingMergeRequests);

      test("it resolves, and every open Issue it declares is read, and no other", async () => {
        const resolved = await tracker.resolveProject(spec.path);
        assert.equal(resolved.kind, "project", JSON.stringify(resolved));
        project = (resolved as Extract<typeof resolved, { kind: "project" }>).project;
        for (let after: string | null = null, first = true; first || after !== null; first = false) {
          const page = await tracker.openIssues(project, after);
          assert.equal(page.kind, "page", JSON.stringify(page));
          const read = page as Extract<typeof page, { kind: "page" }>;
          if (closingUnread()) assert.match(read.unread.closingRequests ?? "", /doesn't list merge requests/, "why Closing Requests aren't read");
          else assert.equal(read.unread.closingRequests, undefined, "Closing Requests are read");
          open.push(...read.issues);
          after = read.next;
        }
        const expected = spec.issues.filter((issue) => !issue.closed).map(title).sort();
        assert.deepEqual(open.map((issue) => issue.title).sort(), expected);
      });

      test("each open Issue has exactly the Links, level and Closing Requests declared", () => {
        for (const issue of open) {
          const spec = byTitle.get(issue.title)!;
          assert.deepEqual(linksRead(issue.links), linksDeclared(fixture, spec), `${issue.title}'s Links`);
          assert.equal(issue.taskLevel, spec.level === "task", `${issue.title}'s level`);
          assert.equal(issue.closingRequests.length > 0, !!spec.closingRequest && !closingUnread(), `${issue.title}'s Closing Requests`);
        }
      });

      test("a closed blocker is read closed, and how it closed where the Tracker says", () => {
        for (const { to } of open.flatMap((issue) => issue.links)) {
          if (!to.readable || to.open) continue;
          const spec = byTitle.get(to.title);
          assert.ok(spec?.closed, `${to.title} is closed, but declared open`);
          const how = typeof spec.closed === "object" ? "duplicate" : spec.closed;
          assert.equal(to.closedAs, fixture.expect.saysClosedAs.includes(how) ? how : undefined, `how ${to.title} closed`);
        }
      });

      test("the Tracker says which Link kinds the Project records, and the Map calls it Promised", async () => {
        const said = await tracker.capabilities(project);
        assert.equal(said.kind, "capabilities", JSON.stringify(said));
        const { links } = said as Extract<typeof said, { kind: "capabilities" }>;
        assert.deepEqual(Object.fromEntries(Object.entries(links).map(([kind, answer]) => [kind, answer.kind])), fixture.expect.links);
        assert.equal(bandOf({ untested: tracker.untested, links }).kind, "promised");
      });

      test("a refresh reads what changed since yesterday", async () => {
        const changes = await tracker.changes(project, new Date(Date.now() - 86_400_000).toISOString(), []);
        assert.equal(changes.kind, "changes", JSON.stringify(changes));
      });

      test("each closed Issue's card says it's closed, and how where the Tracker says", async () => {
        const seeding = tracker.product === "GitHub" ? githubSeeding(processCli, host) : gitlabSeeding(processCli, host);
        const held = await seeding.issues(spec);
        for (const issue of spec.issues.filter((i) => i.closed)) {
          const ref = held.find((h) => h.title === title(issue))?.ref;
          assert.ok(ref, `${title(issue)} isn't there`);
          const card = await tracker.issue(ref);
          assert.equal(card.kind, "issue", JSON.stringify(card));
          const read: IssueRead = (card as Extract<typeof card, { kind: "issue" }>).issue;
          const how = typeof issue.closed === "object" ? "duplicate" : issue.closed!;
          assert.deepEqual([read.open, read.closedAs], [false, fixture.expect.saysClosedAs.includes(how) ? how : null], title(issue));
        }
      });

      test("an open Issue's thread is read for starting work on it", async () => {
        const first = open[0];
        assert.ok(first);
        const thread = await tracker.thread(`${project.path}${first.ref}`);
        assert.equal(thread.kind, "thread", JSON.stringify(thread));
      });
    });
  }
}

/** The Links read, as `role title` of each far end; one this login can't read has no title, and the Fixtures hold none. */
function linksRead(links: Link[]): string[] {
  return links.map(({ role, to }) => `${role} ${to.readable ? to.title : "(unreadable)"}`).sort();
}

/** The Links the Fixture declares at `issue`, as `role title` of each far end, seen from `issue`. */
function linksDeclared(fixture: Fixture, issue: FixtureIssue): string[] {
  const named = (key: string) => title(fixture.projects.flatMap((p) => p.issues).find((i) => i.key === key)!);
  return fixture.links
    .flatMap(([a, kind, b]) => {
      if (b === issue.key) return [`${{ blocks: "blocker", parent: "parent", related: "related" }[kind]} ${named(a)}`];
      if (a === issue.key) return [`${{ blocks: "blocked", parent: "child", related: "related" }[kind]} ${named(b)}`];
      return [];
    })
    .sort();
}
