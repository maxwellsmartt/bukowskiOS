import type { ReactNode } from "react";

import { AssistantChatProvider } from "./AssistantChatContext";
import { CompareTrayProvider } from "./CompareTrayContext";
import { NotificationsProvider } from "./NotificationsProvider";
import { SessionProvider } from "./SessionProvider";
import { ShellContextProvider } from "./ShellContext";
import { ToastProvider } from "./ToastProvider";
import { WorkspaceProvider } from "./WorkspaceProvider";

type AppProvidersProps = {
  children: ReactNode;
};

export const AppProviders = ({ children }: AppProvidersProps) => (
  <SessionProvider>
    <WorkspaceProvider>
      <ToastProvider>
        <NotificationsProvider>
          <ShellContextProvider>
            <CompareTrayProvider>
              <AssistantChatProvider>{children}</AssistantChatProvider>
            </CompareTrayProvider>
          </ShellContextProvider>
        </NotificationsProvider>
      </ToastProvider>
    </WorkspaceProvider>
  </SessionProvider>
);
