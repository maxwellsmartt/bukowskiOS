import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Camera, KeyRound, LogOut, Save, ShieldCheck, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { clearCachedAvatar, useSession } from "@app/providers/SessionProvider";
import { useToast } from "@app/providers/ToastProvider";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { SectionHeader } from "@shared/components/SectionHeader";
import { PasswordRequirementList } from "@shared/components/PasswordRequirementList";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { getUserFacingErrorMessage } from "@shared/lib/errors";
import { isPasswordPolicySatisfied } from "@shared/lib/passwordPolicy";

const initialsFor = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0]!}${parts[parts.length - 1]![0]!}`.toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
};

const isReauthenticationRequiredError = (error: unknown): boolean => {
  const maybeError = error as { code?: unknown; message?: unknown; name?: unknown };
  const haystack = [maybeError.code, maybeError.message, maybeError.name]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();

  return haystack.includes("reauth") || haystack.includes("nonce");
};

type UserAccountSettingsProps = {
  showHeader?: boolean;
};

export const UserAccountSettings = ({ showHeader = true }: UserAccountSettingsProps) => {
  const { t } = useTranslation();
  const toast = useToast();
  const { user, status, supabase, isLocalFallback, signOut, refreshUser, updateUserMetadata } = useSession();
  const { activeMembership, activeWorkspaceName } = useWorkspace();

  const initialFullName = useMemo(() => {
    if (!user) return "";
    return user.displayName === user.email ? "" : user.displayName;
  }, [user]);

  const [fullName, setFullName] = useState(initialFullName);
  const [isSaving, setIsSaving] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [reauthCode, setReauthCode] = useState("");
  const [reauthRequired, setReauthRequired] = useState(false);
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [isSendingReauthCode, setIsSendingReauthCode] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [avatarLoadFailed, setAvatarLoadFailed] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setFullName(initialFullName);
  }, [initialFullName]);

  useEffect(() => {
    setAvatarLoadFailed(false);
  }, [user?.avatarUrl]);

  if (status !== "authenticated" || !user) {
    return (
      <SurfaceCard
        title={t("settings.account.signInRequiredTitle")}
        subtitle={t("settings.account.signInRequiredSubtitle")}
      >
        <p className="surface-card-subtitle">
          {isLocalFallback
            ? t("settings.account.localFallbackHelp")
            : t("settings.account.noSession")}
        </p>
      </SurfaceCard>
    );
  }

  const dirty = (fullName.trim() || null) !== (initialFullName.trim() || null);
  const initials = initialsFor(fullName.trim() || user.email || "?");

  const upsertProfile = async (updates: { avatarUrl?: string | null; fullName?: string | null }) => {
    if (!window.bukowskiApp?.upsertUserProfile) {
      throw new Error("The secure profile update bridge is unavailable.");
    }

    await window.bukowskiApp.upsertUserProfile(updates);
  };

  const handleSave = async () => {
    if (!supabase) {
      toast.error(
        t("settings.account.toasts.cannotSave"),
        t("settings.account.toasts.supabaseUnavailable"),
      );
      return;
    }

    setIsSaving(true);
    try {
      await updateUserMetadata({ full_name: fullName.trim() });
      await upsertProfile({ fullName: fullName.trim() || null });
      await refreshUser();
      toast.success(
        t("settings.account.toasts.accountSaved"),
        t("settings.account.toasts.nameAppears"),
      );
    } catch (error) {
      toast.error(
        t("common.couldNotSave"),
        getUserFacingErrorMessage(error, t("settings.account.toasts.couldNotSaveBody")),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleAvatarFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !supabase) return;

    if (file.size > 2 * 1024 * 1024) {
      toast.error(
        t("settings.account.toasts.fileTooLargeTitle"),
        t("settings.account.toasts.fileTooLargeBody"),
      );
      return;
    }
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      toast.error(
        t("settings.account.toasts.unsupportedFormatTitle"),
        t("settings.account.toasts.unsupportedFormatBody"),
      );
      return;
    }

    setIsUploadingAvatar(true);
    try {
      if (!window.bukowskiApp?.uploadUserAvatar) {
        throw new Error("The secure avatar upload bridge is unavailable.");
      }

      const { publicUrl: avatarUrl } = await window.bukowskiApp.uploadUserAvatar({
        fileName: file.name,
        contentType: file.type,
        bytes: await file.arrayBuffer(),
      });

      await updateUserMetadata({ avatar_url: avatarUrl });
      await upsertProfile({ avatarUrl });

      await refreshUser();
      toast.success(
        t("settings.account.toasts.avatarUpdatedTitle"),
        t("settings.account.toasts.avatarUpdatedBody"),
      );
    } catch (error) {
      toast.error(
        t("settings.account.toasts.uploadFailedTitle"),
        getUserFacingErrorMessage(error, t("settings.account.toasts.uploadFailedBody")),
      );
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const handleRemoveAvatar = async () => {
    if (!supabase) return;
    setIsUploadingAvatar(true);
    try {
      await updateUserMetadata({ avatar_url: null });
      await upsertProfile({ avatarUrl: null });
      if (user?.id) {
        clearCachedAvatar(user.id);
      }
      await refreshUser();
      toast.success(
        t("settings.account.toasts.avatarRemovedTitle"),
        t("settings.account.toasts.avatarRemovedBody"),
      );
    } catch (error) {
      toast.error(
        t("settings.account.toasts.couldNotRemove"),
        getUserFacingErrorMessage(error, t("settings.account.toasts.couldNotSaveBody")),
      );
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const passwordMeetsPolicy = isPasswordPolicySatisfied(newPassword);
  const passwordsMismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;
  const canUpdatePassword =
    passwordMeetsPolicy &&
    newPassword === confirmPassword &&
    currentPassword.length > 0 &&
    (!reauthRequired || reauthCode.trim().length > 0) &&
    !isUpdatingPassword;

  const handleSendReauthCode = async () => {
    if (!supabase || isSendingReauthCode) {
      return;
    }

    setIsSendingReauthCode(true);
    try {
      const { error } = await supabase.auth.reauthenticate();
      if (error) {
        throw error;
      }
      setReauthRequired(true);
      toast.success(
        t("settings.account.security.reauthSentTitle"),
        t("settings.account.security.reauthSentBody"),
      );
    } catch (error) {
      toast.error(
        t("settings.account.security.reauthFailedTitle"),
        getUserFacingErrorMessage(error, t("settings.account.toasts.couldNotSaveBody")),
      );
    } finally {
      setIsSendingReauthCode(false);
    }
  };

  const handleUpdatePassword = async () => {
    if (!supabase || !canUpdatePassword) {
      return;
    }
    setIsUpdatingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
        current_password: currentPassword,
        ...(reauthCode.trim() ? { nonce: reauthCode.trim() } : {}),
      });
      if (error) {
        throw error;
      }
      setNewPassword("");
      setConfirmPassword("");
      setCurrentPassword("");
      setReauthCode("");
      setReauthRequired(false);
      toast.success(
        t("settings.account.security.updatedTitle"),
        t("settings.account.security.updatedBody"),
      );
    } catch (error) {
      if (isReauthenticationRequiredError(error)) {
        setReauthRequired(true);
        await handleSendReauthCode();
        return;
      }
      toast.error(
        t("settings.account.security.failedTitle"),
        getUserFacingErrorMessage(error, t("settings.account.toasts.couldNotSaveBody")),
      );
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await signOut();
      toast.success(
        t("settings.account.toasts.signedOutTitle"),
        t("settings.account.toasts.signedOutBody"),
      );
    } catch (error) {
      toast.error(
        t("settings.account.toasts.signOutFailed"),
        getUserFacingErrorMessage(error, t("settings.account.toasts.couldNotSaveBody")),
      );
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <div className="page-stack">
      {showHeader ? (
        <SectionHeader title={t("settings.account.title")} />
      ) : null}

      <SurfaceCard title={t("settings.account.profile")}>
        <div className="user-account-row">
          <button
            aria-label={t("settings.account.changeAvatar")}
            className="user-account-avatar-button"
            disabled={isUploadingAvatar}
            onClick={() => avatarInputRef.current?.click()}
            type="button"
          >
            {user.avatarUrl && !avatarLoadFailed ? (
              <img
                alt={fullName || user.email || t("settings.account.changeAvatar")}
                className="user-account-avatar-image"
                onError={() => setAvatarLoadFailed(true)}
                src={user.avatarUrl}
              />
            ) : (
              <span className="user-account-avatar" aria-hidden="true">{initials}</span>
            )}
            <span className="user-account-avatar-overlay">
              <Camera size={16} />
            </span>
          </button>
          <input
            accept="image/png,image/jpeg,image/webp"
            className="user-account-avatar-input"
            onChange={(event) => void handleAvatarFile(event)}
            ref={avatarInputRef}
            type="file"
          />
          <div className="user-account-copy">
            <strong>{fullName.trim() || user.email || t("settings.account.setYourName")}</strong>
            <small>{user.email}</small>
            <span className="user-account-membership">
              {activeMembership?.roleName ?? t("settings.account.member")} · {activeWorkspaceName}
            </span>
            {user.avatarUrl ? (
              <button
                className="user-account-avatar-remove"
                disabled={isUploadingAvatar}
                onClick={() => void handleRemoveAvatar()}
                type="button"
              >
                <Trash2 size={11} />
                <span>{t("settings.account.removePhoto")}</span>
              </button>
            ) : null}
          </div>
        </div>

        <div className="agent-form-grid">
          <label className="field-block field-block-span-2">
            <span className="field-label">{t("settings.account.fullNameLabel")}</span>
            <input
              className="field-input"
              onChange={(event) => setFullName(event.target.value)}
              placeholder={t("settings.account.fullNamePlaceholder")}
              value={fullName}
            />
          </label>
          <label className="field-block field-block-span-2">
            <span className="field-label">{t("settings.account.emailLabel")}</span>
            <input className="field-input" value={user.email ?? ""} readOnly disabled />
          </label>
        </div>

        <div className="surface-card-actions" style={{ justifyContent: "flex-end" }}>
          <button
            className="action-primary-button"
            disabled={!dirty || isSaving}
            onClick={() => void handleSave()}
            type="button"
          >
            <Save size={13} />
            <span>{isSaving ? t("common.saving") : t("settings.account.saveProfile")}</span>
          </button>
        </div>

        <p className="surface-card-subtitle" style={{ marginTop: 8, fontSize: "var(--font-2xs)", color: "var(--text-muted)" }}>
          {t("settings.account.avatarHelper")}
        </p>
      </SurfaceCard>

      <SurfaceCard title={t("settings.account.accessTitle")}>
        <div className="summary-grid compact-summary-grid">
          <div className="summary-row">
            <span className="summary-label">{t("settings.account.signedInAs")}</span>
            <span className="summary-value">{user.email}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">{t("settings.account.activeWorkspace")}</span>
            <span className="summary-value">{activeWorkspaceName}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">{t("settings.account.role")}</span>
            <span className="summary-value">{activeMembership?.roleName ?? t("settings.account.member")}</span>
          </div>
        </div>

        {supabase && !isLocalFallback ? (
          <details className="detail-disclosure">
            <summary className="detail-disclosure-summary">{t("settings.account.security.changePassword")}</summary>
            <div className="detail-disclosure-content">
              <div className="agent-form-grid">
                <label className="field-block field-block-span-2">
                  <span className="field-label">{t("settings.account.security.currentPassword")}</span>
                  <input
                    autoComplete="current-password"
                    className="field-input"
                    onChange={(event) => setCurrentPassword(event.target.value)}
                    type="password"
                    value={currentPassword}
                  />
                  <span className="field-helper">{t("settings.account.security.currentPasswordHelp")}</span>
                </label>
                <label className="field-block">
                  <span className="field-label">{t("settings.account.security.newPassword")}</span>
                  <input
                    autoComplete="new-password"
                    className="field-input"
                    onChange={(event) => setNewPassword(event.target.value)}
                    type="password"
                    value={newPassword}
                  />
                </label>
                <label className="field-block">
                  <span className="field-label">{t("settings.account.security.confirmPassword")}</span>
                  <input
                    autoComplete="new-password"
                    className="field-input"
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    type="password"
                    value={confirmPassword}
                  />
                </label>
              </div>
              <PasswordRequirementList password={newPassword} compact />
              {passwordsMismatch ? (
                <p className="surface-card-subtitle">{t("settings.account.security.mismatch")}</p>
              ) : null}
              <div className={`password-reauth-card${reauthRequired ? " is-required" : ""}`}>
                <div className="password-reauth-card-copy">
                  <ShieldCheck size={15} />
                  <div>
                    <strong>{t("settings.account.security.secureChangeTitle")}</strong>
                    <span>{t("settings.account.security.secureChangeBody")}</span>
                  </div>
                </div>
                {reauthRequired ? (
                  <label className="field-block">
                    <span className="field-label">{t("settings.account.security.reauthCode")}</span>
                    <input
                      autoComplete="one-time-code"
                      className="field-input"
                      inputMode="numeric"
                      onChange={(event) => setReauthCode(event.target.value)}
                      placeholder={t("settings.account.security.reauthCodePlaceholder")}
                      value={reauthCode}
                    />
                  </label>
                ) : null}
                <button
                  className="ghost-control action-row-button"
                  disabled={isSendingReauthCode}
                  onClick={() => void handleSendReauthCode()}
                  type="button"
                >
                  <KeyRound size={13} />
                  <span>
                    {isSendingReauthCode
                      ? t("settings.account.security.sendingReauth")
                      : reauthRequired
                        ? t("settings.account.security.resendReauth")
                        : t("settings.account.security.sendReauth")}
                  </span>
                </button>
              </div>
              <div className="surface-card-actions" style={{ justifyContent: "flex-end" }}>
                <button
                  className="action-primary-button"
                  disabled={!canUpdatePassword}
                  onClick={() => void handleUpdatePassword()}
                  type="button"
                >
                  {isUpdatingPassword ? t("settings.account.security.updating") : t("settings.account.security.update")}
                </button>
              </div>
            </div>
          </details>
        ) : null}

        <div className="surface-card-actions" style={{ justifyContent: "flex-end" }}>
          <button
            className="ghost-control is-danger"
            disabled={isSigningOut}
            onClick={() => void handleSignOut()}
            type="button"
          >
            <LogOut size={13} />
            <span>{isSigningOut ? t("settings.account.signingOut") : t("settings.account.signOut")}</span>
          </button>
        </div>
      </SurfaceCard>
    </div>
  );
};
