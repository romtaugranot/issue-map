#!/usr/bin/env python3
"""PROTOTYPE — throwaway. Text Maps of a Project with thousands of open Issues.

    python3 prototype/large/render_large.py <snapshot> overview  --variant A|B|C
    python3 prototype/large/render_large.py <snapshot> outline   --variant A|B|C [--group 1]
    python3 prototype/large/render_large.py <snapshot> unlinked  --variant A|B|C
    python3 prototype/large/render_large.py <snapshot> stats
    ... --upto N   draws from only the first N Issues read, as a partial Snapshot would
    ... --links    prints Markdown links, as Claude would in the conversation

<snapshot> is a file stem in data/, e.g. rust-lang__rust or gitlab-org__gitlab.
Rules are the ones the wayfinder map has decided so far (Take next order,
Groups through Outside Issues, closed blockers unblock, 60-character titles).
"""
import argparse, json, pathlib, re
from collections import Counter, defaultdict

DATA = pathlib.Path(__file__).parent / "data"
BLOCK, BLOCKED, OUT, RELATED = "▶", "⛔", "↗", "~"
TITLE = 60
PER = 4          # children / waiting Issues shown under one Issue in an outline


def n_(x):
    return f"{x:,}"


class Map:
    def __init__(self, snap, upto=None):
        self.project = snap["project"]
        self.gitlab = snap["tracker"].startswith("gitlab")
        self.total = snap.get("totalOpen") or len(snap["issues"])
        issues = snap["issues"][:upto] if upto else snap["issues"]
        self.partial = bool(upto) or not snap.get("complete", True)
        self.I = {i["number"]: i for i in issues}
        self.far = {}                                   # key -> ref, for Outside and not-yet-read Issues
        self.closed_blockers = defaultdict(list)        # n -> refs of closed Issues that Block it
        E = {k: defaultdict(set) for k in ("blocks", "blocked_by", "children", "parents", "related")}
        self.E = E
        for i in issues:
            n = i["number"]
            for r in i["blockedBy"]:
                self.edge("blocks", "blocked_by", r, n, closed_note=n)
            for r in i["blocking"]:
                self.edge("blocks", "blocked_by", n, r)
            for r in ([i["parent"]] if i["parent"] else []) + i["trackedIn"]:
                self.edge("children", "parents", r, n)
            for r in i["children"] + i["tracks"]:
                self.edge("children", "parents", n, r)
            for r in i.get("related", []):
                k = self.key(r)
                if k is not None:
                    E["related"][n].add(k); E["related"][k].add(n)
        self._waits = {}

    def key(self, r):
        """Open in-Project Issue -> number. Open Outside or not-yet-read Issue -> (repo, n). Closed -> None."""
        if r["repo"] == self.project and r["number"] in self.I:
            return r["number"]
        if r["state"] != "OPEN":
            return None
        k = (r["repo"], r["number"])
        self.far[k] = r
        return k

    def edge(self, fwd, back, a, b, closed_note=None):
        ka = a if isinstance(a, int) else self.key(a)
        kb = b if isinstance(b, int) else self.key(b)
        if ka is None and closed_note is not None and isinstance(a, dict):
            self.closed_blockers[closed_note].append(a)
        if ka is None or kb is None:
            return
        self.E[fwd][ka].add(kb); self.E[back][kb].add(ka)

    # --- the rules -------------------------------------------------------
    def nbrs(self, k):
        E = self.E
        return E["blocks"][k] | E["blocked_by"][k] | E["children"][k] | E["parents"][k] | E["related"][k]

    def linked(self, n):
        return bool(self.nbrs(n))

    def blocked(self, n):
        return bool(self.E["blocked_by"][n])

    def unblocked(self, n):
        return not self.blocked(n) and (self.linked(n) or bool(self.closed_blockers[n]))

    def waits(self, k):
        """Open Issues that wait on k, through Blocks Links (Outside Issues pass it on)."""
        if k not in self._waits:
            seen, stack = set(), [k]
            while stack:
                for x in self.E["blocks"][stack.pop()]:
                    if x not in seen and x != k:
                        seen.add(x); stack.append(x)
            self._waits[k] = seen
        return self._waits[k]

    def is_task(self, k):
        return self.gitlab and (self.I[k] if isinstance(k, int) else self.far[k]).get("type") == "Task"

    def take_next(self):
        """Unblocked, unassigned, not a Parent with open non-task children. Children carry the Parent's count."""
        out = []
        for n, i in self.I.items():
            if not self.unblocked(n) or i["assigned"]:
                continue
            if any(not self.is_task(c) for c in self.E["children"][n]):
                continue
            w = set(self.waits(n))
            stack, seen = list(self.E["parents"][n]), set()
            while stack:
                p = stack.pop()
                if p in seen or not isinstance(p, int):
                    continue
                seen.add(p); w |= self.waits(p); stack.extend(self.E["parents"][p])
            out.append((n, len(w)))
        out.sort(key=lambda t: (-t[1], self.I[t[0]].get("due") or "9999", self.I[t[0]]["createdAt"]))
        return out

    def groups(self):
        seen, out = set(), []
        for n in self.I:
            if n in seen or not self.linked(n):
                continue
            comp, stack = set(), [n]
            while stack:
                x = stack.pop()
                if x in comp:
                    continue
                comp.add(x)
                stack.extend(self.nbrs(x))
            seen |= comp
            out.append(comp)
        return out

    def head(self, comp):
        """The Issue a Group's line names: the one with most under it, Outside Issues last."""
        return max(comp, key=lambda k: (len(self.desc(k)) + len(self.waits(k)), isinstance(k, int),
                                        -(k if isinstance(k, int) else 0)))

    def desc(self, k):
        seen, stack = set(), [k]
        while stack:
            for x in self.E["children"][stack.pop()]:
                if x not in seen and x != k:
                    seen.add(x); stack.append(x)
        return seen


class Out:
    def __init__(self, m, links):
        self.m, self.links, self.lines = m, links, []

    def add(self, s=""):
        self.lines.append(s)

    def ref(self, k):
        m = self.m
        if isinstance(k, int):
            text, url = f"#{k}", m.I[k]["url"]
        else:
            r = m.far[k]
            if r.get("hidden"):
                return "↗(no access)"
            inside = r["repo"] == m.project
            text = f"#{r['number']}" if inside else f"{OUT}{r['repo']}#{r['number']}"
            if m.gitlab and r.get("type") == "Epic":
                text = f"{OUT}&{r['number']}"
            url = r["url"]
        return f"[{text}]({url})" if self.links else text

    def title(self, k):
        t = self.m.I[k]["title"] if isinstance(k, int) else self.m.far[k]["title"]
        return t if len(t) <= TITLE else t[:TITLE - 1] + "…"

    def issue(self, prefix, k, suffix="", indent=0):
        self.add(" " * indent + f"{prefix}{self.ref(k)} {self.title(k)}{suffix}".rstrip())

    def header(self):
        m = self.m
        on = sum(1 for n in m.I if m.linked(n))
        un = len(m.I) - on
        blocked = sum(1 for n in m.I if m.blocked(n))
        unbl = sum(1 for n in m.I if m.unblocked(n))
        read = f" · read {n_(len(m.I))} of {n_(m.total)}" if m.partial else ""
        self.add(f"**{m.project}** · {n_(m.total)} open · {n_(on)} on the Map · {n_(un)} Unlinked{read}")
        self.add(f"{n_(unbl)} unblocked · {n_(blocked)} Blocked")
        self.add()

    def take_next(self, k=5):
        tn = self.m.take_next()
        self.add("**Take next**")
        for n, w in tn[:k]:
            self.issue("- ", n, f"  {BLOCK}{w} wait on it" if w else "")
        if len(tn) > k:
            self.add(f"- … {n_(len(tn) - k)} more")
        self.add()

    def group_line(self, prefix, comp, extra=""):
        m = self.m
        inside = [k for k in comp if isinstance(k, int)]
        outs = len(comp) - len(inside)
        unbl = sum(1 for k in inside if m.unblocked(k))
        s = f" — {n_(len(inside))} Issue{'s' if len(inside) != 1 else ''}, {n_(unbl)} unblocked" + (f", {outs}{OUT}" if outs else "") + extra
        self.issue(prefix, m.head(comp), s)

    def unlinked_line(self):
        m = self.m
        un = [n for n in m.I if not m.linked(n)]
        since = sum(1 for n in un if m.closed_blockers[n] and not m.blocked(n))
        self.add(f"**Unlinked: {n_(len(un))}** — no Link to another open Issue"
                 + (f" ({since} unblocked since a blocker closed)" if since else "")
                 + ". Ask to list them, or for Link Suggestions.")


# --- overview ---------------------------------------------------------------
def overview(o, variant, lim=8):
    m = o.m
    o.header()
    o.take_next()
    gs = m.groups()
    tn_rank = {n: r for r, (n, _) in enumerate(m.take_next())}
    if variant == "A":           # largest first
        gs.sort(key=lambda c: -sum(isinstance(k, int) for k in c))
        o.add(f"**Groups: {n_(len(gs))}** — largest first")
        for c in gs[:lim]:
            o.group_line("- ", c)
        rest = gs[lim:]
        if rest:
            o.add(f"- … {n_(len(rest))} more Groups, {n_(sum(sum(isinstance(k, int) for k in c) for c in rest))} Issues")
    elif variant == "B":         # the Group holding the best Take-next Issue first
        best = lambda c: min((tn_rank[k] for k in c if k in tn_rank), default=10**9)
        gs.sort(key=lambda c: (best(c), -len(c)))
        o.add(f"**Groups: {n_(len(gs))}** — in Take-next order")
        for c in gs[:lim]:
            b = best(c)
            o.group_line("- ", c, "" if b < 10**9 else " · nothing to take")
        idle = sum(1 for c in gs[lim:] if best(c) == 10**9)
        if len(gs) > lim:
            o.add(f"- … {n_(len(gs) - lim)} more Groups; {n_(idle)} of them have nothing to take")
    else:                        # size bands
        o.add(f"**Groups: {n_(len(gs))}** — by size; pick a band to list it")
        size = lambda c: sum(isinstance(k, int) for k in c)
        bands = [(100, 10**9, "100+"), (20, 99, "20–99"), (5, 19, "5–19"), (2, 4, "2–4"), (1, 1, "1 + Outside only")]
        for lo, hi, label in bands:
            cs = sorted((c for c in gs if lo <= size(c) <= hi), key=lambda c: -size(c))
            if not cs:
                continue
            if len(cs) == 1:
                o.group_line(f"- 1 Group of {label}: ", cs[0])
            else:
                iss = sum(size(c) for c in cs)
                o.add(f"- {n_(len(cs))} Groups of {label} Issues — {n_(iss)} Issues, largest " +
                      o.ref(m.head(cs[0])) + f" ({n_(size(cs[0]))})")
    o.add()
    o.unlinked_line()


# --- outline of one Group -----------------------------------------------------
def outline(o, variant, gi, budget=25):
    m = o.m
    gs = sorted(m.groups(), key=lambda c: -sum(isinstance(k, int) for k in c))
    comp = gs[gi - 1]
    size = sum(isinstance(k, int) for k in comp)
    o.group_line(f"**Group {gi}** · ", comp)
    o.add()
    tops = [k for k in comp if not (m.E["parents"][k] & comp) and not (m.E["blocked_by"][k] & comp)]
    weight = lambda k: len(m.desc(k) | m.waits(k))
    tops.sort(key=lambda k: (-weight(k), str(k)))
    if variant == "A":           # the tree, as today, stopped at a line budget
        shown = set()

        def tree(k, depth, how=""):
            if len(o.lines) >= budget:
                return
            if k in shown:
                o.add("  " * depth + f"- {how}{o.ref(k)} (above)"); return
            shown.add(k)
            o.issue(f"- {how}", k, f"  {BLOCKED}" if m.blocked(k) and how == "" else "", indent=2 * depth)
            kids = sorted(m.E["children"][k], key=lambda c: -weight(c))
            for c in kids[:PER]:
                tree(c, depth + 1)
            if len(kids) > PER and len(o.lines) < budget:
                o.add("  " * (depth + 1) + f"- … {len(kids) - PER} more children")
            wait = sorted((c for c in m.E["blocks"][k] if not m.E["parents"][c]), key=lambda c: -weight(c))
            for c in wait[:PER]:
                tree(c, depth + 1, BLOCKED + " ")
            if len(wait) > PER and len(o.lines) < budget:
                o.add("  " * (depth + 1) + f"- {BLOCKED} … {len(wait) - PER} more wait on it")

        for t in tops:
            tree(t, 0)
            if len(o.lines) >= budget:
                break
        drawn = sum(1 for k in shown if isinstance(k, int))
        o.add(f"_… {n_(size - drawn)} more Issues in this Group. Name a # to open its part._")
    elif variant == "B":         # one level at a time
        o.add(f"{n_(len(tops))} at the top of this Group — biggest first")
        for t in tops[:10]:
            under = (m.desc(t) | m.waits(t)) & comp
            u_in = [k for k in under if isinstance(k, int)]
            unbl = sum(1 for k in u_in if m.unblocked(k))
            s = f" — {n_(len(u_in))} under it, {n_(unbl)} unblocked" if u_in else ""
            o.issue("- ", t, s)
        if len(tops) > 10:
            loose = sum(1 for t in tops[10:] if not (m.desc(t) | m.waits(t)))
            o.add(f"- … {n_(len(tops) - 10)} more ({n_(loose)} with nothing under them, joined only by {RELATED} Related)")
        o.add("_Pick one to open the level below it._")
    else:                        # only what waits on what
        chains = []
        for k in comp:
            if m.E["blocks"][k] and not (m.E["blocked_by"][k] & comp):
                chains.append(k)
        chains.sort(key=lambda k: -len(m.waits(k)))
        o.add(f"**Waits** in this Group — {n_(sum(1 for k in comp if isinstance(k, int) and m.blocked(k)))} Blocked Issues")
        for k in chains[:8]:
            path, cur = [k], k
            while m.E["blocks"][cur] and len(path) < 5:
                cur = max(m.E["blocks"][cur], key=lambda x: len(m.waits(x)))
                path.append(cur)
            o.issue("- ", k, f"  {BLOCK}{len(m.waits(k))} wait on it")
            o.add("  " + f" {BLOCK} ".join(o.ref(x) for x in path[1:]))
        if len(chains) > 8:
            o.add(f"- … {n_(len(chains) - 8)} more Issues that others wait on")
        par = sum(1 for k in comp if m.E["children"][k])
        rel = sum(1 for k in comp if m.E["related"][k])
        o.add()
        o.add(f"Not drawn: {n_(par)} Parents and {n_(rel)} Issues with {RELATED} Related Links. Ask for `parents` to list them.")


# --- the Unlinked list ------------------------------------------------------------
STOP = set("a an and the of to in for on with is not when from by be at as it if or no can should does do add support use"
           " fix error when using into via are this that than".split())


def unlinked(o, variant, per=15):
    m = o.m
    un = sorted((n for n in m.I if not m.linked(n)), key=lambda n: m.I[n]["createdAt"], reverse=True)
    if variant == "A":           # pages, newest first
        o.add(f"**Unlinked: {n_(len(un))}** — newest first, page 1 of {n_(-(-len(un) // per))}")
        for n in un[:per]:
            since = m.closed_blockers[n]
            o.issue("- ", n, f"  unblocked since #{since[0]['number']} closed" if since else "")
        o.add(f"_`more` for the next {per} · a word to filter titles · `suggest` for Link Suggestions on this page_")
    elif variant == "B":         # facets from what the Snapshot holds: age, milestone, assignee
        o.add(f"**Unlinked: {n_(len(un))}** — pick a slice to list")
        years = Counter(m.I[n]["createdAt"][:4] for n in un)
        recent = sorted(years.items(), reverse=True)
        o.add("- By year opened: " + " · ".join(f"{y} {n_(c)}" for y, c in recent[:4]) +
              (f" · older {n_(sum(c for _, c in recent[4:]))}" if len(recent) > 4 else ""))
        ms = Counter(m.I[n]["milestone"] or "(none)" for n in un)
        o.add("- By milestone: " + " · ".join(f"{k} {n_(c)}" for k, c in ms.most_common(4)))
        mine = sum(1 for n in un if m.I[n]["assigned"])
        o.add(f"- Assigned {n_(mine)} · unassigned {n_(len(un) - mine)}")
        stale = sum(1 for n in un if m.I[n]["updatedAt"] < "2025-09-22")
        o.add(f"- Untouched for a year: {n_(stale)}")
        o.add("_Or type words to search titles. Each slice lists newest first, 15 at a time._")
    else:                        # by title words, no labels on disk
        words = Counter()
        for n in un:
            t = m.I[n]["title"]
            tag = re.match(r"^\s*\[?([A-Za-z][\w-]{1,20})\]?\s*[:\]]", t)
            if tag:
                words[tag.group(1).lower() + ":"] += 1
            for w in set(re.findall(r"[a-z][a-z_-]{2,}", t.lower())) - STOP:
                words[w] += 1
        o.add(f"**Unlinked: {n_(len(un))}** — most common title words; pick one to list")
        top = [(w, c) for w, c in words.most_common(40)][:12]
        for i in range(0, len(top), 4):
            o.add("- " + " · ".join(f"`{w}` {n_(c)}" for w, c in top[i:i + 4]))
        o.add("_Or type your own words. Each list is newest first, 15 at a time._")


# --- the first read of a large Project ---------------------------------------
def progress(stem, at):
    """(Issues read by `at` seconds, seconds the whole read took), from the fetch log."""
    rows = [json.loads(l) for l in (DATA / f"{stem}.log").read_text().splitlines()]
    read = max([r["read"] for r in rows if r["t"] <= at] or [0])
    return read, rows[-1]["t"], rows[-1]["total"]


def firstread(o, variant, stem, at, snap):
    read, total_s, total = progress(stem, at)
    left = f"about {round((total_s - at) / 60)} min left" if total_s - at > 90 else f"about {round(total_s - at)}s left"
    pct = f"{100 * read // total}%"
    if variant == "A":           # wait, with progress
        o.add(f"**{o.m.project}** · {n_(total)} open · reading it for the first time")
        o.add()
        o.add(f"⏳ {n_(read)} of {n_(total)} Issues read ({pct}) · {left}")
        o.add("The Map draws when the read finishes. Meanwhile:")
        o.add("- `#n` opens any Issue card — a card always reads its Issue live.")
        o.add("- `home` goes back to the Project you came from.")
    elif variant == "B":         # draw what's been read, oldest first
        o.add(f"⏳ **Reading {o.m.project}** — {n_(read)} of {n_(total)} ({pct}), oldest Issues first · {left}")
        o.add("_Take next, Groups and the Unlinked count are from what's been read and will change._")
        o.add()
        m = Map(snap, read)
        o2 = Out(m, o.links)
        overview(o2, "A", lim=4)
        o.lines += o2.lines
    else:                        # what search can draw at once, then the rest in the background
        nums = set(json.loads((DATA / f"{stem}.searched.json").read_text()))
        part = dict(snap, issues=[i for i in snap["issues"] if i["number"] in nums], complete=True)
        m = Map(part)
        o2 = Out(m, o.links)
        o2.add(f"**{m.project}** · {n_(total)} open · {n_(len(nums))} with a Link that search can see (2.9 s)")
        o2.add()
        o2.take_next()
        gs = sorted(m.groups(), key=lambda c: -sum(isinstance(k, int) for k in c))
        o2.add(f"**Groups so far: {n_(len(gs))}** — largest first")
        for c in gs[:4]:
            o2.group_line("- ", c)
        o2.add(f"- … {n_(len(gs) - 4)} more")
        o2.add()
        o2.add(f"⏳ Reading the rest: {n_(read)} of {n_(total)} ({pct}) · {left}. Search can't see Links made by a "
               f"task list, so Groups will grow, and the Unlinked count comes with the full read.")
        o.lines += o2.lines


def stats(m):
    gs = sorted(m.groups(), key=lambda c: -sum(isinstance(k, int) for k in c))
    sizes = [sum(isinstance(k, int) for k in c) for c in gs]
    tn = m.take_next()
    print(json.dumps({
        "issues": len(m.I), "on_map": sum(1 for n in m.I if m.linked(n)),
        "blocked": sum(1 for n in m.I if m.blocked(n)), "unblocked": sum(1 for n in m.I if m.unblocked(n)),
        "take_next": len(tn), "take_next_with_waits": sum(1 for _, w in tn if w),
        "groups": len(gs), "top_sizes": sizes[:15],
        "bands": {b: sum(1 for s in sizes if lo <= s <= hi) for b, lo, hi in
                  [("100+", 100, 10**9), ("20-99", 20, 99), ("5-19", 5, 19), ("2-4", 2, 4), ("1", 1, 1)]},
        "outside": len([k for k in m.far if m.far[k]["repo"] != m.project]),
        "unread_far": len([k for k in m.far if m.far[k]["repo"] == m.project]),
        "edges": {k: sum(len(v) for v in d.values()) for k, d in m.E.items()},
    }, indent=1))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("snapshot")
    ap.add_argument("view")
    ap.add_argument("--variant", default="A")
    ap.add_argument("--group", type=int, default=1)
    ap.add_argument("--upto", type=int)
    ap.add_argument("--links", action="store_true")
    ap.add_argument("--at", type=float, default=5, help="firstread: seconds into the first read")
    a = ap.parse_args()
    snap = json.loads((DATA / f"{a.snapshot}.json").read_text())
    m = Map(snap, a.upto)
    if a.view == "stats":
        return stats(m)
    o = Out(m, a.links)
    {"overview": lambda: overview(o, a.variant), "outline": lambda: outline(o, a.variant, a.group),
     "unlinked": lambda: unlinked(o, a.variant),
     "firstread": lambda: firstread(o, a.variant, a.snapshot, a.at, snap)}[a.view]()
    print("\n".join(o.lines))


if __name__ == "__main__":
    main()
