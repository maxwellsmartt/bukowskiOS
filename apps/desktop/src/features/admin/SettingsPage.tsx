import { SectionHeader } from "@shared/components/SectionHeader";
import { SurfaceCard } from "@shared/components/SurfaceCard";

export const SettingsPage = () => (
  <div className="page-stack">
    <SectionHeader
      eyebrow="Admin / Settings"
      title="Foundation controls for workspace, roles and app behavior"
      body="This section stays intentionally lean for now, but it marks the future home of workspace administration, roles, permissions and app-level preferences."
    />

    <SurfaceCard title="Foundation scope" subtitle="Settings are intentionally sparse in this stage to avoid fake completeness.">
      <div className="summary-grid">
        <div className="summary-row">
          <span className="summary-label">Roles & permissions</span>
          <span className="summary-value">Workspace memberships + role permissions planned</span>
        </div>
        <div className="summary-row">
          <span className="summary-label">Sync profile</span>
          <span className="summary-value">Local-first with cloud backbone</span>
        </div>
        <div className="summary-row">
          <span className="summary-label">Theme</span>
          <span className="summary-value">Dark-only foundation</span>
        </div>
        <div className="summary-row">
          <span className="summary-label">Desktop shell</span>
          <span className="summary-value">Electron + typed IPC</span>
        </div>
      </div>
    </SurfaceCard>
  </div>
);
