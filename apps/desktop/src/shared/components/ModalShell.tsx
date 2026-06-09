import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

type ModalShellProps = {
  onClose: () => void;
  children: ReactNode;
  /** Optional max content width. Defaults to a comfortable form width. */
  width?: number;
  className?: string;
  backdropClassName?: string;
};

/**
 * Lightweight centered modal: portal + backdrop, Esc and click-outside to close,
 * and an internally scrollable dialog so tall content never grows the page layout.
 */
export const ModalShell = ({ onClose, children, width = 920, className = "", backdropClassName = "" }: ModalShellProps) => {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className={`modal-shell-backdrop ${backdropClassName}`.trim()} onClick={onClose} role="presentation">
      <div
        className={`modal-shell-dialog ${className}`.trim()}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        style={{ width: `min(${width}px, 100%)` }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
};
