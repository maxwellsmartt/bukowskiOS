import { Mail } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { useSession } from "@app/providers/SessionProvider";

export const PasswordResetScreen = () => {
  const { requestPasswordReset } = useSession();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  return (
    <div className="auth-screen">
      <section className="auth-panel" aria-labelledby="recovery-title">
        <p className="auth-eyebrow">Account recovery</p>
        <h1 id="recovery-title">Recover access</h1>
        <form
          className="auth-form"
          onSubmit={(event) => {
            event.preventDefault();
            setIsSubmitting(true);
            setStatus(null);
            void requestPasswordReset(email)
              .then(() => setStatus("Recovery email sent. Open the link in your email to set a new password."))
              .catch((error: unknown) => setStatus(error instanceof Error ? error.message : "Could not send recovery link."))
              .finally(() => setIsSubmitting(false));
          }}
        >
          <label className="auth-field">
            <span>Email</span>
            <input className="text-input" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} />
          </label>
          <button className="auth-primary-button" disabled={isSubmitting} type="submit">
            <Mail size={16} />
            <span>{isSubmitting ? "Sending..." : "Send recovery email"}</span>
          </button>
        </form>
        {status ? <p className="auth-status">{status}</p> : null}
        <Link className="auth-back-link" to="/login">Back to sign in</Link>
      </section>
    </div>
  );
};
