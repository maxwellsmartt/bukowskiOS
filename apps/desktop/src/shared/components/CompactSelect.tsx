import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

export type CompactSelectOption<T extends string> = {
  value: T;
  /** Label shown both in the trigger (compact) and in the popup menu. */
  label: string;
  /** Optional secondary line shown in the popup only (e.g. a hint). */
  description?: string;
};

type CompactSelectProps<T extends string> = {
  value: T;
  onChange: (next: T) => void;
  options: ReadonlyArray<CompactSelectOption<T>>;
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  /**
   * Optional fixed width hint for the popup. By default the popup
   * stretches to fit the longest label without being capped to the
   * trigger's width — that's the whole point of the component.
   */
  popupMinWidth?: number;
};

type PopupRect = { top: number; left: number; minWidth: number };

const POPUP_GAP = 6;
const POPUP_MAX_HEIGHT = 320;

/**
 * Dropdown shaped like a native `<select>` but with a portaled popup
 * that escapes the parent column's width constraints. Useful inside
 * compact grid cells where the closed trigger gets squeezed but you
 * still want the options menu to render the labels in full.
 *
 * The trigger truncates with ellipsis (and surfaces the full label via
 * `title`); the popup is anchored to the trigger and flips above when
 * there isn't enough room below.
 */
export const CompactSelect = <T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  className = "",
  disabled = false,
  popupMinWidth,
}: CompactSelectProps<T>) => {
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [placeAbove, setPlaceAbove] = useState(false);
  const [rect, setRect] = useState<PopupRect | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLLIElement | null>>([]);

  const selectedOption = useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value],
  );
  const selectedIndex = useMemo(
    () => options.findIndex((option) => option.value === value),
    [options, value],
  );

  // Pop position: measures the trigger, picks above/below based on space.
  const measure = () => {
    const node = triggerRef.current;
    if (!node) return;
    const r = node.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const flip = spaceBelow < POPUP_MAX_HEIGHT + POPUP_GAP && r.top > spaceBelow;
    setPlaceAbove(flip);
    setRect({
      top: flip ? r.top - POPUP_GAP : r.bottom + POPUP_GAP,
      left: r.left,
      minWidth: popupMinWidth ?? Math.max(r.width, 168),
    });
  };

  useLayoutEffect(() => {
    if (open) {
      measure();
      setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedIndex]);

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => measure();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Outside click + Escape.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (popupRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Auto-scroll the active option into view.
  useEffect(() => {
    if (!open) return;
    itemRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  const select = (next: T) => {
    onChange(next);
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const triggerLabel = selectedOption?.label ?? "";

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`compact-select-trigger field-input ${className}`.trim()}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-label={ariaLabel}
        title={triggerLabel}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            setOpen(true);
            return;
          }
          if (open) {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((current) => Math.min(current + 1, options.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((current) => Math.max(current - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              const option = options[activeIndex];
              if (option) select(option.value);
            }
          }
        }}
      >
        <span className="compact-select-trigger-label">{triggerLabel}</span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>

      {open && rect && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={popupRef}
              role="dialog"
              className={`compact-select-popup${placeAbove ? " is-above" : ""}`}
              style={{
                position: "fixed",
                top: placeAbove ? undefined : rect.top,
                bottom: placeAbove ? window.innerHeight - rect.top : undefined,
                left: rect.left,
                minWidth: rect.minWidth,
                maxHeight: POPUP_MAX_HEIGHT,
              }}
            >
              <ul id={listboxId} role="listbox" className="compact-select-listbox" aria-label={ariaLabel}>
                {options.map((option, index) => {
                  const isActive = index === activeIndex;
                  const isSelected = option.value === value;
                  return (
                    <li
                      key={option.value}
                      ref={(node) => {
                        itemRefs.current[index] = node;
                      }}
                      role="option"
                      aria-selected={isSelected}
                      className={`compact-select-option${isActive ? " is-active" : ""}${isSelected ? " is-selected" : ""}`}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => select(option.value)}
                    >
                      <span className="compact-select-option-body">
                        <span className="compact-select-option-label">{option.label}</span>
                        {option.description ? (
                          <small className="compact-select-option-description">{option.description}</small>
                        ) : null}
                      </span>
                      {isSelected ? <Check size={13} aria-hidden="true" /> : null}
                    </li>
                  );
                })}
              </ul>
            </div>,
            document.body,
          )
        : null}
    </>
  );
};
