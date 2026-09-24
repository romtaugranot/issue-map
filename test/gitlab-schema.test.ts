/**
 * The GitLab Dedicated and licensed self-managed stand-in (ADR 0004): every
 * GraphQL query and mutation the GitLab adapter sends a promised GitLab
 * validates against the schema recorded from that version's EE, as the
 * GitLab version matrix records it and `scripts/ci/schemas.ts gitlab` keeps
 * it. What the adapter asks a version for comes from the version itself.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { buildClientSchema, parse, validate, type IntrospectionQuery } from "graphql";
import { TESTED_FROM } from "../src/tracker/gitlab.ts";
import type { IssuePage, ProjectResolution } from "../src/tracker/tracker.ts";
import type { World } from "./contract/tracker-contract.ts";
import { arrange } from "./fakes/fake-glab.ts";

const SCHEMAS = new URL("./schemas/gitlab/", import.meta.url);
const recorded = readdirSync(SCHEMAS).filter((file) => /^ee-\d+\.\d+\.\d+\.json\.gz$/.test(file));
const versionOf = (file: string) => file.replace(/^ee-|\.json\.gz$/g, "");

test("a schema is recorded from the EE of the oldest GitLab the Map is tested on", () => {
  assert.ok(recorded.some((file) => versionOf(file).startsWith(`${TESTED_FROM}.`)), recorded.join(", ") || "none recorded");
});

for (const file of recorded) {
  const version = versionOf(file);
  test(`every query the GitLab adapter sends ${version} validates against its EE's schema`, async () => {
    const { data } = JSON.parse(gunzipSync(readFileSync(new URL(file, SCHEMAS))).toString("utf8")) as { data: IntrospectionQuery };
    const schema = buildClientSchema(data, { assumeValid: true });
    const host = "git.example.com";
    const tools = "fixture-org/tools";
    const world: World = {
      servers: { [host]: { runs: "this-kind", version } },
      loggedInTo: [host],
      projects: [
        { path: tools, number: 1, open: 4, issues: [{ number: 1 }, { number: 2 }, { number: 3, taskLevel: true }, { number: 4 }, { number: 5, closed: true, closedAs: "duplicate", duplicateOf: `${tools}#2` }] },
        { path: "fixture-org/other", number: 3, open: 1, issues: [{ number: 1 }] },
        { path: "fixture-org", number: 2, open: 1, namespace: true, issues: [{ number: 12 }] },
      ],
      links: [
        [`${tools}#1`, "blocks", `${tools}#2`],
        [`${tools}#1`, "parent", `${tools}#3`],
        [`${tools}#4`, "related", `${tools}#1`],
        ["fixture-org/other#1", "blocks", `${tools}#4`],
        ["fixture-org#12", "parent", `${tools}#1`],
      ],
      closingRequests: [{ closes: `${tools}#2`, number: 40, author: "fixture-bot" }],
      mentions: [[`${tools}#4`, `${tools}#2`]],
    };
    const { kind, queries } = arrange(world);
    const probed = await kind.probe(host);
    assert.equal(probed.kind, "identified", JSON.stringify(probed));
    const tracker = (probed as Extract<typeof probed, { kind: "identified" }>).tracker;
    const resolved = (await tracker.resolveProject(tools)) as Extract<ProjectResolution, { kind: "project" }>;
    assert.equal(resolved.kind, "project", JSON.stringify(resolved));
    const { project } = resolved;
    const page = (await tracker.openIssues(project, null)) as Extract<IssuePage, { kind: "page" }>;
    assert.equal(page.kind, "page", JSON.stringify(page));
    const outside = page.issues.flatMap((i) => i.links.flatMap(({ to }) => (to.readable && to.project !== project.path ? [to.id] : [])));
    const answers = {
      viewer: await tracker.viewer(),
      changes: await tracker.changes(project, "2020-01-01T00:00:00Z", outside),
      card: await tracker.issue(`${tools}#2`),
      epic: await tracker.issue("fixture-org&12"),
      capabilities: await tracker.capabilities(project),
      thread: await tracker.thread(`${tools}#2`),
      assign: await tracker.assign(`${tools}#4`, "fixture-viewer"),
      blocks: await tracker.link(`${tools}#2`, "blocks", `${tools}#4`),
      parent: await tracker.link(`${tools}#2`, "parent", `${tools}#4`),
      related: await tracker.link(`${tools}#2`, "related", `${tools}#4`),
    };

    const invalid = [...new Set(queries())].flatMap((query) => {
      const errors = validate(schema, parse(query));
      return errors.length > 0 ? [`${query.split("\n")[0]} — ${errors.map((e) => e.message).join("; ")}`] : [];
    });
    assert.deepEqual(invalid, [], `queries ${version} doesn't accept`);
    for (const [read, answer] of Object.entries(answers)) {
      assert.ok(!["cant-tell", "refused"].includes(answer.kind), `${read}: ${JSON.stringify(answer)}`);
    }
    assert.ok(new Set(queries()).size >= 8, `only ${new Set(queries()).size} distinct queries were sent`);
  });
}
