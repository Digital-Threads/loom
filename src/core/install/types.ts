// Типы пайплайна установки/удаления Loom-плагинов (Task 10.2).
// Всё инъектируется (dataDir + CmdRunner), чтобы тесты не имели реальных сайд-эффектов.
import type { LoomPluginManifest } from "@digital-threads/loom-contract";

// Откуда берём плагин.
export type InstallSource =
  | { type: "local"; path: string }
  | { type: "npm"; spec: string } // "@scope/pkg" или "pkg@1.2.3"
  | { type: "git"; url: string };

// Результат внешней команды. Раннер defensive — НЕ бросает.
export interface CmdResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

// Синхронный исполнитель внешних команд. В проде = обёртка execFileSync, в тестах = фейк.
export type CmdRunner = (cmd: string, args: string[]) => CmdResult;

// Инъектируемые зависимости пайплайна.
export interface InstallDeps {
  dataDir: string; // = loomDataDir() в проде, temp в тестах
  run: CmdRunner; // = defaultRun в проде, фейк в тестах
}

// Нормализованный claudePlugin: source приводим к строке (или undefined).
export interface ClaudePluginRef {
  name: string;
  marketplace: string;
  source?: string;
}

// План установки — что и куда встанет (до подтверждения).
export interface InstallPlan {
  name: string;
  version: string;
  manifest: LoomPluginManifest;
  installDir: string; // <dataDir>/plugins/<name>/<version>
  permissions: string[]; // manifest.permissions ?? []
  claudePlugin?: ClaudePluginRef;
}

export interface InstallResult {
  ok: boolean;
  plan?: InstallPlan;
  error?: string;
  warning?: string;
}

// Запись в реестре установленных плагинов.
export interface InstalledEntry {
  version: string;
  installPath: string;
  enabled: boolean;
  source: string; // человекочитаемое описание источника
  installedAt?: string;
}

export interface InstalledRegistry {
  schemaVersion: 1;
  plugins: Record<string, InstalledEntry>;
}
