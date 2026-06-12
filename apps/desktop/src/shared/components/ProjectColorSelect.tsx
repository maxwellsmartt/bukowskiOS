import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { ProjectColorKey } from "@contracts";
import { projectColorPalette } from "@contracts";
import { resolveProjectColor } from "@shared/lib/projectColors";

type ProjectColorSelectProps = {
  value: ProjectColorKey | "";
  placeholder: string;
  onChange: (value: ProjectColorKey | "") => void;
};

export const ProjectColorSelect = ({ value, placeholder, onChange }: ProjectColorSelectProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectedColor = projectColorPalette.find((color) => color.key === value) ?? null;
  const selectedLabel = selectedColor?.label ?? placeholder;
  const selectedHex = selectedColor ? resolveProjectColor(selectedColor.key) : resolveProjectColor(null);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const chooseColor = (nextValue: ProjectColorKey | "") => {
    onChange(nextValue);
    setIsOpen(false);
  };

  return (
    <div className="project-color-select" ref={rootRef}>
      <button
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        className="project-color-select-trigger action-field-control"
        onClick={() => setIsOpen((current) => !current)}
        type="button"
      >
        <span className="project-color-select-value">
          <span aria-hidden="true" className="project-color-select-swatch" style={{ background: selectedHex }} />
          <span>{selectedLabel}</span>
        </span>
        <ChevronDown aria-hidden size={16} />
      </button>

      {isOpen ? (
        <div className="project-color-select-menu" role="listbox">
          <button
            aria-selected={!value}
            className={`project-color-select-option${!value ? " is-selected" : ""}`}
            onClick={() => chooseColor("")}
            role="option"
            type="button"
          >
            <span aria-hidden="true" className="project-color-select-swatch" style={{ background: resolveProjectColor(null) }} />
            <span>{placeholder}</span>
          </button>

          {projectColorPalette.map((color) => (
            <button
              aria-selected={value === color.key}
              className={`project-color-select-option${value === color.key ? " is-selected" : ""}`}
              key={color.key}
              onClick={() => chooseColor(color.key)}
              role="option"
              type="button"
            >
              <span aria-hidden="true" className="project-color-select-swatch" style={{ background: resolveProjectColor(color.key) }} />
              <span>{color.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
};
