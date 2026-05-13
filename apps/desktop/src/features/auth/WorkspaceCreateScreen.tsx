import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";

import { useSession } from "@app/providers/SessionProvider";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { getUserFacingErrorMessage } from "@shared/lib/errors";

const slugifyWorkspaceName = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 42);

export const WorkspaceCreateScreen = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isLocalFallback } = useSession();
  const { createWorkspace, isCreatingWorkspace, workspaceError } = useWorkspace();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [baseCurrency, setBaseCurrency] = useState("USD");
  const [iconColor, setIconColor] = useState("#668fff");
  const [status, setStatus] = useState<string | null>(null);

  const syncSlugFromName = (value: string) => {
    setName(value);
    setSlug((currentSlug) => (currentSlug ? currentSlug : slugifyWorkspaceName(value)));
  };

  return (
    <div className="auth-screen">
      <section className="auth-panel" aria-labelledby="workspace-create-title">
        <p className="auth-eyebrow">{t("auth.workspaceCreate.eyebrow")}</p>
        <h1 id="workspace-create-title">{t("auth.workspaceCreate.title")}</h1>

        {isLocalFallback ? (
          <div className="auth-placeholder">
            <Plus size={20} />
            <p>{t("auth.workspaceCreate.supabaseMissing")}</p>
          </div>
        ) : null}

        <form
          className="auth-form"
          onSubmit={(event) => {
            event.preventDefault();
            setStatus(null);
            void createWorkspace({
              name,
              slug,
              baseCurrency,
              iconColor,
            })
              .then(() => navigate("/workspaces/select", { replace: true }))
              .catch((error: unknown) => setStatus(getUserFacingErrorMessage(error, t("auth.workspaceCreate.failed"))));
          }}
        >
          <label className="auth-field">
            <span>{t("auth.workspaceCreate.name")}</span>
            <input
              className="text-input"
              disabled={isCreatingWorkspace || isLocalFallback}
              onChange={(event) => syncSlugFromName(event.target.value)}
              required
              value={name}
            />
          </label>
          <label className="auth-field">
            <span>{t("auth.workspaceCreate.slug")}</span>
            <input
              className="text-input"
              disabled={isCreatingWorkspace || isLocalFallback}
              onChange={(event) => setSlug(slugifyWorkspaceName(event.target.value))}
              required
              value={slug}
            />
          </label>
          <label className="auth-field">
            <span>{t("auth.workspaceCreate.currency")}</span>
            <input
              className="text-input"
              disabled={isCreatingWorkspace || isLocalFallback}
              maxLength={3}
              onChange={(event) => setBaseCurrency(event.target.value.toUpperCase())}
              required
              value={baseCurrency}
            />
          </label>
          <label className="auth-field">
            <span>{t("auth.workspaceCreate.color")}</span>
            <input
              className="text-input"
              disabled={isCreatingWorkspace || isLocalFallback}
              onChange={(event) => setIconColor(event.target.value)}
              type="color"
              value={iconColor}
            />
          </label>
          <button className="auth-primary-button" disabled={isCreatingWorkspace || isLocalFallback} type="submit">
            <Plus size={16} />
            <span>{isCreatingWorkspace ? t("auth.workspaceCreate.creating") : t("auth.workspaceCreate.create")}</span>
          </button>
        </form>

        {status || workspaceError ? <p className="auth-status">{status ?? workspaceError}</p> : null}
        <Link className="auth-back-link" to="/workspaces/select">{t("auth.workspaceCreate.backToWorkspaces")}</Link>
      </section>
    </div>
  );
};
