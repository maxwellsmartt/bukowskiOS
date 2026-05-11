import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";

import { App } from "@app/App";
import "./i18n";
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
