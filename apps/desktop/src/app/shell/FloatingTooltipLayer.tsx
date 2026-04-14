import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

type TooltipPlacement = "top" | "bottom";

type TooltipState = {
  anchor: HTMLElement;
  placement: TooltipPlacement;
  text: string;
};

type TooltipLayout = {
  arrowOffset: number;
  left: number;
  top: number;
};

const viewportMargin = 10;
const arrowSize = 8;
const gap = 10;

const resolveTooltipText = (element: Element | null) => {
  if (!element) {
    return null;
  }

  const directTooltip = element.getAttribute("data-tooltip")?.trim();
  if (directTooltip) {
    return directTooltip;
  }

  const ariaLabel = element.getAttribute("aria-label")?.trim();
  if (!ariaLabel || ariaLabel.startsWith("Close ")) {
    return null;
  }

  if (
    element.matches(".surface-card-action, .icon-ghost-control, .shell-project-action, .assistant-chat-sidebar-tool, .assistant-chat-session-action, .assistant-chat-send-button, .assistant-chat-attachment-remove, .project-setup-close-button, .icon-danger-control")
  ) {
    return ariaLabel;
  }

  return null;
};

const resolveTooltipAnchor = (target: EventTarget | null) => {
  if (!(target instanceof Element)) {
    return null;
  }

  return target.closest<HTMLElement>(
    "[data-tooltip], .surface-card-action[aria-label], .icon-ghost-control[aria-label], .shell-project-action[aria-label], .assistant-chat-sidebar-tool[aria-label], .assistant-chat-session-action[aria-label], .assistant-chat-send-button[aria-label], .assistant-chat-attachment-remove[aria-label], .project-setup-close-button[aria-label], .icon-danger-control[aria-label]",
  );
};

export const FloatingTooltipLayer = () => {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [layout, setLayout] = useState<TooltipLayout | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    document.body.classList.add("has-floating-tooltips");

    return () => {
      document.body.classList.remove("has-floating-tooltips");
    };
  }, []);

  useEffect(() => {
    const showTooltip = (element: HTMLElement | null) => {
      const text = resolveTooltipText(element);

      if (!element || !text) {
        setTooltip(null);
        return;
      }

      const placement = element.getAttribute("data-tooltip-position") === "bottom" ? "bottom" : "top";
      setTooltip({ anchor: element, placement, text });
    };

    const handleMouseOver = (event: MouseEvent) => {
      showTooltip(resolveTooltipAnchor(event.target));
    };

    const handleFocusIn = (event: FocusEvent) => {
      showTooltip(resolveTooltipAnchor(event.target));
    };

    const handleMouseOut = (event: MouseEvent) => {
      if (!tooltip?.anchor) {
        return;
      }

      const relatedTarget = event.relatedTarget;
      if (relatedTarget instanceof Node && tooltip.anchor.contains(relatedTarget)) {
        return;
      }

      if (event.target instanceof Node && tooltip.anchor.contains(event.target)) {
        setTooltip(null);
      }
    };

    const handleFocusOut = (event: FocusEvent) => {
      if (!tooltip?.anchor) {
        return;
      }

      const relatedTarget = event.relatedTarget;
      if (relatedTarget instanceof Node && tooltip.anchor.contains(relatedTarget)) {
        return;
      }

      if (event.target instanceof Node && tooltip.anchor.contains(event.target)) {
        setTooltip(null);
      }
    };

    document.addEventListener("mouseover", handleMouseOver);
    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("mouseout", handleMouseOut);
    document.addEventListener("focusout", handleFocusOut);

    return () => {
      document.removeEventListener("mouseover", handleMouseOver);
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("mouseout", handleMouseOut);
      document.removeEventListener("focusout", handleFocusOut);
    };
  }, [tooltip?.anchor]);

  const refreshLayout = useMemo(
    () => () => {
      if (!tooltip?.anchor || !tooltipRef.current) {
        setLayout(null);
        return;
      }

      const anchorRect = tooltip.anchor.getBoundingClientRect();
      const tooltipRect = tooltipRef.current.getBoundingClientRect();
      const centeredLeft = anchorRect.left + anchorRect.width / 2 - tooltipRect.width / 2;
      const left = Math.min(
        Math.max(centeredLeft, viewportMargin),
        window.innerWidth - tooltipRect.width - viewportMargin,
      );
      const top =
        tooltip.placement === "bottom"
          ? anchorRect.bottom + gap
          : Math.max(anchorRect.top - tooltipRect.height - gap, viewportMargin);
      const arrowOffset = Math.min(
        Math.max(anchorRect.left + anchorRect.width / 2 - left, 14),
        tooltipRect.width - 14,
      );

      setLayout({ left, top, arrowOffset });
    },
    [tooltip],
  );

  useLayoutEffect(() => {
    refreshLayout();
  }, [refreshLayout]);

  useEffect(() => {
    if (!tooltip) {
      return;
    }

    const handleViewportChange = () => {
      refreshLayout();
    };

    window.addEventListener("scroll", handleViewportChange, true);
    window.addEventListener("resize", handleViewportChange);

    return () => {
      window.removeEventListener("scroll", handleViewportChange, true);
      window.removeEventListener("resize", handleViewportChange);
    };
  }, [refreshLayout, tooltip]);

  if (!tooltip) {
    return null;
  }

  return createPortal(
    <div
      ref={tooltipRef}
      className={`floating-tooltip floating-tooltip-${tooltip.placement}`}
      style={
        layout
          ? ({
              "--floating-tooltip-arrow-offset": `${layout.arrowOffset}px`,
              left: `${layout.left}px`,
              top: `${layout.top}px`,
            } as CSSProperties)
          : { opacity: 0 }
      }
      role="tooltip"
    >
      {tooltip.text}
    </div>,
    document.body,
  );
};
