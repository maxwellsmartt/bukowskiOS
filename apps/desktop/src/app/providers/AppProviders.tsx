import type { ReactNode } from "react";

import { AssistantChatProvider } from "./AssistantChatContext";
import { CompareTrayProvider } from "./CompareTrayContext";
import { SessionProvider } from "./SessionProvider";
import { ShellContextProvider } from "./ShellContext";
import { WorkspaceProvider } from "./WorkspaceProvider";

type AppProvidersProps = {
  children: ReactNode;
};

export const AppProviders = ({ children }: AppProvidersProps) => (
  <SessionProvider>
    <WorkspaceProvider>
      <ShellContextProvider>
        <CompareTrayProvider>
          <AssistantChatProvider>{children}</AssistantChatProvider>
        </CompareTrayProvider>
      </ShellContextProvider>
    </WorkspaceProvider>
  </SessionProvider>
);
