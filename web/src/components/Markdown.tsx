import type { ReactNode } from "react";
import { mdBlocks, mdInline, safeHref } from "../markdown";

// XSS-safe Markdown renderer for agent output (specs, analyses): parses with the
// pure helpers in ../markdown and renders React elements only — raw HTML is
// never injected, so untrusted agent text cannot inject markup.

function renderInline(text: string, key: string): ReactNode[] {
  return mdInline(text).map((tok, j) => {
    const k = `${key}-${j}`;
    if (tok.t === "b") return <strong key={k}>{tok.v}</strong>;
    if (tok.t === "i") return <em key={k}>{tok.v}</em>;
    if (tok.t === "code") return <code key={k} className="md-code">{tok.v}</code>;
    if (tok.t === "a") {
      const href = safeHref(tok.href);
      return href ? <a key={k} href={href} target="_blank" rel="noreferrer">{tok.v}</a> : <span key={k}>{tok.v}</span>;
    }
    return <span key={k}>{tok.v}</span>;
  });
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      {mdBlocks(text).map((b, i) => {
        const key = `b${i}`;
        if (b.type === "code") return <pre key={key} className="md-pre"><code>{b.text}</code></pre>;
        if (b.type === "heading") {
          const H = `h${Math.min(b.level + 2, 6)}` as "h3" | "h4" | "h5" | "h6";
          return <H key={key} className="md-h">{renderInline(b.text, key)}</H>;
        }
        if (b.type === "list") {
          const items = b.items.map((it, j) => <li key={`${key}-${j}`}>{renderInline(it, `${key}-${j}`)}</li>);
          return b.ordered ? <ol key={key} className="md-list">{items}</ol> : <ul key={key} className="md-list">{items}</ul>;
        }
        if (b.type === "quote") return <blockquote key={key} className="md-quote">{renderInline(b.text, key)}</blockquote>;
        return <p key={key} className="md-p">{renderInline(b.text, key)}</p>;
      })}
    </div>
  );
}
