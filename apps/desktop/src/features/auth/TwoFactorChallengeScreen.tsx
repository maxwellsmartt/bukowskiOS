import { ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";

export const TwoFactorChallengeScreen = () => (
  <div className="auth-screen">
    <section className="auth-panel" aria-labelledby="mfa-title">
      <p className="auth-eyebrow">Two-factor authentication</p>
      <h1 id="mfa-title">2FA challenge</h1>
      <div className="auth-placeholder">
        <ShieldCheck size={20} />
        <p>TOTP verification is reserved for the Supabase MFA wiring step in this slice.</p>
      </div>
      <Link className="auth-back-link" to="/login">Back to sign in</Link>
    </section>
  </div>
);
