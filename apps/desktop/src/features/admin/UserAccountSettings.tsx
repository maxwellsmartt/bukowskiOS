import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Camera, LogOut, Save, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useSession } from "@app/providers/SessionProvider";
import { useToast } from "@app/providers/ToastProvider";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { SectionHeader } from "@shared/components/SectionHeader";
import { SurfaceCard } from "@shared/components/SurfaceCard";
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
    if (!supabase) {
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const looseSupabase = supabase as any;
    const payload: Record<string, string | null> = {
      user_id: user.id,
      email: user.email,
      updated_at: new Date().toISOString(),
    };

    if ("avatarUrl" in updates) {
      payload.avatar_url = updates.avatarUrl ?? null;
    }

    if ("fullName" in updates) {
      payload.full_name = updates.fullName ?? null;
    }

    const { error } = await looseSupabase.from("user_profiles").upsert(payload, {
      onConflict: "user_id",
      ignoreDuplicates: false,
    });

    if (error) {
      throw error;
    }
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
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const path = `${user.id}/avatar-${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("user-avatars")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage.from("user-avatars").getPublicUrl(path);
      const avatarUrl = publicUrlData.publicUrl;

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
