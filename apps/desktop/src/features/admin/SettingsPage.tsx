import { SectionHeader } from "@shared/components/SectionHeader";
import { SurfaceCard } from "@shared/components/SurfaceCard";

export const SettingsPage = () => {
  return (
    <div className="page-stack">
      <SectionHeader title="Settings" />

      <SurfaceCard title="Settings">
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
