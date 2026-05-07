import { Github, Mail } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { useSession } from "@app/providers/SessionProvider";
import brandLogoWhite1x from "@shared/assets/inbox/logos/bukowskiOS_logo_white.png";
import brandLogoWhite from "@shared/assets/logos/bukowskiOS_logo_white@2x.png";
import { getUserFacingErrorMessage } from "@shared/lib/errors";

type OAuthProvider = "google" | "github";

const providerLabel = (provider: OAuthProvider) => (provider === "google" ? "Google" : "GitHub");

export const LoginScreen = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { authError, isLocalFallback, requestFirstLoginLink, signInWithMagicLink, signInWithOAuth, signInWithPassword } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberLogin, setRememberLogin] = useState(true);
  const [status, setStatus] = useState<string | null>(isLocalFallback ? "Local dev session is active." : null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingOAuthProvider, setPendingOAuthProvider] = useState<OAuthProvider | null>(null);

  const from = typeof location.state === "object" && location.state && "from" in location.state ? String(location.state.from) : "/";

  const runAuthAction = async (action: () => Promise<void>, successMessage?: string) => {
    setPendingOAuthProvider(null);
    setIsSubmitting(true);
    setStatus(null);

    try {
      await action();
      if (rememberLogin && email.trim()) {
        window.localStorage.setItem("bukowski:last-login-email", email.trim().toLowerCase());
      } else {
        window.localStorage.removeItem("bukowski:last-login-email");
      }
      setStatus(successMessage ?? null);
      if (!successMessage) {
        navigate(from, { replace: true });
      }
    } catch (error) {
      setStatus(getUserFacingErrorMessage(error, "Authentication failed."));
    } finally {
      setIsSubmitting(false);
    }
  };

  const runOAuthAction = async (provider: OAuthProvider) => {
    setPendingOAuthProvider(provider);
    setIsSubmitting(true);
    setStatus(`Opening ${providerLabel(provider)}. Approve access in your browser and bukowskiOS will continue here.`);

    try {
      await signInWithOAuth(provider);
      setStatus(`Waiting for ${providerLabel(provider)} approval. You can return here after approving in the browser.`);
    } catch (error) {
      setPendingOAuthProvider(null);
      setStatus(getUserFacingErrorMessage(error, `${providerLabel(provider)} sign in could not start.`));
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    const savedEmail = window.localStorage.getItem("bukowski:last-login-email");

    if (savedEmail) {
      setEmail(savedEmail);
    }
  }, []);

  return (
    <div className="auth-screen">
      <div className="auth-lockup" aria-hidden="true">
        <img src={brandLogoWhite1x} srcSet={`${brandLogoWhite1x} 1x, ${brandLogoWhite} 2x`} alt="" />
      </div>
      <section className="auth-panel" aria-labelledby="login-title">
        <div className="auth-brand">
          <h1 id="login-title">Welcome back</h1>
        </div>

        <form
          className="auth-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (pendingOAuthProvider) {
              return;
            }
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

          <label className="auth-check-row">
            <input
              checked={rememberLogin}
              onChange={(event) => setRememberLogin(event.target.checked)}
              type="checkbox"
            />
            <span>Keep me signed in on this Mac</span>
          </label>

          <button className="auth-primary-button" disabled={isSubmitting || Boolean(pendingOAuthProvider)} type="submit">
            <span>{isSubmitting ? "Signing in..." : "Sign in"}</span>
          </button>
        </form>

        <div className="auth-divider">or</div>

        <div className="auth-actions">
          <button
            className="auth-secondary-button"
            disabled={isSubmitting || Boolean(pendingOAuthProvider) || !email.trim()}
            onClick={() => void runAuthAction(() => signInWithMagicLink(email), "Magic link sent. Check your email.")}
            type="button"
          >
            <span className="auth-button-content">
              <span className="auth-button-icon">
                <Mail size={16} />
              </span>
              <span>Send magic link</span>
            </span>
          </button>
          <button
            className="auth-secondary-button"
            disabled={isSubmitting || Boolean(pendingOAuthProvider)}
            onClick={() => void runOAuthAction("google")}
            type="button"
          >
            <span className="auth-button-content">
              <span className="auth-button-icon">
                <span className="auth-provider-dot">G</span>
              </span>
              <span>Continue with Google</span>
            </span>
          </button>
          <button
            className="auth-secondary-button"
            disabled={isSubmitting || Boolean(pendingOAuthProvider)}
            onClick={() => void runOAuthAction("github")}
            type="button"
          >
            <span className="auth-button-content">
              <span className="auth-button-icon">
                <Github size={16} />
              </span>
              <span>Continue with GitHub</span>
            </span>
          </button>
        </div>

        <div className="auth-first-login">
          <div>
            <p>First time here?</p>
            <span>Enter your email and get a secure link to create your password.</span>
          </div>
          <button
            disabled={isSubmitting || Boolean(pendingOAuthProvider) || !email.trim()}
            onClick={() => void runAuthAction(() => requestFirstLoginLink(email), "Setup link sent. Open it to create your password.")}
            type="button"
          >
            Set up password
          </button>
        </div>

        {pendingOAuthProvider ? (
          <div className="auth-oauth-waiting" role="status" aria-live="polite">
            <div className="auth-oauth-spinner" aria-hidden="true" />
            <div>
              <p>Waiting for {providerLabel(pendingOAuthProvider)}</p>
              <span>Approve access in your browser. This window will continue automatically when the secure callback returns.</span>
            </div>
            <button
              onClick={() => {
                setPendingOAuthProvider(null);
                setStatus(null);
              }}
              type="button"
            >
              Use another method
            </button>
          </div>
        ) : null}

        {status || authError ? <p className="auth-status">{status ?? authError}</p> : null}
      </section>
    </div>
  );
};
