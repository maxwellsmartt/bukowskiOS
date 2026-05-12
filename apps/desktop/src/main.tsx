import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";

// i18n must be imported BEFORE App so that the i18next instance is
// fully initialized (synchronously, with inline resources) before any
// component tries to call `useTranslation`. If you swap these imports
// you'll see raw `settings.nav.general.label`-style keys flashing in
// the UI before the catalogs load.
import "./i18n";
import { App } from "@app/App";
import "@shared/styles/tokens.css";
import "@shared/styles/global.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    console.info("[dev] Renderer hot update applied");
  });
}
