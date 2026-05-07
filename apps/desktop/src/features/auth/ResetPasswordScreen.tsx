import { KeyRound } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { useSession } from "@app/providers/SessionProvider";
import brandLogoWhite1x from "@shared/assets/inbox/logos/bukowskiOS_logo_white.png";
import brandLogoWhite from "@shared/assets/logos/bukowskiOS_logo_white@2x.png";
import { getUserFacingErrorMessage } from "@shared/lib/errors";

export const ResetPasswordScreen = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { authError, isPasswordRecovery, updatePassword } = useSession();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const mismatch = confirmPassword.length > 0 && password !== confirmPassword;
  const isFirstLogin = searchParams.get("mode") === "first-login";

  return (
    <div className="auth-screen">
      <div className="auth-lockup" aria-hidden="true">
        <img src={brandLogoWhite1x} srcSet={`${brandLogoWhite1x} 1x, ${brandLogoWhite} 2x`} alt="" />
      </div>
      <section className="auth-panel" aria-labelledby="reset-password-title">
        <p className="auth-eyebrow">{isFirstLogin ? "First login" : "Password reset"}</p>
        <h1 id="reset-password-title">{isFirstLogin ? "Create your password" : "Set a new password"}</h1>
        <p className="auth-lede">
          {isFirstLogin
            ? "Add a password so you can sign in quickly next time. You can still use magic links whenever needed."
            : "Choose a new password for your bukowskiOS account."}
        </p>
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
                setStatus("Password updated. Opening your workspaces…");
                navigate("/workspaces/select", { replace: true });
              })
              .catch((error: unknown) => {
                setStatus(getUserFacingErrorMessage(error, "Could not update the password."));
              })
              .finally(() => setIsSubmitting(false));
          }}
        >
          {!isPasswordRecovery ? (
            <p className="auth-status">Open the secure email link first, then return here to set the password.</p>
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
