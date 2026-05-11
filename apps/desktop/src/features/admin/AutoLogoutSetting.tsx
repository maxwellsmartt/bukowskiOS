import { useToast } from "@app/providers/ToastProvider";
import { useUserSetting } from "@shared/hooks/useUserSetting";
import { getUserFacingErrorMessage } from "@shared/lib/errors";
import { userSettingKeys } from "@shared/lib/userSettings";

const presetMinutes: Array<{ value: number; label: string; helper: string }> = [
  { value: 0, label: "Off", helper: "Stay signed in until you sign out." },
  { value: 5, label: "5 min", helper: "Best for shared computers." },
  { value: 15, label: "15 min", helper: "Balanced for daily work." },
  { value: 30, label: "30 min", helper: "Good for a personal workstation." },
  { value: 60, label: "1 hour", helper: "Fewer interruptions on trusted devices." },
];

const normalize = (value: number | undefined) =>
  Number.isFinite(value) && (value ?? 0) > 0 ? Math.floor(value as number) : 0;

export const AutoLogoutSetting = () => {
  const toast = useToast();
  const [storedValue, setStoredValue] = useUserSetting(userSettingKeys.autoLogoutInactivityMinutes);
  const selected = normalize(storedValue);
  const helper = presetMinutes.find((preset) => preset.value === selected)?.helper ?? "";

  const handleChange = async (next: number) => {
    try {
      await setStoredValue(next);
      if (next === 0) {
        toast.info("Auto sign-out off", "You'll stay signed in until you sign out manually.");
      } else {
        toast.success("Auto sign-out updated", `You'll be signed out after ${next} min of inactivity.`);
      }
    } catch (error) {
      toast.error(
        "Could not save setting",
        getUserFacingErrorMessage(error, "Try again in a moment."),
      );
    }
  };

  return (
    <div className="auto-logout-setting">
      <label className="compact-filter-field auto-logout-select">
        <span>Timeout</span>
        <select
          className="compact-filter-select"
          onChange={(event) => void handleChange(Number(event.target.value))}
          value={selected}
        >
          {presetMinutes.map((preset) => (
            <option key={preset.value} value={preset.value}>
              {preset.label}
            </option>
          ))}
        </select>
      </label>
      <p className="auto-logout-helper">{helper}</p>
      <p className="surface-card-subtitle" style={{ fontSize: "var(--font-2xs)", color: "var(--text-muted)" }}>
        Synced across your devices. The timer resets when you use the app.
      </p>
    </div>
  );
};
