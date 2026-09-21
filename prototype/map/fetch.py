#!/usr/bin/env python3
"""PROTOTYPE — throwaway. Snapshot a GitHub Project's open Issues and their Links.

    python3 prototype/map/fetch.py opentofu/opentofu

Writes prototype/map/data/<owner>__<name>.json. Uses the `gh` login. Read-only.
Assignee logins are not stored, only whether an Issue is assigned.
"""
import json, pathlib, subprocess, sys

REF = "number title url state repository { nameWithOwner }"
QUERY = """
query($o:String!,$n:String!,$after:String){
  repository(owner:$o,name:$n){
    issues(states:OPEN,first:40,after:$after,orderBy:{field:CREATED_AT,direction:ASC}){
      totalCount
      pageInfo{hasNextPage endCursor}
      nodes{
        number title url createdAt updatedAt
        labels(first:10){nodes{name}}
        assignees(first:1){totalCount}
        comments{totalCount}
        milestone{title}
        parent{%(r)s}
        subIssues(first:50){nodes{%(r)s}}
        blockedBy(first:50){nodes{%(r)s}}
        blocking(first:50){nodes{%(r)s}}
        trackedIssues(first:50){nodes{%(r)s}}
        trackedInIssues(first:20){nodes{%(r)s}}
      }
    }
  }
}""" % {"r": REF}


def gql(**v):
    args = ["gh", "api", "graphql", "-f", f"query={QUERY}"]
    for k, val in v.items():
        if val is not None:
            args += ["-F", f"{k}={val}"]
    return json.loads(subprocess.check_output(args))["data"]


def ref(n):
    return {"repo": n["repository"]["nameWithOwner"], "number": n["number"],
            "title": n["title"], "url": n["url"], "state": n["state"]}


def main(slug):
    owner, name = slug.split("/")
    issues, after = [], None
    while True:
        page = gql(o=owner, n=name, after=after)["repository"]["issues"]
        for n in page["nodes"]:
            issues.append({
                "number": n["number"], "title": n["title"], "url": n["url"],
                "createdAt": n["createdAt"], "updatedAt": n["updatedAt"],
                "labels": [l["name"] for l in n["labels"]["nodes"]],
                "assigned": n["assignees"]["totalCount"] > 0,
                "comments": n["comments"]["totalCount"],
                "milestone": (n["milestone"] or {}).get("title"),
                "parent": ref(n["parent"]) if n["parent"] else None,
                "children": [ref(x) for x in n["subIssues"]["nodes"]],
                "blockedBy": [ref(x) for x in n["blockedBy"]["nodes"]],
                "blocking": [ref(x) for x in n["blocking"]["nodes"]],
                "tracks": [ref(x) for x in n["trackedIssues"]["nodes"]],
                "trackedIn": [ref(x) for x in n["trackedInIssues"]["nodes"]],
            })
        print(f"{len(issues)}/{page['totalCount']}", file=sys.stderr)
        if not page["pageInfo"]["hasNextPage"]:
            break
        after = page["pageInfo"]["endCursor"]
    out = pathlib.Path(__file__).parent / "data" / f"{owner}__{name}.json"
    out.write_text(json.dumps({"project": slug, "tracker": "github.com",
                               "canRecordBlocks": True, "issues": issues}, indent=1))
    print(out)


if __name__ == "__main__":
    main(sys.argv[1])
