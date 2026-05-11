import { GeneralSettingsCard } from "./GeneralSettingsCard";
import { SettingsLayout } from "./SettingsLayout";
import { UserAccountSettings } from "./UserAccountSettings";

export const UserAccountSettingsPage = () => (
  <SettingsLayout>
    <div className="page-stack">
      <UserAccountSettings />
      <GeneralSettingsCard />
    </div>
  </SettingsLayout>
);
