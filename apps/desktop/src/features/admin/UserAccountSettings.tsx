import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Camera, LogOut, Save, Trash2 } from "lucide-react";

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
  const toast = useToast();
  const { user, status, supabase, isLocalFallback, signOut, refreshUser } = useSession();
  const { activeMembership, activeWorkspaceName } = useWorkspace();

  const initialFullName = useMemo(() => {
    if (!user) return "";
    return user.displayName === user.email ? "" : user.displayName;
  }, [user]);

  const [fullName, setFullName] = useState(initialFullName);
  const [isSaving, setIsSaving] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setFullName(initialFullName);
  }, [initialFullName]);

  if (status !== "authenticated" || !user) {
    return (
      <SurfaceCard title="Your account" subtitle="Sign in to manage your profile.">
        <p className="surface-card-subtitle">
          {isLocalFallback
            ? "You are running in local fallback. Connect to Supabase to manage your account."
            : "No active session detected."}
        </p>
      </SurfaceCard>
    );
  }

  const dirty = (fullName.trim() || null) !== (initialFullName.trim() || null);
  const initials = initialsFor(fullName.trim() || user.email || "?");

  const handleSave = async () => {
    if (!supabase) {
      toast.error("Cannot save", "Supabase is not configured for this device.");
      return;
    }

    setIsSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({
        data: {
          full_name: fullName.trim(),
        },
      });
      if (error) throw error;
      await refreshUser();
      toast.success("Account saved", "Your name now appears across the app.");
    } catch (error) {
      toast.error("Could not save", getUserFacingErrorMessage(error, "Try again in a moment."));
    } finally {
      setIsSaving(false);
    }
  };

  const handleAvatarFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !supabase) return;

    if (file.size > 2 * 1024 * 1024) {
      toast.error("File too large", "Pick an image under 2 MB.");
      return;
    }
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      toast.error("Unsupported format", "PNG, JPEG or WebP only.");
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

      const { error: updateError } = await supabase.auth.updateUser({
        data: { avatar_url: avatarUrl },
      });
      if (updateError) throw updateError;

      await refreshUser();
      toast.success("Avatar updated", "Your photo now appears across the app.");
    } catch (error) {
      toast.error("Upload failed", getUserFacingErrorMessage(error, "Try again with a smaller file."));
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const handleRemoveAvatar = async () => {
    if (!supabase) return;
    setIsUploadingAvatar(true);
    try {
      const { error } = await supabase.auth.updateUser({ data: { avatar_url: null } });
      if (error) throw error;
      await refreshUser();
      toast.success("Avatar removed", "Your initials are back.");
    } catch (error) {
      toast.error("Could not remove", getUserFacingErrorMessage(error, "Try again in a moment."));
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await signOut();
      toast.success("Signed out", "See you soon.");
    } catch (error) {
      toast.error("Sign out failed", getUserFacingErrorMessage(error, "Try again in a moment."));
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <div className="page-stack">
      {showHeader ? (
        <SectionHeader
          eyebrow="Account"
          title="Your account"
        />
      ) : null}

      <SurfaceCard title="Profile">
        <div className="user-account-row">
          <button
            aria-label="Change avatar"
            className="user-account-avatar-button"
            disabled={isUploadingAvatar}
            onClick={() => avatarInputRef.current?.click()}
            type="button"
          >
            {user.avatarUrl ? (
              <img alt={fullName || user.email || "Avatar"} className="user-account-avatar-image" src={user.avatarUrl} />
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
            <strong>{fullName.trim() || user.email || "Set your name"}</strong>
            <small>{user.email}</small>
            <span className="user-account-membership">
              {activeMembership?.roleName ?? "Member"} · {activeWorkspaceName}
            </span>
            {user.avatarUrl ? (
              <button
                className="user-account-avatar-remove"
                disabled={isUploadingAvatar}
                onClick={() => void handleRemoveAvatar()}
                type="button"
              >
                <Trash2 size={11} />
                <span>Remove photo</span>
              </button>
            ) : null}
          </div>
        </div>

        <div className="agent-form-grid">
          <label className="field-block field-block-span-2">
            <span className="field-label">Full name</span>
            <input
              className="field-input"
              onChange={(event) => setFullName(event.target.value)}
              placeholder="Your display name"
              value={fullName}
            />
          </label>
          <label className="field-block field-block-span-2">
            <span className="field-label">Email</span>
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
            <span>{isSaving ? "Saving…" : "Save profile"}</span>
          </button>
        </div>

        <p className="surface-card-subtitle" style={{ marginTop: 8, fontSize: "var(--font-2xs)", color: "var(--text-muted)" }}>
          Click your avatar to upload a photo. PNG, JPEG or WebP, up to 2 MB.
        </p>
      </SurfaceCard>

      <SurfaceCard title="Access">
        <div className="summary-grid compact-summary-grid">
          <div className="summary-row">
            <span className="summary-label">Signed in as</span>
            <span className="summary-value">{user.email}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">Active workspace</span>
            <span className="summary-value">{activeWorkspaceName}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">Role</span>
            <span className="summary-value">{activeMembership?.roleName ?? "Member"}</span>
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
            <span>{isSigningOut ? "Signing out…" : "Sign out"}</span>
          </button>
        </div>
      </SurfaceCard>
    </div>
  );
};
