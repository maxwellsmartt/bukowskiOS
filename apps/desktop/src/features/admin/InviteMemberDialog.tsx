import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, RefreshCw, Send, UserRoundPlus, X } from "lucide-react";

import type { AppUserRoleRow } from "@contracts";
import { useSession } from "@app/providers/SessionProvider";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { getUserFacingErrorMessage } from "@shared/lib/errors";

import { sendWorkspaceInvite } from "./inviteService";

type InviteMemberDialogProps = {
  isOpen: boolean;
  roles: AppUserRoleRow[];
  existingEmails?: string[];
  pendingInviteEmails?: string[];
  onClose: () => void;
  onSent: (email: string) => void | Promise<void>;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isValidEmail = (value: string) => emailPattern.test(value.trim());

const ROLE_HINT_KEYS: Record<string, string> = {
  admin: "settings.workspace.inviteDialog.roleHints.admin",
  supervisor: "settings.workspace.inviteDialog.roleHints.supervisor",
  crew: "settings.workspace.inviteDialog.roleHints.crew",
  finance_viewer: "settings.workspace.inviteDialog.roleHints.finance_viewer",
  maintenance: "settings.workspace.inviteDialog.roleHints.maintenance",
};

type EmailStatus =
  | { tone: "idle" }
  | { tone: "invalid" }
  | { tone: "duplicate-member" }
  | { tone: "duplicate-invite" }
  | { tone: "valid" };

const resolveEmailStatus = (
  rawValue: string,
  existingEmails: string[],
  pendingEmails: string[],
): EmailStatus => {
  const value = rawValue.trim().toLowerCase();
  if (!value) {
    return { tone: "idle" };
  }
  if (!isValidEmail(value)) {
    return { tone: "invalid" };
  }
  if (existingEmails.some((email) => email.toLowerCase() === value)) {
    return { tone: "duplicate-member" };
  }
  if (pendingEmails.some((email) => email.toLowerCase() === value)) {
    return { tone: "duplicate-invite" };
  }
  return { tone: "valid" };
};

export const InviteMemberDialog = ({
  isOpen,
  roles,
  existingEmails = [],
  pendingInviteEmails = [],
  onClose,
  onSent,
}: InviteMemberDialogProps) => {
  const { t } = useTranslation();
  const { supabase, isLocalFallback } = useSession();
  const { activeWorkspaceId } = useWorkspace();
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [justSent, setJustSent] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setEmail("");
    setMessage("");
    setError(null);
    setIsSending(false);
    setJustSent(false);

    const crewRole = roles.find((role) => role.key === "crew");
    setRoleId(crewRole?.id ?? roles[0]?.id ?? "");
  }, [isOpen, roles]);

  const emailStatus = useMemo(
    () => resolveEmailStatus(email, existingEmails, pendingInviteEmails),
    [email, existingEmails, pendingInviteEmails],
  );

  const selectedRole = useMemo(() => roles.find((role) => role.id === roleId) ?? null, [roleId, roles]);
  const roleHint = selectedRole
    ? ROLE_HINT_KEYS[selectedRole.key]
      ? t(ROLE_HINT_KEYS[selectedRole.key]!)
      : selectedRole.description
    : null;

  if (!isOpen) {
    return null;
  }

  const submitCopy = (() => {
    if (justSent) return t("settings.workspace.inviteDialog.submit.done");
    if (isSending) return t("settings.workspace.inviteDialog.submit.working");
    if (emailStatus.tone === "duplicate-member") return t("settings.workspace.inviteDialog.submit.update");
    if (emailStatus.tone === "duplicate-invite") return t("settings.workspace.inviteDialog.submit.resend");
    return t("settings.workspace.inviteDialog.submit.send");
  })();

  const canSubmit =
    (emailStatus.tone === "valid" || emailStatus.tone === "duplicate-member" || emailStatus.tone === "duplicate-invite") &&
    Boolean(roleId) &&
    !isSending &&
    !isLocalFallback;

  const handleSubmit = async () => {
    if (!supabase) {
      setError(t("settings.workspace.inviteDialog.supabaseRequired"));
      return;
    }

    if (!canSubmit) {
      return;
    }

    setIsSending(true);
    setError(null);

    try {
      const result = await sendWorkspaceInvite(supabase, {
        workspaceId: activeWorkspaceId,
        email,
        roleId,
        message: message || null,
      });

      if (result.warning) {
        setError(t("settings.workspace.inviteDialog.magicLinkWarning", { warning: result.warning }));
        setIsSending(false);
        await onSent(email.trim());
        return;
      }

      setJustSent(true);
      await onSent(email.trim());
      // Brief success confirmation before closing.
      setTimeout(() => {
        onClose();
      }, 700);
    } catch (nextError) {
      setError(getUserFacingErrorMessage(nextError, t("settings.workspace.inviteDialog.couldNotSend")));
      setIsSending(false);
    }
  };

  return (
    <div aria-modal="true" className="confirm-dialog-backdrop" role="dialog">
      <div className="confirm-dialog invite-member-dialog">
        <div className="confirm-dialog-header invite-member-dialog-header">
          <span className="confirm-dialog-icon invite-member-dialog-icon">
            <UserRoundPlus size={16} />
          </span>
          <div className="confirm-dialog-copy">
            <strong>{t("settings.workspace.inviteDialog.title")}</strong>
            <p>{t("settings.workspace.inviteDialog.subtitle")}</p>
          </div>
          <button
            aria-label={t("settings.workspace.inviteDialog.close")}
            className="icon-ghost-control"
            onClick={onClose}
            type="button"
            style={{ marginLeft: "auto" }}
          >
            <X size={14} />
          </button>
        </div>

        <div className="invite-member-grid">
          <label className="field-block invite-member-email">
            <span className="field-label">{t("settings.workspace.inviteDialog.emailLabel")}</span>
            <input
              autoFocus
              className={`field-input invite-member-input${emailStatus.tone === "invalid" ? " is-invalid" : ""}`}
              onChange={(event) => setEmail(event.target.value)}
              placeholder={t("settings.workspace.inviteDialog.emailPlaceholder")}
              type="email"
              value={email}
            />
            {emailStatus.tone === "valid" ? (
              <span className="field-hint field-hint-success">
                <Check size={11} /> {t("settings.workspace.inviteDialog.emailValid")}
              </span>
            ) : null}
            {emailStatus.tone === "invalid" ? (
              <span className="field-hint field-hint-error">
                {t("settings.workspace.inviteDialog.emailInvalid")}
              </span>
            ) : null}
            {emailStatus.tone === "duplicate-member" ? (
              <span className="field-hint field-hint-info">
                <RefreshCw size={11} /> {t("settings.workspace.inviteDialog.duplicateMember")}
              </span>
            ) : null}
            {emailStatus.tone === "duplicate-invite" ? (
              <span className="field-hint field-hint-warning">
                <RefreshCw size={11} /> {t("settings.workspace.inviteDialog.duplicateInvite")}
              </span>
            ) : null}
          </label>

          <label className="field-block invite-member-role">
            <span className="field-label">{t("settings.workspace.inviteDialog.roleLabel")}</span>
            <select
              className="field-input"
              onChange={(event) => setRoleId(event.target.value)}
              value={roleId}
            >
              <option value="">{t("settings.workspace.inviteDialog.rolePlaceholder")}</option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
            {roleHint ? <span className="field-hint">{roleHint}</span> : null}
          </label>

          <label className="field-block invite-member-note">
            <span className="field-label">{t("settings.workspace.inviteDialog.noteLabel")}</span>
            <textarea
              className="field-input invite-member-textarea"
              onChange={(event) => setMessage(event.target.value)}
              placeholder={t("settings.workspace.inviteDialog.notePlaceholder")}
              rows={3}
              value={message}
            />
          </label>
        </div>

        {isLocalFallback ? (
          <div className="action-feedback action-feedback-warning">
            {t("settings.workspace.inviteDialog.localFallback")}
          </div>
        ) : null}

        {error ? <div className="action-feedback action-feedback-error">{error}</div> : null}

        <div className="confirm-dialog-actions invite-member-actions">
          <button className="ghost-control cancel-control" disabled={isSending || justSent} onClick={onClose} type="button">
            {t("common.cancel")}
          </button>
          <button
            className="action-primary-button"
            disabled={!canSubmit && !justSent}
            onClick={() => void handleSubmit()}
            type="button"
          >
            {justSent ? (
              <>
                <Check size={14} /> <span>{submitCopy}</span>
              </>
            ) : isSending ? (
              submitCopy
            ) : (
              <>
                <Send size={14} />
                <span>{submitCopy}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
