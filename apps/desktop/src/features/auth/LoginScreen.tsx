import { Github, KeyRound, Mail } from "lucide-react";
import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { useSession } from "@app/providers/SessionProvider";

export const LoginScreen = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { authError, isLocalFallback, signInWithMagicLink, signInWithOAuth, signInWithPassword } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<string | null>(isLocalFallback ? "Local dev session is active." : null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const from = typeof location.state === "object" && location.state && "from" in location.state ? String(location.state.from) : "/";

  const runAuthAction = async (action: () => Promise<void>, successMessage?: string) => {
    setIsSubmitting(true);
    setStatus(null);

    try {
      await action();
      setStatus(successMessage ?? null);
      if (!successMessage) {
        navigate(from, { replace: true });
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Authentication failed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="auth-screen">
      <section className="auth-panel" aria-labelledby="login-title">
        <div className="auth-brand">
          <span className="auth-brand-mark">B</span>
          <div>
            <p className="auth-eyebrow">bukowskiOS</p>
            <h1 id="login-title">Sign in</h1>
          </div>
        </div>

        <form
          className="auth-form"
          onSubmit={(event) => {
            event.preventDefault();
            void runAuthAction(() => signInWithPassword(email, password));
          }}
        >
          <label className="auth-field">
            <span>Email</span>
            <input
              autoComplete="email"
              className="text-input"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </label>
          <label className="auth-field">
            <span>Password</span>
            <input
              autoComplete="current-password"
              className="text-input"
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>

          <div className="auth-row">
            <Link to="/login/recovery">Forgot password?</Link>
            <Link to="/login/mfa">Use 2FA</Link>
          </div>

          <button className="auth-primary-button" disabled={isSubmitting} type="submit">
            <KeyRound size={16} />
            <span>{isSubmitting ? "Signing in..." : "Sign in"}</span>
          </button>
        </form>

        <div className="auth-divider">or</div>

        <div className="auth-actions">
          <button
            className="auth-secondary-button"
            disabled={isSubmitting || !email.trim()}
            onClick={() => void runAuthAction(() => signInWithMagicLink(email), "Magic link sent. Check your email.")}
            type="button"
          >
            <Mail size={16} />
            <span>Send magic link</span>
          </button>
          <button className="auth-secondary-button" disabled={isSubmitting} onClick={() => void runAuthAction(() => signInWithOAuth("google"))} type="button">
            <span className="auth-provider-dot">G</span>
            <span>Continue with Google</span>
          </button>
          <button className="auth-secondary-button" disabled={isSubmitting} onClick={() => void runAuthAction(() => signInWithOAuth("github"))} type="button">
            <Github size={16} />
            <span>Continue with GitHub</span>
          </button>
        </div>

        {status || authError ? <p className="auth-status">{status ?? authError}</p> : null}
      </section>
    </div>
  );
};
