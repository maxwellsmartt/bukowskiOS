import { Plus } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

export const WorkspaceCreateScreen = () => {
  const [status, setStatus] = useState<string | null>(null);

  return (
    <div className="auth-screen">
      <section className="auth-panel" aria-labelledby="workspace-create-title">
        <p className="auth-eyebrow">Workspace setup</p>
        <h1 id="workspace-create-title">Create workspace</h1>
        <div className="auth-placeholder">
          <Plus size={20} />
          <p>Workspace creation will call the secure `admin-workspace-bootstrap` Edge Function after Supabase dev is connected.</p>
        </div>
        <button className="auth-secondary-button" onClick={() => setStatus("Pending Supabase dev environment validation.")} type="button">
          <span>Check setup status</span>
        </button>
        {status ? <p className="auth-status">{status}</p> : null}
        <Link className="auth-back-link" to="/workspaces/select">Back to workspaces</Link>
      </section>
    </div>
  );
};
