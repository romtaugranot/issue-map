# Privacy and data

[← Docs](README.md) · [README](../README.md)

What the Map writes, what it keeps and for how long, what runs in the background, and what leaves your machine.

## To a Tracker

The Map writes two things, each only after you confirm it: assigning an Issue to you, and a Link Suggestion you ticked. Before each write, it reads the Issue again. It then writes once and stops at the first refusal. It writes nothing on a Best effort Project, or for a login that may only read.

## On your machine

It keeps its state in `$ISSUE_MAP_STATE_DIR`, or `$XDG_STATE_HOME/issue-map`, or `~/.local/state/issue-map`, readable only by your OS user:

| What | Kept |
|---|---|
| A Snapshot of each Project's open Issues and Links per login, and the pages of a read not yet finished. They hold private Issue titles | Until the Tracker says the login can no longer read the Project, or until nothing has drawn or read the Project for a month. The refresher keeps the Home Project's Snapshot warm, so it never expires while the refresher runs. The Snapshot of a Project you visited with `go` lasts until it's drawn again or expires |
| Each output shown through the display hook | A month, even after its Project's Snapshot is deleted |
| This session's trail for `back` | A month |
| The 10 Projects you moved to last, and the last Home Project of each checkout | Until replaced |
| The Link Suggestions offered in each session (references only, never an Issue's text) | Until that session's next offer replaces them |
| The Link Suggestions you declined | Kept, so they aren't offered again |
| The HTML Picture of a Project, when you ask for one: a page holding its open Issue titles, one per Tracker, Project and login | Until the next one you ask for replaces it, or the Snapshot it was drawn from is deleted |
| `background.log`, what the background processes print | Past a megabyte, it's moved to `background.log.1`, replacing the one there |

Both variables must be absolute paths. An empty or relative one is ignored, as if unset, so private Issue titles never land in your working tree.

Outside that directory, it writes only when you ask. It writes `issue-map.home` in the checkout's local git config when you pick a Home Project among several. It writes `statusLine` in your Claude Code `settings.json` when you ask it to take out the status line 0.1.0 wrote there.

## In the background

Drawing the Map starts a full read of a Project when one is due. It also starts a refresher that keeps the Home Project's Snapshot warm, with a few requests every 90 seconds. The refresher runs as a process of its own and carries on after Claude Code exits. It stops when any of these happens:

- a day passes with nobody drawing the Map or glancing at its status line row;
- the login changes;
- the Tracker refuses it;
- the Project's path leads elsewhere.

To stop it sooner:

```sh
pkill -f 'src/cli.ts refresher'
```

Drawing the Map again starts it again. After an update, the new refresher replaces the previous version's.

Each `gh` or `glab` call is stopped after 60 seconds, or after 5 minutes for a page of a full read. A full read is stopped after 3 hours. The Map then says the Tracker didn't answer, keeps drawing from the Snapshot, and tries again on the next draw or refresher round. A stopped full read resumes from its last page. To stop a stuck full read sooner:

```sh
pkill -f 'src/cli.ts read'
```

## Over the network

Besides `gh` and `glab`, the Map sends anonymous HTTPS requests to a remote's host, or to a host you name with `go`, to tell whether it runs GitHub or GitLab. It sends one request to `/api/v3/meta` and one to `/api/v4/version`, never with a credential. It skips them for the hosts it knows by name: github.com, `*.ghe.com`, gitlab.com and `*.gitlab-dedicated.com`. A host found only that way, with no login for it, is never read.

The HTML Picture sends and fetches nothing. It's one file with nothing to load, and its policy forbids every request. Only the Tracker links you click on it leave the page.

Publishing the HTML Picture as an Artifact sends the Project's open Issue titles to claude.ai, under your claude.ai account. It happens only after you say yes, each time. Sharing it is your own act.

## To the model provider

Issue text goes wherever the conversation goes. Claude reads what each command prints, so the titles of the Issues it shows reach your model provider, as everything in a Claude Code conversation does. An Issue's body and comments also reach it when you start work on that Issue or ask for Link Suggestions.

A host you type into `go` gets the requests above, whether or not it runs a Tracker, unless the Map knows it by name.
