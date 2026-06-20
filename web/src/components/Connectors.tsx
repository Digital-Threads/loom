import { useEffect, useState } from "react";
import type { ConnectorMeta, LoomClient, McpServer, McpTransport, PluginEntry } from "../api";
import { StateView } from "./StateView";
import { Select } from "./Select";
import { toast } from "../toast";

// Parse the args field — one argument per line (so an argument may contain
// spaces). Blank lines are dropped.
function parseArgs(raw: string): string[] {
  return raw.split(/\r?\n/).map((a) => a.trim()).filter(Boolean);
}

// Parse the env field — one KEY=VALUE per line (split on the first =), so a
// value may itself contain commas, spaces or further '='. Lines without a key
// or without an = are ignored.
function parseEnv(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (key) out[key] = line.slice(eq + 1).trim();
  }
  return out;
}

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
  const [transport, setTransport] = useState<McpTransport>("stdio");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [env, setEnv] = useState("");
  const [url, setUrl] = useState("");
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const [imp, setImp] = useState<ImportState>({ kind: "idle" });
  const [connectors, setConnectors] = useState<ConnectorMeta[]>([]);
  const [connector, setConnector] = useState("beads");
  const [repo, setRepo] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [plugins, setPlugins] = useState<PluginEntry[]>([]);
  const [marketplaces, setMarketplaces] = useState<string[]>([]);
  const [pluginName, setPluginName] = useState("");
  const [marketplaceSrc, setMarketplaceSrc] = useState("");
  const [pluginsLoaded, setPluginsLoaded] = useState(false);

  function refresh() { client.mcpList().then(setServers).catch((e) => setErr(String(e))).finally(() => setLoading(false)); }
  useEffect(refresh, [client]);
  useEffect(() => { client.listConnectors().then(setConnectors).catch(() => {}); }, [client]);

  function refreshPlugins() { client.pluginList().then(setPlugins).catch(() => {}).finally(() => setPluginsLoaded(true)); }
  function refreshMarketplaces() { client.marketplaceList().then(setMarketplaces).catch(() => {}); }
  useEffect(refreshPlugins, [client]);
  useEffect(refreshMarketplaces, [client]);

  // A plugin op returns { ok?, error? }; surface the error as a toast and refresh.
  // Returns true on success so callers can clear inputs only when it worked.
  async function runPluginOp(p: Promise<{ ok?: boolean; error?: string }>, okMsg: string): Promise<boolean> {
    try {
      const r = await p;
      if (r.error) { toast.error(r.error); return false; }
      toast.success(okMsg);
      refreshPlugins();
      return true;
    } catch (e) { toast.error(String(e)); return false; }
  }
  async function installPlugin() {
    const name = pluginName.trim();
    if (!name) return;
    if (await runPluginOp(client.pluginInstall(name), `Installing ${name}`)) setPluginName("");
  }
  async function addMarketplace() {
    const src = marketplaceSrc.trim();
    if (!src) return;
    try {
      const r = await client.marketplaceAdd(src);
      if (r.error) { toast.error(r.error); return; }
      toast.success("Marketplace added");
      setMarketplaceSrc("");
      refreshMarketplaces();
    } catch (e) { toast.error(String(e)); }
  }

  const selected = connectors.find((m) => m.id === connector);
  const needsRepo = selected?.needsRepo ?? false;

  function resetForm() { setId(""); setCommand(""); setArgs(""); setEnv(""); setUrl(""); }
  const remote = transport === "sse" || transport === "http";
  async function add() {
    if (!id.trim()) return;
    if (remote ? !url.trim() : !command.trim()) return;
    try {
      if (remote) {
        await client.mcpAdd({ id: id.trim(), transport, url: url.trim() });
      } else {
        const parsedArgs = parseArgs(args);
        const parsedEnv = parseEnv(env);
        await client.mcpAdd({
          id: id.trim(),
          transport,
          command: command.trim(),
          args: parsedArgs.length ? parsedArgs : undefined,
          env: Object.keys(parsedEnv).length ? parsedEnv : undefined,
        });
      }
      resetForm();
      refresh();
      toast.success("MCP server added");
    } catch (e) { toast.error(`Couldn’t add server: ${e}`); }
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

  async function importFromTracker() {
    setImp({ kind: "running" });
    try {
      const r = await client.importTracker({ connector, repo: repo.trim() || undefined });
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
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <input className="inp" placeholder="id" value={id} onChange={(e) => setId(e.target.value)} />
        <Select aria-label="Transport" value={transport} onChange={(e) => setTransport(e.target.value as McpTransport)}>
          <option value="stdio">stdio</option>
          <option value="sse">sse</option>
          <option value="http">http</option>
        </Select>
        {remote ? (
          <input className="inp" placeholder="url (e.g. https://host/mcp)" value={url} onChange={(e) => setUrl(e.target.value)} />
        ) : (
          <>
            <input className="inp" placeholder="command (e.g. mcp-server-fs)" value={command} onChange={(e) => setCommand(e.target.value)} />
            <textarea className="inp" rows={2} placeholder="args (one per line)" value={args} onChange={(e) => setArgs(e.target.value)} />
            <textarea className="inp" rows={2} placeholder="env (KEY=VALUE, one per line)" value={env} onChange={(e) => setEnv(e.target.value)} />
          </>
        )}
        <button className="btn acc" onClick={add}>Add MCP</button>
        {connectors.length > 0 ? (
          <Select aria-label="Connector" value={connector} onChange={(e) => setConnector(e.target.value)}>
            {connectors.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </Select>
        ) : null}
        {needsRepo ? (
          <input className="inp" placeholder="owner/repo" value={repo} onChange={(e) => setRepo(e.target.value)} />
        ) : null}
        <button className="btn" onClick={importFromTracker} disabled={imp.kind === "running" || (needsRepo && !repo.trim())}>Import</button>
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
          <thead><tr><th>Server</th><th>Endpoint</th><th></th></tr></thead>
          <tbody>
            {servers.map((s) => {
              const isRemote = s.transport === "sse" || s.transport === "http";
              return (
              <tr key={s.id}>
                <td>{s.id}{s.enabled ? <span className="chip ok" style={{ marginLeft: 6 }}>on</span> : <span className="chip" style={{ marginLeft: 6 }}>off</span>}</td>
                <td className="crumb">
                  {isRemote ? <span className="chip" style={{ marginRight: 6 }}>{s.transport}</span> : null}
                  {isRemote ? s.url : s.command}
                  {isRemote ? null : <TestStatus state={tests[s.id]} />}
                </td>
                <td>
                  <button className="btn" onClick={() => toggle(s)}>{s.enabled ? "Disable" : "Enable"}</button>
                  {isRemote ? null : <button className="btn" onClick={() => test(s.id)} disabled={tests[s.id]?.kind === "checking"}>Test</button>}
                  <button className="btn" onClick={() => remove(s.id)}>Remove</button>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <h3 style={{ marginTop: 24 }}>Plugins</h3>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <input className="inp" placeholder="plugin (name@marketplace)" value={pluginName} onChange={(e) => setPluginName(e.target.value)} />
        <button className="btn acc" onClick={installPlugin}>Install</button>
        <input className="inp" placeholder="marketplace source (owner/repo or url)" value={marketplaceSrc} onChange={(e) => setMarketplaceSrc(e.target.value)} />
        <button className="btn" onClick={addMarketplace}>Add marketplace</button>
      </div>
      {marketplaces.length > 0 ? (
        <div className="crumb" style={{ marginTop: 8 }}>
          Marketplaces: {marketplaces.map((m) => <span key={m} className="chip" style={{ marginLeft: 6 }}>{m}</span>)}
        </div>
      ) : null}
      {!pluginsLoaded ? (
        <StateView kind="loading" />
      ) : plugins.length === 0 ? (
        <StateView kind="empty" msg="No plugins installed." />
      ) : (
        <table className="tbl" style={{ marginTop: 16 }}>
          <thead><tr><th>Plugin</th><th>Version</th><th></th></tr></thead>
          <tbody>
            {plugins.map((p) => (
              <tr key={p.name}>
                <td>
                  {p.name}
                  {p.enabled ? <span className="chip ok" style={{ marginLeft: 6 }}>on</span> : <span className="chip" style={{ marginLeft: 6 }}>off</span>}
                  {p.bundled ? <span className="chip" style={{ marginLeft: 6 }} title="Bundled with Loom and required by the pipeline">required</span> : null}
                </td>
                <td className="crumb">{p.version ?? "—"}</td>
                <td>
                  <button className="btn" onClick={() => runPluginOp(client.pluginUpdate(p.name), `Updating ${p.name}`)}>Update</button>
                  {p.bundled ? null : (
                    <button className="btn" onClick={() => runPluginOp(p.enabled ? client.pluginDisable(p.name) : client.pluginEnable(p.name), p.enabled ? `Disabling ${p.name}` : `Enabling ${p.name}`)}>{p.enabled ? "Disable" : "Enable"}</button>
                  )}
                  {p.bundled ? null : (
                    <button className="btn" onClick={() => runPluginOp(client.pluginUninstall(p.name), `Removing ${p.name}`)}>Remove</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
