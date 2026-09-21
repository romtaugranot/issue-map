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
