import { DependencyList, useEffect, useState } from "react";

type AsyncValueState<T> = {
  data: T;
  error: string | null;
  isLoading: boolean;
};

export const useAsyncValue = <T>(
  load: () => Promise<T>,
  initialValue: T,
  deps: DependencyList,
): AsyncValueState<T> => {
  const [state, setState] = useState<AsyncValueState<T>>({
    data: initialValue,
    error: null,
    isLoading: true,
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
          });
        }
      })
      .catch((error: unknown) => {
        if (!isCancelled) {
          setState({
            data: initialValue,
            error: error instanceof Error ? error.message : "Unknown loading error",
            isLoading: false,
          });
        }
      });

    return () => {
      isCancelled = true;
    };
  }, deps);

  return state;
};
