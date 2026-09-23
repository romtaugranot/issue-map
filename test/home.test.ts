import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveHome } from "../src/home/home.ts";
import { gitCheckout } from "../src/home/checkout.ts";
import type { Trackers } from "../src/tracker/tracker.ts";
import { fakeTrackers, type FakeProject } from "./fakes/fake-trackers.ts";

/** A real git checkout with these remotes, in this order, and this local config. */
function checkout(remotes: Record<string, string>, config: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "issue-map-home-"));
  git(dir, "init", "-q");
  for (const [name, url] of Object.entries(remotes)) git(dir, "remote", "add", name, url);
  for (const [key, value] of Object.entries(config)) git(dir, "config", "--local", key, value);
  return dir;
}

function git(dir: string, ...args: string[]): string {
  return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();
}

function localConfig(dir: string): string {
  return git(dir, "config", "--local", "--list");
}

function home(dir: string, trackers: Trackers, options: { pick?: string; env?: Record<string, string> } = {}) {
  return resolveHome(
    { checkout: gitCheckout(dir), trackers, env: options.env ?? {}, sshHostname: async (alias) => alias },
    { pick: options.pick },
  );
}

const tofu: FakeProject = { path: "opentofu/opentofu", open: 274 };

test("one remote: names the Home Project and its open-Issue count without asking", async () => {
  const dir = checkout({ origin: "git@github.com:opentofu/opentofu.git" });
  const before = localConfig(dir);
  const answer = await home(dir, fakeTrackers({ "github.com": { product: "GitHub", projects: [tofu] } }));
  assert.equal(answer.text, "Home Project: github.com/opentofu/opentofu — 274 open Issues");
  assert.deepEqual(answer.choices, []);
  assert.equal(localConfig(dir), before);
});

const cli: FakeProject = { path: "cli/cli", open: 1028 };

test("a fork's checkout resolves to the parent Project", async () => {
  const dir = checkout({ origin: "https://github.com/fixture-user/cli.git" });
  const fork: FakeProject = { path: "fixture-user/cli", open: "off", parent: cli };
  const answer = await home(dir, fakeTrackers({ "github.com": { product: "GitHub", projects: [fork, cli] } }));
  assert.equal(answer.text, "Home Project: github.com/cli/cli — 1,028 open Issues");
  assert.deepEqual(answer.choices, []);
});

test("candidates with Issues off or none open are dropped before anything is asked", async () => {
  const dir = checkout({
    upstream: "https://github.com/tools/archive.git",
    origin: "https://github.com/opentofu/opentofu.git",
    mirror: "https://gitlab.com/mirrors/opentofu.git",
  });
  const answer = await home(
    dir,
    fakeTrackers({
      "github.com": { product: "GitHub", projects: [tofu, { path: "tools/archive", open: 0 }] },
      "gitlab.com": { product: "GitLab", projects: [{ path: "mirrors/opentofu", open: "off" }] },
    }),
  );
  assert.equal(answer.text, "Home Project: github.com/opentofu/opentofu — 274 open Issues");
  assert.deepEqual(answer.choices, []);
});

test("when no candidate has open Issues, the top-ranked one is the Home Project", async () => {
  const dir = checkout({
    origin: "https://github.com/fixture-org/quiet.git",
    upstream: "https://github.com/fixture-org/archive.git",
  });
  const answer = await home(
    dir,
    fakeTrackers({ "github.com": { product: "GitHub", projects: [{ path: "fixture-org/quiet", open: 0 }, { path: "fixture-org/archive", open: "off" }] } }),
  );
  assert.equal(answer.text, "Home Project: github.com/fixture-org/archive — Issues are turned off");
});

test("a genuine tie asks once, and re-running after the pick does not ask again", async () => {
  const dir = checkout({ origin: "https://github.com/fixture-user/cli.git" });
  const fork: FakeProject = { path: "fixture-user/cli", open: 12, parent: cli };
  const trackers = fakeTrackers({ "github.com": { product: "GitHub", projects: [fork, cli] } });

  const first = await home(dir, trackers);
  assert.equal(
    first.text,
    "This checkout leads to 2 Projects with open Issues. Ask which one is the Home Project, then run `issue-map home --pick <URL>`.",
  );
  assert.deepEqual(first.choices, [
    { label: "github.com/cli/cli", description: "1,028 open Issues · parent of origin", url: "https://github.com/cli/cli" },
    { label: "github.com/fixture-user/cli", description: "12 open Issues · remote origin", url: "https://github.com/fixture-user/cli" },
  ]);

  const picked = await home(dir, trackers, { pick: "https://github.com/fixture-user/cli" });
  assert.equal(picked.text, "Home Project: github.com/fixture-user/cli — 12 open Issues");
  assert.deepEqual(picked.choices, []);

  const again = await home(dir, trackers);
  assert.equal(again.text, "Home Project: github.com/fixture-user/cli — 12 open Issues");
  assert.deepEqual(again.choices, []);
});

test("the pick is saved in the checkout's local git config under the plugin's own key", async () => {
  const dir = checkout({ origin: "https://github.com/fixture-user/cli.git" });
  const fork: FakeProject = { path: "fixture-user/cli", open: 12, parent: cli };
  await home(dir, fakeTrackers({ "github.com": { product: "GitHub", projects: [fork, cli] } }), { pick: "https://github.com/cli/cli" });
  assert.equal(git(dir, "config", "--local", "--get", "issue-map.home"), "https://github.com/cli/cli");
});

test("a tie offers at most four Projects, best guess first", async () => {
  const names = ["upstream", "origin", "a", "b", "c"];
  const dir = checkout(Object.fromEntries(names.map((n) => [n, `https://github.com/fixture-org/${n}.git`])));
  const answer = await home(
    dir,
    fakeTrackers({ "github.com": { product: "GitHub", projects: names.map((n) => ({ path: `fixture-org/${n}`, open: 1 })) } }),
  );
  assert.match(answer.text, /leads to 5 Projects/);
  assert.deepEqual(answer.choices.map((c) => c.label), ["github.com/fixture-org/upstream", "github.com/fixture-org/origin", "github.com/fixture-org/a", "github.com/fixture-org/b"]);
});

test("a pick that isn't one of the tied Projects is not saved", async () => {
  const dir = checkout({ origin: "https://github.com/fixture-user/cli.git" });
  const fork: FakeProject = { path: "fixture-user/cli", open: 12, parent: cli };
  const answer = await home(dir, fakeTrackers({ "github.com": { product: "GitHub", projects: [fork, cli, tofu] } }), {
    pick: "https://github.com/opentofu/opentofu",
  });
  assert.match(answer.text, /^https:\/\/github\.com\/opentofu\/opentofu isn't one of this checkout's Projects\./);
  assert.equal(answer.choices.length, 2);
  assert.doesNotMatch(localConfig(dir), /issue-map/);
});

const forkWithIssues: FakeProject = { path: "fixture-user/cli", open: 12, parent: cli };
const forkAndParent = () => fakeTrackers({ "github.com": { product: "GitHub", projects: [forkWithIssues, cli] } });

test("a gh default settles a tie, and is read but never written", async () => {
  const dir = checkout({ origin: "https://github.com/fixture-user/cli.git" }, { "remote.origin.gh-resolved": "cli/cli" });
  const before = localConfig(dir);
  const answer = await home(dir, forkAndParent());
  assert.equal(answer.text, "Home Project: github.com/cli/cli — 1,028 open Issues");
  assert.deepEqual(answer.choices, []);
  assert.equal(localConfig(dir), before);
});

test("a gh default of `base` means the remote's own Project", async () => {
  const dir = checkout({ origin: "https://github.com/fixture-user/cli.git" }, { "remote.origin.gh-resolved": "base" });
  const answer = await home(dir, forkAndParent());
  assert.equal(answer.text, "Home Project: github.com/fixture-user/cli — 12 open Issues");
});

test("GH_REPO settles a tie ahead of a saved gh default", async () => {
  const dir = checkout({ origin: "https://github.com/fixture-user/cli.git" }, { "remote.origin.gh-resolved": "cli/cli" });
  const answer = await home(dir, forkAndParent(), { env: { GH_REPO: "fixture-user/cli" } });
  assert.equal(answer.text, "Home Project: github.com/fixture-user/cli — 12 open Issues");
});

test("the plugin's own pick outranks the gh default", async () => {
  const dir = checkout(
    { origin: "https://github.com/fixture-user/cli.git" },
    { "remote.origin.gh-resolved": "cli/cli", "issue-map.home": "https://github.com/fixture-user/cli" },
  );
  const answer = await home(dir, forkAndParent());
  assert.equal(answer.text, "Home Project: github.com/fixture-user/cli — 12 open Issues");
});

test("when the gh and glab defaults disagree, the user is asked", async () => {
  const dir = checkout(
    {
      upstream: "https://github.com/fixture-org/other.git",
      origin: "https://github.com/fixture-org/tool.git",
      mirror: "https://gitlab.com/fixture-org/tool.git",
    },
    { "remote.origin.gh-resolved": "base", "remote.mirror.glab-resolved-base": "base" },
  );
  const answer = await home(
    dir,
    fakeTrackers({
      "github.com": { product: "GitHub", projects: [{ path: "fixture-org/tool", open: 5 }, { path: "fixture-org/other", open: 7 }] },
      "gitlab.com": { product: "GitLab", projects: [{ path: "fixture-org/tool", open: 3 }] },
    }),
  );
  assert.deepEqual(answer.choices.map((c) => c.label), ["github.com/fixture-org/tool", "gitlab.com/fixture-org/tool"]);
});

const notLoggedIn = "not logged in to github.com — run `gh auth login --hostname github.com`";

test("remotes that lead nowhere readable say which Tracker refused and why", async () => {
  const dir = checkout({
    origin: "https://github.com/fixture-org/private.git",
    backup: "https://git.example.com/fixture-org/tool.git",
  });
  const answer = await home(dir, fakeTrackers({ "github.com": { product: "GitHub", refuse: notLoggedIn } }));
  assert.equal(
    answer.text,
    [
      "No Home Project: no remote of this checkout leads to a Project the Map can read.",
      `  origin → github.com/fixture-org/private: GitHub refused: ${notLoggedIn}`,
      "  backup → git.example.com/fixture-org/tool: git.example.com runs no Tracker the Map can read",
    ].join("\n"),
  );
  assert.deepEqual(answer.choices, []);
});

test("a candidate the login can't read isn't counted in the tie, and is noted", async () => {
  const dir = checkout({
    origin: "https://github.com/opentofu/opentofu.git",
    work: "git@gitlab.example.com:group/project.git",
  });
  const answer = await home(
    dir,
    fakeTrackers({
      "github.com": { product: "GitHub", projects: [tofu] },
      "gitlab.example.com": { product: "GitLab", refuse: "no login for gitlab.example.com" },
    }),
  );
  assert.equal(
    answer.text,
    "Home Project: github.com/opentofu/opentofu — 274 open Issues\nAlso here: gitlab.example.com/group/project — GitLab refused: no login for gitlab.example.com",
  );
});

test("a checkout without remotes says so", async () => {
  const answer = await home(checkout({}), fakeTrackers({}));
  assert.equal(answer.text, "No Home Project: this checkout has no remote that leads to a Tracker.");
});

test("a saved pick that no remote leads to any more is dropped, and the user is asked again", async () => {
  const dir = checkout({ origin: "https://github.com/fixture-user/cli.git" }, { "issue-map.home": "https://github.com/opentofu/opentofu" });
  const answer = await home(dir, fakeTrackers({ "github.com": { product: "GitHub", projects: [forkWithIssues, cli, tofu] } }));
  assert.equal(answer.choices.length, 2);
  assert.doesNotMatch(localConfig(dir), /issue-map/);
});

test("a saved pick whose Project was renamed still matches, and the key follows the new URL", async () => {
  const moved: FakeProject = { path: "new-org/tool", open: 3, oldPaths: ["old-org/tool"] };
  const dir = checkout(
    { upstream: "https://github.com/fixture-org/other.git", origin: "https://github.com/new-org/tool.git" },
    { "issue-map.home": "https://github.com/old-org/tool" },
  );
  const answer = await home(dir, fakeTrackers({ "github.com": { product: "GitHub", projects: [moved, { path: "fixture-org/other", open: 5 }] } }));
  assert.equal(answer.text, "Home Project: github.com/new-org/tool — 3 open Issues");
  assert.equal(git(dir, "config", "--local", "--get", "issue-map.home"), "https://github.com/new-org/tool");
});

test("a saved pick is kept when its Tracker can't be reached", async () => {
  const dir = checkout({ origin: "https://github.com/fixture-user/cli.git" }, { "issue-map.home": "https://github.com/cli/cli" });
  const answer = await home(dir, fakeTrackers({ "github.com": { product: "GitHub", unreachable: "couldn't reach github.com" } }));
  assert.match(answer.text, /couldn't reach github\.com/);
  assert.equal(git(dir, "config", "--local", "--get", "issue-map.home"), "https://github.com/cli/cli");
});

test("a pick that can't be saved holds for this session and says so", async () => {
  const dir = checkout({ origin: "https://github.com/fixture-user/cli.git" });
  chmodSync(join(dir, ".git"), 0o555);
  try {
    const answer = await home(dir, forkAndParent(), { pick: "https://github.com/cli/cli" });
    assert.match(answer.text, /^Home Project: github\.com\/cli\/cli — 1,028 open Issues\nThe pick couldn't be saved to git config \(.+\), so it holds for this session only\.$/);
  } finally {
    chmodSync(join(dir, ".git"), 0o755);
  }
});

test("a pick of something else when there is no tie names the Home Project and saves nothing", async () => {
  const dir = checkout({ origin: "https://github.com/opentofu/opentofu.git" });
  const answer = await home(dir, fakeTrackers({ "github.com": { product: "GitHub", projects: [tofu] } }), { pick: "https://github.com/cli/cli" });
  assert.equal(answer.text, "https://github.com/cli/cli isn't one of this checkout's Projects.\nHome Project: github.com/opentofu/opentofu — 274 open Issues");
  assert.deepEqual(answer.choices, []);
  assert.doesNotMatch(localConfig(dir), /issue-map/);
});

test("a default naming a Project no remote leads to is passed over", async () => {
  const dir = checkout({ origin: "https://github.com/fixture-user/cli.git" });
  const trackers = fakeTrackers({ "github.com": { product: "GitHub", projects: [forkWithIssues, cli, tofu] } });
  const answer = await home(dir, trackers, { env: { GH_REPO: "opentofu/opentofu", GITLAB_REPO: "fixture-org/tool" } });
  assert.deepEqual(answer.choices.map((c) => c.label), ["github.com/cli/cli", "github.com/fixture-user/cli"]);
});
