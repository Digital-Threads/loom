import { createContext } from "react";

// Режим захвата ввода: когда панель открывает свободный текст-ввод, глобальные
// хоткеи App (q / ←/→ / цифры) должны молчать, иначе буквы уходят в них (напр. 'q'
// закрыл бы приложение). App владеет состоянием и кладёт его сюда; TextInput его дёргает.
export interface InputMode {
  capturing: boolean;
  setCapturing: (b: boolean) => void;
}

export const InputModeContext = createContext<InputMode>({
  capturing: false,
  setCapturing: () => {},
});
