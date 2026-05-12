import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./locales/en.json";
import es from "./locales/es.json";

/**
 * i18next initialization.
 *
 * Two operating modes share this file:
 *
 *   1) Cold start (production / first dev load): we call `init` once
 *      with the resources inline. With no async backend, the promise
 *      resolves on the same tick and `useTranslation` is ready before
 *      React even mounts.
 *
 *   2) Hot module replacement (Vite dev): when one of the JSON catalogs
 *      changes, Vite re-evaluates this module. i18next is a singleton
 *      from the `i18next` package, so it is still `isInitialized` from
 *      the previous run — calling `init` again would be a no-op for the
 *      resources. We *must* push the fresh bundles in via
 *      `addResourceBundle` and emit a `loaded` event so subscribed
 *      components re-render with the new strings. Without this, edits
 *      to en/es JSON show up as raw `setting.foo.bar` keys until you
 *      restart the dev server.
 *
 * Suspense is disabled because we don't wrap the tree in a Suspense
 * boundary; without that, components mounted before init signals ready
 * would render their fallback (the raw key, with `returnNull: false`).
 */

const REACT_OPTIONS = {
  useSuspense: false,
  bindI18n: "languageChanged loaded",
} as const;

const RESOURCES = {
  en: { translation: en as Record<string, unknown> },
  es: { translation: es as Record<string, unknown> },
};

if (!i18n.isInitialized) {
  i18n
    .use(initReactI18next)
    .init({
      resources: RESOURCES,
      lng: "en",
      fallbackLng: "en",
      defaultNS: "translation",
      ns: ["translation"],
      interpolation: { escapeValue: false },
      returnNull: false,
      react: REACT_OPTIONS,
    });
} else {
  // HMR path — refresh in place.
  i18n.addResourceBundle("en", "translation", en, true, true);
  i18n.addResourceBundle("es", "translation", es, true, true);
  // Force subscribed `useTranslation` consumers to re-render with the
  // new strings. `emit("loaded")` is what react-i18next listens for when
  // `bindI18n` includes "loaded".
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (i18n as unknown as { emit: (event: string, payload?: unknown) => void }).emit("loaded", {
    languageChanged: false,
  });
}

// Vite HMR hook: when either JSON catalog changes, the import bindings
// (en/es) above get the new objects but the module body only re-runs if
// we tell Vite to accept the update.
if (import.meta.hot) {
  import.meta.hot.accept(["./locales/en.json", "./locales/es.json"], () => {
    i18n.addResourceBundle("en", "translation", en, true, true);
    i18n.addResourceBundle("es", "translation", es, true, true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (i18n as unknown as { emit: (event: string, payload?: unknown) => void }).emit("loaded", {
      languageChanged: false,
    });
  });
}

export default i18n;
