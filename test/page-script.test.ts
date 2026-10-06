/**
 * The HTML Picture's own script, run against a small stand-in for a browser's
 * page: enough DOM to draw, open each list and open a Group, and to read back
 * the words a viewer would see. It catches what a type check can't, such as
 * a missing part printed as "null" (#140).
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { htmlPicture } from "../src/map/page.ts";
import { snapshot } from "./fakes/snapshot-builder.ts";
import type { Snapshot } from "../src/snapshot/snapshot.ts";

type Kid = Fake | string;

/** An element as far as the page uses one; a child given as null or undefined becomes its text, as the DOM does. */
class Fake {
  kids: Kid[] = [];
  text = "";
  attrs: Record<string, string> = {};
  style = { cssText: "", transform: "", animationDelay: "", setProperty() {} };
  hidden = false;
  scrollTop = 0;
  clientWidth = 1000;
  value = "";
  [prop: string]: unknown;
  classList = {
    names: new Set<string>(),
    add: (...names: string[]) => names.forEach((n) => this.classList.names.add(n)),
    remove: (...names: string[]) => names.forEach((n) => this.classList.names.delete(n)),
    toggle: (n: string, on?: boolean) => ((on ?? !this.classList.names.has(n)) ? this.classList.names.add(n) : this.classList.names.delete(n)),
    contains: (n: string) => this.classList.names.has(n),
  };
  tag: string;
  constructor(tag: string) { this.tag = tag; }
  set className(names: string) { this.classList.names = new Set(names.split(/\s+/).filter(Boolean)); }
  set textContent(text: string) { this.text = String(text); this.kids = []; }
  get textContent(): string { return this.text + this.kids.map((k) => (typeof k === "string" ? k : k.textContent)).join(""); }
  append(...kids: unknown[]) { for (const k of kids) this.kids.push(k instanceof Fake ? k : String(k)); }
  replaceChildren(...kids: unknown[]) { this.kids = []; this.text = ""; this.append(...kids); }
  insertBefore(kid: Fake) { this.kids.push(kid); }
  remove() {}
  setAttribute(name: string, value: unknown) { this.attrs[name] = String(value); }
  addEventListener(type: string, f: () => void) { this[`on${type}`] ??= f; }
  getBoundingClientRect() { return { width: 1000, height: 700 }; }
  getTotalLength() { return 100; }
  focus() {}
  select() {}
  scrollIntoView() {}
  /** Every element under this one, this one first. */
  *all(): Generator<Fake> { yield this; for (const k of this.kids) if (k instanceof Fake) yield* k.all(); }
}

/** Runs the page made from `s`, at once and with no motion, and returns its root. */
function open(s: Snapshot): Fake {
  const html = htmlPicture(s);
  const data = html.match(/<script type="application\/json" id="data">([\s\S]*?)<\/script>/)![1]!;
  const script = html.match(/<script>([\s\S]*?)<\/script>/)![1]!;
  const page = new Fake("div");
  const document = {
    getElementById: (id: string) => (id === "data" ? { textContent: data } : page),
    createElement: (tag: string) => new Fake(tag),
    createElementNS: (_: string, tag: string) => new Fake(tag),
  };
  const now = (f: () => void) => (f(), 0);
  runInNewContext(script, { document, navigator: {}, matchMedia: () => ({ matches: true }), requestAnimationFrame: now, setTimeout: now, addEventListener() {} });
  return page;
}

const click = (page: Fake, words: RegExp) => {
  const button = [...page.all()].find((e) => typeof e.onclick === "function" && words.test(e.textContent));
  assert.ok(button, `a control saying ${words}`);
  (button.onclick as () => void)();
};

describe("the page's script, as a viewer sees it", () => {
  /** #1 Blocks #2 and #3; nobody has taken anything, and #4 is Unlinked. */
  const plain = () => snapshot([{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }], [[1, "blocks", 2], [1, "blocks", 3]]);
  /** As `plain`, but #5, which Blocks #6, is assigned to someone else. */
  const taken = () => snapshot([{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }, { n: 5, assignees: ["someone"] }, { n: 6 }], [[1, "blocks", 2], [1, "blocks", 3], [5, "blocks", 6]]);

  for (const [what, made] of [["with nothing taken by others", plain], ["with Issues taken by others", taken]] as const) {
    test(`no list prints a missing part as "null", ${what}`, () => {
      const page = open(made());
      for (const list of [/^Take next: /, /^Groups: /, /^Unlinked: /]) {
        click(page, list);
        assert.doesNotMatch(page.textContent, /null|undefined/, `after opening ${list}`);
      }
      click(page, /^Start with #1/);
      assert.doesNotMatch(page.textContent, /null|undefined/, "after opening the first Issue's Group");
    });
  }

  test("Take next names the Issues taken by others only when there are some", () => {
    const shows = (s: Snapshot) => { const page = open(s); click(page, /^Take next: /); return page.textContent; };
    assert.doesNotMatch(shows(plain()), /Taken by others/);
    assert.match(shows(taken()), /Taken by others: 1/);
  });
});
