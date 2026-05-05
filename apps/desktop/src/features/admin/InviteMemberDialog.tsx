import { useEffect, useMemo, useState } from "react";
import { Check, Send, X } from "lucide-react";

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
    return { tone: "duplicate-member", message: "That email is already a member of this workspace." };
  }
  if (pendingEmails.some((email) => email.toLowerCase() === value)) {
    return { tone: "duplicate-invite", message: "An invite is already pending for that email." };
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
    emailStatus.tone === "valid" && Boolean(roleId) && !isSending && !isLocalFallback;

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
      await sendWorkspaceInvite(supabase, {
        workspaceId: activeWorkspaceId,
        email,
        roleId,
        message: message || null,
      });
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
      <div className="confirm-dialog" style={{ width: "min(480px, 100%)" }}>
        <div className="confirm-dialog-header">
          <span className="confirm-dialog-icon">
            <Send size={16} />
          </span>
          <div className="confirm-dialog-copy">
            <strong>Invite a teammate</strong>
            <p>They will get an email with a magic link that lands them inside this workspace.</p>
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

        <div className="agent-form-grid">
          <label className="field-block">
            <span className="field-label">Email</span>
            <input
              autoFocus
              className={`field-input${emailStatus.tone !== "idle" && emailStatus.tone !== "valid" ? " is-invalid" : ""}`}
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
              <span className="field-hint field-hint-warning">{emailStatus.message}</span>
            ) : null}
            {emailStatus.tone === "duplicate-invite" ? (
              <span className="field-hint field-hint-warning">{emailStatus.message}</span>
            ) : null}
          </label>

          <label className="field-block">
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

          <label className="field-block">
            <span className="field-label">Optional note</span>
            <textarea
              className="field-input"
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

        <div className="confirm-dialog-actions">
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
                <Check size={14} /> <span>Invite sent</span>
              </>
            ) : isSending ? (
              "Sending…"
            ) : (
              "Send invite"
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
