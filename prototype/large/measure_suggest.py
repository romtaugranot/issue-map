#!/usr/bin/env python3
"""PROTOTYPE — throwaway. What `suggest` costs to read on a Project with thousands of Unlinked Issues.

    python3 prototype/large/measure_suggest.py rust-lang__rust 120

Reads the newest N Unlinked Issues' body, comments and Mentions (cross-references),
10 per GraphQL query, and measures time, bytes, tokens (chars/4) and how many
references to other Issues the text holds. Read-only.
"""
import json, pathlib, re, subprocess, sys, time

DATA = pathlib.Path(__file__).parent / "data"
PART = """
  i%(n)d: issue(number:%(num)d){
    number bodyText
    comments(first:20){totalCount nodes{bodyText}}
    timelineItems(first:50,itemTypes:[CROSS_REFERENCED_EVENT]){
      totalCount nodes{... on CrossReferencedEvent{willCloseTarget source{... on Issue{number state} ... on PullRequest{number state}}}}
    }
  }"""


def main(stem, n=120, per=10):
    snap = json.loads((DATA / f"{stem}.json").read_text())
    owner, name = snap["project"].split("/")
    linked = lambda i: any([i["parent"], i["children"], i["blockedBy"], i["blocking"], i["tracks"], i["trackedIn"]])
    un = sorted((i for i in snap["issues"] if not linked(i)), key=lambda i: i["createdAt"], reverse=True)[:n]
    numbers = [i["number"] for i in un]
    chars = refs = mentions = open_refs = 0
    t0, pages, byts = time.time(), 0, 0
    per_issue = []
    for s in range(0, len(numbers), per):
        chunk = numbers[s:s + per]
        q = "query{repository(owner:\"%s\",name:\"%s\"){%s}rateLimit{cost}}" % (
            owner, name, "".join(PART % {"n": i, "num": x} for i, x in enumerate(chunk)))
        out = subprocess.check_output(["gh", "api", "graphql", "-f", f"query={q}"])
        byts += len(out); pages += 1
        d = json.loads(out)["data"]["repository"]
        for k, v in d.items():
            if not isinstance(v, dict) or "bodyText" not in v:
                continue
            text = (v["bodyText"] or "") + " ".join(c["bodyText"] or "" for c in v["comments"]["nodes"])
            chars += len(text)
            r = set(int(x) for x in re.findall(r"#(\d{3,6})", text))
            refs += len(r)
            mentions += v["timelineItems"]["totalCount"]
            open_refs += sum(1 for e in v["timelineItems"]["nodes"] if e and e.get("source", {}).get("state") == "OPEN")
            per_issue.append({"n": v["number"], "chars": len(text), "comments": v["comments"]["totalCount"], "refs": len(r)})
    dt = time.time() - t0
    print(json.dumps({
        "issues": len(numbers), "requests": pages, "seconds": round(dt, 1), "bytes": byts,
        "chars": chars, "tokens_est": chars // 4, "text_refs": refs, "mentions": mentions,
        "mentions_open": open_refs,
        "per_issue": {"chars": chars // len(numbers), "tokens": chars // 4 // len(numbers)},
        "biggest": sorted(per_issue, key=lambda x: -x["chars"])[:5],
    }, indent=1))


if __name__ == "__main__":
    main(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 120)
