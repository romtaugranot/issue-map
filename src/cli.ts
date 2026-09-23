/** `issue-map home [--pick <URL>]`: says which Project the Map opens on for this checkout. */
import { parseArgs } from "node:util";
import { anonymousHttp, processCli } from "./tracker/boundary.ts";
import { github } from "./tracker/github.ts";
import { gitlab } from "./tracker/gitlab.ts";
import { trackers } from "./tracker/tracker.ts";
import { checkoutRoot, gitCheckout } from "./home/checkout.ts";
import { resolveHome, type HomeAnswer } from "./home/home.ts";

const USAGE = "usage: issue-map home [--pick <URL>]";

async function main(argv: string[]): Promise<number> {
  const { positionals, values } = parseArgs({ args: argv, allowPositionals: true, options: { pick: { type: "string" } } });
  if (positionals[0] !== "home" || positionals.length > 1) {
    console.error(USAGE);
    return 2;
  }
  const root = await checkoutRoot(process.cwd());
  if (!root) {
    console.log(`No Home Project: ${process.cwd()} isn't inside a git checkout.`);
    return 0;
  }
  const deps = { cli: processCli, http: anonymousHttp, env: process.env };
  const answer = await resolveHome(
    { checkout: gitCheckout(root), trackers: trackers([github(deps), gitlab(deps)]), env: process.env, sshHostname },
    { pick: values.pick },
  );
  console.log(render(answer));
  return 0;
}

function render({ text, choices }: HomeAnswer): string {
  if (choices.length === 0) return text;
  const lines = choices.map((c) => `- ${c.label} — ${c.description}\n  ${c.url}`);
  return [text, "", "Choices, best guess first:", ...lines].join("\n");
}

/** The real host behind an SSH alias, read from the user's SSH config without connecting. */
async function sshHostname(alias: string): Promise<string> {
  const answer = await processCli("ssh", ["-G", alias]);
  if (answer.kind !== "exited" || answer.code !== 0) return alias;
  return /^hostname (\S+)$/m.exec(answer.stdout)?.[1] ?? alias;
}

process.exitCode = await main(process.argv.slice(2));
