# An optional, read-only Picture beside the in-session Map

The Map stays inside Claude Code, as ADR 0001 has it, and stays the surface everything is done from. A large Project can't be seen whole there, so the user can also ask for a Picture: the same Map drawn whole on a page outside Claude Code, from the same Snapshot, by the same drawing code. It shows Take next, every Group fully open, the Unlinked Issues and the Outside Issues, says how old its Snapshot is, and links each Issue to its Tracker. It never writes to a Tracker, never asks Claude anything and never refreshes itself; making a new one refreshes the Snapshot first, as any draw does.

The Picture is first a local page: one self-contained HTML file, with its CSS and script inline, no CDN and no request of its own, so it works for any Tracker and nothing leaves the machine. It is written to the state directory, never the working tree, readable only by its OS user, one per Tracker, Project and login, and replaced by the next. It opens with the OS's opener, or in Desktop's Browser pane from its path, and its path is printed where there is no opener.

The way back into the session is a copy button on each Issue that copies its URL. Pasting a URL already moves the Map to that Issue's card, so starting work and assigning stay in the session, behind the card's live read.

A local file can't reach a browser on another machine. Over SSH, on a VPS for instance, the Picture says so and prints its path with a ready `scp` command to fetch it. In a cloud or Remote Control session no command can fetch it to the user's device, so it says so plainly and points back to the in-session Map, or to an Artifact.

Publishing the Picture as a claude.ai Artifact is allowed, but only on the user's yes, asked before every publish and republish and never remembered. The question names what leaves the machine: the Project's private Issue titles, sent to claude.ai and held under the user's claude.ai account, which isn't the Tracker login. It isn't offered where artifacts aren't available — under `claude -p`, on an API key, Bedrock, Vertex or Foundry, or where they are turned off. The plugin never shares an Artifact and never suggests sharing one.

## Amends

- **ADR 0001**, which rejected "a browser page (an artifact or a local page)": the Map is still shown only inside Claude Code, but a read-only Picture of it may be opened outside, beside it. Nothing is done from the Picture.
- **ADR 0006**, which keeps a Snapshot's private titles to one OS user and one login: a local Picture is kept like a Snapshot, by the same rules, and is deleted with it. A published Artifact is the one place titles leave the machine, and only after the user says yes to that publish. An Artifact the user shares, or comments on through a share, is the user's own act and outside ADR 0006's guarantee.

## Considered Options

- **No browser page, as ADR 0001 had it.** A Project of hundreds of Groups can still only be read a summary at a time.
- **A `localhost` server reading the Tracker live.** It could send the chosen Issue straight back, but it opens a port that serves private titles, needs a process to manage, and does nothing more for SSH users than a file does, with `ssh -L`.
- **The Artifact first, or only.** It reaches every client, but needs a claude.ai sign-in on a paid plan, is unavailable on API keys and cloud providers, and sends private titles off the machine.
- **Consent to publishing given once and remembered.** Every publish sends the titles of that moment, which may include Issues that weren't there when consent was given.
- **Artifact comments as the way back.** "Send to Claude" works on Team and Enterprise only, through a share within the organisation, which is the line ADR 0006 draws. The copy button works everywhere.
- **Copy a prompt, such as "start work on" an Issue, instead of its URL.** It skips the card, so the moment of acting would rest on the Picture's old data rather than a live read.

## Consequences

- **Two drawings of one Snapshot.** The Picture and the Map come from the same drawing code and the same Snapshot, so they never disagree on what's Blocked or on Take next's order.
- **The Picture can be old.** It is a file, frozen at the Snapshot's age when it was made, and says so.
- **Size.** The largest Snapshots put tens of thousands of Issues on one page; the page has to stay usable at that size, and an Artifact under its 16 MB limit.
- **The README's privacy section gains the Picture**: under *On your machine*, the Picture file and how long it is kept; under *Over the network*, that a local Picture sends nothing; and a line that an Artifact sends the Project's open Issue titles to claude.ai, only after the user says yes, each time.
