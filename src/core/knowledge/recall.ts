// L7 knowledge — P2.1: extracted to the standalone package
// ../layers/knowledge/index.js. The host re-exports it so existing imports
// (`../core/knowledge/recall.js`) keep working; the layer now also runs
// standalone (its own CLI/lib/tests). One-way dependency: the package does not
// know about Loom.
export * from "../layers/knowledge/index.js";
