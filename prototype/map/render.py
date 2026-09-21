#!/usr/bin/env python3
"""PROTOTYPE — throwaway. Four text Maps of one snapshot, for reacting to.

    python3 prototype/map/render.py opentofu__opentofu --variant A [--width 40] [--plain]
    python3 prototype/map/render.py opentofu__opentofu --variant C --focus 1234

A  Ready queue   — what you can take now, then what's waiting on what
B  Outline       — a tree: children and the Issues that wait on an Issue nest under it
C  Focus card    — one Issue and its Links by kind, the step a picker walks
D  Clusters      — one line per group of linked Issues, pick one to open

Output is Markdown as Claude would print it in the conversation, with Issue
numbers as links. --plain drops the links. --width trims titles to fit.
--no-blocks pretends the Tracker can't record Blocks.
"""
import argparse, json, pathlib, re
from collections import defaultdict

DATA = pathlib.Path(__file__).parent / "data"
BLOCK, BLOCKED, PARENT, CHILD, RELATED, OUT = "▶", "⛔", "↑", "↓", "~", "↗"
SIBLINGS = 4   # Outline: how many children / waiting Issues to show under one Issue


class Map:
    def __init__(self, snap, no_blocks=False):
        self.project = snap["project"]
        self.can_block = snap.get("canRecordBlocks", True) and not no_blocks
        self.issues = {i["number"]: i for i in snap["issues"]}
        self.outside = {}          # key -> ref, for Links that leave the Project
        self.blocks = defaultdict(set)     # blocker -> blocked   (keys: int or ("repo", n))
        self.blocked_by = defaultdict(set)
        self.children = defaultdict(set)
        self.parents = defaultdict(set)
        self.related = defaultdict(set)
        for i in snap["issues"]:
            n = i["number"]
            if self.can_block:
                for r in i["blockedBy"]:
                    self._edge(self.blocks, self.blocked_by, self.key(r), n)
                for r in i["blocking"]:
                    self._edge(self.blocks, self.blocked_by, n, self.key(r))
            if i["parent"]:
                self._edge(self.children, self.parents, self.key(i["parent"]), n)
            for r in i["trackedIn"]:
                self._edge(self.children, self.parents, self.key(r), n)
            for r in i["children"] + i["tracks"]:
                self._edge(self.children, self.parents, n, self.key(r))
            for r in i.get("related", []):
                k = self.key(r)
                if k is not None:
                    self.related[n].add(k); self.related[k].add(n)

    def key(self, r):
        """In-Project open Issue -> number; Outside Issue -> (repo, n); closed in-Project -> None."""
        if r["repo"] == self.project:
            return r["number"] if r["number"] in self.issues else None
        k = (r["repo"], r["number"])
        self.outside[k] = r
        return k

    @staticmethod
    def _edge(fwd, back, a, b):
        if a is None or b is None:
            return
        fwd[a].add(b); back[b].add(a)

    def is_open(self, k):
        return k in self.issues or (isinstance(k, tuple) and self.outside[k]["state"] == "OPEN")

    def links(self, n):
        return {"blocked_by": {k for k in self.blocked_by[n] if self.is_open(k)},
                "blocks": {k for k in self.blocks[n] if self.is_open(k)},
                "parents": {k for k in self.parents[n] if self.is_open(k)},
                "children": {k for k in self.children[n] if self.is_open(k)},
                "related": {k for k in self.related[n] if self.is_open(k)}}

    def linked(self, n):
        return any(self.links(n).values())

    def blocked(self, n):
        return bool(self.links(n)["blocked_by"])

    def unblocks(self, n, seen=None):
        """Open Issues transitively waiting on n."""
        seen = set() if seen is None else seen
        for k in self.links(n)["blocks"]:
            if k not in seen:
                seen.add(k)
                if k in self.issues:
                    self.unblocks(k, seen)
        return seen

    def clusters(self):
        seen, out = set(), []
        for n in sorted(self.issues):
            if n in seen or not self.linked(n):
                continue
            stack, comp = [n], set()
            while stack:
                x = stack.pop()
                if x in comp:
                    continue
                comp.add(x)
                if x in self.issues:
                    for ks in self.links(x).values():
                        stack.extend(ks)
            seen |= comp
            out.append(comp)
        return sorted(out, key=lambda c: -len(c))


class Out:
    def __init__(self, m, width, plain):
        self.m, self.width, self.plain, self.lines = m, width, plain, []

    @staticmethod
    def order(k):
        return (isinstance(k, tuple), k if isinstance(k, tuple) else ("", k))

    def ref(self, k):
        if isinstance(k, tuple):
            r = self.m.outside[k]
            text, url = f"{OUT}{r['repo']}#{r['number']}", r["url"]
        else:
            text, url = f"#{k}", self.m.issues[k]["url"]
        return (text if self.plain else f"[{text}]({url})"), len(text)

    def title(self, k):
        return self.m.outside[k]["title"] if isinstance(k, tuple) else self.m.issues[k]["title"]

    def line(self, prefix, k, suffix="", indent=0):
        """prefix + ref + title (trimmed to width) + suffix. Width counts visible text only."""
        r, rlen = self.ref(k)
        room = self.width - indent - len(prefix) - rlen - 1 - len(re.sub(r"\[([^]]*)\]\([^)]*\)", r"\1", suffix))
        t = self.title(k)
        if room < len(t):
            t = t[:max(room - 1, 0)] + "…" if room > 4 else ""
        self.lines.append(" " * indent + f"{prefix}{r} {t}{suffix}".rstrip())

    def refs(self, ks, limit=3):
        ks = sorted(ks, key=self.order)
        s = ", ".join(self.ref(k)[0] for k in ks[:limit])
        return s + (f" +{len(ks) - limit}" if len(ks) > limit else "")

    def add(self, s=""):
        self.lines.append(s)

    def header(self):
        m = self.m
        linked = [n for n in m.issues if m.linked(n)]
        blocked = [n for n in linked if m.blocked(n)]
        self.add(f"**{m.project}** · {len(m.issues)} open · {len(linked)} on the Map · "
                 f"{len(m.issues) - len(linked)} Unlinked")
        if not m.can_block:
            self.add("_This Project can't record blocking, so nothing is shown as unblocked._")
        elif linked:
            self.add(f"{len(linked) - len(blocked)} unblocked · {len(blocked)} Blocked")
        self.add()

    def unlinked_footer(self, n=0):
        m = self.m
        un = sorted((i for i in m.issues if not m.linked(i)), key=lambda i: m.issues[i]["updatedAt"], reverse=True)
        self.add(f"**Unlinked ({len(un)})** — no Link to another open Issue")
        for i in un[:n]:
            self.line("- ", i)
        if len(un) > n:
            self.add(f"- … {len(un) - n} more, newest first. Ask for Link Suggestions to connect them.")


def variant_a(o):
    """Ready queue."""
    m = o.m
    o.header()
    linked = [n for n in m.issues if m.linked(n)]
    if not linked:
        o.add("_No Issue here has a Link, so there's no Map to draw._"); o.add()
        o.unlinked_footer(8); return
    if m.can_block:
        ready = [n for n in linked if not m.blocked(n)]
        ready.sort(key=lambda n: (-len(m.unblocks(n)), m.issues[n]["assigned"], n))
        o.add("**Take next** — unblocked, most unblocking first")
        for n in ready[:6]:
            u = len(m.unblocks(n))
            mark = f"  {BLOCK}{u}" if u else ""
            mark += " (assigned)" if m.issues[n]["assigned"] else ""
            o.line("- ", n, mark)
        if len(ready) > 6:
            o.add(f"- … {len(ready) - 6} more unblocked")
        o.add()
        o.add(f"**Blocked** — {BLOCKED} waiting on")
        blocked = sorted((n for n in linked if m.blocked(n)), key=lambda n: -len(m.unblocks(n)))
        for n in blocked[:6]:
            o.line("- ", n)
            o.lines[-1] += f"  \n  {BLOCKED} {o.refs(m.links(n)['blocked_by'])}"
        if len(blocked) > 6:
            o.add(f"- … {len(blocked) - 6} more Blocked")
        o.add()
    o.unlinked_footer(0)
    o.add(); o.add(f"_{BLOCK}n unblocks n Issues · {BLOCKED} Blocked by · {OUT} Outside Issue_")


def variant_b(o):
    """Outline: a tree. A plain bullet under an Issue is its child (Parent Link);
    a ⛔ bullet under an Issue waits on it (Blocks Link). Issues reached twice say (above)."""
    m = o.m
    o.header()
    comps = m.clusters()
    if not comps:
        o.add("_No Issue here has a Link, so there's no Map to draw._"); o.add()
        o.unlinked_footer(8); return
    shown = set()

    def tree(k, depth, how=""):
        pre = f"- {how}"
        if k in shown:
            o.add("  " * depth + f"{pre}{o.ref(k)[0]} (above)"); return
        shown.add(k)
        extra = ""
        if k in m.issues:
            L = m.links(k)
            others = L["blocked_by"] - ({parent_of[k]} if k in parent_of else set())
            if others and how == BLOCKED + " ":
                extra = f"  also {BLOCKED}{o.refs(others, 2)}"
            elif others and how != BLOCKED + " ":
                extra = f"  {BLOCKED}{o.refs(others, 2)}"
            if L["related"]:
                extra += f"  {RELATED}{o.refs(L['related'], 2)}"
        o.line(pre, k, extra, indent=2 * depth)
        if k in m.issues:
            L = m.links(k)
            kids = sorted(L["children"], key=o.order)
            for c in kids[:SIBLINGS]:
                parent_of.setdefault(c, None)
                tree(c, depth + 1)
            if len(kids) > SIBLINGS:
                shown.update(kids[SIBLINGS:])
                n_more = len(kids) - SIBLINGS
                o.add("  " * (depth + 1) + f"- … {n_more} more child" + ("ren" if n_more > 1 else ""))
            waiting = [c for c in sorted(L["blocks"], key=lambda c: (-len(m.unblocks(c)) if c in m.issues else 0, o.order(c)))
                       if not (c in m.issues and m.links(c)["parents"])]  # those are drawn under their parent
            for c in waiting[:SIBLINGS]:
                parent_of[c] = k
                tree(c, depth + 1, BLOCKED + " ")
            if len(waiting) > SIBLINGS:
                for c in waiting[SIBLINGS:]:
                    shown.add(c)
                o.add("  " * (depth + 1) + f"- {BLOCKED} … {len(waiting) - SIBLINGS} more wait on it")

    parent_of = {}
    for comp in comps[:4]:
        # roots: nothing above them in this tree (no open parent, no open blocker in the Project)
        roots = [k for k in comp if (k in m.issues and not m.links(k)["parents"]
                 and not (m.links(k)["blocked_by"] & set(m.issues)))
                 or (isinstance(k, tuple) and m.children.get(k))]  # an Outside parent (e.g. an epic) heads its tree; an Outside blocker stays an inline mark
        roots.sort(key=lambda k: (-len(m.unblocks(k)) if k in m.issues else -len(m.blocks.get(k, ())), o.order(k)))
        for r in roots:
            if r not in shown:
                tree(r, 0)
        for k in sorted(comp, key=o.order):
            if k not in shown and k in m.issues:
                tree(k, 0)
        o.add()
    if len(comps) > 4:
        o.add(f"… {len(comps) - 4} more groups ({sum(len(c) for c in comps[4:])} Issues)"); o.add()
    o.unlinked_footer(0)
    o.add(); o.add(f"_nested = child · {BLOCKED} nested = waits on the line above · {RELATED} Related · {OUT} Outside Issue_")


def variant_c(o, focus):
    """Focus card: one Issue and its Links, the step a picker walks."""
    m = o.m
    if focus is None:
        focus = max((n for n in m.issues if m.linked(n)), key=lambda n: sum(map(len, m.links(n).values())), default=None)
    if focus is None:
        o.header(); o.add("_No Issue here has a Link, so there's no Map to draw._"); o.add(); o.unlinked_footer(8); return
    i = m.issues[focus]
    L = m.links(focus)
    state = "Blocked" if L["blocked_by"] else ("unblocked" if m.can_block else "blocking unknown")
    o.add(f"**{m.project}** › {o.ref(focus)[0]}")
    o.add(f"### {i['title']}")
    meta = [state]
    if i["assigned"]: meta.append("assigned")
    if i["milestone"]: meta.append(f"milestone {i['milestone']}")
    if i["labels"]: meta.append(", ".join(i["labels"][:3]))
    meta.append(f"{i['comments']} comments")
    o.add(" · ".join(meta)); o.add()
    for key, label in [("blocked_by", f"{BLOCKED} Blocked by"), ("blocks", f"{BLOCK} Blocks"),
                       ("parents", f"{PARENT} Parent"), ("children", f"{CHILD} Children"),
                       ("related", f"{RELATED} Related")]:
        if L[key]:
            o.add(f"**{label}**")
            for k in sorted(L[key], key=o.order):
                s = ""
                if k in m.issues and m.blocked(k): s = f"  {BLOCKED}"
                o.line("- ", k, s)
            o.add()
    if not m.can_block:
        o.add("_This Project can't record blocking._"); o.add()
    o.add("_Next: follow a Link · open on the Tracker · start work on it · suggest Links for it · back to the Map_")


def variant_d(o):
    """Clusters: one line per group of linked Issues."""
    m = o.m
    o.header()
    comps = m.clusters()
    if not comps:
        o.add("_No Issue here has a Link, so there's no Map to draw._"); o.add()
        o.unlinked_footer(8); return
    o.add("**Groups of linked Issues** — pick one to open it")
    for idx, c in enumerate(comps[:8], 1):
        inside = [k for k in c if k in m.issues]
        head = max(inside, key=lambda k: (not m.links(k)["parents"], len(m.links(k)["children"]), len(m.unblocks(k)), -k))
        ready = [k for k in inside if not m.blocked(k)] if m.can_block else []
        outs = [k for k in c if isinstance(k, tuple)]
        stats = f"{len(inside)} Issue" + ("s" if len(inside) != 1 else "")
        if m.can_block:
            stats += f", {len(ready)} ready"
        if outs:
            stats += f", {len(outs)}{OUT}"
        o.line(f"{idx}. ", head, f" — {stats}")
    if len(comps) > 8:
        o.add(f"… {len(comps) - 8} more groups")
    o.add()
    o.unlinked_footer(0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("snapshot")
    ap.add_argument("--variant", default="A")
    ap.add_argument("--width", type=int, default=100)
    ap.add_argument("--focus", type=int)
    ap.add_argument("--plain", action="store_true")
    ap.add_argument("--no-blocks", action="store_true")
    a = ap.parse_args()
    m = Map(json.loads((DATA / f"{a.snapshot}.json").read_text()), a.no_blocks)
    o = Out(m, a.width, a.plain)
    {"A": variant_a, "B": variant_b, "D": variant_d}.get(a.variant, lambda o: variant_c(o, a.focus))(o)
    print("\n".join(o.lines))


if __name__ == "__main__":
    main()
