/**
 * The MessageDisplay hook's work (ADR 0009): reads a batch of a reply as it
 * streams, and answers with it as shown, each line standing for a kept
 * output replaced by that output, which it marks as shown. Prints nothing
 * when there's none.
 */
import { stateDir } from "./state.ts";
import { displayed } from "./show/shown.ts";

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
const { delta } = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { delta?: string };
const shown = delta === undefined ? null : await displayed(stateDir(), delta);
if (shown !== null) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "MessageDisplay", displayContent: shown } }));
