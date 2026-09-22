#!/usr/bin/env python3
"""PROTOTYPE — throwaway. Can GitHub's advanced search find every Issue on the Map first?

    python3 prototype/large/search_first.py rust-lang__rust

Runs the four Link qualifiers as ISSUE_ADVANCED searches, times them, and
compares what they return with the Issues the full snapshot shows as Linked.
"""
import json, pathlib, subprocess, sys, time

DATA = pathlib.Path(__file__).parent / "data"
Q = ["is:blocked", "is:blocking", "has:sub-issue", "has:parent-issue"]


def search(repo, q):
    nums, after, t = [], None, time.time()
    while True:
        query = ('query($q:String!,$after:String){search(type:ISSUE_ADVANCED,query:$q,first:100,after:$after)'
                 '{issueCount pageInfo{hasNextPage endCursor} nodes{... on Issue{number}}}}')
        args = ["gh", "api", "graphql", "-f", f"query={query}", "-F", f"q=repo:{repo} is:issue is:open {q}"]
        if after:
            args += ["-F", f"after={after}"]
        d = json.loads(subprocess.check_output(args))["data"]["search"]
        nums += [n["number"] for n in d["nodes"] if n]
        if not d["pageInfo"]["hasNextPage"]:
            return nums, d["issueCount"], round(time.time() - t, 2)
        after = d["pageInfo"]["endCursor"]


def main(stem):
    snap = json.loads((DATA / f"{stem}.json").read_text())
    repo = snap["project"]
    linked = {i["number"] for i in snap["issues"]
              if any([i["parent"], i["children"], i["blockedBy"], i["blocking"], i["tracks"], i["trackedIn"]])}
    found, t0 = set(), time.time()
    for q in Q:
        nums, count, dt = search(repo, q)
        found |= set(nums)
        print(f"{q}: {count} found in {dt}s")
    (DATA / f"{stem}.searched.json").write_text(json.dumps(sorted(found)))
    print(json.dumps({"searched_total": len(found), "linked_in_snapshot": len(linked),
                      "missed_by_search": len(linked - found), "extra_from_search": len(found - linked),
                      "seconds": round(time.time() - t0, 1),
                      "missed_examples": sorted(linked - found)[:5]}, indent=1))


if __name__ == "__main__":
    main(sys.argv[1])
