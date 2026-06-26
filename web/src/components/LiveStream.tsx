import { useState } from "react";
import { groupLiveStream, toolAction } from "../ui";

// Render the agent's live output as readable activity: prose stays prose, but
// runs of the same tool fold into one "→ Tool ×N" row you can expand — so a
// burst of ten reads is one line, not ten.
export function LiveStream({ lines }: { lines: string[] }) {
  const items = groupLiveStream(lines);
  return (
    <div className="livestream">
      {items.map((it, i) =>
        it.kind === "text" ? (
          it.text.trim() ? (
            <pre className="live-text mono" key={i}>{it.text}</pre>
          ) : null
        ) : (
          <ToolGroup key={i} tool={it.tool} count={it.count} calls={it.calls} />
        ),
      )}
    </div>
  );
}

function ToolGroup({ tool, count, calls }: { tool: string; count: number; calls: string[] }) {
  const [open, setOpen] = useState(false);
  const many = calls.length > 1;
  // Human action (📖 Reading code / 🧪 Running tests …) as the headline; the raw
  // tool name stays next to it so a developer still sees exactly what ran.
  const act = toolAction(tool, calls[0]);
  return (
    <div className="live-tool">
      <button className="live-tool-head" disabled={!many} onClick={() => setOpen((o) => !o)}>
        <span className="live-tool-arrow">{act.icon}</span>
        <b>{act.label}</b>
        <span className="live-tool-raw mono">{tool}</span>
        {count > 1 ? <span className="live-tool-count">×{count}</span> : null}
        {calls.length === 1 ? <span className="live-tool-inline mono">{calls[0]}</span> : null}
        {many ? <span className="live-tool-toggle">{open ? "▾ hide" : `▸ ${count} calls`}</span> : null}
      </button>
      {open && many ? (
        <div className="live-tool-calls">
          {calls.map((c, i) => (
            <div className="live-tool-call mono" key={i}>{c}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
