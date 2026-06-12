import { ChevronDown } from "lucide-react";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { ProjectColorKey } from "@contracts";
import { projectColorPalette } from "@contracts";
import { resolveProjectColor } from "@shared/lib/projectColors";

type ProjectColorSelectProps = {
  value: ProjectColorKey | "";
  placeholder: string;
  onChange: (value: ProjectColorKey | "") => void;
};

type MenuPosition = {
  left: number;
  maxHeight: number;
  top: number;
  width: number;
};

export const ProjectColorSelect = ({ value, placeholder, onChange }: ProjectColorSelectProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const selectedColor = projectColorPalette.find((color) => color.key === value) ?? null;
  const selectedLabel = selectedColor?.label ?? placeholder;
  const selectedHex = selectedColor ? resolveProjectColor(selectedColor.key) : resolveProjectColor(null);

  const updateMenuPosition = useCallback(() => {
    const triggerRect = rootRef.current?.getBoundingClientRect();
    if (!triggerRect) return;

    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const gutter = 12;
    const preferredMenuHeight = Math.min(360, Math.round(viewportHeight * 0.46));
    const spaceBelow = viewportHeight - triggerRect.bottom - gutter;
    const spaceAbove = triggerRect.top - gutter;
    const openAbove = spaceBelow < 220 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(180, Math.min(preferredMenuHeight, openAbove ? spaceAbove : spaceBelow));
    const top = openAbove ? Math.max(gutter, triggerRect.top - maxHeight - 8) : Math.min(triggerRect.bottom + 8, viewportHeight - gutter - maxHeight);
    const width = Math.max(triggerRect.width, 220);
    const left = Math.min(Math.max(gutter, triggerRect.left), viewportWidth - gutter - width);

    setMenuPosition({ left, maxHeight, top, width });
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    updateMenuPosition();

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
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
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [isOpen, updateMenuPosition]);

  const chooseColor = (nextValue: ProjectColorKey | "") => {
    onChange(nextValue);
    setIsOpen(false);
  };

  const menuStyle: CSSProperties | undefined = menuPosition
    ? {
        left: menuPosition.left,
        maxHeight: menuPosition.maxHeight,
        position: "fixed",
        top: menuPosition.top,
        width: menuPosition.width,
      }
    : undefined;

  const menu = isOpen && menuStyle && typeof document !== "undefined"
    ? createPortal(
        <div className="project-color-select-menu" ref={menuRef} role="listbox" style={menuStyle}>
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
        </div>,
        document.body,
      )
    : null;

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
      {menu}
    </div>
  );
};
