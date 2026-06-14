import { useEffect, useState } from "react";
import type { LoomClient, DirListing } from "../api";

// A server-backed folder picker: the host lists directories (the browser can't
// read the filesystem). Navigate into folders, go up, and pick a directory.
// Git repos are flagged so the user can spot valid repos at a glance.
export function DirectoryPicker({
  client,
  onPick,
  onCancel,
}: {
  client: LoomClient;
  onPick: (path: string) => void;
  onCancel: () => void;
}) {
  const [listing, setListing] = useState<DirListing | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function load(path?: string) {
    setErr(null);
    client.fsList(path).then(setListing).catch((e) => setErr(String(e)));
  }
  useEffect(() => load(undefined), [client]);

  return (
    <div className="overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h">Select a folder</div>
        <div className="modal-b">
          <div className="picker-path" title={listing?.path}>{listing?.path ?? "…"}</div>
          {err ? <div className="modal-err">{err}</div> : null}
          <div className="picker-list">
            {listing?.parent ? (
              <button className="picker-row" onClick={() => load(listing.parent!)}>↑ ..</button>
            ) : null}
            {(listing?.entries ?? []).map((e) => (
              <button key={e.path} className="picker-row" onClick={() => load(e.path)}>
                <span>📁 {e.name}</span>
                {e.isGitRepo ? <span className="picker-git">git</span> : null}
              </button>
            ))}
            {listing && listing.entries.length === 0 ? <div className="muted">no sub-folders</div> : null}
          </div>
        </div>
        <div className="modal-f">
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn acc" disabled={!listing} onClick={() => listing && onPick(listing.path)}>
            Use this folder
          </button>
        </div>
      </div>
    </div>
  );
}
