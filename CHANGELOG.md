# Changelog

What each release changes for someone using the Map. The Release workflow publishes the section headed with the version it releases as that release's notes, and refuses a version with none ([docs/releasing.md](docs/releasing.md)).

## 0.1.0

The first release. It needs Claude Code 2.1.152 or later, which shows the Map's output through a display hook, and Node.js 22.18 or later.

- Draws a GitHub or GitLab Project's open Issues as a Map joined by the Blocks, Parent and Related Links its Tracker records: Take next, the Groups, and the Unlinked Issues.
- Lists all of Take next, the Unblocked Issues others have taken, every Group and the Unlinked Issues, 15 a page, and refreshes the Map when you ask.
- Opens any Issue's card, read live, and moves from one card to the next, between Projects, and back.
- Draws a whole Group, or the Picture around one Issue, and gives either as Mermaid or DOT to paste where GitHub or GitLab render it.
- Shows the whole Map as one read-only HTML page in your browser, or publishes it as a private claude.ai Artifact. It asks before every publish, because that sends the Project's Issue titles to claude.ai.
- Puts the Home Project's first Issue in Take next in your status line, beside any status line you already have, and takes it out again leaving yours as it was.
- Assigns an Issue to you, briefs you on one before you start, and offers Link Suggestions from the Issues' text, writing nothing until you confirm it.
- Promises github.com, GHEC, GHES 3.18 and later, gitlab.com, GitLab Dedicated and self-managed GitLab 16.0 and later, and reads older releases as Best effort, as the README's support table says.
