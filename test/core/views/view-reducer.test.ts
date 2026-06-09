import { describe, it, expect } from "vitest";
import {
  viewReducer,
  initialViewState,
  type ViewReducerOpts,
  type ViewState,
} from "../../../src/core/views/view-reducer.js";

const baseOpts: ViewReducerOpts = { listLength: 3 };

function navState(over: Partial<ViewState> = {}): ViewState {
  return { ...initialViewState("root"), ...over };
}

describe("cursor navigation", () => {
  it("down increments cursor, clamped to listLength-1", () => {
    let s = navState({ cursor: 0 });
    s = viewReducer(s, { type: "down" }, baseOpts);
    expect(s.cursor).toBe(1);
    s = viewReducer({ ...s, cursor: 2 }, { type: "down" }, baseOpts);
    expect(s.cursor).toBe(2); // clamped
  });

  it("up decrements cursor, clamped at 0", () => {
    let s = navState({ cursor: 1 });
    s = viewReducer(s, { type: "up" }, baseOpts);
    expect(s.cursor).toBe(0);
    s = viewReducer(s, { type: "up" }, baseOpts);
    expect(s.cursor).toBe(0); // clamped
  });

  it("keeps cursor at 0 for an empty list", () => {
    const s = viewReducer(navState({ cursor: 0 }), { type: "down" }, { listLength: 0 });
    expect(s.cursor).toBe(0);
  });
});

describe("enter transitions", () => {
  it("enter pushes a detail frame when hasOnSelect", () => {
    const s = viewReducer(
      navState({ cursor: 1 }),
      { type: "enter" },
      { listLength: 3, hasOnSelect: true, openView: "detail", selectedId: "tj-7" },
    );
    expect(s.stack).toHaveLength(2);
    expect(s.stack[1]).toEqual({ viewKey: "detail", idParam: "tj-7" });
    expect(s.cursor).toBe(0);
  });

  it("enter on a number field switches to editNumber with initial buffer", () => {
    const s = viewReducer(
      navState(),
      { type: "enter" },
      { listLength: 3, enterEditsNumber: true, editInitial: "42" },
    );
    expect(s.mode).toBe("editNumber");
    expect(s.editBuffer).toBe("42");
  });

  it("enter is a no-op when neither onSelect nor number edit applies", () => {
    const s = viewReducer(navState(), { type: "enter" }, baseOpts);
    expect(s.mode).toBe("nav");
    expect(s.stack).toHaveLength(1);
  });
});

describe("editNumber mode", () => {
  const editOpts: ViewReducerOpts = { listLength: 0 };
  it("appends digits and ignores non-digits", () => {
    let s: ViewState = navState({ mode: "editNumber", editBuffer: "1" });
    s = viewReducer(s, { type: "char", char: "2" }, editOpts);
    expect(s.editBuffer).toBe("12");
    s = viewReducer(s, { type: "char", char: "x" }, editOpts);
    expect(s.editBuffer).toBe("12");
  });

  it("backspace trims the buffer", () => {
    const s = viewReducer(navState({ mode: "editNumber", editBuffer: "12" }), { type: "backspace" }, editOpts);
    expect(s.editBuffer).toBe("1");
  });

  it("esc cancels back to nav", () => {
    const s = viewReducer(navState({ mode: "editNumber", editBuffer: "12" }), { type: "esc" }, editOpts);
    expect(s.mode).toBe("nav");
    expect(s.editBuffer).toBe("");
    expect(s.status).toBe("cancelled");
  });

  it("enter on empty buffer cancels", () => {
    const s = viewReducer(navState({ mode: "editNumber", editBuffer: "" }), { type: "enter" }, editOpts);
    expect(s.mode).toBe("nav");
    expect(s.status).toBe("cancelled");
  });

  it("enter on non-empty buffer returns to nav (layer reads buffer)", () => {
    const s = viewReducer(navState({ mode: "editNumber", editBuffer: "12" }), { type: "enter" }, editOpts);
    expect(s.mode).toBe("nav");
  });
});

describe("action key + confirm flow", () => {
  it("actionKey with confirm enters confirm mode", () => {
    const s = viewReducer(
      navState(),
      { type: "actionKey", key: "c" },
      { listLength: 3, confirmKeys: { c: true } },
    );
    expect(s.mode).toBe("confirm");
    expect(s.confirmKey).toBe("c");
  });

  it("actionKey without confirm stays in nav", () => {
    const s = viewReducer(
      navState(),
      { type: "actionKey", key: "t" },
      { listLength: 3, confirmKeys: { t: false } },
    );
    expect(s.mode).toBe("nav");
    expect(s.confirmKey).toBeNull();
  });

  it("confirmNo returns to nav with cancel status", () => {
    const s = viewReducer(navState({ mode: "confirm", confirmKey: "c" }), { type: "confirmNo" }, baseOpts);
    expect(s.mode).toBe("nav");
    expect(s.confirmKey).toBeNull();
    expect(s.status).toBe("cancelled");
  });

  it("confirmYes returns to nav clearing confirmKey", () => {
    const s = viewReducer(navState({ mode: "confirm", confirmKey: "c" }), { type: "confirmYes" }, baseOpts);
    expect(s.mode).toBe("nav");
    expect(s.confirmKey).toBeNull();
  });

  it("setStatus during confirm closes confirm and sets status", () => {
    const s = viewReducer(navState({ mode: "confirm", confirmKey: "c" }), { type: "setStatus", text: "готово" }, baseOpts);
    expect(s.mode).toBe("nav");
    expect(s.status).toBe("готово");
  });
});

describe("esc stack pop", () => {
  it("pops a detail frame", () => {
    const s = viewReducer(
      navState({ stack: [{ viewKey: "root" }, { viewKey: "detail", idParam: "x" }], cursor: 0 }),
      { type: "esc" },
      baseOpts,
    );
    expect(s.stack).toHaveLength(1);
    expect(s.stack[0].viewKey).toBe("root");
  });

  it("does not pop the root frame", () => {
    const s = viewReducer(navState(), { type: "esc" }, baseOpts);
    expect(s.stack).toHaveLength(1);
  });
});
