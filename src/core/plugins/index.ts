import { createRegistry } from "./registry.js";
import { plugin as aimux } from "./aimux/adapter.js";
import { plugin as tokenPilot } from "./token-pilot/adapter.js";
import { plugin as taskJournal } from "./task-journal/adapter.js";

export const loomRegistry = createRegistry([aimux, tokenPilot, taskJournal]);
