// Реестр отложенной "передачи терминала" (exit-and-handover). Интерактивный
// дочерний процесс (напр. aimux launchProfile с OAuth) нельзя запускать внутри
// живого Ink-рендера — он владеет терминалом. Поэтому action кладёт сюда thunk,
// ViewRenderer гасит Ink (exit), а cli.tsx после waitUntilExit исполняет thunk.
export type HandoverThunk = () => unknown | Promise<unknown>;

let pending: HandoverThunk | null = null;

export function requestHandover(fn: HandoverThunk): void {
  pending = fn;
}

export function takeHandover(): HandoverThunk | null {
  const p = pending;
  pending = null;
  return p;
}
