import { useEffect, useRef, useState } from "react";
import { ChevronUp, LogOut, Settings as SettingsIcon, UserCircle2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { useSession } from "@app/providers/SessionProvider";
import { useToast } from "@app/providers/ToastProvider";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { getUserFacingErrorMessage } from "@shared/lib/errors";

const initialsFor = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0]!}${parts[parts.length - 1]![0]!}`.toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
};

export const SidebarUserMenu = () => {
  const navigate = useNavigate();
  const toast = useToast();
  const { user, status, signOut, isLocalFallback } = useSession();
  const { activeMembership } = useWorkspace();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  const isAuthenticated = status === "authenticated" && user;
  const rawDisplayName = isAuthenticated ? user.displayName : isLocalFallback ? "Local fallback" : "Sign in";
  const userEmail = isAuthenticated ? user.email ?? null : null;
  // When the user has not set a real name, displayName falls back to email — show
  // a friendly "Set your name" prompt instead of duplicating the email.
  const displayNameMatchesEmail = Boolean(userEmail && rawDisplayName === userEmail);
  const displayName = displayNameMatchesEmail ? "Set your name" : rawDisplayName;
  const subtitle = isAuthenticated
    ? userEmail ?? activeMembership?.roleName ?? "Member"
    : isLocalFallback
      ? "No remote auth"
      : "Tap to authenticate";
  const initials = initialsFor(displayNameMatchesEmail ? userEmail ?? "?" : rawDisplayName);

  const handleSignOut = async () => {
    setOpen(false);
    try {
      await signOut();
      toast.success("Signed out", "See you soon.");
    } catch (error) {
      toast.error("Sign out failed", getUserFacingErrorMessage(error, "Try again in a moment."));
    }
  };

  return (
    <div className="sidebar-user-menu" ref={containerRef}>
      <button
        aria-expanded={open}
        aria-label={open ? "Close user menu" : "Open user menu"}
        className={`sidebar-user-trigger${open ? " is-open" : ""}`}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        {user?.avatarUrl ? (
          <img alt="" className="sidebar-user-avatar-img" src={user.avatarUrl} />
        ) : (
          <span className="sidebar-user-avatar" aria-hidden="true">
            {initials}
          </span>
        )}
        <span className="sidebar-user-copy">
          <strong>{displayName}</strong>
          <small>{subtitle}</small>
        </span>
        <ChevronUp className={`sidebar-user-chevron${open ? " is-open" : ""}`} size={14} aria-hidden="true" />
      </button>

      {open ? (
        <div className="sidebar-user-popover" role="menu">
          <div className="sidebar-user-popover-header">
            {user?.avatarUrl ? (
              <img alt="" className="sidebar-user-avatar-img sidebar-user-avatar-lg" src={user.avatarUrl} />
            ) : (
              <span className="sidebar-user-avatar sidebar-user-avatar-lg" aria-hidden="true">
                {initials}
              </span>
            )}
            <span className="sidebar-user-popover-copy">
              <strong>{displayName}</strong>
              <small>{subtitle}</small>
              {activeMembership ? <span className="sidebar-user-role-pill">{activeMembership.roleName}</span> : null}
            </span>
          </div>

          <div className="sidebar-user-popover-actions">
            <button
              className="sidebar-user-action"
              onClick={() => {
                setOpen(false);
                navigate("/settings/account");
              }}
              type="button"
            >
              <UserCircle2 size={14} />
              <span>Your account</span>
            </button>
            <button
              className="sidebar-user-action"
              onClick={() => {
                setOpen(false);
                navigate("/settings/workspace");
              }}
              type="button"
            >
              <SettingsIcon size={14} />
              <span>Workspace settings</span>
            </button>
            {isAuthenticated ? (
              <button className="sidebar-user-action sidebar-user-action-danger" onClick={() => void handleSignOut()} type="button">
                <LogOut size={14} />
                <span>Sign out</span>
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
};
