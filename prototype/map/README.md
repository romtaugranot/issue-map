# PROTOTYPE — what the Map looks like and how you move through it

Throwaway code for the wayfinder ticket "Prototype: what the Map looks like and how you move through it" (#9). Not the plugin. Nothing here is meant to be kept.

Test data are snapshots of two public Projects, taken 2026-09-21 with `fetch.py`:

- `opentofu/opentofu`: 277 open Issues, with Blocks and Parent Links and 7 Outside Issues.
- `microsoft/playwright`: 176 open Issues and no Links.

| File | What it tries |
|---|---|
| `fetch.py` | Snapshot a GitHub Project's open Issues and Links with one paged GraphQL query |
| `render.py` | Four text Maps for the conversation: A ready queue, B outline, C focus card, D clusters |
| `statusline.py` | A status line row, alone or wrapping an existing status line command |
| `elicit_server.py` + `elicit.mcp.json` | An MCP server whose tool walks the Map through elicitation forms |

```sh
python3 prototype/map/render.py opentofu__opentofu --variant B --width 44
echo '{}' | python3 prototype/map/statusline.py opentofu__opentofu --wrap "echo 'existing status line'"
claude --mcp-config prototype/map/elicit.mcp.json   # then ask it to call walk_map
```

## What the tests showed (2026-09-21, Claude Code 2.1.278)

- **Elicitation in the terminal** (`walk_map`, 100 options, 100×40 terminal): the form shows 24 options, then "↓ N more below". Typing doesn't filter the list. Option labels are cut at about 50 characters, so a mark at the end of a label is lost. Picking one takes about four keys (→, ↓…, Space, Enter, Enter). A multi-line message renders in full. At 44 columns, titles are cut to about 25 characters and so is the Issue's URL. The client advertised `elicitation: {}`. Desktop, web and Remote Control were not tested.
- **Status line**: `--wrap` runs the existing command with the same stdin, prints its rows, then adds one row of its own.
- **Link Suggestions** from the text of opentofu's 233 Unlinked Issues: 149 references to other Issues, 59 of them to open Issues in the Project, and only 3 that make a Link GitHub can record (2 Parent, 1 Blocks). The rest were "related", a possible duplicate, a closed Issue, or a ranked list that just names Issues.
- The text Map has to be reprinted by Claude in its reply to be seen, so every line costs output tokens.
