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
  SUPPORTED_LANGUAGES,
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

  const workspaceCurrency = (activeMembership?.baseCurrency ?? "USD").toUpperCase();
  const effectiveDateMode: DateFormatMode = dateFormatMode ?? "locale";
  const today = useMemo(() => new Date(), []);

  const datePreview = formatDate(today);
  const moneyPreview = formatMoney(1234.56);

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
      </div>
    </SurfaceCard>
  );
};
