import { Bell, CheckCheck, ExternalLink, Inbox, X } from "lucide-react";
import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";

import { useNotifications } from "@app/providers/NotificationsProvider";

const formatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const kindLabel = (kind: string) => {
  switch (kind) {
    case "agent_completion":
      return "Agent";
    case "archive_done":
      return "Archive";
    case "reminder":
      return "Reminder";
    case "invite":
      return "Invite";
    case "sync":
      return "Sync";
    default:
      return "System";
  }
};

export const NotificationsButton = () => {
  const { unreadCount, toggleTray } = useNotifications();
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  return (
    <button
      ref={buttonRef}
      aria-label={unreadCount > 0 ? `${unreadCount} unread notifications` : "Notifications"}
      className={`icon-ghost-control notifications-trigger${unreadCount > 0 ? " has-unread" : ""}`}
      data-tooltip={unreadCount > 0 ? `${unreadCount} unread` : "Notifications"}
      onClick={() => toggleTray(buttonRef.current?.getBoundingClientRect() ?? null)}
      type="button"
    >
      <Bell size={14} />
      {unreadCount > 0 ? <span className="notifications-trigger-badge">{Math.min(unreadCount, 99)}</span> : null}
    </button>
  );
};

export const NotificationsTray = () => {
  const navigate = useNavigate();
  const trayRef = useRef<HTMLElement | null>(null);
  const { closeTray, isLoading, isTrayOpen, items, markAllRead, markRead, trayAnchor, unreadCount } = useNotifications();

  const groupedItems = useMemo(() => {
    const groups = new Map<string, typeof items>();
    items.forEach((item) => {
      const createdDate = new Date(item.createdAt);
      const key = createdDate.toDateString();
      groups.set(key, [...(groups.get(key) ?? []), item]);
    });
    return Array.from(groups.entries()).map(([key, rows]) => ({
      key,
      label: key === new Date().toDateString() ? "Today" : formatter.format(new Date(rows[0]?.createdAt ?? Date.now())).split(",")[0],
      rows,
    }));
  }, [items]);

  useEffect(() => {
    if (!isTrayOpen) {
      return undefined;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      const clickedTrigger = target instanceof Element && Boolean(target.closest(".notifications-trigger"));
      if (clickedTrigger || trayRef.current?.contains(target)) {
        return;
      }

      closeTray();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeTray();
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeTray, isTrayOpen]);

  if (!isTrayOpen) {
    return null;
  }

  const openNotification = async (item: (typeof items)[number]) => {
    if (!item.readAt) {
      await markRead(item.id).catch(() => undefined);
    }

    if (item.linkTo) {
      navigate(item.linkTo);
      closeTray();
    }
  };

  const trayStyle = trayAnchor
    ? ({
        "--notifications-popover-top": `${Math.round(trayAnchor.bottom + 10)}px`,
        "--notifications-popover-right": `${Math.max(12, Math.round(window.innerWidth - trayAnchor.right))}px`,
      } as CSSProperties)
    : undefined;

  return (
    <aside ref={trayRef} className="notifications-tray" style={trayStyle} aria-label="Notifications">
      <div className="notifications-tray-header">
        <div>
          <h2>Notifications</h2>
        </div>
        <div className="notifications-tray-actions">
          <button
            className="icon-ghost-control"
            data-tooltip="Mark all read"
            disabled={unreadCount === 0}
            onClick={() => void markAllRead()}
            type="button"
          >
            <CheckCheck size={15} />
          </button>
          <button className="icon-ghost-control" data-tooltip="Close" onClick={closeTray} type="button">
            <X size={15} />
          </button>
        </div>
      </div>

      <div className="notifications-tray-list">
        {isLoading ? (
          <div className="notifications-empty">
            <Inbox size={18} />
            <span>Loading notifications…</span>
          </div>
        ) : groupedItems.length === 0 ? (
          <div className="notifications-empty">
            <Inbox size={18} />
            <strong>All clear</strong>
            <span>New agent updates, reminders and system events will land here.</span>
          </div>
        ) : (
          groupedItems.map((group) => (
            <section key={group.key} className="notifications-group">
              <h3>{group.label}</h3>
              {group.rows.map((item) => (
                <button
                  key={item.id}
                  className={`notification-row${item.readAt ? "" : " is-unread"}`}
                  onClick={() => void openNotification(item)}
                  type="button"
                >
                  <span className="notification-row-dot" />
                  <span className="notification-row-copy">
                    <span className="notification-row-meta">
                      {kindLabel(item.kind)} · {formatter.format(new Date(item.createdAt))}
                    </span>
                    <strong>{item.title}</strong>
                    {item.body ? <span>{item.body}</span> : null}
                  </span>
                  {item.linkTo ? <ExternalLink size={13} /> : null}
                </button>
              ))}
            </section>
          ))
        )}
      </div>
    </aside>
  );
};
