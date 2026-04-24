import { KeyRound } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useSession } from "@app/providers/SessionProvider";

export const ResetPasswordScreen = () => {
  const navigate = useNavigate();
  const { authError, isPasswordRecovery, updatePassword } = useSession();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const mismatch = confirmPassword.length > 0 && password !== confirmPassword;

  return (
    <div className="auth-screen">
      <section className="auth-panel" aria-labelledby="reset-password-title">
        <p className="auth-eyebrow">Password reset</p>
        <h1 id="reset-password-title">Set a new password</h1>
        <form
          className="auth-form"
          onSubmit={(event) => {
            event.preventDefault();

            if (password.length < 8) {
              setStatus("Use at least 8 characters for the new password.");
              return;
            }

            if (password !== confirmPassword) {
              setStatus("Passwords do not match.");
              return;
            }

            setIsSubmitting(true);
            setStatus(null);
            void updatePassword(password)
              .then(() => {
                setStatus("Password updated. You can sign in with the new password now.");
                navigate("/workspaces/select", { replace: true });
              })
              .catch((error: unknown) => {
                setStatus(error instanceof Error ? error.message : "Could not update the password.");
              })
              .finally(() => setIsSubmitting(false));
          }}
        >
          {!isPasswordRecovery ? (
            <p className="auth-status">Open the recovery link from your email first, then return here to set the new password.</p>
          ) : null}
          <label className="auth-field">
            <span>New password</span>
            <input
              autoComplete="new-password"
              className="text-input"
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
          <label className="auth-field">
            <span>Confirm password</span>
            <input
              autoComplete="new-password"
              className="text-input"
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
              type="password"
              value={confirmPassword}
            />
          </label>
          <button className="auth-primary-button" disabled={isSubmitting || mismatch || !isPasswordRecovery} type="submit">
            <KeyRound size={16} />
            <span>{isSubmitting ? "Updating..." : "Update password"}</span>
          </button>
        </form>
        {status || authError ? <p className="auth-status">{status ?? authError}</p> : null}
        <Link className="auth-back-link" to="/login">Back to sign in</Link>
      </section>
    </div>
  );
};
