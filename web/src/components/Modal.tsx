import { useEffect, useId, useRef, type ReactNode, type CSSProperties, type KeyboardEvent } from "react";

const FOCUSABLE =
  'a[href],area[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),button:not([disabled]),[tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement | null): HTMLElement[] {
  return root ? Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)) : [];
}

/** Accessible modal dialog: role=dialog + aria-modal, labelled by its title,
 *  closes on Escape and overlay click, traps Tab focus inside, and restores
 *  focus to the opener on unmount. Pass no onClose for a forced (non-dismissable)
 *  dialog. Callers supply their own modal-b / modal-f children, so existing
 *  layouts migrate unchanged. */
export function Modal({
  title,
  onClose,
  children,
  headStyle,
  className,
}: {
  title: ReactNode;
  onClose?: () => void;
  children: ReactNode;
  headStyle?: CSSProperties;
  /** Extra class on the dialog box (e.g. "modal-wide"). */
  className?: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Focus into the dialog on open; hand focus back to the opener on close.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const first = focusables(boxRef.current)[0];
    (first ?? boxRef.current)?.focus();
    return () => opener?.focus?.();
  }, []);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      if (onClose) onClose();
      return;
    }
    if (e.key !== "Tab") return;
    // Trap: keep Tab / Shift+Tab cycling within the dialog's focusables.
    const f = focusables(boxRef.current);
    e.preventDefault();
    if (!f.length) return;
    const i = f.indexOf(document.activeElement as HTMLElement);
    const next = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : i === -1 || i === f.length - 1 ? 0 : i + 1;
    f[next].focus();
  }

  return (
    <div className="overlay" onClick={onClose ? () => onClose() : undefined}>
      <div
        className={className ? `modal ${className}` : "modal"}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={boxRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="modal-h" id={titleId} style={headStyle}>
          {title}
        </div>
        {children}
      </div>
    </div>
  );
}
