import { useEffect, useState } from "react";
import { Send, X } from "lucide-react";

import type { AppUserRoleRow } from "@contracts";
import { useSession } from "@app/providers/SessionProvider";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { getUserFacingErrorMessage } from "@shared/lib/errors";

import { sendWorkspaceInvite } from "./inviteService";

type InviteMemberDialogProps = {
  isOpen: boolean;
  roles: AppUserRoleRow[];
  onClose: () => void;
  onSent: (email: string) => void | Promise<void>;
};

const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

export const InviteMemberDialog = ({ isOpen, roles, onClose, onSent }: InviteMemberDialogProps) => {
  const { supabase, isLocalFallback } = useSession();
  const { activeWorkspaceId } = useWorkspace();
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setEmail("");
    setMessage("");
    setError(null);
    setIsSending(false);

    const adminRole = roles.find((role) => role.key === "admin");
    setRoleId(adminRole?.id ?? roles[0]?.id ?? "");
  }, [isOpen, roles]);

  if (!isOpen) {
    return null;
  }

  const canSubmit = isValidEmail(email) && Boolean(roleId) && !isSending && !isLocalFallback;

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
      await onSent(email.trim());
      onClose();
    } catch (nextError) {
      setError(getUserFacingErrorMessage(nextError, "Could not send the invite."));
    } finally {
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
            <p>They will get an email with a link that lands them inside this workspace.</p>
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
              className="field-input"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="teammate@studio.com"
              type="email"
              value={email}
            />
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
          <button className="ghost-control cancel-control" disabled={isSending} onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="action-primary-button"
            disabled={!canSubmit}
            onClick={() => void handleSubmit()}
            type="button"
          >
            {isSending ? "Sending..." : "Send invite"}
          </button>
        </div>
      </div>
    </div>
  );
};
