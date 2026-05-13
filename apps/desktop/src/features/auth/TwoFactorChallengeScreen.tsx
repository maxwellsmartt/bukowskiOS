import { ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

export const TwoFactorChallengeScreen = () => {
  const { t } = useTranslation();

  return (
    <div className="auth-screen">
      <section className="auth-panel" aria-labelledby="mfa-title">
        <p className="auth-eyebrow">{t("auth.mfa.eyebrow")}</p>
        <h1 id="mfa-title">{t("auth.mfa.title")}</h1>
        <div className="auth-placeholder">
          <ShieldCheck size={20} />
          <p>{t("auth.mfa.placeholder")}</p>
        </div>
        <Link className="auth-back-link" to="/login">{t("auth.backToSignIn")}</Link>
      </section>
    </div>
  );
};
