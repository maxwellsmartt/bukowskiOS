import { Check, ChevronDown, Plus } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

type CreatableSelectProps = {
  value: string | null;
  onChange: (next: string) => void;
  options: ReadonlyArray<string>;
  ariaLabel: string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  /** Builds the "create" row label, e.g. (q) => `Crear "${q}"`. */
  createLabel?: (query: string) => string;
};

const POPUP_GAP = 6;
const POPUP_MAX_HEIGHT = 300;

/**
 * A combobox that lets the user pick an existing option OR type a new one
 * inline (a creatable select). Used for free-form-but-reusable fields like
 * expense categories: the option list is whatever has been used before, and
 * typing + Enter (or the "create" row) adds a new value on the fly.
 *
 * The popup is portaled to `document.body` so it escapes table/column clipping.
 */
export const CreatableSelect = ({
  value,
  onChange,
  options,
  ariaLabel,
  placeholder = "—",
  className = "",
  disabled = false,
  createLabel = (query) => `Crear "${query}"`,
}: CreatableSelectProps) => {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [rect, setRect] = useState<{ top: number; left: number; width: number; above: boolean } | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((option) => option.toLowerCase().includes(q));
  }, [options, query]);

  const exactMatch = useMemo(
    () => options.some((option) => option.toLowerCase() === query.trim().toLowerCase()),
    [options, query],
  );
  const canCreate = query.trim().length > 0 && !exactMatch;

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    if (!trigger) return;
    const r = trigger.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const above = spaceBelow < POPUP_MAX_HEIGHT && r.top > spaceBelow;
    setRect({
      top: above ? r.top - POPUP_GAP : r.bottom + POPUP_GAP,
      left: r.left,
      width: Math.max(r.width, 200),
      above,
    });
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    inputRef.current?.focus();
    const onDown = (event: MouseEvent) => {
      if (
        triggerRef.current?.contains(event.target as Node) ||
        (event.target as HTMLElement)?.closest?.(".creatable-select-popup")
      ) {
        return;
      }
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const commit = (next: string) => {
    onChange(next);
    setQuery("");
    setOpen(false);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`compact-select-trigger field-input ${className}`.trim()}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={value ?? placeholder}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="compact-select-trigger-label">{value || placeholder}</span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {open && rect
        ? createPortal(
            <div
              className="compact-select-popup creatable-select-popup"
              style={{
                position: "fixed",
                top: rect.above ? undefined : rect.top,
                bottom: rect.above ? window.innerHeight - rect.top : undefined,
                left: rect.left,
                minWidth: rect.width,
                maxHeight: POPUP_MAX_HEIGHT,
              }}
            >
              <input
                ref={inputRef}
                className="field-input creatable-select-input"
                value={query}
                placeholder={ariaLabel}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    if (canCreate) commit(query.trim());
                    else if (filtered[0]) commit(filtered[0]);
                  }
                }}
              />
              <ul className="compact-select-listbox" role="listbox" aria-label={ariaLabel}>
                {value ? (
                  <li
                    className="compact-select-option"
                    role="option"
                    aria-selected={false}
                    onClick={() => commit("")}
                  >
                    <span className="compact-select-option-body">
                      <span className="compact-select-option-label" style={{ opacity: 0.7 }}>
                        {placeholder}
                      </span>
                    </span>
                  </li>
                ) : null}
                {filtered.map((option) => (
                  <li
                    key={option}
                    className={`compact-select-option${option === value ? " is-selected" : ""}`}
                    role="option"
                    aria-selected={option === value}
                    onClick={() => commit(option)}
                  >
                    <span className="compact-select-option-body">
                      <span className="compact-select-option-label">{option}</span>
                    </span>
                    {option === value ? <Check size={13} /> : null}
                  </li>
                ))}
                {canCreate ? (
                  <li
                    className="compact-select-option creatable-select-create"
                    role="option"
                    aria-selected={false}
                    onClick={() => commit(query.trim())}
                  >
                    <span className="compact-select-option-body">
                      <span className="compact-select-option-label">
                        <Plus size={12} style={{ marginRight: 4, verticalAlign: "-1px" }} />
                        {createLabel(query.trim())}
                      </span>
                    </span>
                  </li>
                ) : null}
              </ul>
            </div>,
            document.body,
          )
        : null}
    </>
  );
};
