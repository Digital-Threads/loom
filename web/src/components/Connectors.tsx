import { useEffect, useState } from "react";
import type { LoomClient, McpServer } from "../api";
import { StateView } from "./StateView";
import { toast } from "../toast";

// D5.3 — Connectors (MCP): list/add/enable/test the MCP servers Loom passes
// into agent sessions.
export function Connectors({ client }: { client: LoomClient }) {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [id, setId] = useState("");
  const [command, setCommand] = useState("");
  const [status, setStatus] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  function refresh() { client.mcpList().then(setServers).catch((e) => setErr(String(e))).finally(() => setLoading(false)); }
  useEffect(refresh, [client]);

  async function add() {
    if (!id.trim() || !command.trim()) return;
    try { await client.mcpAdd({ id: id.trim(), command: command.trim() }); setId(""); setCommand(""); refresh(); toast.success("MCP server added"); }
    catch (e) { toast.error(`Couldn’t add server: ${e}`); }
  }
  async function toggle(s: McpServer) {
    try { await client.mcpToggle(s.id, !s.enabled); refresh(); toast.success(s.enabled ? "Disabled" : "Enabled"); }
    catch (e) { toast.error(`Couldn’t toggle ${s.id}: ${e}`); }
  }
  async function remove(sid: string) {
    try { await client.mcpRemove(sid); refresh(); toast.success("Server removed"); }
    catch (e) { toast.error(`Couldn’t remove ${sid}: ${e}`); }
  }
  async function test(sid: string) {
    try {
      const r = await client.mcpTest(sid);
      setStatus((m) => ({ ...m, [sid]: r.ok ? "ok" : r.error ?? "fail" }));
      if (r.ok) toast.success(`${sid}: reachable`); else toast.error(`${sid}: ${r.error ?? "unreachable"}`);
    } catch (e) { toast.error(`Couldn’t test ${sid}: ${e}`); }
  }

  if (err) return <StateView kind="error" msg={err} />;

  return (
    <div className="panel">
      <div className="row" style={{ gap: 8 }}>
        <input className="inp" placeholder="id" value={id} onChange={(e) => setId(e.target.value)} />
        <input className="inp" placeholder="command (e.g. mcp-server-fs)" value={command} onChange={(e) => setCommand(e.target.value)} />
        <button className="btn acc" onClick={add}>Add MCP</button>
        <button className="btn" onClick={async () => { try { const r = await client.importTracker(); setStatus((m) => ({ ...m, import: `imported ${r.created}` })); } catch (e) { toast.error(`Import failed: ${e}`); } }}>Import from beads</button>
      </div>
      {status.import ? <div className="muted">{status.import}</div> : null}
      {loading ? (
        <StateView kind="loading" />
      ) : servers.length === 0 ? (
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
