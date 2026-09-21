#!/usr/bin/env python3
"""PROTOTYPE — throwaway. A status line row for the Map, alone or wrapping yours.

Claude Code runs a status line command after every message, with session JSON on stdin.
This reads a snapshot (a stand-in for the cache a real one would need) and prints one row.

    echo '{}' | python3 prototype/map/statusline.py opentofu__opentofu
    echo '{}' | python3 prototype/map/statusline.py opentofu__opentofu --style long --width 120
    echo '{}' | python3 prototype/map/statusline.py opentofu__opentofu --wrap "echo 'your status line'"

To try it live, point `statusLine.command` in a settings file at this script.
"""
import argparse, json, os, subprocess, sys
sys.path.insert(0, os.path.dirname(__file__))
from render import DATA, Map, BLOCKED, BLOCK

DIM, RESET = "\033[2m", "\033[0m"


def link(text, url):
    return f"\033]8;;{url}\033\\{text}\033]8;;\033\\"


def row(m, style, width):
    linked = [n for n in m.issues if m.linked(n)]
    unlinked = len(m.issues) - len(linked)
    head = f"◆ {m.project.split('/')[-1]}"
    if not linked:
        return f"{head} {DIM}· no Links · {unlinked} Unlinked{RESET}"
    if not m.can_block:
        return f"{head} {DIM}· {len(linked)} on the Map · can't record blocking · {unlinked} Unlinked{RESET}"
    ready = [n for n in linked if not m.blocked(n) and not m.issues[n]["assigned"]]
    ready.sort(key=lambda n: (-len(m.unblocks(n)), n))
    blocked = sum(1 for n in linked if m.blocked(n))
    nxt = ready[0] if ready else None
    if style == "short":
        s = f"{head} {len(ready)} ready {DIM}{BLOCKED}{blocked}{RESET}"
        if nxt:
            s += f" next {link('#' + str(nxt), m.issues[nxt]['url'])}"
        return s
    s = f"{head} · {len(ready)} ready · {blocked} Blocked · {unlinked} Unlinked"
    if nxt:
        t = m.issues[nxt]["title"]
        room = width - len(s) - len(f" · next #{nxt} ") - 4
        t = t if len(t) <= room else (t[:max(room - 1, 0)] + "…" if room > 6 else "")
        s += f" · next {link('#' + str(nxt), m.issues[nxt]['url'])} {DIM}{t}{RESET}"
    return s


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("snapshot")
    ap.add_argument("--style", choices=["short", "long"], default="long")
    ap.add_argument("--width", type=int, default=int(os.environ.get("COLUMNS", 100)))
    ap.add_argument("--wrap", help="the user's existing status line command; its rows are printed first")
    ap.add_argument("--no-blocks", action="store_true")
    a = ap.parse_args()
    stdin = sys.stdin.read() if not sys.stdin.isatty() else "{}"
    if a.wrap:
        theirs = subprocess.run(a.wrap, shell=True, input=stdin, capture_output=True, text=True, timeout=5).stdout
        if theirs.strip():
            print(theirs.rstrip("\n"))
    m = Map(json.loads((DATA / f"{a.snapshot}.json").read_text()), a.no_blocks)
    print(row(m, a.style, a.width))


if __name__ == "__main__":
    main()
