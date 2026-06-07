// Шим: типы контракта переехали в @digital-threads/loom-contract (Phase 9.1).
// `export type *` полностью эрейзится в рантайме; существующие импорты loom-host
// (`../plugins/types.js`) продолжают работать без правок.
export type * from "@digital-threads/loom-contract";
