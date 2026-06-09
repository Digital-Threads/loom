import React, { useState, useEffect, useContext } from "react";
import { Text, useInput } from "ink";
import { InputModeContext } from "./InputModeContext.js";

// Minimal Ink component for free-text input (no external dependencies --
// the project has its own useInput style). Enter=submit, Esc=cancel, Backspace=erase.
// On mount it enables capture mode (App mutes global hotkeys), on unmount it disables it.
export function TextInput({
  initial = "",
  placeholder = "",
  onSubmit,
  onCancel,
  onChange,
}: {
  initial?: string;
  placeholder?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
  onChange?: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const { setCapturing } = useContext(InputModeContext);

  useEffect(() => {
    setCapturing(true);
    return () => setCapturing(false);
  }, [setCapturing]);

  useInput((input, key) => {
    if (key.return) {
      onSubmit(value);
      return;
    }
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.backspace || key.delete) {
      setValue((v) => {
        const next = v.slice(0, -1);
        onChange?.(next);
        return next;
      });
      return;
    }
    // Printable characters. We ignore control combinations.
    if (input && !key.ctrl && !key.meta) {
      setValue((v) => {
        const next = v + input;
        onChange?.(next);
        return next;
      });
    }
  });

  return (
    <Text>
      {value.length ? value : <Text dimColor>{placeholder}</Text>}
      <Text inverse> </Text>
    </Text>
  );
}
