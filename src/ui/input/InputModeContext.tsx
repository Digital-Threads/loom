import { createContext } from "react";

// Input capture mode: when a panel opens free-text input, App's global
// hotkeys (q / left/right / digits) must stay silent, otherwise letters go to them (e.g. 'q'
// would close the app). App owns the state and stores it here; TextInput toggles it.
export interface InputMode {
  capturing: boolean;
  setCapturing: (b: boolean) => void;
}

export const InputModeContext = createContext<InputMode>({
  capturing: false,
  setCapturing: () => {},
});
