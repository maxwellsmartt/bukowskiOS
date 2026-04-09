import type { ReactNode } from "react";

import { ShellContextProvider } from "./ShellContext";

type AppProvidersProps = {
  children: ReactNode;
};

export const AppProviders = ({ children }: AppProvidersProps) => (
  <ShellContextProvider>{children}</ShellContextProvider>
);
