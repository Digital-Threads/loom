import type { CSSProperties, ReactNode, SelectHTMLAttributes } from "react";

// DS Select (.docs/Loom Design System/components/forms/Select.jsx): a native
// <select> with appearance:none, a chevron affordance, and the shared input
// focus language — styled via .lm-select* classes (tokens, not inline colours).
// Keeping a REAL <select> under the hood preserves native keyboard handling and
// accessibility, and the open option list is themed dark in styles.css so it no
// longer renders as the OS-default white/blue popup.
type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> & {
  size?: "sm" | "md";
  /** Stretch the control to the full width of its container. */
  block?: boolean;
  /** Extra class on the wrapper span (e.g. layout/margin). */
  wrapClassName?: string;
  wrapStyle?: CSSProperties;
  children?: ReactNode;
};

export function Select({ size = "md", block, className = "", wrapClassName = "", wrapStyle, children, ...rest }: SelectProps) {
  const wrap = ["lm-select-wrap", block ? "block" : "", wrapClassName].filter(Boolean).join(" ");
  const cls = ["lm-select", size === "sm" ? "sm" : "", className].filter(Boolean).join(" ");
  return (
    <span className={wrap} style={wrapStyle}>
      <select className={cls} {...rest}>{children}</select>
      <span className="lm-select-chev" aria-hidden="true">▾</span>
    </span>
  );
}
