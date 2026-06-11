import { useCallback, useMemo } from "react";

import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { useUserSetting } from "@shared/hooks/useUserSetting";
import {
  formatDate as rawFormatDate,
  formatDateTime as rawFormatDateTime,
  formatMoney as rawFormatMoney,
  formatNumber as rawFormatNumber,
  type LocaleContext,
} from "@shared/lib/locale";
import {
  userSettingKeys,
  type DateFormatMode,
  type SupportedLanguage,
} from "@shared/lib/userSettings";

const DEFAULT_LANGUAGE: SupportedLanguage = "es";

/**
 * Unified locale hook. Combines:
 *   - user setting (authoritative when set),
 *   - active workspace's base currency (fallback for `currency`),
 *   - the app's Spanish product default (fallback for `language`).
 *
 * Every component that renders dates, numbers or money should consume
 * this hook — never `toLocaleDateString` directly — so a setting change
 * reformats the whole app on next render.
 */
export const useLocale = () => {
  const { activeMembership } = useWorkspace();
  const [userLanguage] = useUserSetting(userSettingKeys.language);
  const [userDateFormat] = useUserSetting(userSettingKeys.dateFormatMode);
  const [userCurrency] = useUserSetting(userSettingKeys.defaultCurrency);

  const language: SupportedLanguage = userLanguage ?? DEFAULT_LANGUAGE;
  const dateFormatMode: DateFormatMode = userDateFormat ?? "locale";
  const currency: string = (userCurrency ?? activeMembership?.baseCurrency ?? "USD").toUpperCase();

  const ctx: LocaleContext = useMemo(
    () => ({ language, dateFormatMode, currency }),
    [language, dateFormatMode, currency],
  );

  const formatDate = useCallback(
    (value: Date | string | number | null | undefined, options?: Intl.DateTimeFormatOptions) =>
      rawFormatDate(value, ctx, options),
    [ctx],
  );

  const formatDateTime = useCallback(
    (value: Date | string | number | null | undefined, options?: Intl.DateTimeFormatOptions) =>
      rawFormatDateTime(value, ctx, options),
    [ctx],
  );

  const formatNumber = useCallback(
    (value: number | null | undefined, options?: Intl.NumberFormatOptions) =>
      rawFormatNumber(value, ctx, options),
    [ctx],
  );

  const formatMoney = useCallback(
    (
      amount: number | null | undefined,
      overrideCurrency?: string,
      options?: Intl.NumberFormatOptions,
    ) => rawFormatMoney(amount, overrideCurrency ?? ctx.currency, ctx, options),
    [ctx],
  );

  return {
    language,
    dateFormatMode,
    currency,
    formatDate,
    formatDateTime,
    formatNumber,
    formatMoney,
  };
};
