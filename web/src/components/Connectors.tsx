import { useEffect, useState } from "react";
import type { LoomClient, McpServer } from "../api";
import { StateView } from "./StateView";

// D5.3 — Connectors (MCP): list/add/enable/test the MCP servers Loom passes
// into agent sessions.
export function Connectors({ client }: { client: LoomClient }) {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [id, setId] = useState("");
  const [command, setCommand] = useState("");
  const [status, setStatus] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  function refresh() { client.mcpList().then(setServers).catch((e) => setErr(String(e))); }
  useEffect(refresh, [client]);

  async function add() {
    if (!id.trim() || !command.trim()) return;
    await client.mcpAdd({ id: id.trim(), command: command.trim() });
    setId(""); setCommand(""); refresh();
  }
  async function toggle(s: McpServer) { await client.mcpToggle(s.id, !s.enabled); refresh(); }
  async function remove(sid: string) { await client.mcpRemove(sid); refresh(); }
  async function test(sid: string) {
    const r = await client.mcpTest(sid);
    setStatus((m) => ({ ...m, [sid]: r.ok ? "ok" : r.error ?? "fail" }));
  }

  if (err) return <StateView kind="error" msg={err} />;

  return (
    <div className="panel">
      <div className="row" style={{ gap: 8 }}>
        <input className="inp" placeholder="id" value={id} onChange={(e) => setId(e.target.value)} />
        <input className="inp" placeholder="command (e.g. mcp-server-fs)" value={command} onChange={(e) => setCommand(e.target.value)} />
        <button className="btn acc" onClick={add}>Add MCP</button>
        <button className="btn" onClick={async () => { const r = await client.importTracker(); setStatus((m) => ({ ...m, import: `imported ${r.created}` })); }}>Import from beads</button>
      </div>
      {status.import ? <div className="muted">{status.import}</div> : null}
      {servers.length === 0 ? (
        <StateView kind="empty" msg="No MCP servers yet." />
      ) : (
        <table className="tbl" style={{ marginTop: 16 }}>
          <thead><tr><th>Server</th><th>Command</th><th></th></tr></thead>
          <tbody>
            {servers.map((s) => (
              <tr key={s.id}>
                <td>{s.id}{s.enabled ? <span className="chip ok" style={{ marginLeft: 6 }}>on</span> : <span className="chip" style={{ marginLeft: 6 }}>off</span>}</td>
                <td className="crumb">{s.command}{status[s.id] ? ` · ${status[s.id]}` : ""}</td>
                <td>
                  <button className="btn" onClick={() => toggle(s)}>{s.enabled ? "Disable" : "Enable"}</button>
                  <button className="btn" onClick={() => test(s.id)}>Test</button>
                  <button className="btn" onClick={() => remove(s.id)}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
