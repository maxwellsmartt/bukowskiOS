import { DependencyList, useEffect, useState } from "react";

import { getUserFacingErrorMessage } from "@shared/lib/errors";

type AsyncValueState<T> = {
  data: T;
  error: string | null;
  isLoading: boolean;
  reload: () => void;
};

export const useAsyncValue = <T>(
  load: () => Promise<T>,
  initialValue: T,
  deps: DependencyList,
): AsyncValueState<T> => {
  const [reloadToken, setReloadToken] = useState(0);
  const [state, setState] = useState<AsyncValueState<T>>({
    data: initialValue,
    error: null,
    isLoading: true,
    reload: () => setReloadToken((current) => current + 1),
  });

  useEffect(() => {
    let isCancelled = false;

    setState((current) => ({
      ...current,
      error: null,
      isLoading: true,
    }));

    load()
      .then((data) => {
        if (!isCancelled) {
          setState({
            data,
            error: null,
            isLoading: false,
            reload: () => setReloadToken((current) => current + 1),
          });
        }
      })
      .catch((error: unknown) => {
        if (!isCancelled) {
          setState({
            data: initialValue,
            error: getUserFacingErrorMessage(error, "Unknown loading error"),
            isLoading: false,
            reload: () => setReloadToken((current) => current + 1),
          });
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [...deps, reloadToken]);

  return state;
};
