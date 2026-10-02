import { test } from "node:test";
import assert from "node:assert/strict";
import { remoteAddress } from "../src/home/remote-address.ts";

const sshConfig: Record<string, string> = { "my-alias": "gitlab.example.com" };
const sshHostname = (alias: string) => sshConfig[alias] ?? alias;

const cases: [remote: string, host: string, path: string][] = [
  ["git@github.com:cli/cli.git", "github.com", "cli/cli"],
  ["https://github.com/cli/cli", "github.com", "cli/cli"],
  ["https://github.com/cli/cli/", "github.com", "cli/cli"],
  ["https://someone:SECRET@github.com/cli/cli.git", "github.com", "cli/cli"],
  ["git+ssh://git@github.com/cli/cli.git", "github.com", "cli/cli"],
  ["git://github.com/cli/cli.git", "github.com", "cli/cli"],
  ["ssh://git@ssh.github.com:443/cli/cli.git", "github.com", "cli/cli"],
  ["https://GitHub.com/cli/cli.git", "github.com", "cli/cli"],
  ["tenant@tenant.ghe.com:owner/repo.git", "tenant.ghe.com", "owner/repo"],
  ["git@gitlab.com:gitlab-org/cli.git", "gitlab.com", "gitlab-org/cli"],
  ["ssh://git@altssh.gitlab.com:443/gitlab-org/cli.git", "gitlab.com", "gitlab-org/cli"],
  ["ssh://git@gitlab.example.com:2222/group/sub/project.git", "gitlab.example.com", "group/sub/project"],
  ["https://gitlab.com/group/project.wiki.git", "gitlab.com", "group/project"],
  ["http://git.example.com/group/project.git", "git.example.com", "group/project"],
  ["my-alias:group/project.git", "gitlab.example.com", "group/project"],
  ["ssh://git@my-alias/group/project.git", "gitlab.example.com", "group/project"],
  ["git@[2001:db8::1]:group/project.git", "[2001:db8::1]", "group/project"],
  ["ssh://git@[2001:DB8::1]:2222/group/project.git", "[2001:db8::1]", "group/project"],
  ["https://github.com/cli/my%20cli.git", "github.com", "cli/my cli"],
];

for (const [remote, host, path] of cases) {
  test(`${remote} leads to ${host} ${path}`, () => {
    assert.deepEqual(remoteAddress(remote, sshHostname), { host, path });
  });
}

const notTrackers = [
  "/srv/git/project.git",
  "file:///srv/git/project.git",
  "./sibling:checkout",
  "../project.git",
  "hg::https://example.com/repo",
  "https://github.com/cli/c%zzli.git",
  "C:/srv/git/project.git",
  "C:\\srv\\git\\project.git",
  "https://github.com/",
  "",
];

for (const remote of notTrackers) {
  test(`${JSON.stringify(remote)} leads to no Tracker`, () => {
    assert.equal(remoteAddress(remote, sshHostname), null);
  });
}
