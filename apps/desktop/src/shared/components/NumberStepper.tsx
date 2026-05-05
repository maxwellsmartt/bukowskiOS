import { Minus, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type NumberStepperProps = {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  precision?: number; // decimals
  ariaLabel?: string;
  /** Optional unit label rendered to the right (e.g. "%", "DOP"). */
  suffix?: string;
  className?: string;
  align?: "left" | "center" | "right";
  disabled?: boolean;
  placeholder?: string;
};

const clamp = (value: number, min?: number, max?: number) => {
  let next = value;
  if (typeof min === "number") next = Math.max(min, next);
  if (typeof max === "number") next = Math.min(max, next);
  return next;
};

const formatForDisplay = (value: number, precision: number) => {
  if (!Number.isFinite(value)) return "";
  if (precision === 0) return String(Math.round(value));
  return value
    .toFixed(precision)
    .replace(/\.?0+$/, (match) => (match.startsWith(".") ? "" : match));
};

/**
 * Replacement for the browser's native number spinner. Two pill buttons on
 * either side of the input keep the surface visually integrated with the
 * design system (no native arrows, no double bevels). Manual typing is still
 * allowed; values are clamped on commit.
 */
export const NumberStepper = ({
  value,
  onChange,
  min,
  max,
  step = 1,
  precision = 0,
  ariaLabel,
  suffix,
  className = "",
  align = "right",
  disabled = false,
  placeholder,
}: NumberStepperProps) => {
  const [draft, setDraft] = useState(() => formatForDisplay(value, precision));
  const lastEmittedRef = useRef(value);

  // Keep the visible draft in sync when the parent updates `value` externally.
  useEffect(() => {
    if (lastEmittedRef.current !== value) {
      setDraft(formatForDisplay(value, precision));
      lastEmittedRef.current = value;
    }
  }, [value, precision]);

  const commit = (next: number) => {
    const clamped = clamp(next, min, max);
    if (clamped !== value) {
      lastEmittedRef.current = clamped;
      onChange(clamped);
    }
    setDraft(formatForDisplay(clamped, precision));
  };

  const decrement = () => commit((Number.isFinite(value) ? value : 0) - step);
  const increment = () => commit((Number.isFinite(value) ? value : 0) + step);

  return (
    <div className={`number-stepper${disabled ? " is-disabled" : ""} ${className}`.trim()}>
      <button
        aria-label="Decrease"
        className="number-stepper-button"
        disabled={disabled || (typeof min === "number" && value <= min)}
        onClick={decrement}
        tabIndex={-1}
        type="button"
      >
        <Minus size={12} />
      </button>
      <input
        aria-label={ariaLabel}
        className={`number-stepper-input number-stepper-align-${align}`}
        disabled={disabled}
        onBlur={() => {
          const parsed = Number(draft.replace(",", "."));
          if (Number.isFinite(parsed)) commit(parsed);
          else setDraft(formatForDisplay(value, precision));
        }}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            increment();
          } else if (event.key === "ArrowDown") {
            event.preventDefault();
            decrement();
          }
        }}
        placeholder={placeholder}
        type="text"
        inputMode="decimal"
        value={draft}
      />
      {suffix ? <span className="number-stepper-suffix">{suffix}</span> : null}
      <button
        aria-label="Increase"
        className="number-stepper-button"
        disabled={disabled || (typeof max === "number" && value >= max)}
        onClick={increment}
        tabIndex={-1}
        type="button"
      >
        <Plus size={12} />
      </button>
    </div>
  );
};

export default NumberStepper;
