import type { ReactNode } from "react";

import { CompareTrayProvider } from "./CompareTrayContext";
import { ShellContextProvider } from "./ShellContext";

type AppProvidersProps = {
  children: ReactNode;
};

export const AppProviders = ({ children }: AppProvidersProps) => (
  <ShellContextProvider>
    <CompareTrayProvider>{children}</CompareTrayProvider>
  </ShellContextProvider>
);
