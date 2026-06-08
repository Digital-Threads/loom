import React, { useState, useEffect, useContext } from "react";
import { Text, useInput } from "ink";
import { InputModeContext } from "./InputModeContext.js";

// Минимальный Ink-компонент свободного текст-ввода (без внешних зависимостей —
// в проекте свой useInput-стиль). Enter=submit, Esc=cancel, Backspace=стереть.
// На маунте включает режим захвата (App глушит глобальные хоткеи), на размонтаже — выключает.
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
    // Печатные символы. Игнорируем управляющие комбинации.
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
