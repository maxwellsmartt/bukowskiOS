import { useCallback, useRef, useState, type ReactNode } from "react";

import { ConfirmDialog } from "@shared/components/ConfirmDialog";

export type ConfirmOptions = {
  title: string;
  body?: ReactNode;
  details?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
};

/**
 * Promise-based confirmation. Call `await confirm({...})` before a destructive
 * action; it resolves `true` if the user confirms, `false` otherwise. Render
 * `{confirmDialog}` once in the component tree. Reuses the shared ConfirmDialog
 * so every table's delete/remove/archive flows look and behave the same.
 */
export const useConfirmDialog = () => {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback(
    (next: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        resolverRef.current = resolve;
        setOptions(next);
      }),
    [],
  );

  const settle = useCallback((value: boolean) => {
    resolverRef.current?.(value);
    resolverRef.current = null;
    setOptions(null);
  }, []);

  const confirmDialog = options ? (
    <ConfirmDialog
      isOpen
      title={options.title}
      body={options.body ?? ""}
      details={options.details}
      confirmLabel={options.confirmLabel}
      cancelLabel={options.cancelLabel}
      tone={options.tone ?? "danger"}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  ) : null;

  return { confirm, confirmDialog };
};
