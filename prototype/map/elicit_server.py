#!/usr/bin/env python3
"""PROTOTYPE — throwaway. An MCP server whose one tool walks the Map through elicitation forms.

No SDK: bare JSON-RPC over stdio, just enough to test how the forms render and how long a
single-select list can get before picking an Issue from it stops being usable.

    claude --mcp-config prototype/map/elicit.mcp.json
    > use the walk_map tool on opentofu__opentofu with list_size 30

Each step is one form. The loop runs inside one tool call, so no model turn is spent per step.
Every form and answer is appended to prototype/map/elicit.log so the state after each step can be read.
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from render import DATA, Map, BLOCKED, BLOCK, PARENT, CHILD, RELATED, OUT

LOG = os.path.join(os.path.dirname(__file__), "elicit.log")
_next_id = [1000]


def log(*a):
    with open(LOG, "a") as f:
        print(*a, file=f)


def send(msg):
    sys.stdout.write(json.dumps(msg) + "\n"); sys.stdout.flush()


def read():
    line = sys.stdin.readline()
    if not line:
        sys.exit(0)
    return json.loads(line)


def elicit(message, prop, schema):
    """Send elicitation/create and wait for its answer, answering pings meanwhile."""
    _next_id[0] += 1
    rid = _next_id[0]
    req = {"message": message, "requestedSchema": {"type": "object", "properties": {prop: schema}, "required": [prop]}}
    log(f"--> form ({len(schema.get('oneOf', []))} options)\n{message}")
    send({"jsonrpc": "2.0", "id": rid, "method": "elicitation/create", "params": req})
    while True:
        msg = read()
        if msg.get("id") == rid and ("result" in msg or "error" in msg):
            log("<--", json.dumps(msg.get("result") or msg.get("error")))
            r = msg.get("result") or {}
            return r.get("action"), (r.get("content") or {}).get(prop)
        if msg.get("method") == "ping":
            send({"jsonrpc": "2.0", "id": msg["id"], "result": {}})


def label(m, k):
    if isinstance(k, tuple):
        r = m.outside[k]
        return f"{OUT}{r['repo']}#{r['number']} {r['title']}"[:90]
    i = m.issues[k]
    mark = f" {BLOCKED}" if m.blocked(k) else (f" {BLOCK}{len(m.unblocks(k))}" if m.unblocks(k) else "")
    return f"#{k} {i['title']}"[:80] + mark


def pick_list(m, size):
    linked = [n for n in m.issues if m.linked(n)]
    ready = sorted((n for n in linked if not m.blocked(n)), key=lambda n: (-len(m.unblocks(n)), n))
    blocked = sorted(n for n in linked if m.blocked(n))
    unlinked = sorted((n for n in m.issues if not m.linked(n)), key=lambda n: m.issues[n]["updatedAt"], reverse=True)
    return (ready + blocked + unlinked)[:size]


def card(m, n):
    i, L = m.issues[n], m.links(n)
    lines = [f"{m.project} › #{n} {i['title']}",
             ("Blocked" if L["blocked_by"] else "unblocked") + f" · {i['comments']} comments · {i['url']}"]
    for key, name in [("blocked_by", f"{BLOCKED} Blocked by"), ("blocks", f"{BLOCK} Blocks"),
                      ("parents", f"{PARENT} Parent"), ("children", f"{CHILD} Children"), ("related", f"{RELATED} Related")]:
        if L[key]:
            lines.append(f"{name}: " + ", ".join(label(m, k).split(" ")[0] for k in sorted(L[key], key=str)))
    return "\n".join(lines)


def walk(args):
    m = Map(json.loads((DATA / f"{args.get('snapshot', 'opentofu__opentofu')}.json").read_text()))
    size = int(args.get("list_size", 20))
    trail = []
    current = None
    while True:
        if current is None:
            opts = pick_list(m, size)
            action, val = elicit(
                f"{m.project} — {len(m.issues)} open. Pick an Issue ({len(opts)} shown: unblocked first, then Blocked, then Unlinked).",
                "issue", {"type": "string", "title": "Issue",
                          "oneOf": [{"const": str(k), "title": label(m, k)} for k in opts]})
            if action != "accept":
                break
            current = int(val); trail.append(current); continue
        L = m.links(current)
        opts = [{"const": f"go:{k}" if not isinstance(k, tuple) else f"out:{k[0]}#{k[1]}", "title": f"{sym} {label(m, k)}"}
                for key, sym in [("blocked_by", BLOCKED), ("blocks", BLOCK), ("parents", PARENT), ("children", CHILD), ("related", RELATED)]
                for k in sorted(L[key], key=str)]
        opts += [{"const": "start", "title": "Start work on it"},
                 {"const": "suggest", "title": "Suggest Links for it"},
                 {"const": "back", "title": "Back to the list"},
                 {"const": "done", "title": "Done"}]
        action, val = elicit(card(m, current), "next", {"type": "string", "title": "Next", "oneOf": opts})
        if action != "accept" or val == "done":
            break
        if val == "back":
            current = None
        elif val.startswith("go:"):
            current = int(val[3:]); trail.append(current)
        elif val.startswith("out:"):
            trail.append(val[4:])   # an Outside Issue isn't followed; stay put
        else:
            trail.append(val); break
    text = "Trail: " + " → ".join(f"#{t}" if isinstance(t, int) else str(t) for t in trail)
    log(text)
    return text


TOOL = {"name": "walk_map", "description": "PROTOTYPE: walk the Issue Map through elicitation forms.",
        "inputSchema": {"type": "object", "properties": {
            "snapshot": {"type": "string", "description": "opentofu__opentofu or microsoft__playwright"},
            "list_size": {"type": "integer", "description": "how many Issues the first form offers"}}}}


def main():
    while True:
        msg = read()
        method, mid = msg.get("method"), msg.get("id")
        if method == "initialize":
            send({"jsonrpc": "2.0", "id": mid, "result": {
                "protocolVersion": msg["params"].get("protocolVersion", "2025-06-18"),
                "capabilities": {"tools": {}}, "serverInfo": {"name": "issue-map-prototype", "version": "0"}}})
            log("client capabilities:", json.dumps(msg["params"].get("capabilities")))
        elif method == "tools/list":
            send({"jsonrpc": "2.0", "id": mid, "result": {"tools": [TOOL]}})
        elif method == "tools/call":
            text = walk(msg["params"].get("arguments") or {})
            send({"jsonrpc": "2.0", "id": mid, "result": {"content": [{"type": "text", "text": text}]}})
        elif method == "ping":
            send({"jsonrpc": "2.0", "id": mid, "result": {}})
        elif mid is not None:
            send({"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": "not supported"}})


if __name__ == "__main__":
    main()
