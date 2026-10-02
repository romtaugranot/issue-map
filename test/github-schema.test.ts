/**
 * The GHES, GHEC and github.com stand-in (ADR 0004): every GraphQL query and
 * mutation the GitHub adapter sends validates against the schema GitHub
 * publishes for each promised release, as `scripts/ci/schemas.ts` records
 * them. Which Link kinds' fields a GHES is asked for comes from that
 * release's own schema, as the adapter asks it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { buildSchema, parse, validate, type GraphQLObjectType } from "graphql";
import { github } from "../src/tracker/github.ts";
import type { Cli } from "../src/tracker/boundary.ts";
import type { ChangesAnswer, IssuePage, ProjectResolution } from "../src/tracker/tracker.ts";
import { authStatus, ghApi, probe } from "./fakes/fake-gh.ts";
import type { World } from "./contract/tracker-contract.ts";

const SCHEMAS = new URL("./schemas/github/", import.meta.url);
const recorded = readdirSync(SCHEMAS).filter((file) => file.endsWith(".graphql.gz"));

test("a schema is recorded for github.com, GHEC and every promised GHES release", () => {
  assert.ok(recorded.includes("fpt.graphql.gz") && recorded.includes("ghec.graphql.gz"), recorded.join(", "));
  assert.ok(recorded.some((file) => file.startsWith("ghes-")), recorded.join(", "));
});

for (const file of recorded) {
  const name = file.replace(/\.graphql\.gz$/, "");
  test(`every query the GitHub adapter sends validates against ${name}'s published schema`, async () => {
    // Built without validating the schema itself, which graphql 17 refuses (a deprecated field implementing an undeprecated one); only the queries are checked.
    const schema = buildSchema(gunzipSync(readFileSync(new URL(file, SCHEMAS))).toString("utf8"), { assumeValidSDL: true, assumeValid: true });
    const host = name === "fpt" ? "github.com" : name === "ghec" ? "fixtures.ghe.com" : "ghes.example.com";
    const invalid: string[] = [];
    const sent = new Set<string>();
    const world: World = {
      // The fake answers every field; what the adapter asks for comes from the schema.
      servers: { "ghes.example.com": { runs: "this-kind", version: "99.0.0" } },
      loggedInTo: [host],
      projects: [
        { path: "fixture-org/tools", number: 1, open: 3, issues: [{ number: 1 }, { number: 2 }, { number: 3 }, { number: 4, closed: true }] },
        { path: "fixture-org/other", number: 2, open: 1, issues: [{ number: 1 }] },
      ],
      links: [
        ["fixture-org/tools#1", "parent", "fixture-org/tools#2"],
        ["fixture-org/tools#3", "blocks", "fixture-org/tools#2"],
        ["fixture-org/other#1", "blocks", "fixture-org/tools#3"],
        ["fixture-org/tools#4", "blocks", "fixture-org/tools#1"],
      ],
      closingRequests: [{ closes: "fixture-org/tools#2", number: 9, author: "fixture-viewer" }],
    };
    const cli: Cli = async (command, args) => {
      if (args[0] === "auth") return authStatus(world, args);
      const query = args.find((a) => a.startsWith("query="))?.slice("query=".length);
      if (query !== undefined) {
        sent.add(query);
        const errors = validate(schema, parse(query));
        if (errors.length > 0) invalid.push(`${query.split("\n")[0]} — ${errors.map((e) => e.message).join("; ")}`);
        // A GHES tells its own Link kinds from its schema's Issue fields.
        if (query.includes('__type(name: "Issue")')) {
          const fields = Object.keys((schema.getType("Issue") as GraphQLObjectType).getFields());
          return { kind: "exited", code: 0, stdout: JSON.stringify({ data: { __type: { fields: fields.map((f) => ({ name: f })) } } }), stderr: "" };
        }
      }
      return ghApi(world, args);
    };
    const kind = github({ env: {}, cli, http: async (url) => probe(world, new URL(url)) });
    const found = (await kind.recognise(host)) ?? (await kind.probe(host));
    const tracker = "tracker" in found ? found.tracker : found;
    assert.ok("resolveProject" in tracker, JSON.stringify(found));

    const resolved = (await tracker.resolveProject("fixture-org/tools")) as Extract<ProjectResolution, { kind: "project" }>;
    assert.equal(resolved.kind, "project", JSON.stringify(resolved));
    const { project } = resolved;
    const page = (await tracker.openIssues(project, null)) as Extract<IssuePage, { kind: "page" }>;
    assert.equal(page.kind, "page", JSON.stringify(page));
    const outside = page.issues.flatMap((i) => i.links.flatMap(({ to }) => (to.readable && to.project !== project.path ? [to.id] : [])));
    const answers = {
      viewer: await tracker.viewer(),
      changes: (await tracker.changes(project, "2020-01-01T00:00:00Z", outside)) as ChangesAnswer,
      card: await tracker.issue("fixture-org/tools#2"),
      capabilities: await tracker.capabilities(project),
      thread: await tracker.thread("fixture-org/tools#2"),
      blocks: await tracker.link("fixture-org/tools#1", "blocks", "fixture-org/tools#3"),
      parent: await tracker.link("fixture-org/tools#1", "parent", "fixture-org/tools#3"),
    };
    const kinds = Object.fromEntries(Object.entries(answers).map(([read, a]) => [read, a.kind]));
    assert.deepEqual(invalid, [], `queries ${name} doesn't accept`);
    for (const read of ["viewer", "changes", "card", "capabilities", "thread"] as const) {
      assert.ok(["viewer", "changes", "issue", "capabilities", "thread"].includes(kinds[read]!), `${read}: ${JSON.stringify(answers[read])}`);
    }
    // A write the release can't record is refused before anything is sent.
    for (const write of ["blocks", "parent"] as const) assert.ok(["linked", "cant-record"].includes(kinds[write]!), `${write}: ${JSON.stringify(answers[write])}`);
    assert.ok(sent.size >= 8, `only ${sent.size} distinct queries were sent`);
  });
}
