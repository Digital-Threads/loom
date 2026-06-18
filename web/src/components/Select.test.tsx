import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Select } from "./Select";

describe("Select (DS dropdown)", () => {
  it("renders a real native <select> so aria-label + selectOptions keep working", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Select aria-label="Pick stage" value="a" onChange={onChange}>
        <option value="a">Analysis</option>
        <option value="b">Brainstorm</option>
      </Select>,
    );
    const el = screen.getByLabelText("Pick stage");
    expect(el.tagName).toBe("SELECT");
    expect(el).toHaveClass("lm-select");
    await user.selectOptions(el, "b");
    expect(onChange).toHaveBeenCalled();
  });

  it("applies the sm size and forwards a custom className to the select", () => {
    render(
      <Select aria-label="s" size="sm" className="extra">
        <option value="x">x</option>
      </Select>,
    );
    const el = screen.getByLabelText("s");
    expect(el).toHaveClass("lm-select", "sm", "extra");
  });

  it("renders a chevron affordance hidden from assistive tech", () => {
    const { container } = render(
      <Select aria-label="c"><option value="x">x</option></Select>,
    );
    const chev = container.querySelector(".lm-select-chev");
    expect(chev).not.toBeNull();
    expect(chev).toHaveAttribute("aria-hidden", "true");
  });
});
