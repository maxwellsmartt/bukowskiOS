import { SectionHeader } from "@shared/components/SectionHeader";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { useSectionScopeLabel } from "@shared/hooks/useSectionScopeLabel";

export const SettingsPage = () => {
  const sectionScopeLabel = useSectionScopeLabel();

  return (
    <div className="page-stack">
      <SectionHeader
        eyebrow="Admin / Settings"
        title="Settings"
        body="Workspace configuration and desktop preferences."
        contextLabel={sectionScopeLabel}
      />

      <SurfaceCard title="Workspace settings" subtitle="Permissions, sync controls and app behavior will live here.">
        <div className="summary-grid">
          <div className="summary-row">
            <span className="summary-label">Roles & permissions</span>
            <span className="summary-value">Coming soon</span>
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
            <span className="summary-label">Desktop app</span>
            <span className="summary-value">BukowskiOS desktop</span>
          </div>
        </div>
      </SurfaceCard>
    </div>
  );
};
