import { describe, it, expect } from "vitest";
import { t } from "./i18n";

describe("i18n t()", () => {
  it("returns the Russian string when the language has one", () => {
    expect(t("nav.board", "ru")).toBe("Доска");
  });

  it("falls back to English when the language lacks the key", () => {
    // "fr" has no dictionary, so it falls through to the English source.
    expect(t("nav.board", "fr")).toBe("Board");
    // English itself always resolves.
    expect(t("nav.settings", "en")).toBe("Settings");
  });

  it("falls back to the key itself for an unknown key", () => {
    expect(t("does.not.exist", "ru")).toBe("does.not.exist");
    expect(t("does.not.exist", "en")).toBe("does.not.exist");
  });
});
