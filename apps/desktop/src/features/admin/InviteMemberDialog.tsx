import { useEffect, useMemo, useState } from "react";
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

const roleHintMap: Record<string, string> = {
  admin: "Full control: members, roles, invites, billing, settings.",
  supervisor: "Operational lead: projects, assets, packing, incidents and RMAs.",
  crew: "Daily crew: assigned gear, packing context, report incidents.",
  finance_viewer: "Finance visibility without edit access.",
  maintenance: "Repair and RMA access for damaged equipment follow-up.",
};

type EmailStatus =
  | { tone: "idle" }
  | { tone: "invalid"; message: string }
  | { tone: "duplicate-member"; message: string }
  | { tone: "duplicate-invite"; message: string }
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
    return { tone: "invalid", message: "That doesn't look like a valid email address." };
  }
  if (existingEmails.some((email) => email.toLowerCase() === value)) {
    return { tone: "duplicate-member", message: "This teammate already has access. You can update their role from here." };
  }
  if (pendingEmails.some((email) => email.toLowerCase() === value)) {
    return { tone: "duplicate-invite", message: "An invite is already pending. You can resend it or adjust the role." };
  }
  return { tone: "valid" };
};

const submitCopyForStatus = (status: EmailStatus["tone"]) => {
  if (status === "duplicate-member") {
    return "Update access";
  }

  if (status === "duplicate-invite") {
    return "Resend invite";
  }

  return "Send invite";
};

export const InviteMemberDialog = ({
  isOpen,
  roles,
  existingEmails = [],
  pendingInviteEmails = [],
  onClose,
  onSent,
}: InviteMemberDialogProps) => {
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
  const roleHint = selectedRole ? roleHintMap[selectedRole.key] ?? selectedRole.description : null;

  if (!isOpen) {
    return null;
  }

  const canSubmit =
    (emailStatus.tone === "valid" || emailStatus.tone === "duplicate-member" || emailStatus.tone === "duplicate-invite") &&
    Boolean(roleId) &&
    !isSending &&
    !isLocalFallback;

  const handleSubmit = async () => {
    if (!supabase) {
      setError("Workspace invites require a connected Supabase session.");
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
        setError(`Access was updated, but the magic link could not be sent: ${result.warning}`);
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
      setError(getUserFacingErrorMessage(nextError, "Could not send the invite."));
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
            <strong>Invite or grant access</strong>
            <p>Add a teammate to this workspace, resend a pending invite, or update access for someone already registered.</p>
          </div>
          <button
            aria-label="Close invite dialog"
            className="surface-card-action"
            onClick={onClose}
            type="button"
            style={{ marginLeft: "auto" }}
          >
            <X size={14} />
          </button>
        </div>

        <div className="invite-member-grid">
          <label className="field-block invite-member-email">
            <span className="field-label">Email</span>
            <input
              autoFocus
              className={`field-input invite-member-input${emailStatus.tone === "invalid" ? " is-invalid" : ""}`}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="teammate@studio.com"
              type="email"
              value={email}
            />
            {emailStatus.tone === "valid" ? (
              <span className="field-hint field-hint-success">
                <Check size={11} /> Looks good — ready to send.
              </span>
            ) : null}
            {emailStatus.tone === "invalid" ? (
              <span className="field-hint field-hint-error">{emailStatus.message}</span>
            ) : null}
            {emailStatus.tone === "duplicate-member" ? (
              <span className="field-hint field-hint-info">
                <RefreshCw size={11} /> {emailStatus.message}
              </span>
            ) : null}
            {emailStatus.tone === "duplicate-invite" ? (
              <span className="field-hint field-hint-warning">
                <RefreshCw size={11} /> {emailStatus.message}
              </span>
            ) : null}
          </label>

          <label className="field-block invite-member-role">
            <span className="field-label">Role</span>
            <select
              className="field-input"
              onChange={(event) => setRoleId(event.target.value)}
              value={roleId}
            >
              <option value="">Select a role</option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
            {roleHint ? <span className="field-hint">{roleHint}</span> : null}
          </label>

          <label className="field-block invite-member-note">
            <span className="field-label">Optional note</span>
            <textarea
              className="field-input invite-member-textarea"
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Add a short message they will see in the email."
              rows={3}
              value={message}
            />
          </label>
        </div>

        {isLocalFallback ? (
          <div className="action-feedback action-feedback-warning">
            Invites are only available when connected to Supabase. You are currently in local fallback mode.
          </div>
        ) : null}

        {error ? <div className="action-feedback action-feedback-error">{error}</div> : null}

        <div className="confirm-dialog-actions invite-member-actions">
          <button className="ghost-control cancel-control" disabled={isSending || justSent} onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="action-primary-button"
            disabled={!canSubmit && !justSent}
            onClick={() => void handleSubmit()}
            type="button"
          >
            {justSent ? (
              <>
                <Check size={14} /> <span>Access updated</span>
              </>
            ) : isSending ? (
              "Working…"
            ) : (
              <>
                <Send size={14} />
                <span>{submitCopyForStatus(emailStatus.tone)}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
