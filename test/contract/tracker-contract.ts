/**
 * One contract suite for every Tracker adapter (spec, Seam B), covering
 * needs 1 and 2 including their "can't tell" answers. Each adapter supplies
 * a Stage that stands a World up behind its own boundary.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Project, ProjectResolution, Tracker, TrackerKind } from "../../src/tracker/tracker.ts";

export interface ProjectSpec {
  path: string;
  /** Distinct per Project in a World; not the Project's identity as the Tracker states it. */
  number: number;
  open: number | "off";
  parent?: ProjectSpec;
  /** Paths the Project had before it was renamed or moved. */
  oldPaths?: string[];
}

export interface World {
  /** What answers at each host other than the well-known one. A host not listed can't be reached. */
  servers?: Record<string, { runs: "this-kind"; version: string } | { runs: "something-else" }>;
  projects?: ProjectSpec[];
  login?: "ok" | "none" | "refused";
  cli?: "installed" | "missing";
  /** Hosts besides the well-known one that the CLI holds a login for. */
  loggedInTo?: string[];
  /** Whether the well-known host can be reached. */
  network?: "up" | "down";
}

export interface Stage {
  product: string;
  /** A host this kind is known to run at by name alone. */
  wellKnownHost: string;
  /** Builds the adapter against a World, counts requests that left the machine, and lists the hosts the CLI's login was sent to. */
  arrange(world: World): { kind: TrackerKind; requests(): number; loginsSentTo(): string[] };
}

/** The whole contract: every need an adapter answers. */
export function trackerContract(stage: Stage): void {
  identifyContract(stage);
  resolveContract(stage);
}

export function identifyContract(stage: Stage): void {
  const { product, wellKnownHost } = stage;

  describe(`${product} Tracker contract`, () => {
    describe("need 1: identify a Tracker at an address", () => {
      test("recognises its well-known host by name, without the network", async () => {
        const { kind, requests } = stage.arrange({});
        const tracker = await kind.recognise(wellKnownHost);
        assert.equal(tracker?.product, product);
        assert.equal(tracker?.host, wellKnownHost);
        assert.equal(requests(), 0);
      });

      test("does not claim an unfamiliar host by name alone", async () => {
        const { kind, requests } = stage.arrange({});
        assert.equal(await kind.recognise("git.example.com"), null);
        assert.equal(requests(), 0);
      });

      test("identifies a self-hosted Tracker and its version, anonymously where it can", async () => {
        const { kind } = stage.arrange({
          servers: { "git.example.com": { runs: "this-kind", version: "3.17.2" } },
          loggedInTo: ["git.example.com"],
        });
        const answer = await kind.probe("git.example.com");
        assert.equal(answer.kind, "identified");
        const { tracker } = answer as Extract<typeof answer, { kind: "identified" }>;
        assert.deepEqual([tracker.product, tracker.host, tracker.version], [product, "git.example.com", "3.17.2"]);
      });

      test("lends the login to no host it found only by probing", async () => {
        const { kind, loginsSentTo } = stage.arrange({ servers: { "git.example.com": { runs: "this-kind", version: "3.17.2" } } });
        assert.equal((await kind.probe("git.example.com")).kind, "identified");
        assert.deepEqual(loginsSentTo(), []);
      });

      test("says a host running something else is not this kind", async () => {
        const { kind } = stage.arrange({ servers: { "git.example.com": { runs: "something-else" } } });
        assert.deepEqual(await kind.probe("git.example.com"), { kind: "not-this-kind" });
      });

      test("can't tell when the host can't be reached, and names it", async () => {
        const { kind } = stage.arrange({});
        const answer = await kind.probe("git.example.com");
        assert.equal(answer.kind, "cant-tell");
        assert.match((answer as { reason: string }).reason, /git\.example\.com/);
      });
    });
  });
}

export function resolveContract(stage: Stage): void {
  const { product, wellKnownHost } = stage;

  async function trackerIn(world: World): Promise<Tracker> {
    const tracker = await stage.arrange(world).kind.recognise(wellKnownHost);
    assert.ok(tracker, `${product} recognises ${wellKnownHost}`);
    return tracker;
  }

  async function resolved(world: World, path: string): Promise<{ project: Project; parent: Project | null }> {
    const answer = await (await trackerIn(world)).resolveProject(path);
    assert.equal(answer.kind, "project", JSON.stringify(answer));
    return answer as Extract<ProjectResolution, { kind: "project" }>;
  }

  describe(`${product} Tracker contract`, () => {
    describe("need 2: resolve a Project", () => {
      const tofu: ProjectSpec = { path: "opentofu/opentofu", number: 1, open: 274 };

      test("resolves a Project to its path, URL and open-Issue count", async () => {
        const { project, parent } = await resolved({ projects: [tofu] }, "opentofu/opentofu");
        assert.equal(project.host, wellKnownHost);
        assert.equal(project.path, "opentofu/opentofu");
        assert.match(project.url, /opentofu\/opentofu$/);
        assert.deepEqual(project.issues, { open: 274 });
        assert.equal(parent, null);
      });

      test("says when a Project has Issues turned off", async () => {
        const { project } = await resolved({ projects: [{ path: "tools/mirror", number: 2, open: "off" }] }, "tools/mirror");
        assert.equal(project.issues, "off");
      });

      test("names a fork's parent with the parent's own open-Issue count", async () => {
        const upstream: ProjectSpec = { path: "cli/cli", number: 3, open: 1028 };
        const fork: ProjectSpec = { path: "fixture-user/cli", number: 4, open: "off", parent: upstream };
        const { project, parent } = await resolved({ projects: [fork, upstream] }, "fixture-user/cli");
        assert.equal(project.issues, "off");
        assert.equal(parent?.path, "cli/cli");
        assert.deepEqual(parent?.issues, { open: 1028 });
        assert.notEqual(parent?.id, project.id);
      });

      test("an old path resolves to the Project's current path and the same identity", async () => {
        const moved: ProjectSpec = { path: "new-org/tool", number: 5, open: 3, oldPaths: ["old-org/tool"] };
        const byOld = await resolved({ projects: [moved] }, "old-org/tool");
        const byNew = await resolved({ projects: [moved] }, "new-org/tool");
        assert.equal(byOld.project.path, "new-org/tool");
        assert.equal(byOld.project.id, byNew.project.id);
      });

      test("says when there is no such Project", async () => {
        const answer = await (await trackerIn({ projects: [tofu] })).resolveProject("nobody/nothing");
        assert.equal(answer.kind, "not-found");
        assert.match((answer as { reason: string }).reason, /nobody\/nothing/);
      });

      test("refuses without a login, and says how to log in", async () => {
        const answer = await (await trackerIn({ projects: [tofu], login: "none" })).resolveProject("opentofu/opentofu");
        assert.equal(answer.kind, "refused");
        assert.match((answer as { reason: string }).reason, /log ?in/i);
      });

      test("refuses when the Tracker rejects the login", async () => {
        const answer = await (await trackerIn({ projects: [tofu], login: "refused" })).resolveProject("opentofu/opentofu");
        assert.equal(answer.kind, "refused");
        assert.match((answer as { reason: string }).reason, new RegExp(wellKnownHost.replaceAll(".", "\\.")));
      });

      test("refuses when there is no CLI to borrow a login from", async () => {
        const answer = await (await trackerIn({ projects: [tofu], cli: "missing" })).resolveProject("opentofu/opentofu");
        assert.equal(answer.kind, "refused");
        assert.match((answer as { reason: string }).reason, /install/i);
      });

      test("refuses a Project on a host found only by probing, without sending it the login", async () => {
        const { kind, loginsSentTo } = stage.arrange({ servers: { "git.example.com": { runs: "this-kind", version: "3.17.2" } }, projects: [tofu] });
        const answer = await kind.probe("git.example.com");
        assert.equal(answer.kind, "identified");
        const resolved = await (answer as Extract<typeof answer, { kind: "identified" }>).tracker.resolveProject("opentofu/opentofu");
        assert.equal(resolved.kind, "refused");
        assert.match((resolved as { reason: string }).reason, /log ?in/i);
        assert.deepEqual(loginsSentTo(), []);
      });

      test("can't tell when the Tracker can't be reached, and names it", async () => {
        const answer = await (await trackerIn({ projects: [tofu], network: "down" })).resolveProject("opentofu/opentofu");
        assert.equal(answer.kind, "cant-tell");
        assert.match((answer as { reason: string }).reason, new RegExp(wellKnownHost.replaceAll(".", "\\.")));
      });
    });
  });
}
