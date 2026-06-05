import { Github, Mail } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { REMEMBER_SESSION_KEY, useSession } from "@app/providers/SessionProvider";
import brandLogoWhite1x from "@shared/assets/inbox/logos/bukowskiOS_logo_white.png";
import brandLogoWhite from "@shared/assets/logos/bukowskiOS_logo_white@2x.png";
import { getUserFacingErrorMessage } from "@shared/lib/errors";

type OAuthProvider = "google" | "github";

export const LoginScreen = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { authError, isLocalFallback, requestFirstLoginLink, signInWithMagicLink, signInWithOAuth, signInWithPassword } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberLogin, setRememberLogin] = useState(true);
  const [status, setStatus] = useState<string | null>(isLocalFallback ? t("auth.login.localFallback") : null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingOAuthProvider, setPendingOAuthProvider] = useState<OAuthProvider | null>(null);

  const from = typeof location.state === "object" && location.state && "from" in location.state ? String(location.state.from) : "/";

  // Persist the "Keep me signed in" choice before any sign-in starts, so the
  // session provider honours it the moment auth state changes. Applies to every
  // method (password, magic link, OAuth). "0" = session-only (memory).
  const commitRememberPreference = () => {
    try {
      window.localStorage.setItem(REMEMBER_SESSION_KEY, rememberLogin ? "1" : "0");
    } catch {
      /* storage unavailable — default (remember) applies */
    }
  };

  useEffect(() => {
    commitRememberPreference();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rememberLogin]);

  const runAuthAction = async (action: () => Promise<void>, successMessage?: string) => {
    commitRememberPreference();
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
      setStatus(getUserFacingErrorMessage(error, t("auth.login.errors.authFailed")));
    } finally {
      setIsSubmitting(false);
    }
  };

  const runOAuthAction = async (provider: OAuthProvider) => {
    commitRememberPreference();
    setPendingOAuthProvider(provider);
    setIsSubmitting(true);
    setStatus(t("auth.login.oauthOpening", { provider: t(`auth.providers.${provider}`) }));

    try {
      await signInWithOAuth(provider);
      setStatus(t("auth.login.oauthWaitingStatus", { provider: t(`auth.providers.${provider}`) }));
    } catch (error) {
      setPendingOAuthProvider(null);
      setStatus(getUserFacingErrorMessage(error, t("auth.login.errors.oauthStartFailed", { provider: t(`auth.providers.${provider}`) })));
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
          <h1 id="login-title">{t("auth.login.title")}</h1>
        </div>

        {!pendingOAuthProvider ? (
        <div className="auth-options">
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
            <span>{t("auth.fields.email")}</span>
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
            <span>{t("auth.fields.password")}</span>
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
            <Link to="/login/recovery">{t("auth.login.forgotPassword")}</Link>
            <Link to="/login/mfa">{t("auth.login.use2fa")}</Link>
          </div>

          <label className="auth-check-row">
            <input
              checked={rememberLogin}
              onChange={(event) => setRememberLogin(event.target.checked)}
              type="checkbox"
            />
            <span>{t("auth.login.remember")}</span>
          </label>

          <button className="auth-primary-button" disabled={isSubmitting || Boolean(pendingOAuthProvider)} type="submit">
            <span>{isSubmitting ? t("auth.login.signingIn") : t("auth.login.signIn")}</span>
          </button>
        </form>

        <div className="auth-divider">{t("auth.login.or")}</div>

        <div className="auth-actions">
          <button
            className="auth-secondary-button"
            disabled={isSubmitting || Boolean(pendingOAuthProvider) || !email.trim()}
            onClick={() => void runAuthAction(() => signInWithMagicLink(email), t("auth.login.magicLinkSent"))}
            type="button"
          >
            <span className="auth-button-content">
              <span className="auth-button-icon">
                <Mail size={16} />
              </span>
              <span>{t("auth.login.sendMagicLink")}</span>
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
              <span>{t("auth.login.continueWith", { provider: t("auth.providers.google") })}</span>
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
              <span>{t("auth.login.continueWith", { provider: t("auth.providers.github") })}</span>
            </span>
          </button>
        </div>

        <div className="auth-first-login">
          <div>
            <p>{t("auth.login.firstTimeTitle")}</p>
            <span>{t("auth.login.firstTimeBody")}</span>
          </div>
          <button
            disabled={isSubmitting || Boolean(pendingOAuthProvider) || !email.trim()}
            onClick={() => void runAuthAction(() => requestFirstLoginLink(email), t("auth.login.setupLinkSent"))}
            type="button"
          >
            {t("auth.login.setupPassword")}
          </button>
        </div>
        </div>
        ) : (
          <div className="auth-oauth-waiting" role="status" aria-live="polite">
            <div className="auth-oauth-spinner" aria-hidden="true" />
            <div>
              <p>{t("auth.login.waitingFor", { provider: t(`auth.providers.${pendingOAuthProvider}`) })}</p>
              <span>{t("auth.login.oauthWaitingBody")}</span>
            </div>
            <button
              onClick={() => {
                setPendingOAuthProvider(null);
                setStatus(null);
              }}
              type="button"
            >
              {t("auth.login.useAnotherMethod")}
            </button>
          </div>
        )}

        {status || authError ? <p className="auth-status">{status ?? authError}</p> : null}
      </section>
    </div>
  );
};
