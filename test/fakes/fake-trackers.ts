/** An in-memory stand-in for the Tracker seam, for testing what sits above it. */
import type { Identification, Project, ProjectResolution, Tracker, Trackers } from "../../src/tracker/tracker.ts";

export interface FakeProject {
  path: string;
  open: number | "off";
  parent?: FakeProject;
  oldPaths?: string[];
}

export interface FakeHost {
  product: string;
  projects?: FakeProject[];
  /** Every Project read here is refused with this reason. */
  refuse?: string;
  /** Every Project read here can't be told, with this reason. */
  unreachable?: string;
}

/** Hosts not listed run something that isn't a Tracker. */
export function fakeTrackers(hosts: Record<string, FakeHost>): Trackers & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    async at(host): Promise<Identification> {
      const fake = hosts[host];
      return fake ? { kind: "identified", tracker: tracker(host, fake, reads) } : { kind: "not-this-kind" };
    },
  };
}

function tracker(host: string, fake: FakeHost, reads: string[]): Tracker {
  return {
    product: fake.product,
    host,
    version: null,
    async resolveProject(path): Promise<ProjectResolution> {
      reads.push(`${host}/${path}`);
      if (fake.refuse) return { kind: "refused", reason: fake.refuse };
      if (fake.unreachable) return { kind: "cant-tell", reason: fake.unreachable };
      const found = (fake.projects ?? []).find((p) => [p.path, ...(p.oldPaths ?? [])].includes(path));
      if (!found) return { kind: "not-found", reason: `no Project ${path} on ${host}` };
      return { kind: "project", project: project(host, found), parent: found.parent ? project(host, found.parent) : null };
    },
    async viewer() {
      return { kind: "cant-tell", reason: "the fake doesn't name a viewer" };
    },
    async openIssues() {
      return { kind: "cant-tell", reason: "the fake holds no Issues" };
    },
    async issue() {
      return { kind: "cant-tell", reason: "the fake holds no Issues" };
    },
  };
}

function project(host: string, fake: FakeProject): Project {
  return {
    id: `${host}#${fake.oldPaths?.[0] ?? fake.path}`,
    host,
    path: fake.path,
    url: `https://${host}/${fake.path}`,
    issues: fake.open === "off" ? "off" : { open: fake.open },
  };
}
