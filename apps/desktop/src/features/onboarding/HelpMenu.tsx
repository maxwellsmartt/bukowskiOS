import { useEffect, useRef, useState, type ReactNode } from "react";
import { HelpCircle, Keyboard, RefreshCcw, Settings as SettingsIcon, X } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { triggerOnboardingTour } from "./OnboardingTour";

type HelpItem = {
  icon: ReactNode;
  label: string;
  body: string;
  shortcut?: string;
  onClick: () => void;
};

export const HelpMenu = () => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  const items: HelpItem[] = [
    {
      icon: <RefreshCcw size={14} />,
      label: "Replay onboarding tour",
      body: "Walk through the four key concepts again.",
      onClick: () => {
        setOpen(false);
        triggerOnboardingTour();
      },
    },
    {
      icon: <Keyboard size={14} />,
      label: "Open command palette",
      body: "Jump anywhere fast.",
      shortcut: "⌘K",
      onClick: () => {
        setOpen(false);
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }),
        );
      },
    },
    {
      icon: <SettingsIcon size={14} />,
      label: "Workspace settings",
      body: "Members, invites and roles.",
      onClick: () => {
        setOpen(false);
        navigate("/settings/workspace");
      },
    },
  ];

  return (
    <div className="help-menu" ref={containerRef}>
      <button
        aria-expanded={open}
        aria-label={open ? "Close help" : "Open help"}
        className={`icon-ghost-control help-menu-trigger${open ? " is-open" : ""}`}
        data-tooltip="Help & tour"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <HelpCircle size={14} />
      </button>

      {open ? (
        <div className="help-menu-popover" role="menu">
          <div className="help-menu-header">
            <strong>Need a hand?</strong>
            <button aria-label="Close help" className="help-menu-close" onClick={() => setOpen(false)} type="button">
              <X size={13} />
            </button>
          </div>
          <ul className="help-menu-list">
            {items.map((item) => (
              <li key={item.label}>
                <button className="help-menu-item" onClick={item.onClick} type="button">
                  <span className="help-menu-item-icon">{item.icon}</span>
                  <span className="help-menu-item-copy">
                    <strong>{item.label}</strong>
                    <small>{item.body}</small>
                  </span>
                  {item.shortcut ? <kbd className="help-menu-item-kbd">{item.shortcut}</kbd> : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
};
