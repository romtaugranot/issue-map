import { test } from "node:test";
import assert from "node:assert/strict";
import { ghesReleases, gitlabMatrix } from "../scripts/ci/versions.ts";

test("every promised GitLab minor from the floor, at its latest patch, as CE and EE", () => {
  const tags = {
    ce: ["15.11.13-ce.0", "16.0.0-ce.0", "16.0.8-ce.0", "16.1.2-ce.0", "latest", "nightly", "16.2.0-rc42.ce.0", "16.1.10-ce.0"],
    ee: ["16.0.8-ee.0", "16.1.10-ee.0", "rc", "16.2.0-rc42.ee.0"],
  };
  assert.deepEqual(gitlabMatrix(tags, "16.0"), [
    { version: "16.0.8", edition: "ce", image: "gitlab/gitlab-ce:16.0.8-ce.0" },
    { version: "16.0.8", edition: "ee", image: "gitlab/gitlab-ee:16.0.8-ee.0" },
    { version: "16.1.10", edition: "ce", image: "gitlab/gitlab-ce:16.1.10-ce.0" },
    { version: "16.1.10", edition: "ee", image: "gitlab/gitlab-ee:16.1.10-ee.0" },
  ]);
});

test("a release that lands after the plugin's is in the matrix the next time it's worked out", () => {
  const before = gitlabMatrix({ ce: ["19.4.1-ce.0"], ee: ["19.4.1-ee.0"] }, "16.0");
  const after = gitlabMatrix({ ce: ["19.4.1-ce.0", "19.5.0-ce.0"], ee: ["19.4.1-ee.0", "19.5.0-ee.0"] }, "16.0");
  assert.deepEqual(before.map((e) => e.version), ["19.4.1", "19.4.1"]);
  assert.deepEqual(after.map((e) => e.version), ["19.4.1", "19.4.1", "19.5.0", "19.5.0"]);
});

test("a minor published in one edition only runs in that edition", () => {
  assert.deepEqual(gitlabMatrix({ ce: ["17.3.0-ce.0"], ee: [] }, "16.0").map((e) => e.edition), ["ce"]);
});

test("the promised GHES releases run from the oldest GitHub supports to the newest with a published schema", async () => {
  const published = new Set(["3.17", "3.18", "3.19", "3.20"]);
  assert.deepEqual(await ghesReleases("3.18", async (r) => published.has(r)), ["3.18", "3.19", "3.20"]);
});

test("the README's support table promises from the floors the adapters promise from", async () => {
  const { readFile } = await import("node:fs/promises");
  const { TESTED_FROM } = await import("../src/tracker/gitlab.ts");
  const { OLDEST_SUPPORTED_GHES } = await import("../src/tracker/github.ts");
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  assert.match(readme, new RegExp(`GHES ${OLDEST_SUPPORTED_GHES.replace(".", "\\.")} and later`));
  assert.match(readme, new RegExp(`GitLab ${TESTED_FROM.replace(".", "\\.")} and later`));
});
