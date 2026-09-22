#!/usr/bin/env python3
"""PROTOTYPE — throwaway. Snapshot a large GitLab Project's open work items and Links.

    python3 prototype/large/fetch_gitlab.py gitlab-org/gitlab

Anonymous GraphQL on gitlab.com, 100 a page (gl_query.graphql). Writes the same
shape as fetch_github.py to data/<group>__<name>.json every 10 pages, so a draw
can be tried against a partial Snapshot while the read runs. Read-only.
"""
import json, pathlib, sys, time, urllib.request

HERE = pathlib.Path(__file__).parent
QUERY = (HERE / "gl_query.graphql").read_text()


def post(v):
    body = json.dumps({"query": QUERY, "variables": v}).encode()
    for attempt in range(6):
        try:
            req = urllib.request.Request("https://gitlab.com/api/graphql", body, {"Content-Type": "application/json"})
            d = json.loads(urllib.request.urlopen(req, timeout=60).read())
            if d.get("errors"):
                raise RuntimeError(d["errors"][:2])
            return d["data"]
        except Exception as e:
            print("retry", attempt, e, file=sys.stderr, flush=True)
            time.sleep(5 * (attempt + 1))
    raise SystemExit("gave up")


HIDDEN = [0]


def ref(w):
    if w is None:  # a linked item the anonymous reader can't see: a nameless Outside Issue
        HIDDEN[0] += 1
        return {"repo": "(hidden)", "number": HIDDEN[0], "title": "", "url": "", "state": "OPEN",
                "closedAt": None, "type": "?", "hidden": True}
    return {"repo": w["namespace"]["fullPath"], "number": int(w["iid"]), "title": w["title"],
            "url": w["webUrl"], "state": w["state"], "closedAt": w["closedAt"], "type": w["workItemType"]["name"]}


def main(path):
    base = HERE / "data" / path.replace("/", "__")
    out, log = base.with_suffix(".json"), open(base.with_suffix(".log"), "w")
    issues, after, t0, pages = [], None, time.time(), 0

    def save(done):
        out.write_text(json.dumps({"project": path, "tracker": "gitlab.com", "canRecordBlocks": True,
                                   "totalOpen": total, "complete": done, "issues": issues}))

    while True:
        t = time.time()
        wi = post({"p": path, "first": 100, "after": after})["project"]["workItems"]
        total = wi["count"]
        for n in wi["nodes"]:
            w = {k: v for x in n["widgets"] for k, v in x.items()}
            h = {"parent": w.get("parent"), "children": (w.get("children") or {}).get("nodes", [])}
            links = (w.get("linkedItems") or {}).get("nodes", [])
            kind = lambda *names: [ref(l["workItem"]) for l in links if l["linkType"].lower() in names]
            issues.append({
                "number": int(n["iid"]), "title": n["title"], "url": n["webUrl"], "type": n["workItemType"]["name"],
                "createdAt": n["createdAt"], "updatedAt": n["updatedAt"],
                "assigned": ((w.get("assignees") or {}).get("count") or 0) > 0,
                "comments": n["userDiscussionsCount"],
                "milestone": (w.get("milestone") or {}).get("title"),
                "due": (w.get("milestone") or {}).get("dueDate"),
                "parent": ref(h["parent"]) if h["parent"] else None,
                "children": [ref(x) for x in h["children"]],
                "blockedBy": kind("is_blocked_by", "blocked_by"),
                "blocking": kind("blocks"),
                "related": kind("relates_to", "related"),
                "tracks": [], "trackedIn": [],
            })
        pages += 1
        done = not wi["pageInfo"]["hasNextPage"]
        if done or pages % 10 == 0:
            save(done)
        print(json.dumps({"t": round(time.time() - t0, 1), "page_s": round(time.time() - t, 2),
                          "read": len(issues), "total": total}), file=log, flush=True)
        if done:
            break
        after = wi["pageInfo"]["endCursor"]
    print(out, f"{len(issues)} work items in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main(sys.argv[1])
