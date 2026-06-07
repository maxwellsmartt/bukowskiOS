import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { useToast } from "@app/providers/ToastProvider";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { CurrencyPicker } from "@shared/components/CurrencyPicker";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { useLocale } from "@shared/hooks/useLocale";
import { useUserSetting } from "@shared/hooks/useUserSetting";
import { getCurrencyEntry } from "@shared/lib/currencyCatalog";
import { getUserFacingErrorMessage } from "@shared/lib/errors";
import {
  DATE_FORMAT_MODES,
  NOTIFICATION_CATEGORIES,
  SUPPORTED_LANGUAGES,
  defaultNativeNotificationPreferences,
  mergeNativeNotificationPreferences,
  userSettingKeys,
  type DateFormatMode,
  type SupportedLanguage,
} from "@shared/lib/userSettings";

import { AutoLogoutSetting } from "./AutoLogoutSetting";

const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  en: "English",
  es: "Español",
};

export const GeneralSettingsCard = () => {
  const { t } = useTranslation();
  const toast = useToast();
  const { activeMembership } = useWorkspace();
  const { formatDate, formatMoney } = useLocale();

  const [language, setLanguage] = useUserSetting(userSettingKeys.language);
  const [dateFormatMode, setDateFormatMode] = useUserSetting(userSettingKeys.dateFormatMode);
  const [defaultCurrency, setDefaultCurrency] = useUserSetting(userSettingKeys.defaultCurrency);
  const [nativeNotifications, setNativeNotifications] = useUserSetting(userSettingKeys.nativeNotifications);

  const workspaceCurrency = (activeMembership?.baseCurrency ?? "USD").toUpperCase();
  const effectiveDateMode: DateFormatMode = dateFormatMode ?? "locale";
  const today = useMemo(() => new Date(), []);

  const datePreview = formatDate(today);
  const moneyPreview = formatMoney(1234.56);
  const effectiveNativeNotifications = mergeNativeNotificationPreferences(
    nativeNotifications ?? defaultNativeNotificationPreferences,
  );

  const handleSet = async <T,>(label: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (error) {
      toast.error(
        `Could not save ${label}`,
        getUserFacingErrorMessage(error, "Try again in a moment."),
      );
    }
  };

  return (
    <SurfaceCard title={t("settings.general.title")}>
      <div className="general-settings-grid">
        {/* Language */}
        <div className="general-settings-row">
          <div className="general-settings-row-label">
            <strong>{t("settings.general.language.label")}</strong>
            <small>{t("settings.general.language.helper")}</small>
          </div>
          <div className="general-settings-row-control">
            <select
              className="field-input"
              value={language ?? ""}
              onChange={(event) =>
                void handleSet("language", async () => {
                  const next = event.target.value as SupportedLanguage | "";
                  await setLanguage(next === "" ? undefined : next);
                })
              }
            >
              {SUPPORTED_LANGUAGES.map((code) => (
                <option key={code} value={code}>
                  {LANGUAGE_LABELS[code]}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Date format */}
        <div className="general-settings-row">
          <div className="general-settings-row-label">
            <strong>{t("settings.general.dateFormat.label")}</strong>
            <small>{t("settings.general.dateFormat.helper")}</small>
          </div>
          <div className="general-settings-row-control">
            <select
              className="field-input"
              value={effectiveDateMode}
              onChange={(event) =>
                void handleSet("date format", async () => {
                  await setDateFormatMode(event.target.value as DateFormatMode);
                })
              }
            >
              {DATE_FORMAT_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {t(`settings.general.dateFormat.modes.${mode}`)}
                </option>
              ))}
            </select>
            <span className="general-settings-preview">
              {t("settings.general.dateFormat.preview", { value: datePreview })}
            </span>
          </div>
        </div>

        {/* Default currency */}
        <div className="general-settings-row">
          <div className="general-settings-row-label">
            <strong>{t("settings.general.defaultCurrency.label")}</strong>
            <small>
              {t("settings.general.defaultCurrency.helper", {
                workspaceCurrency,
              })}
            </small>
          </div>
          <div className="general-settings-row-control">
            <CurrencyPicker
              value={defaultCurrency ?? null}
              onChange={(next) =>
                void handleSet("default currency", async () => {
                  await setDefaultCurrency(next ?? undefined);
                })
              }
              placeholderLabel={t("settings.general.defaultCurrency.useWorkspace", {
                workspaceCurrency,
              })}
            />
            <span className="general-settings-preview">
              {t("settings.general.defaultCurrency.preview", {
                value: moneyPreview,
              })}
              {defaultCurrency && getCurrencyEntry(defaultCurrency) ? null : null}
            </span>
          </div>
        </div>

        {/* Auto sign-out */}
        <div className="general-settings-row">
          <div className="general-settings-row-label">
            <strong>{t("settings.general.autoLogout.label")}</strong>
            <small>{t("settings.general.autoLogout.helper")}</small>
          </div>
          <div className="general-settings-row-control">
            <AutoLogoutSetting />
          </div>
        </div>

        {/* Native notifications */}
        <div className="general-settings-row general-settings-row-wide">
          <div className="general-settings-row-label">
            <strong>{t("settings.general.notifications.label")}</strong>
            <small>{t("settings.general.notifications.helper")}</small>
          </div>
          <div className="general-settings-row-control">
            <label className="settings-toggle-row">
              <input
                checked={effectiveNativeNotifications.enabled}
                type="checkbox"
                onChange={(event) =>
                  void handleSet("native notifications", async () => {
                    await setNativeNotifications({
                      ...effectiveNativeNotifications,
                      enabled: event.target.checked,
                    });
                  })
                }
              />
              <span>{t("settings.general.notifications.nativeEnabled")}</span>
            </label>
            <div className="notification-settings-grid" aria-label={t("settings.general.notifications.categoriesLabel")}>
              {NOTIFICATION_CATEGORIES.map((category) => (
                <label className="settings-toggle-row" key={category}>
                  <input
                    checked={effectiveNativeNotifications.categories[category]}
                    disabled={!effectiveNativeNotifications.enabled}
                    type="checkbox"
                    onChange={(event) =>
                      void handleSet("native notification category", async () => {
                        await setNativeNotifications({
                          ...effectiveNativeNotifications,
                          categories: {
                            ...effectiveNativeNotifications.categories,
                            [category]: event.target.checked,
                          },
                        });
                      })
                    }
                  />
                  <span>{t(`settings.general.notifications.categories.${category}`)}</span>
                </label>
              ))}
            </div>
            <span className="general-settings-preview">
              {t("settings.general.notifications.preview")}
            </span>
          </div>
        </div>
      </div>
    </SurfaceCard>
  );
};
