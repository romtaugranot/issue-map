/**
 * Records the GraphQL schemas GitHub publishes for github.com, GHEC and
 * every promised GHES release (ADR 0004), gzipped under `test/schemas/github`,
 * for the schema checks to validate the GitHub adapter's queries against. A
 * release that falls out of GitHub's support leaves, and a new one arrives
 * the first time this runs after GitHub publishes it.
 *
 * It also keeps the schema the GitLab version matrix records from each
 * promised GitLab's EE, under `test/schemas/gitlab`, for the GitLab adapter's
 * queries to be checked against where the build can't run that GitLab
 * licensed, as on GitLab Dedicated.
 *
 * `node scripts/ci/schemas.ts`: records GitHub's, and prints what changed.
 * `node scripts/ci/schemas.ts gitlab <dir>`: keeps the GitLab schemas the
 * matrix's `gitlab-<version>-ee-schema` artifacts in `dir` hold, and prints
 * what changed.
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { gunzipSync, gzipSync } from "node:zlib";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { atLeast } from "../../src/tracker/boundary.ts";
import { OLDEST_SUPPORTED_GHES } from "../../src/tracker/github.ts";
import { TESTED_FROM } from "../../src/tracker/gitlab.ts";
import { ghesReleases, publishedOnDocs, schemaUrl } from "./versions.ts";

export const SCHEMAS = fileURLToPath(new URL("../../test/schemas/github/", import.meta.url));
const GITLAB_SCHEMAS = fileURLToPath(new URL("../../test/schemas/gitlab/", import.meta.url));

/**
 * What the GitLab schemas `arrived` from a matrix run change among those
 * `recorded`, by version: each one from `floor` on is written, in place of
 * any other patch of its minor, and none below `floor` is kept. A minor the
 * run didn't record, as in a narrowed run, keeps its schema.
 */
export function gitlabSchemaChanges(recorded: string[], arrived: string[], floor: string): { write: string[]; remove: string[] } {
  const minor = (version: string) => version.split(".").slice(0, 2).join(".");
  const write = arrived.filter((version) => atLeast(version, floor));
  const remove = recorded.filter((version) => !write.includes(version) && (!atLeast(version, floor) || write.some((w) => minor(w) === minor(version))));
  return { write, remove };
}

async function keepGitlab(artifacts: string): Promise<void> {
  const arrived = (await readdir(artifacts)).flatMap((name) => /^gitlab-(\d+\.\d+\.\d+)-ee-schema$/.exec(name)?.[1] ?? []);
  await mkdir(GITLAB_SCHEMAS, { recursive: true });
  const recorded = (await readdir(GITLAB_SCHEMAS)).flatMap((file) => /^ee-(\d+\.\d+\.\d+)\.json\.gz$/.exec(file)?.[1] ?? []);
  const { write, remove } = gitlabSchemaChanges(recorded, arrived, TESTED_FROM);
  for (const version of write) {
    const text = await readFile(join(artifacts, `gitlab-${version}-ee-schema`, "schema.json"), "utf8");
    const path = join(GITLAB_SCHEMAS, `ee-${version}.json.gz`);
    const before = await readFile(path).then((gz) => gunzipSync(gz).toString("utf8"), () => null);
    if (before === text) continue;
    await writeFile(path, gzipSync(text, { level: 9 }));
    console.log(`${before === null ? "added" : "updated"} GitLab ${version} EE`);
  }
  for (const version of remove) {
    await rm(join(GITLAB_SCHEMAS, `ee-${version}.json.gz`));
    console.log(`removed GitLab ${version} EE`);
  }
}

async function fetched(url: string): Promise<string | null> {
  const response = await fetch(url);
  return response.ok ? response.text() : null;
}

async function main(): Promise<void> {
  const ghes = await ghesReleases(OLDEST_SUPPORTED_GHES, publishedOnDocs);
  const wanted = new Map<string, string>([["fpt", schemaUrl("fpt")], ["ghec", schemaUrl("ghec")], ...ghes.map((r): [string, string] => [`ghes-${r}`, schemaUrl(r)])]);
  await mkdir(SCHEMAS, { recursive: true });
  for (const [name, url] of wanted) {
    const text = await fetched(url);
    if (text === null) throw new Error(`couldn't fetch ${url}`);
    const path = join(SCHEMAS, `${name}.graphql.gz`);
    const before = await readFile(path).then((gz) => gunzipSync(gz).toString("utf8"), () => null);
    if (before === text) continue;
    await writeFile(path, gzipSync(text, { level: 9 }));
    console.log(`${before === null ? "added" : "updated"} ${name}`);
  }
  for (const file of await readdir(SCHEMAS)) {
    if (!wanted.has(file.replace(/\.graphql\.gz$/, ""))) {
      await rm(join(SCHEMAS, file));
      console.log(`removed ${file}, no longer promised`);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [what, dir] = process.argv.slice(2);
  if (what === "gitlab" && dir) await keepGitlab(dir);
  else if (what === undefined) await main();
  else {
    console.error("usage: node scripts/ci/schemas.ts [gitlab <dir>]");
    process.exitCode = 2;
  }
}
