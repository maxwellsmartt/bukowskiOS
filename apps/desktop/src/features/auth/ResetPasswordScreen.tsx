import { KeyRound } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { useSession } from "@app/providers/SessionProvider";
import brandLogoWhite1x from "@shared/assets/inbox/logos/bukowskiOS_logo_white.png";
import brandLogoWhite from "@shared/assets/logos/bukowskiOS_logo_white@2x.png";
import { PasswordRequirementList } from "@shared/components/PasswordRequirementList";
import { getUserFacingErrorMessage } from "@shared/lib/errors";
import { isPasswordPolicySatisfied } from "@shared/lib/passwordPolicy";

export const ResetPasswordScreen = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { authError, isPasswordRecovery, updatePassword } = useSession();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const passwordsMatch = confirmPassword.length > 0 && password === confirmPassword;
  const passwordMeetsPolicy = isPasswordPolicySatisfied(password);
  const isFirstLogin = searchParams.get("mode") === "first-login";

  return (
    <div className="auth-screen">
      <div className="auth-lockup" aria-hidden="true">
        <img src={brandLogoWhite1x} srcSet={`${brandLogoWhite1x} 1x, ${brandLogoWhite} 2x`} alt="" />
      </div>
      <section className="auth-panel" aria-labelledby="reset-password-title">
        <p className="auth-eyebrow">{isFirstLogin ? t("auth.reset.firstLoginEyebrow") : t("auth.reset.eyebrow")}</p>
        <h1 id="reset-password-title">{isFirstLogin ? t("auth.reset.firstLoginTitle") : t("auth.reset.title")}</h1>
        <p className="auth-lede">
          {isFirstLogin
            ? t("auth.reset.firstLoginBody")
            : t("auth.reset.body")}
        </p>
        <form
          className="auth-form"
          onSubmit={(event) => {
            event.preventDefault();

            if (!passwordMeetsPolicy) {
              setStatus(t("auth.reset.minLength"));
              return;
            }

            if (password !== confirmPassword) {
              setStatus(t("auth.reset.passwordMismatch"));
              return;
            }

            setIsSubmitting(true);
            setStatus(null);
            void updatePassword(password)
              .then(() => {
                setStatus(t("auth.reset.updated"));
                navigate("/workspaces/select", { replace: true });
              })
              .catch((error: unknown) => {
                setStatus(getUserFacingErrorMessage(error, t("auth.reset.updateFailed")));
              })
              .finally(() => setIsSubmitting(false));
          }}
        >
          {!isPasswordRecovery ? (
            <p className="auth-status">{t("auth.reset.openLinkFirst")}</p>
          ) : null}
          <label className="auth-field">
            <span>{t("auth.reset.newPassword")}</span>
            <input
              autoComplete="new-password"
              className="text-input"
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
          <PasswordRequirementList password={password} />
          <label className="auth-field">
            <span>{t("auth.reset.confirmPassword")}</span>
            <input
              autoComplete="new-password"
              className="text-input"
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
              type="password"
              value={confirmPassword}
            />
          </label>
          <button className="auth-primary-button" disabled={isSubmitting || !passwordsMatch || !passwordMeetsPolicy || !isPasswordRecovery} type="submit">
            <KeyRound size={16} />
            <span>{isSubmitting ? t("auth.reset.updating") : t("auth.reset.updatePassword")}</span>
          </button>
        </form>
        {status || authError ? <p className="auth-status">{status ?? authError}</p> : null}
        <Link className="auth-back-link" to="/login">{t("auth.backToSignIn")}</Link>
      </section>
    </div>
  );
};
