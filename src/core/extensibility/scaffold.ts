// L11.4 — SDK: scaffold a new Loom plugin (standalone + embeddable via the
// LoomPlugin contract). Returns the files to write; the `loom plugin new <name>`
// CLI persists them. Pure → testable.
export interface ScaffoldFile {
  path: string;
  content: string;
}

export function scaffoldPlugin(name: string): ScaffoldFile[] {
  const manifest = {
    schemaVersion: 1,
    type: "loom-plugin",
    name,
    title: name,
    version: "0.1.0",
    apiVersion: "^1.0",
    description: `${name} — a Loom plugin`,
    entry: "./dist/adapter.js",
    export: "plugin",
    provides: { tabs: [{ id: name, title: name }] },
  };
  return [
    { path: `${name}/plugin.json`, content: JSON.stringify(manifest, null, 2) + "\n" },
    { path: `${name}/src/adapter.ts`, content: adapterTemplate(name) },
    { path: `${name}/README.md`, content: readmeTemplate(name) },
  ];
}

function adapterTemplate(name: string): string {
  return `// ${name} — Loom plugin. Works standalone AND embedded via the LoomPlugin contract.
import type { LoomPlugin, LoomContext } from "@digital-threads/loom-host/contract";

export const plugin: LoomPlugin = {
  id: ${JSON.stringify(name)},
  title: ${JSON.stringify(name)},
  tabs: [{ id: ${JSON.stringify(name)}, title: ${JSON.stringify(name)} }],
  // Return this plugin's data. ctx injects host surfaces (absent standalone).
  load(_ctx: LoomContext) {
    return {};
  },
  // Behaviour layers (optional): implement execute() to run pipeline steps.
  // async execute(step, ctx) { return { ok: true }; },
};
`;
}

function readmeTemplate(name: string): string {
  return `# ${name}

A Loom plugin generated with \`loom plugin new\`. It works **standalone** and
**embedded** in Loom through the \`LoomPlugin\` contract.

- \`plugin.json\` — manifest (id, version, apiVersion, entry, provides).
- \`src/adapter.ts\` — the plugin: \`load()\` for data; add \`execute()\` for a
  behaviour layer; add \`slots\` to back pipeline stages.

Build to \`dist/adapter.js\` and drop the folder under \`~/.loom/plugins/${name}/<version>/\`.
`;
}
