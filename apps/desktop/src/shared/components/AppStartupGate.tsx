import brandLogoWhite1x from "@shared/assets/inbox/logos/bukowskiOS_logo_white.png";
import brandLogoWhite from "@shared/assets/logos/bukowskiOS_logo_white@2x.png";
import { createPortal } from "react-dom";

type AppStartupGateProps = {
  message?: string;
  detail?: string;
};

export const AppStartupGate = ({ detail = "Almost ready..." }: AppStartupGateProps) =>
  createPortal(
    <div className="app-startup-gate" role="status" aria-live="polite">
      <div className="app-startup-gate-core">
        <img
          className="app-startup-logo-img"
          src={brandLogoWhite1x}
          srcSet={`${brandLogoWhite1x} 1x, ${brandLogoWhite} 2x`}
          alt="bukowskiOS"
        />
        <span>{detail}</span>
        <div className="app-startup-progress" aria-hidden="true">
          <span />
        </div>
      </div>
    </div>,
    document.body,
  );

export default AppStartupGate;
