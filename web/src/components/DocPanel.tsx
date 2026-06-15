import { useEffect, useState } from "react";
import type { LoomClient } from "../api";
import { Markdown } from "./Markdown";

// Right-side slide-over that reads a file the agent produced (e.g. the spec the
// agent wrote to .docs/…md) and renders it — markdown nicely, anything else as
// monospace. Open it to read, close it, then approve the stage.
export function DocPanel({
  client,
  taskId,
  path,
  onClose,
}: {
  client: LoomClient;
  taskId: string;
  path: string;
  onClose: () => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setContent(null);
    setErr(null);
    client.readFile(taskId, path).then((d) => setContent(d.content)).catch((e) => setErr(String(e)));
  }, [client, taskId, path]);

  const isMd = /\.(md|markdown|mdx)$/i.test(path);

  return (
    <div className="doc-overlay" onClick={onClose}>
      <aside className="doc-panel" onClick={(e) => e.stopPropagation()}>
        <header className="doc-panel-h">
          <span className="doc-panel-path" title={path}>{path}</span>
          <button className="btn sm" onClick={onClose}>✕ Close</button>
        </header>
        <div className="doc-panel-b">
          {err ? <div className="modal-err">{err}</div> : null}
          {content === null && !err ? <div className="state-loading">Loading…</div> : null}
          {content !== null ? (isMd ? <Markdown text={content} /> : <pre className="doc-raw">{content}</pre>) : null}
        </div>
      </aside>
    </div>
  );
}
