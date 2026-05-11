import { useTranslation } from "react-i18next";

import { useToast } from "@app/providers/ToastProvider";
import { useUserSetting } from "@shared/hooks/useUserSetting";
import { getUserFacingErrorMessage } from "@shared/lib/errors";
import { userSettingKeys } from "@shared/lib/userSettings";

const PRESET_VALUES: ReadonlyArray<number> = [0, 5, 15, 30, 60];

/**
 * Auto sign-out picker. Renders just the `<select>` — the surrounding
 * label, helper text and section layout live in `GeneralSettingsCard`.
 */
export const AutoLogoutSetting = () => {
  const { t } = useTranslation();
  const toast = useToast();
  const [storedValue, setStoredValue] = useUserSetting(userSettingKeys.autoLogoutInactivityMinutes);

  const selected =
    typeof storedValue === "number" && Number.isFinite(storedValue) && storedValue > 0
      ? Math.floor(storedValue)
      : 0;

  const labelFor = (value: number): string => {
    if (value === 0) return t("settings.general.autoLogout.off");
    if (value === 60) return t("settings.general.autoLogout.hour");
    return t("settings.general.autoLogout.minutes", { count: value });
  };

  const handleChange = async (next: number) => {
    try {
      await setStoredValue(next);
    } catch (error) {
      toast.error(
        "Could not save",
        getUserFacingErrorMessage(error, "Try again in a moment."),
      );
    }
  };

  return (
    <select
      className="field-input"
      onChange={(event) => void handleChange(Number(event.target.value))}
      value={selected}
      aria-label={t("settings.general.autoLogout.label")}
    >
      {PRESET_VALUES.map((value) => (
        <option key={value} value={value}>
          {labelFor(value)}
        </option>
      ))}
    </select>
  );
};
