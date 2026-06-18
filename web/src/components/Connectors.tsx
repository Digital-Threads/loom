import { useEffect, useState } from "react";
import type { LoomClient, McpServer } from "../api";
import { StateView } from "./StateView";
import { toast } from "../toast";

// D5.3 — Connectors (MCP): list/add/enable/test the MCP servers Loom passes
// into agent sessions.

// Per-server reachability after a Test, and the beads-import flow state — both
// shown as clear status chips instead of raw strings.
type TestState = { kind: "checking" } | { kind: "ok" } | { kind: "fail"; error?: string };
type ImportState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "done"; created: number }
  | { kind: "error"; message: string };

function TestStatus({ state }: { state?: TestState }) {
  if (!state) return null;
  if (state.kind === "checking") return <span className="chip warn" style={{ marginLeft: 6 }}>Checking…</span>;
  if (state.kind === "ok") return <span className="chip ok" style={{ marginLeft: 6 }}>Reachable</span>;
  return <span className="chip bad" style={{ marginLeft: 6 }} title={state.error}>Unreachable</span>;
}

export function Connectors({ client }: { client: LoomClient }) {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [id, setId] = useState("");
  const [command, setCommand] = useState("");
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const [imp, setImp] = useState<ImportState>({ kind: "idle" });
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
    try {
      await client.mcpRemove(sid);
      setTests((m) => { if (!(sid in m)) return m; const next = { ...m }; delete next[sid]; return next; });
      refresh();
      toast.success("Server removed");
    }
    catch (e) { toast.error(`Couldn’t remove ${sid}: ${e}`); }
  }
  async function test(sid: string) {
    setTests((m) => ({ ...m, [sid]: { kind: "checking" } }));
    try {
      const r = await client.mcpTest(sid);
      setTests((m) => ({ ...m, [sid]: r.ok ? { kind: "ok" } : { kind: "fail", error: r.error } }));
      if (r.ok) toast.success(`${sid}: reachable`); else toast.error(`${sid}: ${r.error ?? "unreachable"}`);
    } catch (e) {
      setTests((m) => ({ ...m, [sid]: { kind: "fail", error: String(e) } }));
      toast.error(`Couldn’t test ${sid}: ${e}`);
    }
  }

  async function importFromBeads() {
    setImp({ kind: "running" });
    try {
      const r = await client.importTracker();
      setImp({ kind: "done", created: r.created });
      toast.success(r.created > 0 ? `Imported ${r.created}` : "Nothing new to import");
    } catch (e) {
      setImp({ kind: "error", message: String(e) });
      toast.error(`Import failed: ${e}`);
    }
  }

  if (err) return <StateView kind="error" msg={err} />;

  return (
    <div className="panel">
      <div className="row" style={{ gap: 8 }}>
        <input className="inp" placeholder="id" value={id} onChange={(e) => setId(e.target.value)} />
        <input className="inp" placeholder="command (e.g. mcp-server-fs)" value={command} onChange={(e) => setCommand(e.target.value)} />
        <button className="btn acc" onClick={add}>Add MCP</button>
        <button className="btn" onClick={importFromBeads} disabled={imp.kind === "running"}>Import from beads</button>
      </div>
      {imp.kind === "running" ? (
        <div style={{ marginTop: 8 }}><span className="chip warn">Importing…</span></div>
      ) : imp.kind === "done" ? (
        <div style={{ marginTop: 8 }}><span className="chip ok">{imp.created > 0 ? `Imported ${imp.created}` : "Nothing new to import"}</span></div>
      ) : imp.kind === "error" ? (
        <div style={{ marginTop: 8 }}><StateView kind="error" msg={imp.message} /></div>
      ) : null}
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
                <td className="crumb">{s.command}<TestStatus state={tests[s.id]} /></td>
                <td>
                  <button className="btn" onClick={() => toggle(s)}>{s.enabled ? "Disable" : "Enable"}</button>
                  <button className="btn" onClick={() => test(s.id)} disabled={tests[s.id]?.kind === "checking"}>Test</button>
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
