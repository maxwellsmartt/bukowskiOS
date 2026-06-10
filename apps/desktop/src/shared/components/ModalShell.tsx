import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { UnsavedChangesDialog } from "./UnsavedChangesDialog";

type ModalCloseGuard = {
  isDirty: () => boolean;
  /** The form's own submit; offered as "apply changes" in the guard dialog. */
  apply?: () => void | Promise<void>;
};

type ModalCloseGuardContextValue = {
  /** Close the modal through the unsaved-changes guard. */
  requestClose: () => void;
  /** Form panels register their dirtiness here (null on unmount). */
  registerGuard: (guard: ModalCloseGuard | null) => void;
};

const ModalCloseGuardContext = createContext<ModalCloseGuardContextValue | null>(null);

/**
 * Inside a ModalShell, lets a form panel (a) register an unsaved-changes guard
 * and (b) route its own X/cancel buttons through that guard. Returns null when
 * the panel renders outside a modal (e.g. embedded in a rail) — fall back to
 * plain onClose there.
 */
export const useModalCloseGuard = () => useContext(ModalCloseGuardContext);

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
 *
 * Every close path (Esc, backdrop, and any panel button routed through
 * useModalCloseGuard) checks the registered guard first: with pending edits the
 * user chooses to keep editing, discard, or apply via the form's own submit.
 */
export const ModalShell = ({ onClose, children, width = 920, className = "", backdropClassName = "" }: ModalShellProps) => {
  const guardRef = useRef<ModalCloseGuard | null>(null);
  const [unsavedDialogOpen, setUnsavedDialogOpen] = useState(false);

  const requestClose = useCallback(() => {
    if (guardRef.current?.isDirty()) {
      setUnsavedDialogOpen(true);
      return;
    }
    onClose();
  }, [onClose]);

  const contextValue = useMemo<ModalCloseGuardContextValue>(
    () => ({
      requestClose,
      registerGuard: (guard) => {
        guardRef.current = guard;
      },
    }),
    [requestClose],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        requestClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestClose]);

  return createPortal(
    <div className={`modal-shell-backdrop ${backdropClassName}`.trim()} onClick={requestClose} role="presentation">
      <div
        className={`modal-shell-dialog ${className}`.trim()}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        style={{ width: `min(${width}px, 100%)` }}
      >
        <ModalCloseGuardContext.Provider value={contextValue}>{children}</ModalCloseGuardContext.Provider>
      </div>
      <UnsavedChangesDialog
        isOpen={unsavedDialogOpen}
        onApply={
          guardRef.current?.apply
            ? async () => {
                setUnsavedDialogOpen(false);
                await guardRef.current?.apply?.();
              }
            : undefined
        }
        onDiscard={() => {
          setUnsavedDialogOpen(false);
          onClose();
        }}
        onStay={() => setUnsavedDialogOpen(false)}
      />
    </div>,
    document.body,
  );
};
