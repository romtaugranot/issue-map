#!/usr/bin/env python3
"""PROTOTYPE — throwaway. Snapshot a large GitHub Project's open Issues and Links.

    python3 prototype/large/fetch_github.py rust-lang/rust

Same shape as prototype/map/fetch.py, at 100 Issues a page, plus open Closing
Requests. Rewrites data/<owner>__<name>.json after every page, so a draw can be
tried against a partial Snapshot while the read runs. Logs each page's time to
data/<owner>__<name>.log. Uses the `gh` login. Read-only.
"""
import json, pathlib, subprocess, sys, time

REF = "number title url state closedAt repository { nameWithOwner }"
QUERY = """
query($o:String!,$n:String!,$after:String){
  repository(owner:$o,name:$n){
    issues(states:OPEN,first:100,after:$after,orderBy:{field:CREATED_AT,direction:ASC}){
      totalCount
      pageInfo{hasNextPage endCursor}
      nodes{
        number title url createdAt updatedAt
        assignees(first:1){totalCount}
        comments{totalCount}
        milestone{title dueOn}
        parent{%(r)s}
        subIssues(first:50){nodes{%(r)s}}
        blockedBy(first:50){nodes{%(r)s}}
        blocking(first:50){nodes{%(r)s}}
        trackedIssues(first:50){nodes{%(r)s}}
        trackedInIssues(first:20){nodes{%(r)s}}
      }
    }
  }
  rateLimit{cost remaining}
}""" % {"r": REF}


def gql(**v):
    args = ["gh", "api", "graphql", "-f", f"query={QUERY}"]
    for k, val in v.items():
        if val is not None:
            args += ["-F", f"{k}={val}"]
    return json.loads(subprocess.check_output(args))["data"]


def ref(n):
    return {"repo": n["repository"]["nameWithOwner"], "number": n["number"], "title": n["title"],
            "url": n["url"], "state": n["state"], "closedAt": n["closedAt"]}


def main(slug):
    owner, name = slug.split("/")
    base = pathlib.Path(__file__).parent / "data" / f"{owner}__{name}"
    out, log = base.with_suffix(".json"), open(base.with_suffix(".log"), "w")
    issues, after, t0, total = [], None, time.time(), None
    while True:
        t = time.time()
        d = gql(o=owner, n=name, after=after)
        page = d["repository"]["issues"]
        total = page["totalCount"]
        for n in page["nodes"]:
            issues.append({
                "number": n["number"], "title": n["title"], "url": n["url"],
                "createdAt": n["createdAt"], "updatedAt": n["updatedAt"],
                "assigned": n["assignees"]["totalCount"] > 0,
                "comments": n["comments"]["totalCount"],
                "milestone": (n["milestone"] or {}).get("title"),
                "due": (n["milestone"] or {}).get("dueOn"),
                "parent": ref(n["parent"]) if n["parent"] else None,
                "children": [ref(x) for x in n["subIssues"]["nodes"]],
                "blockedBy": [ref(x) for x in n["blockedBy"]["nodes"]],
                "blocking": [ref(x) for x in n["blocking"]["nodes"]],
                "tracks": [ref(x) for x in n["trackedIssues"]["nodes"]],
                "trackedIn": [ref(x) for x in n["trackedInIssues"]["nodes"]],
            })
        done = not page["pageInfo"]["hasNextPage"]
        out.write_text(json.dumps({"project": slug, "tracker": "github.com", "canRecordBlocks": True,
                                   "totalOpen": total, "complete": done, "issues": issues}))
        print(json.dumps({"t": round(time.time() - t0, 1), "page_s": round(time.time() - t, 2),
                          "read": len(issues), "total": total, "cost": d["rateLimit"]["cost"]}), file=log, flush=True)
        if done:
            break
        after = page["pageInfo"]["endCursor"]
    print(out, f"{len(issues)} Issues in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main(sys.argv[1])
