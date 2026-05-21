type AppStartupGateProps = {
  message?: string;
  detail?: string;
};

export const AppStartupGate = ({
  message = "Starting bukowskiOS",
  detail = "Almost ready...",
}: AppStartupGateProps) => (
  <div className="app-startup-gate" role="status" aria-live="polite">
    <div className="app-startup-gate-core">
      <div className="app-startup-logo" aria-hidden="true">
        OS
      </div>
      <strong>{message}</strong>
      <span>{detail}</span>
      <div className="app-startup-progress" aria-hidden="true">
        <span />
      </div>
    </div>
  </div>
);

export default AppStartupGate;
