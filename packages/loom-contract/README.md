# @digital-threads/loom-contract

The TypeScript contract that every [Loom](https://github.com/Digital-Threads/loom) plugin implements. It is **types only** — no runtime code. The host (`@digital-threads/loom`) keeps all the logic; this package just defines the shape of a plugin so the host and a plugin can agree on an interface without depending on each other's internals.

## Install

```bash
npm install --save-dev @digital-threads/loom-contract
```

Because it ships only `.d.ts` files, it belongs in `devDependencies`.

## What's in it

The central type is `LoomPlugin`. Around it sit the supporting types: `LoomContext`, `PluginTab`, `PluginSettings`, `PluginAction`, `SettingsSchema`, the declarative view types (`ViewSpec`, `TableView`, `DetailView`, `SummaryView`, `FormView`), and the plugin manifest type `LoomPluginManifest`.

## A minimal plugin

```ts
import type { LoomPlugin } from "@digital-threads/loom-contract";

interface MyData {
  items: string[];
}

export const plugin: LoomPlugin<MyData> = {
  id: "my-tool",
  title: "My Tool",
  tabs: [{ id: "items", title: "Items" }],
  load: (ctx) => ({ items: readItemsFrom(ctx.projectRoot) }),
};
```

The host imports the exported `plugin` object, calls `load()` to get data, and renders the tabs. Where the data comes from — an npm module, a file, a CLI — is hidden inside `load()`; the contract doesn't care.

## License

MIT
