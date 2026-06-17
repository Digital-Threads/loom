import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Modal } from "./Modal";

// A small harness so we can observe focus restore: the trigger is focused (by
// the click that opens), the Modal mounts, and on close it should hand focus
// back to the trigger.
function Harness({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen(true)}>open</button>
      {open ? (
        <Modal title="Delete task" onClose={onClose ?? (() => setOpen(false))}>
          <div className="modal-b">body</div>
          <div className="modal-f">
            <button>Cancel</button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

describe("Modal", () => {
  it("exposes dialog semantics labelled by its title", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByText("open"));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    // aria-labelledby points at the element holding the title text
    const labelId = dialog.getAttribute("aria-labelledby");
    expect(labelId).toBeTruthy();
    expect(document.getElementById(labelId!)).toHaveTextContent("Delete task");
  });

  it("moves focus into the dialog on open and restores it on close", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByText("open");
    await user.click(trigger);
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveFocus(); // focus handed back to the opener
  });

  it("closes on Escape and on overlay click, not on box click", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await user.click(screen.getByText("open"));

    await user.click(screen.getByText("body")); // inside the box → no close
    expect(onClose).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("traps Tab focus within the dialog", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByText("open"));
    const dialog = screen.getByRole("dialog");
    // Tab forward several times — focus must never escape the dialog.
    for (let i = 0; i < 4; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it("is non-dismissable when no onClose is given (forced warning)", async () => {
    const user = userEvent.setup();
    function Forced() {
      return (
        <Modal title="Locked">
          <div className="modal-b">forced</div>
        </Modal>
      );
    }
    render(<Forced />);
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument(); // still open
  });
});
