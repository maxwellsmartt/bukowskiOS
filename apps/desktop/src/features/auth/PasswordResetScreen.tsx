import { Mail } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { useSession } from "@app/providers/SessionProvider";

export const PasswordResetScreen = () => {
  const { signInWithMagicLink } = useSession();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  return (
    <div className="auth-screen">
      <section className="auth-panel" aria-labelledby="recovery-title">
        <p className="auth-eyebrow">Account recovery</p>
        <h1 id="recovery-title">Recover access</h1>
        <form
          className="auth-form"
          onSubmit={(event) => {
            event.preventDefault();
            void signInWithMagicLink(email)
              .then(() => setStatus("Recovery link sent. Check your email."))
              .catch((error: unknown) => setStatus(error instanceof Error ? error.message : "Could not send recovery link."));
          }}
        >
          <label className="auth-field">
            <span>Email</span>
            <input className="text-input" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} />
          </label>
          <button className="auth-primary-button" type="submit">
            <Mail size={16} />
            <span>Send recovery link</span>
          </button>
        </form>
        {status ? <p className="auth-status">{status}</p> : null}
        <Link className="auth-back-link" to="/login">Back to sign in</Link>
      </section>
    </div>
  );
};
