import {
  Children,
  useEffect,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";

import { readNumberPreference, writePreference } from "@shared/lib/preferences";

type ResizableSideRailLayoutProps = {
  children: ReactNode;
  className?: string;
  defaultWidth: number;
  maxWidth: number;
  minWidth: number;
  storageKey: string;
};

const clampRailWidth = (width: number, minWidth: number, maxWidth: number) => Math.min(maxWidth, Math.max(minWidth, width));

export const ResizableSideRailLayout = ({
  children,
  className = "",
  defaultWidth,
  maxWidth,
  minWidth,
  storageKey,
}: ResizableSideRailLayoutProps) => {
  const childItems = Children.toArray(children).filter(Boolean);
  const hasSideRail = childItems.length > 1;
  const [railWidth, setRailWidth] = useState(() =>
    clampRailWidth(readNumberPreference(storageKey, defaultWidth), minWidth, maxWidth),
  );

  useEffect(() => {
    setRailWidth((current) => clampRailWidth(current, minWidth, maxWidth));
  }, [maxWidth, minWidth]);

  useEffect(
    () => () => {
      document.body.classList.remove("is-resizing-side-rail");
    },
    [],
  );

  const handleResizeStart = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();

    const startX = event.clientX;
    const initialWidth = railWidth;
    let nextWidth = initialWidth;
    document.body.classList.add("is-resizing-side-rail");

    const handleMouseMove = (moveEvent: MouseEvent) => {
      nextWidth = clampRailWidth(initialWidth + startX - moveEvent.clientX, minWidth, maxWidth);
      setRailWidth(nextWidth);
    };

    const handleMouseUp = () => {
      document.body.classList.remove("is-resizing-side-rail");
      writePreference(storageKey, String(nextWidth));
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp, { once: true });
  };

  const layoutStyle = {
    "--side-rail-min-width": `${minWidth}px`,
    "--side-rail-width": `${railWidth}px`,
  } as CSSProperties;

  return (
    <div
      className={`resizable-side-layout${hasSideRail ? " has-side-rail" : ""}${className ? ` ${className}` : ""}`}
      style={layoutStyle}
    >
      {childItems[0] ?? null}
      {hasSideRail ? (
        <>
          <div
            aria-label="Resize side panel"
            className="side-rail-resize-handle"
            onMouseDown={handleResizeStart}
            role="separator"
          />
          {childItems[1]}
        </>
      ) : null}
    </div>
  );
};
