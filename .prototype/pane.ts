/**
 * PROTOTYPE — wipe me (branch prototype/pane-look).
 *
 * Question: what should the Issue Map pane look like in the Claude desktop
 * app's Code tab, so it is simple to understand? Three variants of the
 * pane, beside a stand-in transcript, switchable with ?variant= and the
 * floating bar. Each variant draws only what a desktop pane can: rows of
 * text, native buttons, one SVG picture (which can't be clicked) and
 * markdown. Data is real: the recorded Snapshots, through pageData, the
 * same rules the HTML Picture and the Map draw by.
 *
 * Run: node .prototype/pane.ts   then open http://localhost:4173
 */
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { htmlPicture, pageData } from "../src/map/page.ts";
import type { Snapshot } from "../src/snapshot/snapshot.ts";
import { snapshot as built } from "../test/fakes/snapshot-builder.ts";

const here = new URL(".", import.meta.url);
const recorded = (name: string): Snapshot => JSON.parse(gunzipSync(readFileSync(new URL(`../test/fixtures/snapshots/${name}.json.gz`, here))).toString("utf8"));

/** The README's fixture Project, near enough: small, with every kind of line in it. */
function small(): Snapshot {
  const titles: Record<number, string> = {
    1: "Lay the foundation", 2: "Build the walls", 3: "Put on the roof", 4: "Plan the release", 5: "Write the release notes",
    6: "Tag the build", 7: "Proofread the release notes", 8: "Use the shared config", 9: "Remove the compatibility shims",
    11: "Keep the old parser working", 12: "Drop the legacy flag", 13: "Document the new layout", 14: "Rename the default branch", 15: "Add a changelog check",
  };
  const s = built(
    Object.entries(titles).map(([n, title]) => ({ n: Number(n), title })),
    [
      [1, "blocks", 2], [2, "blocks", 3],
      [4, "parent", 5], [4, "parent", 6], [5, "parent", 7], [4, "parent", { outside: "issue-map-fixtures/site#1", title: "Update the website for the release" }],
      [{ outside: "issue-map-fixtures-b/elsewhere#1", title: "Publish the shared config" }, "blocks", 8],
      [{ closed: 20 }, "blocks", 9], [{ closed: 10, closedAs: "not planned" }, "blocks", 11], [{ closed: 21 }, "blocks", 12],
    ],
  );
  return { ...s, project: { ...s.project, path: "issue-map-fixtures/map", url: "https://github.com/issue-map-fixtures/map" } };
}

/** What a pane is drawn from: pageData, and each of the Project's Issues' Links, which an Issue card shows. */
function paneData(key: string, label: string, s: Snapshot) {
  const page = pageData(s);
  const at = new Map(s.issues.map((issue, i) => [issue.id, i]));
  // [role, index among page.issues or -1, ref, title, open]
  const links = s.issues.map((issue) =>
    issue.links.map((link) => {
      const to = link.to;
      if (!to.readable) return [link.role, -1, "an Issue this login can't read", "", true];
      return [link.role, to.open ? (at.get(to.id) ?? -1) : -1, to.project === s.project.path ? to.ref.replace(/^.*(#\d+)$/, "$1") : `↗${to.ref}`, to.title, to.open];
    }),
  );
  const assigned = s.issues.map((issue) => issue.assignees.length > 0);
  return { key, label, page, links, assigned, picture: `${key}.html` };
}

const projects = [
  paneData("small", "Small: 14 open", small()),
  paneData("opentofu", "opentofu: 277 open", recorded("opentofu__opentofu")),
  paneData("playwright", "playwright: no Links", recorded("microsoft__playwright")),
];

for (const p of projects) {
  const s = p.key === "small" ? small() : recorded({ opentofu: "opentofu__opentofu", playwright: "microsoft__playwright" }[p.key]!);
  writeFileSync(new URL(p.picture, here), htmlPicture(s));
  console.log(p.label, "→", p.page.open, "open,", p.page.groups.length, "Groups,", p.page.next.picks.length, "in Take next");
}

const data = JSON.stringify(projects).replace(/</g, "\\u003c");
// The chosen design, and round 1's three variants beside it for comparison.
for (const page of ["pane", "pane.round1"]) {
  const template = readFileSync(new URL(`${page}.template.html`, here), "utf8");
  writeFileSync(new URL(`${page}.html`, here), template.replace("/*DATA*/null", data));
}
console.log(`pane.html: ${(data.length / 1024).toFixed(0)} KB of data; open http://localhost:4173 (round 1: /pane.round1.html)`);
