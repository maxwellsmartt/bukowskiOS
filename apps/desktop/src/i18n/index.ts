import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./locales/en.json";
import es from "./locales/es.json";

/**
 * i18next is initialized **once** at module load, before any component
 * tries to render. We do not pull in the language detector here on
 * purpose — language selection is owned by `UserSettingsProvider` (via
 * the synced user setting + `navigator.language` fallback) and pushed
 * into i18next with `i18n.changeLanguage(...)`. Keeping a single source
 * of truth avoids the classic "two places fighting over the locale"
 * bug.
 */
if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources: {
      en: { translation: en },
      es: { translation: es },
    },
    lng: "en",
    fallbackLng: "en",
    interpolation: {
      escapeValue: false, // React already escapes
    },
    returnNull: false,
  });
}

export default i18n;
