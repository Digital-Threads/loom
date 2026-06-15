import { describe, it, expect } from "vitest";
import { mdBlocks, mdInline, safeHref } from "../../web/src/markdown.js";

describe("markdown parser", () => {
  it("splits headings, paragraphs and lists", () => {
    const b = mdBlocks("# Title\n\nsome text\n\n- one\n- two\n\n1. a\n2. b");
    expect(b[0]).toEqual({ type: "heading", level: 1, text: "Title" });
    expect(b[1]).toEqual({ type: "p", text: "some text" });
    expect(b[2]).toEqual({ type: "list", ordered: false, items: ["one", "two"] });
    expect(b[3]).toEqual({ type: "list", ordered: true, items: ["a", "b"] });
  });

  it("captures fenced code blocks verbatim", () => {
    const b = mdBlocks("text\n\n```ts\nconst x = 1\n```\nafter");
    expect(b).toContainEqual({ type: "code", lang: "ts", text: "const x = 1" });
    expect(b.find((x) => x.type === "p" && x.text === "after")).toBeTruthy();
  });

  it("captures blockquotes", () => {
    expect(mdBlocks("> quoted\n> more")).toEqual([{ type: "quote", text: "quoted\nmore" }]);
  });

  it("tokenizes bold, italic, inline code and links", () => {
    expect(mdInline("a **b** c *d* `e` [f](https://x.io)")).toEqual([
      { t: "text", v: "a " },
      { t: "b", v: "b" },
      { t: "text", v: " c " },
      { t: "i", v: "d" },
      { t: "text", v: " " },
      { t: "code", v: "e" },
      { t: "text", v: " " },
      { t: "a", v: "f", href: "https://x.io" },
    ]);
  });

  it("only allows http(s) links (no javascript: injection)", () => {
    expect(safeHref("https://ok.dev")).toBe("https://ok.dev");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("/relative")).toBeNull();
  });
});
