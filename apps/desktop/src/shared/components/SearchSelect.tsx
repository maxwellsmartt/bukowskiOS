import { Check, ChevronDown } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type SearchSelectOption = {
  value: string;
  label: string;
  /** Extra searchable text shown under the label (e.g. serial, category). */
  description?: string;
};

type SearchSelectProps = {
  value: string;
  onChange: (next: string) => void;
  options: ReadonlyArray<SearchSelectOption>;
  ariaLabel: string;
  /** Label for the empty selection row; omit to make a choice mandatory. */
  emptyOptionLabel?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  className?: string;
  disabled?: boolean;
};

const POPUP_GAP = 6;
const POPUP_MAX_HEIGHT = 320;

/**
 * A type-to-search dropdown for long entity lists (assets, projects…): the
 * trigger looks like a regular select, the popup opens with a focused filter
 * input that matches against label and description, so operators can jump to
 * "1185" or "702 touch" instead of scrolling hundreds of rows.
 *
 * Visual cousin of CreatableSelect (same compact-select chrome, portaled
 * popup); this one selects from a fixed list and never creates values.
 */
export const SearchSelect = ({
  value,
  onChange,
  options,
  ariaLabel,
  emptyOptionLabel,
  placeholder = "—",
  searchPlaceholder,
  className = "",
  disabled = false,
}: SearchSelectProps) => {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [rect, setRect] = useState<{ top: number; left: number; width: number; above: boolean } | null>(null);

  const selected = useMemo(() => options.find((option) => option.value === value) ?? null, [options, value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((option) =>
      `${option.label} ${option.description ?? ""}`.toLowerCase().includes(q),
    );
  }, [options, query]);

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
      width: Math.max(r.width, 240),
      above,
    });
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    inputRef.current?.focus();
    const onDown = (event: MouseEvent) => {
      if (
        triggerRef.current?.contains(event.target as Node) ||
        (event.target as HTMLElement)?.closest?.(".search-select-popup")
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
        title={selected?.label ?? placeholder}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="compact-select-trigger-label">{selected?.label || placeholder}</span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {open && rect
        ? createPortal(
            <div
              className="compact-select-popup search-select-popup"
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
                placeholder={searchPlaceholder ?? ariaLabel}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    if (filtered[0]) commit(filtered[0].value);
                  }
                }}
              />
              <ul className="compact-select-listbox" role="listbox" aria-label={ariaLabel}>
                {emptyOptionLabel && value ? (
                  <li
                    className="compact-select-option"
                    role="option"
                    aria-selected={false}
                    onClick={() => commit("")}
                  >
                    <span className="compact-select-option-body">
                      <span className="compact-select-option-label" style={{ opacity: 0.7 }}>
                        {emptyOptionLabel}
                      </span>
                    </span>
                  </li>
                ) : null}
                {filtered.map((option) => (
                  <li
                    key={option.value}
                    className={`compact-select-option${option.value === value ? " is-selected" : ""}`}
                    role="option"
                    aria-selected={option.value === value}
                    onClick={() => commit(option.value)}
                  >
                    <span className="compact-select-option-body">
                      <span className="compact-select-option-label">{option.label}</span>
                      {option.description ? (
                        <span className="compact-select-option-description">{option.description}</span>
                      ) : null}
                    </span>
                    {option.value === value ? <Check size={13} /> : null}
                  </li>
                ))}
                {!filtered.length ? (
                  <li className="compact-select-option is-empty" aria-disabled="true">
                    <span className="compact-select-option-body">
                      <span className="compact-select-option-label" style={{ opacity: 0.6 }}>
                        —
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
