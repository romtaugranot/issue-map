/**
 * The fixture Projects the live reads assert on, and the seeder writes
 * (spec #25, Seam B): the Link shapes the Map has to read, declared once as
 * data. They live in project-owned GitHub organisations and GitLab.com
 * groups, never a personal account, and name no person, private Project or
 * machine. `docs/fixtures.md` says how they're set up.
 */
import { fileURLToPath } from "node:url";
import type { LinkKind } from "../../src/tracker/tracker.ts";

/** Where the fixtures live: renaming one is an edit here and nowhere else. */
export const NAMESPACES = {
  /** Two organisations, so an Outside Issue can be in another organisation's Project. */
  github: { main: "issue-map-fixtures", other: "issue-map-fixtures-b" },
  /** GitLab.com groups: one on Free, one whose tier comes from GitLab for Open Source. */
  gitlab: { free: "issue-map-fixtures", oss: "issue-map-fixtures-oss" },
} as const;

export type FixtureName = "github" | "gitlab-free" | "gitlab-oss";

export interface FixtureIssue {
  /** Unique in its Fixture; the Issue's title starts with it in brackets, which is how the seeder finds it again. */
  key: string;
  title: string;
  /** A GitLab task, under an ordinary Issue; or a GitLab group's epic. An ordinary Issue by default. */
  level?: "task" | "epic";
  /** Closed, and how; a duplicate names the key of the Issue it duplicates. Open by default. */
  closed?: "completed" | "not planned" | { duplicateOf: string };
  /** An open pull or merge request closes it. */
  closingRequest?: boolean;
}

export interface FixtureProject {
  path: string;
  /** Not a Project but the group above them, holding Issues of its own: epics. */
  namespace?: boolean;
  issues: FixtureIssue[];
}

export interface Fixture {
  name: FixtureName;
  /** The Tracker it lives on by default. The GitLab Free Fixture seeds any GitLab, such as one the version matrix runs. */
  host: string;
  /** The organisations or groups it needs; the seeder creates Projects in them, never the namespaces themselves unless told to. */
  namespaces: string[];
  projects: FixtureProject[];
  /** By key: `[a, "blocks", b]` reads "a Blocks b"; `[a, "parent", b]` "a is the Parent of b"; `[a, "related", b]` "a is Related to b". */
  links: [string, LinkKind, string][];
  /** What the Tracker must say of every Project here: which Link kinds it records, and how it says a closed Issue closed. */
  expect: {
    links: Record<LinkKind, "readable" | "cant-record">;
    /** The ways of closing the Tracker names; one it doesn't name reads as not said. */
    saysClosedAs: ("completed" | "not planned" | "duplicate")[];
  };
}

export function title({ key, title }: FixtureIssue): string {
  return `[${key}] ${title}`;
}

const gh = NAMESPACES.github;

/**
 * github.com: a Blocks chain, a Parent tree reaching into another Project,
 * blockers closed each way GitHub says, a Closing Request, an Unlinked
 * Issue, and an Outside Issue in the other organisation. GitHub records no
 * Related Links and has no level below an Issue.
 */
const GITHUB: Fixture = {
  name: "github",
  host: "github.com",
  namespaces: [gh.main, gh.other],
  projects: [
    {
      path: `${gh.main}/map`,
      issues: [
        { key: "b1", title: "Lay the foundation" },
        { key: "b2", title: "Build the walls" },
        { key: "b3", title: "Put on the roof" },
        { key: "p1", title: "Plan the release" },
        { key: "p2", title: "Write the release notes" },
        { key: "p3", title: "Tag the build" },
        { key: "p4", title: "Proofread the release notes" },
        { key: "c1", title: "Retire the old API", closed: "completed" },
        { key: "u1", title: "Remove the compatibility shims" },
        { key: "c2", title: "Try the parser rewrite", closed: "not planned" },
        { key: "u2", title: "Keep the old parser working" },
        { key: "d1", title: "Crash on empty input" },
        { key: "c3", title: "Crash when the input is empty", closed: { duplicateOf: "d1" } },
        { key: "u3", title: "Release the parser fix" },
        { key: "r1", title: "Fix the typo in the README", closingRequest: true },
        { key: "o1", title: "Adopt the shared config" },
        { key: "n1", title: "Tidy the changelog" },
      ],
    },
    { path: `${gh.main}/site`, issues: [{ key: "s1", title: "Update the website for the release" }] },
    { path: `${gh.other}/elsewhere`, issues: [{ key: "x1", title: "Publish the shared config" }] },
  ],
  links: [
    ["b1", "blocks", "b2"],
    ["b2", "blocks", "b3"],
    ["p1", "parent", "p2"],
    ["p1", "parent", "p3"],
    ["p2", "parent", "p4"],
    ["p1", "parent", "s1"],
    ["c1", "blocks", "u1"],
    ["c2", "blocks", "u2"],
    ["c3", "blocks", "u3"],
    ["x1", "blocks", "o1"],
  ],
  expect: { links: { blocks: "readable", parent: "readable", related: "cant-record" }, saysClosedAs: ["completed", "not planned", "duplicate"] },
};

const free = NAMESPACES.gitlab.free;

/**
 * GitLab Free: Related strands, tasks under an Issue, a duplicate, a
 * Closing Request and an Outside Issue in another Project. Free records no
 * Blocks Links and has no epics, so it holds none. Everything here is
 * Free, so the version matrix seeds it on every GitLab it runs, CE and EE.
 */
const GITLAB_FREE: Fixture = {
  name: "gitlab-free",
  host: "gitlab.com",
  namespaces: [free],
  projects: [
    {
      path: `${free}/map`,
      issues: [
        { key: "r1", title: "Draft the style guide" },
        { key: "r2", title: "Collect examples for the style guide" },
        { key: "r3", title: "Review the style guide" },
        { key: "t1", title: "Set up continuous integration" },
        { key: "t1a", title: "Add the lint job", level: "task" },
        { key: "t1b", title: "Add the test job", level: "task" },
        { key: "m1", title: "Fix the broken link in the footer", closingRequest: true },
        { key: "d1", title: "Footer link goes nowhere", closed: { duplicateOf: "m1" } },
        { key: "o1", title: "Adopt the shared config" },
        { key: "n1", title: "Tidy the changelog" },
      ],
    },
    { path: `${free}/elsewhere`, issues: [{ key: "x1", title: "Publish the shared config" }] },
  ],
  links: [
    ["r1", "related", "r2"],
    ["r2", "related", "r3"],
    ["t1", "parent", "t1a"],
    ["t1", "parent", "t1b"],
    ["x1", "related", "o1"],
  ],
  expect: { links: { blocks: "cant-record", parent: "readable", related: "readable" }, saysClosedAs: ["duplicate"] },
};

const oss = NAMESPACES.gitlab.oss;

/**
 * GitLab's licensed tier, from GitLab for Open Source: Blocks chains, a
 * closed blocker, an epic's Parent tree over Issues and a task, Related
 * Links, a Closing Request, and an Outside Issue Blocking across Projects.
 */
const GITLAB_OSS: Fixture = {
  name: "gitlab-oss",
  host: "gitlab.com",
  namespaces: [oss],
  projects: [
    { path: oss, namespace: true, issues: [{ key: "e1", title: "Ship version two", level: "epic" }] },
    {
      path: `${oss}/map`,
      issues: [
        { key: "b1", title: "Lay the foundation" },
        { key: "b2", title: "Build the walls" },
        { key: "b3", title: "Put on the roof" },
        { key: "c1", title: "Retire the old API", closed: "completed" },
        { key: "u1", title: "Remove the compatibility shims" },
        { key: "p1", title: "Migrate the data" },
        { key: "p1a", title: "Write the migration script", level: "task" },
        { key: "p2", title: "Switch the traffic over" },
        { key: "r1", title: "Draft the style guide" },
        { key: "r2", title: "Review the style guide" },
        { key: "m1", title: "Fix the broken link in the footer", closingRequest: true },
        { key: "o1", title: "Adopt the shared config" },
      ],
    },
    { path: `${oss}/elsewhere`, issues: [{ key: "x1", title: "Publish the shared config" }] },
  ],
  links: [
    ["b1", "blocks", "b2"],
    ["b2", "blocks", "b3"],
    ["c1", "blocks", "u1"],
    ["e1", "parent", "p1"],
    ["e1", "parent", "p2"],
    ["p1", "parent", "p1a"],
    ["r1", "related", "r2"],
    ["x1", "blocks", "o1"],
  ],
  expect: { links: { blocks: "readable", parent: "readable", related: "readable" }, saysClosedAs: ["duplicate"] },
};

export const FIXTURES: Record<FixtureName, Fixture> = { github: GITHUB, "gitlab-free": GITLAB_FREE, "gitlab-oss": GITLAB_OSS };

/** `node test/live/fixtures.ts names`: the namespaces as shell assignments, for the setup wizard and the workflows, so they're named here alone. */
if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === "names") {
  const { github, gitlab } = NAMESPACES;
  console.log(`GH_MAIN=${github.main}\nGH_OTHER=${github.other}\nGL_FREE=${gitlab.free}\nGL_OSS=${gitlab.oss}`);
}
