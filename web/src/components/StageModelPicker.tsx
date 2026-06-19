import { useEffect, useState } from "react";
import type { LoomClient } from "../api";

/** A small dropdown to pin the model for one stage of one task by hand. "" = auto
 *  (the per-stage policy default). The choice takes effect on the next run of the
 *  stage — pair it with the existing Re-run action. */
export function StageModelPicker({ client, taskId, stage }: { client: LoomClient; taskId: string; stage: string }) {
  const [cfg, setCfg] = useState<{ stageDefaults: Record<string, string>; tiers: string[] } | null>(null);
  const [value, setValue] = useState<string>("");

  useEffect(() => {
    client.modelConfig?.().then(setCfg).catch(() => {});
    client
      .settings?.()
      .then((s) => setValue((s[`model.task.${taskId}.${stage}`] as string) || ""))
      .catch(() => {});
  }, [client, taskId, stage]);

  const def = cfg?.stageDefaults[stage];
  if (!cfg || !def) return null;

  return (
    <select
      className="model-pick"
      aria-label="Model for this stage"
      title="Model for this stage on this task (auto = the policy default). Re-run to apply."
      value={value}
      onChange={(e) => {
        setValue(e.target.value);
        client.saveSetting(`model.task.${taskId}.${stage}`, e.target.value).catch(() => {});
      }}
    >
      <option value="">auto · {def}</option>
      {cfg.tiers.map((t) => (
        <option key={t} value={t}>{t}</option>
      ))}
    </select>
  );
}
