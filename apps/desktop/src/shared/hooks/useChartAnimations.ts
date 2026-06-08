import { useUserSetting } from "@shared/hooks/useUserSetting";
import { userSettingKeys } from "@shared/lib/userSettings";

/**
 * Whether chart/graph entrance animations should play. Defaults to true when the
 * user has not set a preference. Pass the result to Recharts' `isAnimationActive`.
 */
export const useChartAnimationsEnabled = (): boolean => {
  const [enabled] = useUserSetting(userSettingKeys.chartAnimations);
  return enabled ?? true;
};
