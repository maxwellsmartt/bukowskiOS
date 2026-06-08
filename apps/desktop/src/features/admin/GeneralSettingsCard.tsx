import { useEffect, useMemo, useState } from "react";
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

const NOTIFICATION_GROUPS = [
  { key: "operations", categories: ["invoiceInbox", "exchangeRates", "appUpdates"] },
  { key: "agents", categories: ["agentsDone", "agentsApproval"] },
  { key: "workspace", categories: ["projects", "todosReminders"] },
] as const;

type SwitchControlProps = {
  checked: boolean;
  disabled?: boolean;
  label: string;
  description?: string;
  onChange: (checked: boolean) => void;
};

type NativeNotificationState = {
  isSupported: boolean;
  permissionStatus: "unknown" | "unsupported";
};

const SwitchControl = ({ checked, disabled = false, label, description, onChange }: SwitchControlProps) => (
  <label className={`settings-switch-row${disabled ? " is-disabled" : ""}`}>
    <input
      checked={checked}
      disabled={disabled}
      type="checkbox"
      onChange={(event) => onChange(event.target.checked)}
    />
    <span className="settings-switch-track" aria-hidden="true">
      <span className="settings-switch-thumb" />
    </span>
    <span className="settings-switch-copy">
      <strong>{label}</strong>
      {description ? <small>{description}</small> : null}
    </span>
  </label>
);

export const GeneralSettingsCard = () => {
  const { t } = useTranslation();
  const toast = useToast();
  const { activeMembership } = useWorkspace();
  const { formatDate, formatMoney } = useLocale();

  const [language, setLanguage] = useUserSetting(userSettingKeys.language);
  const [dateFormatMode, setDateFormatMode] = useUserSetting(userSettingKeys.dateFormatMode);
  const [defaultCurrency, setDefaultCurrency] = useUserSetting(userSettingKeys.defaultCurrency);
  const [nativeNotifications, setNativeNotifications] = useUserSetting(userSettingKeys.nativeNotifications);
  const [chartAnimations, setChartAnimations] = useUserSetting(userSettingKeys.chartAnimations);
  const chartAnimationsEnabled = chartAnimations ?? true;
  const [nativeState, setNativeState] = useState<NativeNotificationState | null>(null);

  const workspaceCurrency = (activeMembership?.baseCurrency ?? "USD").toUpperCase();
  const effectiveDateMode: DateFormatMode = dateFormatMode ?? "locale";
  const today = useMemo(() => new Date(), []);

  const datePreview = formatDate(today);
  const moneyPreview = formatMoney(1234.56);
  const effectiveNativeNotifications = mergeNativeNotificationPreferences(
    nativeNotifications ?? defaultNativeNotificationPreferences,
  );
  const nativeStatusKey = !nativeState?.isSupported
    ? "unsupported"
    : effectiveNativeNotifications.enabled
      ? "ready"
      : "appDisabled";

  useEffect(() => {
    let cancelled = false;
    void window.bukowskiNotifications?.getForegroundState()
      .then((state) => {
        if (!cancelled) {
          setNativeState({
            isSupported: state.isSupported,
            permissionStatus: state.permissionStatus,
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setNativeState({ isSupported: false, permissionStatus: "unsupported" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
    <>
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

        {/* Chart animations */}
        <div className="general-settings-row">
          <div className="general-settings-row-label">
            <strong>{t("settings.general.chartAnimations.label")}</strong>
            <small>{t("settings.general.chartAnimations.helper")}</small>
          </div>
          <div className="general-settings-row-control general-settings-row-control-toggle">
            <label className="settings-switch-row settings-switch-row-bare">
              <input
                checked={chartAnimationsEnabled}
                onChange={(event) =>
                  void handleSet("chart animations", async () => {
                    await setChartAnimations(event.target.checked);
                  })
                }
                type="checkbox"
              />
              <span className="settings-switch-track" aria-hidden="true">
                <span className="settings-switch-thumb" />
              </span>
            </label>
          </div>
        </div>

        </div>
      </SurfaceCard>

      <SurfaceCard
        className="notification-settings-card"
        title={t("settings.general.notifications.label")}
        subtitle={t("settings.general.notifications.helper")}
      >
        <div className="notification-settings-layout">
          <div className="notification-settings-master">
            <SwitchControl
              checked={effectiveNativeNotifications.enabled}
              label={t("settings.general.notifications.nativeEnabled")}
              description={t("settings.general.notifications.nativeEnabledHelper")}
              onChange={(checked) =>
                void handleSet("native notifications", async () => {
                  await setNativeNotifications({
                    ...effectiveNativeNotifications,
                    enabled: checked,
                  });
                })
              }
            />
            <div className={`notification-permission-status is-${nativeStatusKey}`}>
              <span className="notification-permission-dot" aria-hidden="true" />
              <div>
                <strong>{t(`settings.general.notifications.permissionStatus.${nativeStatusKey}.label`)}</strong>
                <small>{t(`settings.general.notifications.permissionStatus.${nativeStatusKey}.helper`)}</small>
              </div>
              <button
                className="ghost-control notification-test-button"
                disabled={!nativeState?.isSupported || !effectiveNativeNotifications.enabled}
                type="button"
                onClick={() =>
                  void window.bukowskiNotifications?.showNative({
                    title: t("settings.general.notifications.test.title"),
                    body: t("settings.general.notifications.test.body"),
                    linkTo: "/settings",
                  }).catch((error) => {
                    toast.error(
                      t("settings.general.notifications.test.failedTitle"),
                      getUserFacingErrorMessage(error, t("settings.general.notifications.test.failedBody")),
                    );
                  })
                }
              >
                {t("settings.general.notifications.test.action")}
              </button>
            </div>
          </div>

          <div className="notification-settings-groups" aria-label={t("settings.general.notifications.categoriesLabel")}>
            {NOTIFICATION_GROUPS.map((group) => (
              <section className="notification-settings-group" key={group.key}>
                <div className="notification-settings-group-header">
                  <strong>{t(`settings.general.notifications.groups.${group.key}.label`)}</strong>
                  <small>{t(`settings.general.notifications.groups.${group.key}.helper`)}</small>
                </div>
                <div className="notification-settings-group-list">
                  {group.categories.map((category) => (
                    <SwitchControl
                      checked={effectiveNativeNotifications.categories[category]}
                      disabled={!effectiveNativeNotifications.enabled}
                      key={category}
                      label={t(`settings.general.notifications.categories.${category}`)}
                      description={t(`settings.general.notifications.categoryHelpers.${category}`)}
                      onChange={(checked) =>
                        void handleSet("native notification category", async () => {
                          await setNativeNotifications({
                            ...effectiveNativeNotifications,
                            categories: {
                              ...effectiveNativeNotifications.categories,
                              [category]: checked,
                            },
                          });
                        })
                      }
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>

          <p className="notification-settings-footnote">
            {t("settings.general.notifications.preview")}
          </p>
        </div>
      </SurfaceCard>
    </>
  );
};
