import { useEffect, useState } from "react";

import { useToast } from "@app/providers/ToastProvider";
import { readNumberPreference, uiPreferenceKeys, writePreference } from "@shared/lib/preferences";

const presetMinutes: Array<{ value: number; label: string; helper: string }> = [
  { value: 0, label: "Off", helper: "Stay signed in until you sign out." },
  { value: 5, label: "5 min", helper: "Best for shared computers." },
  { value: 15, label: "15 min", helper: "Balanced for daily work." },
  { value: 30, label: "30 min", helper: "Good for a personal workstation." },
  { value: 60, label: "1 hour", helper: "Fewer interruptions on trusted devices." },
];

export const AutoLogoutSetting = () => {
  const toast = useToast();
  const [selected, setSelected] = useState<number>(() =>
    Math.max(0, Math.floor(readNumberPreference(uiPreferenceKeys.autoLogoutInactivityMinutes, 0))),
  );

  useEffect(() => {
    writePreference(uiPreferenceKeys.autoLogoutInactivityMinutes, String(selected));
  }, [selected]);

  const helper = presetMinutes.find((preset) => preset.value === selected)?.helper ?? "";

  const handleChange = (next: number) => {
    setSelected(next);
    if (next === 0) {
      toast.info("Auto sign-out off", "You'll stay signed in until you sign out manually.");
      return;
    }
    toast.success("Auto sign-out updated", `You'll be signed out after ${next} min of inactivity.`);
  };

  return (
    <div className="auto-logout-setting">
      <label className="compact-filter-field auto-logout-select">
        <span>Timeout</span>
        <select
          className="compact-filter-select"
          onChange={(event) => handleChange(Number(event.target.value))}
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
        Saved on this device. The timer resets when you use the app.
      </p>
    </div>
  );
};
