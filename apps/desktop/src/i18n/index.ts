import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./locales/en.json";
import es from "./locales/es.json";

/**
 * i18next is initialized **synchronously** at module load, before any
 * component tries to render. Two things make that safe:
 *
 *   1) We pass `resources` inline (no async backend), so `init()`
 *      resolves on the same tick.
 *   2) We disable `react-i18next`'s Suspense integration. Otherwise
 *      components mounted before init signals "ready" suspend without
 *      a boundary and render their fallback (which, with `returnNull:
 *      false`, is the raw key — exactly the bug we hit before).
 *
 * Language selection is owned by `UserSettingsProvider` (synced setting
 * + `navigator.language` fallback) and pushed into i18next with
 * `i18n.changeLanguage(...)`. Keeping a single source of truth avoids
 * the classic "two places fighting over the locale" bug.
 */
if (!i18n.isInitialized) {
  i18n
    .use(initReactI18next)
    .init({
      resources: {
        en: { translation: en as Record<string, unknown> },
        es: { translation: es as Record<string, unknown> },
      },
      lng: "en",
      fallbackLng: "en",
      defaultNS: "translation",
      ns: ["translation"],
      interpolation: {
        escapeValue: false, // React already escapes
      },
      returnNull: false,
      react: {
        useSuspense: false,
        bindI18n: "languageChanged loaded",
      },
    });
}

export default i18n;
