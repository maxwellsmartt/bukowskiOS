import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";

import { ALL_CURRENCIES, COMMON_CURRENCIES, type CurrencyEntry } from "@shared/lib/currencyCatalog";

type CurrencyPickerProps = {
  /** Selected ISO-4217 code, or `null` to show the placeholder option. */
  value: string | null;
  onChange: (next: string | null) => void;
  /** Label shown when nothing is selected (e.g. "Use workspace currency (USD)"). */
  placeholderLabel: string;
  /** Pass `true` to disable the trigger. */
  disabled?: boolean;
  /** Optional id for the trigger button (for label association). */
  id?: string;
};

type PanelRect = { top: number; left: number; width: number };

const PANEL_GAP = 6;
const PANEL_MAX_HEIGHT = 320;

const filterCurrencies = (query: string, list: readonly CurrencyEntry[]): CurrencyEntry[] => {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return [...list];
  return list.filter(
    (entry) =>
      entry.code.toLowerCase().includes(trimmed) || entry.name.toLowerCase().includes(trimmed),
  );
};

/**
 * Accessible currency combobox with search. The dropdown panel is
 * rendered through a portal so it is never clipped by ancestors with
 * `overflow: hidden` (e.g. SurfaceCard). Positioning is recomputed on
 * open and on scroll/resize so the panel tracks the trigger.
 */
export const CurrencyPicker = ({
  value,
  onChange,
  placeholderLabel,
  disabled = false,
  id,
}: CurrencyPickerProps) => {
  const triggerId = useId();
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [placeAbove, setPlaceAbove] = useState(false);
  const [panelRect, setPanelRect] = useState<PanelRect | null>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const itemRefs = useRef<Array<HTMLLIElement | null>>([]);

  const grouped = useMemo(() => {
    const commonMatches = filterCurrencies(query, COMMON_CURRENCIES);
    const commonCodes = new Set(COMMON_CURRENCIES.map((entry) => entry.code));
    const otherMatches = filterCurrencies(query, ALL_CURRENCIES).filter(
      (entry) => !commonCodes.has(entry.code),
    );
    return { commonMatches, otherMatches };
  }, [query]);

  const flatItems = useMemo(
    () => [...grouped.commonMatches, ...grouped.otherMatches],
    [grouped],
  );

  // Compute the absolute viewport position of the trigger; flip above when
  // there's not enough room below.
  const recomputePosition = () => {
    const node = triggerRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const flip = spaceBelow < PANEL_MAX_HEIGHT + PANEL_GAP && rect.top > spaceBelow;
    setPlaceAbove(flip);
    setPanelRect({
      top: flip ? rect.top - PANEL_GAP : rect.bottom + PANEL_GAP,
      left: rect.left,
      width: rect.width,
    });
  };

  useLayoutEffect(() => {
    if (!open) return;
    recomputePosition();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => recomputePosition();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open]);

  // Close on outside click. The trigger and the panel (rendered via
  // portal) are both considered "inside".
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Auto-focus search when opening.
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => searchInputRef.current?.focus());
    } else {
      setQuery("");
      setActiveIndex(0);
    }
  }, [open]);

  useEffect(() => {
    if (activeIndex >= flatItems.length) {
      setActiveIndex(0);
    }
  }, [flatItems.length, activeIndex]);

  useEffect(() => {
    const node = itemRefs.current[activeIndex];
    node?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, flatItems.length]);

  const triggerLabel = (() => {
    if (!value) return placeholderLabel;
    const entry = ALL_CURRENCIES.find((item) => item.code === value);
    return entry ? `${entry.code} — ${entry.name}` : value;
  })();

  const handleSelect = (next: string | null) => {
    onChange(next);
    setOpen(false);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => Math.min(current + 1, flatItems.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const entry = flatItems[activeIndex];
      if (entry) handleSelect(entry.code);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  };

  let renderedIndex = 0;
  const renderItem = (entry: CurrencyEntry) => {
    const index = renderedIndex++;
    const isActive = index === activeIndex;
    const isSelected = entry.code === value;
    return (
      <li
        key={entry.code}
        ref={(node) => {
          itemRefs.current[index] = node;
        }}
        role="option"
        aria-selected={isSelected}
        className={`currency-picker-option${isActive ? " is-active" : ""}${isSelected ? " is-selected" : ""}`}
        onMouseEnter={() => setActiveIndex(index)}
        onClick={() => handleSelect(entry.code)}
      >
        <span className="currency-picker-option-code">{entry.code}</span>
        <span className="currency-picker-option-name">{entry.name}</span>
        {isSelected ? <Check size={14} aria-hidden="true" /> : null}
      </li>
    );
  };

  const panel =
    open && panelRect && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={panelRef}
            role="dialog"
            className={`currency-picker-panel${placeAbove ? " is-above" : ""}`}
            style={{
              position: "fixed",
              top: placeAbove ? undefined : panelRect.top,
              bottom: placeAbove ? window.innerHeight - panelRect.top : undefined,
              left: panelRect.left,
              width: panelRect.width,
              maxHeight: PANEL_MAX_HEIGHT,
            }}
          >
            <div className="currency-picker-search">
              <Search size={13} aria-hidden="true" />
              <input
                ref={searchInputRef}
                className="currency-picker-search-input"
                placeholder="Search currency or code"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveIndex(0);
                }}
                onKeyDown={handleKeyDown}
                aria-controls={listboxId}
                aria-autocomplete="list"
              />
            </div>

            <ul
              id={listboxId}
              role="listbox"
              className="currency-picker-listbox"
              aria-label="Currencies"
            >
              <li
                key="__placeholder"
                role="option"
                aria-selected={value === null}
                className={`currency-picker-option currency-picker-option-placeholder${value === null ? " is-selected" : ""}`}
                onClick={() => handleSelect(null)}
              >
                <span className="currency-picker-option-name">{placeholderLabel}</span>
                {value === null ? <Check size={14} aria-hidden="true" /> : null}
              </li>

              {grouped.commonMatches.length > 0 ? (
                <li className="currency-picker-group-label" aria-hidden="true">
                  Common
                </li>
              ) : null}
              {grouped.commonMatches.map(renderItem)}

              {grouped.otherMatches.length > 0 ? (
                <li className="currency-picker-group-label" aria-hidden="true">
                  Other
                </li>
              ) : null}
              {grouped.otherMatches.map(renderItem)}

              {flatItems.length === 0 ? (
                <li className="currency-picker-empty" aria-live="polite">
                  No matches.
                </li>
              ) : null}
            </ul>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="currency-picker">
      <button
        type="button"
        id={id ?? triggerId}
        ref={triggerRef}
        className="currency-picker-trigger field-input"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="currency-picker-trigger-label">{triggerLabel}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>

      {panel}
    </div>
  );
};
