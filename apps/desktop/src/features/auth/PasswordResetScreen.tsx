import { Mail } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { useSession } from "@app/providers/SessionProvider";
import { getUserFacingErrorMessage } from "@shared/lib/errors";

export const PasswordResetScreen = () => {
  const { t } = useTranslation();
  const { requestPasswordReset } = useSession();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  return (
    <div className="auth-screen">
      <section className="auth-panel" aria-labelledby="recovery-title">
        <p className="auth-eyebrow">{t("auth.recovery.eyebrow")}</p>
        <h1 id="recovery-title">{t("auth.recovery.title")}</h1>
        <form
          className="auth-form"
          onSubmit={(event) => {
            event.preventDefault();
            setIsSubmitting(true);
            setStatus(null);
            void requestPasswordReset(email)
              .then(() => setStatus(t("auth.recovery.sent")))
              .catch((error: unknown) => setStatus(getUserFacingErrorMessage(error, t("auth.recovery.sendFailed"))))
              .finally(() => setIsSubmitting(false));
          }}
        >
          <label className="auth-field">
            <span>{t("auth.fields.email")}</span>
            <input className="text-input" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} />
          </label>
          <button className="auth-primary-button" disabled={isSubmitting} type="submit">
            <Mail size={16} />
            <span>{isSubmitting ? t("auth.recovery.sending") : t("auth.recovery.send")}</span>
          </button>
        </form>
        {status ? <p className="auth-status">{status}</p> : null}
        <Link className="auth-back-link" to="/login">{t("auth.backToSignIn")}</Link>
      </section>
    </div>
  );
};
