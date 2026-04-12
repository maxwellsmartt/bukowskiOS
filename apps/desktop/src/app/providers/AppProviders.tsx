import type { ReactNode } from "react";

import { AssistantChatProvider } from "./AssistantChatContext";
import { CompareTrayProvider } from "./CompareTrayContext";
import { ShellContextProvider } from "./ShellContext";

type AppProvidersProps = {
  children: ReactNode;
};

export const AppProviders = ({ children }: AppProvidersProps) => (
  <ShellContextProvider>
    <CompareTrayProvider>
      <AssistantChatProvider>{children}</AssistantChatProvider>
    </CompareTrayProvider>
  </ShellContextProvider>
);
