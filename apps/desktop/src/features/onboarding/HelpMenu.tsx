import { useEffect, useRef, useState, type ReactNode } from "react";
import { HelpCircle, Keyboard, RefreshCcw, Settings as SettingsIcon, X } from "lucide-react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [isPulsing, setIsPulsing] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handler = () => {
      setIsPulsing(true);
      const timer = window.setTimeout(() => setIsPulsing(false), 6000);
      return () => window.clearTimeout(timer);
    };
    window.addEventListener("bukowski:help-pulse", handler);
    return () => {
      window.removeEventListener("bukowski:help-pulse", handler);
    };
  }, []);

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
      label: t("onboarding.help.replayTour"),
      body: t("onboarding.help.replayTourBody"),
      onClick: () => {
        setOpen(false);
        triggerOnboardingTour();
      },
    },
    {
      icon: <Keyboard size={14} />,
      label: t("onboarding.help.openCommandPalette"),
      body: t("onboarding.help.openCommandPaletteBody"),
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
      label: t("onboarding.help.workspaceSettings"),
      body: t("onboarding.help.workspaceSettingsBody"),
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
        aria-label={open ? t("onboarding.help.closeHelp") : t("onboarding.help.openHelp")}
        className={`icon-ghost-control help-menu-trigger${open ? " is-open" : ""}${isPulsing ? " is-pulsing" : ""}`}
        data-tooltip={t("onboarding.help.tooltip")}
        onClick={() => {
          setOpen((current) => !current);
          setIsPulsing(false);
        }}
        type="button"
      >
        <HelpCircle size={16} />
      </button>

      {open ? (
        <div className="help-menu-popover" role="menu">
          <div className="help-menu-header">
            <strong>{t("onboarding.help.title")}</strong>
            <button aria-label={t("onboarding.help.closeHelp")} className="help-menu-close" onClick={() => setOpen(false)} type="button">
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
