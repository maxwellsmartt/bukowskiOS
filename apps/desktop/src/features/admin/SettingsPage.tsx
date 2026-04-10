import { SectionHeader } from "@shared/components/SectionHeader";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { useSectionScopeLabel } from "@shared/hooks/useSectionScopeLabel";

export const SettingsPage = () => {
  const sectionScopeLabel = useSectionScopeLabel();

  return (
    <div className="page-stack">
      <SectionHeader
        eyebrow="Admin / Settings"
        title="Workspace and system settings"
        body="Core configuration for the workspace, permissions model and app behavior."
        contextLabel={sectionScopeLabel}
      />

      <SurfaceCard title="Current scope" subtitle="This area stays compact until roles, permissions and sync controls are fully wired.">
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
            <span className="summary-value">Dark-only</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">Desktop shell</span>
            <span className="summary-value">Electron + typed IPC</span>
          </div>
        </div>
      </SurfaceCard>
    </div>
  );
};
