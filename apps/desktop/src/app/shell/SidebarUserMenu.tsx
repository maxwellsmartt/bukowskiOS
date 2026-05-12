import { useEffect, useRef, useState } from "react";
import { ChevronUp, LogOut, Settings as SettingsIcon, UserCircle2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();
  const { user, status, signOut, isLocalFallback } = useSession();
  const { activeMembership } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [avatarLoadFailed, setAvatarLoadFailed] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setAvatarLoadFailed(false);
  }, [user?.avatarUrl]);

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
  const rawDisplayName = isAuthenticated
    ? user.displayName
    : isLocalFallback
      ? t("shell.userMenu.localFallback")
      : t("shell.userMenu.signIn");
  const userEmail = isAuthenticated ? user.email ?? null : null;
  // When the user has not set a real name, displayName falls back to email — show
  // a friendly "Set your name" prompt instead of duplicating the email.
  const displayNameMatchesEmail = Boolean(userEmail && rawDisplayName === userEmail);
  const displayName = displayNameMatchesEmail ? t("shell.userMenu.setYourName") : rawDisplayName;
  const subtitle = isAuthenticated
    ? userEmail ?? activeMembership?.roleName ?? t("shell.userMenu.member")
    : isLocalFallback
      ? t("shell.userMenu.noRemoteAuth")
      : t("shell.userMenu.tapToAuth");
  const initials = initialsFor(displayNameMatchesEmail ? userEmail ?? "?" : rawDisplayName);

  const handleSignOut = async () => {
    setOpen(false);
    try {
      await signOut();
      toast.success(t("shell.userMenu.signedOut"), t("shell.userMenu.signedOutBody"));
    } catch (error) {
      toast.error(
        t("shell.userMenu.signOutFailed"),
        getUserFacingErrorMessage(error, t("common.tryAgain")),
      );
    }
  };

  return (
    <div className="sidebar-user-menu" ref={containerRef}>
      <button
        aria-expanded={open}
        aria-label={open ? t("shell.userMenu.closeMenu") : t("shell.userMenu.openMenu")}
        className={`sidebar-user-trigger${open ? " is-open" : ""}`}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        {user?.avatarUrl && !avatarLoadFailed ? (
          <img alt="" className="sidebar-user-avatar-img" onError={() => setAvatarLoadFailed(true)} src={user.avatarUrl} />
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
            {user?.avatarUrl && !avatarLoadFailed ? (
              <img
                alt=""
                className="sidebar-user-avatar-img sidebar-user-avatar-lg"
                onError={() => setAvatarLoadFailed(true)}
                src={user.avatarUrl}
              />
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
              <span>{t("shell.userMenu.yourAccount")}</span>
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
              <span>{t("shell.userMenu.workspaceSettings")}</span>
            </button>
            {isAuthenticated ? (
              <button className="sidebar-user-action sidebar-user-action-danger" onClick={() => void handleSignOut()} type="button">
                <LogOut size={14} />
                <span>{t("shell.userMenu.signOut")}</span>
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
};
