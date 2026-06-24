import { useEffect, useState } from "react";
import type { LoomClient } from "../api";
import { Markdown } from "./Markdown";
import { DiffView } from "./DiffView";

// Right-side slide-over for reading what the agent produced: a file (markdown
// rendered, else monospace) or a colored git diff of the changes. Toggle between
// File and Diff; an empty path means "all changes" (whole-worktree diff).
export function DocPanel({
  client,
  taskId,
  path,
  mode,
  onClose,
}: {
  client: LoomClient;
  taskId: string;
  path: string;
  mode: "file" | "diff";
  onClose: () => void;
}) {
  const [view, setView] = useState<"file" | "diff">(mode);
  const [content, setContent] = useState<string | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { setView(mode); }, [mode, path]);

  useEffect(() => {
    setErr(null);
    if (view === "file") {
      if (!path) return;
      setContent(null);
      client.readFile(taskId, path).then((d) => setContent(d.content)).catch((e) => {
        const msg = String(e);
        setErr(msg.includes("404") ? `File "${path}" was mentioned in the output but is not in the task's working tree.` : msg);
      });
    } else {
      setDiff(null);
      client.readDiff(taskId, path || undefined).then((d) => setDiff(d.diff)).catch((e) => setErr(String(e)));
    }
  }, [client, taskId, path, view]);

  const isMd = /\.(md|markdown|mdx)$/i.test(path);
  const title = path || "All changes";

  return (
    <div className="doc-overlay" onClick={onClose}>
      <aside className="doc-panel" onClick={(e) => e.stopPropagation()}>
        <header className="doc-panel-h">
          <span className="doc-panel-path" title={title}>{title}</span>
          <div className="doc-panel-tabs">
            {path ? <button className={`tab ${view === "file" ? "on" : ""}`} onClick={() => setView("file")}>File</button> : null}
            <button className={`tab ${view === "diff" ? "on" : ""}`} onClick={() => setView("diff")}>Diff</button>
          </div>
          <button className="btn sm" onClick={onClose}>✕ Close</button>
        </header>
        <div className="doc-panel-b">
          {err ? <div className="modal-err">{err}</div> : null}
          {view === "file" ? (
            content === null && !err ? <div className="state-loading">Loading…</div>
              : content !== null ? (isMd ? <Markdown text={content} /> : <pre className="doc-raw">{content}</pre>)
              : null
          ) : (
            diff === null && !err ? <div className="state-loading">Loading…</div>
              : diff !== null ? <DiffView text={diff} />
              : null
          )}
        </div>
      </aside>
    </div>
  );
}
