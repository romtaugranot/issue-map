/**
 * Records the GraphQL schemas GitHub publishes for github.com, GHEC and
 * every promised GHES release (ADR 0004), gzipped under `test/schemas/github`,
 * for the schema checks to validate the GitHub adapter's queries against. A
 * release that falls out of GitHub's support leaves, and a new one arrives
 * the first time this runs after GitHub publishes it.
 *
 * `node scripts/ci/schemas.ts`: prints what changed.
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { gunzipSync, gzipSync } from "node:zlib";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { OLDEST_SUPPORTED_GHES } from "../../src/tracker/github.ts";
import { ghesReleases, schemaUrl } from "./versions.ts";

export const SCHEMAS = fileURLToPath(new URL("../../test/schemas/github/", import.meta.url));

async function fetched(url: string): Promise<string | null> {
  const response = await fetch(url);
  return response.ok ? response.text() : null;
}

async function main(): Promise<void> {
  const ghes = await ghesReleases(OLDEST_SUPPORTED_GHES, async (release) => (await fetch(schemaUrl(release), { method: "HEAD" })).ok);
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

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
