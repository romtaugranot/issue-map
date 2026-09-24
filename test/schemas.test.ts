import { test } from "node:test";
import assert from "node:assert/strict";
import { gitlabSchemaChanges } from "../scripts/ci/schemas.ts";

test("a GitLab schema the matrix recorded replaces the one kept for its minor, and nothing older than the floor is kept", () => {
  const changes = gitlabSchemaChanges(["15.11.13", "16.0.9", "17.3.1"], ["16.0.10", "19.4.1"], "16.0");
  assert.deepEqual(changes, { write: ["16.0.10", "19.4.1"], remove: ["15.11.13", "16.0.9"] });
});

test("a narrowed run keeps the minors it didn't record", () => {
  assert.deepEqual(gitlabSchemaChanges(["16.0.10", "17.3.1"], ["19.4.1"], "16.0"), { write: ["19.4.1"], remove: [] });
});

test("a schema recorded from a version below the floor isn't kept", () => {
  assert.deepEqual(gitlabSchemaChanges([], ["15.11.13"], "16.0"), { write: [], remove: [] });
});
