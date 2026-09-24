/** A first read that saves one page, says so on stdout, then hangs: stands in for a reader killed mid-read. */
import { snapshotStore } from "../../src/snapshot/store.ts";
import type { Tracker } from "../../src/tracker/tracker.ts";
import { READS_EVERYTHING } from "./fake-trackers.ts";

const [dir] = process.argv.slice(2);
const project = { id: "github.com#1", host: "github.com", path: "fixture-org/tools", url: "https://github.com/fixture-org/tools", issues: { open: 150 } };
const key = { tracker: "github.com", project: project.id, login: "fixture-viewer" };
const tracker: Tracker = {
  product: "GitHub",
  host: "github.com",
  version: null,
  thread: async () => ({ kind: "cant-tell", reason: "unused" }),
  link: async () => ({ kind: "cant-tell", reason: "unused" }),
  untested: null,
  capabilities: async () => ({ kind: "capabilities", ...READS_EVERYTHING }),
  resolveProject: async () => ({ kind: "cant-tell", reason: "unused" }),
  changes: async () => ({ kind: "cant-tell", reason: "unused" }),
  issue: async () => ({ kind: "cant-tell", reason: "unused" }),
  assign: async () => ({ kind: "cant-tell", reason: "unused" }),
  viewer: async () => ({ kind: "viewer", login: key.login }),
  async openIssues(_, after) {
    if (after !== null) {
      process.stdout.write("saved one page\n");
      return new Promise(() => setInterval(() => {}, 1000));
    }
    const issues = Array.from({ length: 100 }, (_, i) => ({ id: `I_${i + 1}`, ref: `#${i + 1}`, title: `Issue ${i + 1}`, url: `https://github.com/fixture-org/tools/issues/${i + 1}`, createdAt: new Date(Date.UTC(2026, 0, i + 1)).toISOString(), assignees: [], planned: null, taskLevel: false, links: [], closingRequests: [] }));
    return { kind: "page", issues, total: 150, next: "100", unread: {} };
  },
};
await snapshotStore(dir!, { now: () => Date.now() }).read(key, tracker, project);
