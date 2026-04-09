import { AppProviders } from "@app/providers/AppProviders";
import { AppShell } from "@app/shell/AppShell";

export const App = () => (
  <AppProviders>
    <AppShell />
  </AppProviders>
);
