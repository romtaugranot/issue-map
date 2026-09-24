/**
 * The Tracker versions the build tests on, worked out from the bands
 * (ADR 0003, 0004) rather than kept as a list: every GitLab minor from the
 * oldest the Map is tested on to the latest released, and every GHES
 * release GitHub publishes a schema for from the oldest it still supports.
 * A release that lands after a plugin release is in the next run's matrix.
 *
 * `node scripts/ci/versions.ts gitlab`: the GitLab matrix as JSON, from Docker Hub's tags.
 * `node scripts/ci/versions.ts ghes`: the promised GHES releases as JSON, from the schemas docs.github.com publishes.
 */
import { fileURLToPath } from "node:url";
import { atLeast } from "../../src/tracker/boundary.ts";
import { TESTED_FROM } from "../../src/tracker/gitlab.ts";
import { OLDEST_SUPPORTED_GHES } from "../../src/tracker/github.ts";

export type Edition = "ce" | "ee";

export interface MatrixEntry {
  version: string;
  edition: Edition;
  image: string;
}

/** One job per promised minor per edition, at the minor's latest patch, oldest first; release candidates and moving tags left out. */
export function gitlabMatrix(tags: Record<Edition, string[]>, floor: string): MatrixEntry[] {
  const entries: MatrixEntry[] = [];
  for (const edition of ["ce", "ee"] as const) {
    const latest = new Map<string, number[]>();
    for (const tag of tags[edition]) {
      const match = new RegExp(`^(\\d+)\\.(\\d+)\\.(\\d+)-${edition}\\.0$`).exec(tag);
      if (!match) continue;
      const [major, minor, patch] = match.slice(1).map(Number) as [number, number, number];
      if (!atLeast(`${major}.${minor}.${patch}`, floor)) continue;
      const key = `${major}.${minor}`;
      if ((latest.get(key)?.[2] ?? -1) < patch) latest.set(key, [major, minor, patch]);
    }
    for (const [major, minor, patch] of latest.values()) {
      const version = `${major}.${minor}.${patch}`;
      entries.push({ version, edition, image: `gitlab/gitlab-${edition}:${version}-${edition}.0` });
    }
  }
  const order = (v: string) => v.split(".").map(Number) as [number, number, number];
  return entries.sort((a, b) => {
    const [x, y] = [order(a.version), order(b.version)];
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || a.edition.localeCompare(b.edition);
  });
}

/** GHES releases from `floor` on, while docs.github.com publishes a schema for each; `published` says whether it does. */
export async function ghesReleases(floor: string, published: (release: string) => Promise<boolean>): Promise<string[]> {
  const [major, minor] = floor.split(".").map(Number) as [number, number];
  const releases: string[] = [];
  for (let at = minor; await published(`${major}.${at}`); at++) releases.push(`${major}.${at}`);
  return releases;
}

/** Where docs.github.com publishes a GraphQL schema: `fpt` for github.com, `ghec`, or a GHES release. */
export function schemaUrl(of: "fpt" | "ghec" | string): string {
  return of === "fpt" || of === "ghec" ? `https://docs.github.com/public/${of}/schema.docs.graphql` : `https://docs.github.com/public/ghes-${of}/schema.docs-enterprise.graphql`;
}

/**
 * An edition's tags from `floor`'s major on, a major at a time, since Docker
 * Hub pages no further than 1,000 tags; stops at the first major with none.
 */
async function dockerTags(edition: Edition, floor: string): Promise<string[]> {
  const tags: string[] = [];
  for (let major = Number(floor.split(".")[0]); ; major++) {
    let next: string | null = `https://hub.docker.com/v2/repositories/gitlab/gitlab-${edition}/tags?page_size=100&name=${major}.`;
    const before = tags.length;
    while (next) {
      const response = await fetch(next);
      if (!response.ok) throw new Error(`Docker Hub answered ${response.status} for ${next}`);
      const page = (await response.json()) as { next: string | null; results: { name: string }[] };
      tags.push(...page.results.map((r) => r.name).filter((name) => name.startsWith(`${major}.`)));
      next = page.next;
    }
    if (tags.length === before) return tags;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [what] = process.argv.slice(2);
  if (what === "gitlab") {
    const [ce, ee] = await Promise.all([dockerTags("ce", TESTED_FROM), dockerTags("ee", TESTED_FROM)]);
    console.log(JSON.stringify(gitlabMatrix({ ce, ee }, TESTED_FROM)));
  } else if (what === "ghes") {
    const published = async (release: string) => (await fetch(schemaUrl(release), { method: "HEAD" })).ok;
    console.log(JSON.stringify(await ghesReleases(OLDEST_SUPPORTED_GHES, published)));
  } else {
    console.error("usage: node scripts/ci/versions.ts gitlab | ghes");
    process.exitCode = 2;
  }
}
